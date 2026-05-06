import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { spawnSync } from 'node:child_process'
import { config } from './config.js'
import { tasksRouter } from './routes/tasks.js'
import { webhooksRouter } from './routes/webhooks.js'
import { uiRouter } from './routes/ui.js'
import { modelsRouter } from './routes/models.js'
import { settingsRouter } from './routes/settings.js'
import { reposRouter } from './routes/repos.js'
import { mcpRouter } from './mcp/router.js'
import { reconcileOnStartup } from './queue/reconcile.js'
import { startWorker, stopWorker } from './queue/worker.js'
import { isSetupComplete } from './db/index.js'
import { runWizard } from './wizard/index.js'

if (!isSetupComplete()) {
  await runWizard()
}

// Secure-by-default: refuse to start without KALOS_API_KEY. The wizard always
// generates one for first-run setups; this catches deployments that copy an
// older .env or skip the wizard entirely. Set KALOS_ALLOW_OPEN=true to opt
// back into open auth (intended for trusted localhost dev only).
if (!process.env.KALOS_API_KEY && process.env.KALOS_ALLOW_OPEN !== 'true') {
  console.error(
    '[orchestrator] KALOS_API_KEY is not set. Refusing to start with open auth.\n' +
      '  Either set KALOS_API_KEY=<random-hex> in your .env (the wizard generates one for new installs)\n' +
      '  or set KALOS_ALLOW_OPEN=true to explicitly opt into no-auth (NOT recommended on a public host).',
  )
  process.exit(1)
}

if (process.env.KALOS_ALLOW_OPEN === 'true') {
  console.warn(
    '[orchestrator] KALOS_ALLOW_OPEN=true — REST + MCP are unauthenticated. ' +
      'Anyone who can reach this port can spawn tasks. Localhost dev only.',
  )
}

// Warn loudly at startup if the process executor is selected but mise is
// missing — the agent will fall back to host PATH, which usually means tests
// that depend on a pinned runtime version (.tool-versions, .nvmrc, go.mod,
// composer.json) won't run against the version the project asked for.
if (config.executor === 'process' && !isMiseAvailable()) {
  console.warn(
    '[orchestrator] mise is not on PATH — toolchain pinning is disabled. ' +
      'Tests will run against whatever node/bun/go/php is already installed.',
  )
  console.warn(
    '[orchestrator] Install with: curl https://mise.run | sh   (https://mise.jdx.dev)',
  )
}

try {
  await reconcileOnStartup()
} catch (err) {
  console.error('[orchestrator] reconcile failed (continuing startup):', err)
}

const app = new Hono()

app.route('/', uiRouter)
app.route('/tasks', tasksRouter)
app.route('/models', modelsRouter)
app.route('/settings', settingsRouter)
app.route('/repos', reposRouter)
app.route('/webhooks', webhooksRouter)
app.route('/mcp', mcpRouter)

app.get('/health', (c) => c.json({ ok: true }))

startWorker()

const server = serve({
  fetch: app.fetch,
  port: config.port,
})
console.log(`Kalos running on http://localhost:${config.port}`)

async function shutdown() {
  console.log('[orchestrator] Shutting down…')
  server.close()
  await stopWorker()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

function isMiseAvailable(): boolean {
  const r = spawnSync('mise', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  return !r.error && r.status === 0
}
