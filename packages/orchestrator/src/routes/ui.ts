import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Task, getSetting, getRecentTasks, getDefaultModelId } from '../db/index.js'
import { getModel, FALLBACK_MODEL_ID } from '@kalos/shared/models'
import { safeEqual } from '../auth.js'
import { config } from '../config.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const bundleJs = readFileSync(path.join(here, '..', 'ui', 'dashboard.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script')

const SESSION_COOKIE = 'kalos_session'
const SESSION_TTL_SECONDS = 60 * 60 * 12

function renderHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Kalos · καλός</title>
<link rel="icon" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='%23050715'/><text x='50%25' y='54%25' text-anchor='middle' dominant-baseline='middle' font-family='Georgia,serif' font-style='italic' font-size='48' fill='%23d4a24c'>K</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400;1,9..144,600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#050715;color:#efe7d7;font-family:'DM Sans',sans-serif}#app{min-height:100vh}</style>
</head>
<body>
<div id="app"></div>
<script type="module" nonce="${nonce}">${bundleJs}</script>
</body>
</html>`
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

function mask(s: string): string {
  return s.length <= 8 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-4)}`
}

function checkEnv() {
  return [
    { key: 'ANTHROPIC_API_KEY', ok: Boolean(config.anthropicApiKey), detail: config.anthropicApiKey ? mask(config.anthropicApiKey) : 'missing' },
    { key: 'GITHUB_APP_ID', ok: Boolean(config.githubAppId), detail: config.githubAppId ?? 'missing' },
    { key: 'GITHUB_APP_PRIVATE_KEY', ok: Boolean(config.githubAppPrivateKeyPath ?? config.githubAppPrivateKey), detail: config.githubAppPrivateKeyPath ? path.basename(config.githubAppPrivateKeyPath) : config.githubAppPrivateKey ? '(inline)' : 'missing' },
    { key: 'GITHUB_INSTALLATION_ID', ok: Boolean(config.githubInstallationId ?? getSetting('github_installation_id')), detail: config.githubInstallationId ?? getSetting('github_installation_id') ?? 'missing' },
    { key: 'KALOS_API_KEY', ok: Boolean(config.kalosApiKey), detail: config.kalosApiKey ? 'set · auth on' : 'unset · OPEN' },
  ]
}

function computeStats(tasks: Task[]) {
  const now = Date.now()
  const dayMs = 86_400_000
  const tasksToday = tasks.filter((t) => now - t.createdAt < dayMs).length
  const recent = tasks.slice(0, 100)
  const concluded = recent.filter((t) => t.status === 'completed' || t.status === 'failed')
  const successRate = concluded.length === 0 ? null : concluded.filter((t) => t.status === 'completed').length / concluded.length
  const durations = recent.filter((t) => t.completedAt != null).map((t) => (t.completedAt! - t.createdAt) / 1000).filter((s) => s >= 0 && Number.isFinite(s))
  return {
    tasksToday,
    successRate,
    avgDurationSec: durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length,
    activeAgents: tasks.filter((t) => t.status === 'running').length,
    queueDepth: tasks.filter((t) => t.status === 'pending').length,
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch { return '0.0.0' }
}
const VERSION = readVersion()

export const uiRouter = new Hono()

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

// Dashboard auth. The dashboard runs in a browser, which can't set custom
// headers on navigation. The old design accepted the API key via ?key= in the
// URL, which leaked it into proxy logs, browser history, and bookmarks. The
// new flow accepts ?key= once at the root, sets an HttpOnly cookie, and
// redirects to a clean URL — every subsequent request authenticates via the
// cookie, so the raw key never reappears in the URL bar.
function isAuthorized(c: { req: { header: (n: string) => string | undefined; query: (k: string) => string | undefined } }, apiKey: string): boolean {
  const header = c.req.header('X-Api-Key')
  if (header && safeEqual(header, apiKey)) return true
  const cookie = parseCookie(c.req.header('cookie'), SESSION_COOKIE)
  if (cookie && safeEqual(cookie, apiKey)) return true
  return false
}

uiRouter.get('/', (c) => {
  const apiKey = config.kalosApiKey
  if (apiKey) {
    // One-shot ?key= → cookie + redirect to clean URL. Keeps the key out of
    // browser history beyond this single hop.
    const queryKey = c.req.query('key')
    if (queryKey !== undefined) {
      if (!safeEqual(queryKey, apiKey)) return c.text('Unauthorized', 401)
      c.header(
        'Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(queryKey)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`,
      )
      return c.redirect('/', 303)
    }
    if (!isAuthorized(c, apiKey)) return c.text('Unauthorized', 401)
  }

  const nonce = randomBytes(16).toString('base64')
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Content-Security-Policy', buildCsp(nonce))
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Cache-Control', 'no-store')
  return c.body(renderHtml(nonce))
})

// All non-root UI routes (currently /ui/data) require a header or cookie —
// ?key= is intentionally rejected here so a stolen URL can't pull data.
uiRouter.use('/ui/*', async (c, next) => {
  const apiKey = config.kalosApiKey
  if (apiKey && !isAuthorized(c, apiKey)) return c.text('Unauthorized', 401)
  await next()
})

uiRouter.get('/ui/data', (c) => {
  const tasks = getRecentTasks(100)
  c.header('Cache-Control', 'no-store')
  return c.json({
    tasks: tasks.slice(0, 50).map((t) => ({
      id: t.id,
      repo: t.repo,
      description: t.description,
      status: t.status,
      branch: t.branch,
      prUrl: t.prUrl,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      error: t.error,
    })),
    env: checkEnv(),
    stats: computeStats(tasks),
    version: VERSION,
    defaultModel: (() => {
      const id = getDefaultModelId() ?? FALLBACK_MODEL_ID
      const m = getModel(id)
      return m ? { id: m.id, label: m.label } : { id, label: id }
    })(),
    now: new Date().toISOString(),
  })
})
