import { createSign } from 'node:crypto'
import * as fs from 'node:fs'
import { Octokit } from '@octokit/rest'
import { config } from '../config.js'

let _pemCache: string | null = null

function readPem(pemPath: string): string {
  if (_pemCache !== null) return _pemCache
  try {
    const mode = fs.statSync(pemPath).mode
    if (mode & 0o077) {
      console.warn(
        `[auth] WARNING: PEM file ${pemPath} has loose permissions (${(mode & 0o777).toString(8)}). Run: chmod 600 ${pemPath}`,
      )
    }
  } catch {
    /* stat is best-effort */
  }
  _pemCache = fs.readFileSync(pemPath, 'utf8')
  return _pemCache
}

const base64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')

export function signAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 540, iss: appId }
  const encodedHeader = base64url(header)
  const encodedPayload = base64url(payload)
  const data = `${encodedHeader}.${encodedPayload}`
  const sign = createSign('RSA-SHA256')
  sign.update(data)
  const sig = sign.sign(privateKeyPem, 'base64url')
  return `${data}.${sig}`
}

export async function getInstallationToken(opts: {
  appId: string
  privateKeyPem: string
  installationId: string
}): Promise<{ token: string; expiresAt: string }> {
  const jwt = signAppJwt(opts.appId, opts.privateKeyPem)
  const octokit = new Octokit({ request: { signal: AbortSignal.timeout(30_000) } })
  const response = await octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    {
      installation_id: parseInt(opts.installationId, 10),
      headers: { authorization: `Bearer ${jwt}` },
    },
  )
  const { token, expires_at } = response.data
  if (!token || !expires_at) {
    throw new Error('GitHub API returned invalid installation token response')
  }
  return { token, expiresAt: expires_at }
}

let cached: { token: string; expiresAt: Date } | null = null
let inFlight: Promise<{ token: string; expiresAt: Date }> | null = null

export async function getCachedInstallationToken(opts: {
  appId: string
  privateKeyPem: string
  installationId: string
}): Promise<string> {
  const now = new Date()
  if (cached && cached.expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return cached.token
  }
  // Single-flight: concurrent callers share one in-flight request instead of
  // each firing their own GitHub API call.
  if (!inFlight) {
    inFlight = getInstallationToken(opts)
      .then(({ token, expiresAt }) => ({ token, expiresAt: new Date(expiresAt) }))
      .finally(() => {
        inFlight = null
      })
  }
  const fresh = await inFlight
  cached = fresh
  return fresh.token
}

export function getGithubConfig(): {
  appId: string
  privateKeyPem: string
  installationId: string
} {
  const appId = config.githubAppId
  const pemPath = config.githubAppPrivateKeyPath
  const pemInline = config.githubAppPrivateKey
  const installationId = config.githubInstallationId

  if (!appId) throw new Error('Missing required env var: GITHUB_APP_ID')
  if (!pemPath && !pemInline)
    throw new Error(
      'Missing required env var: GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY',
    )
  if (!installationId) throw new Error('Missing required env var: GITHUB_INSTALLATION_ID')

  const privateKeyPem = pemPath ? readPem(pemPath) : pemInline!.replace(/\\n/g, '\n')
  return { appId, privateKeyPem, installationId }
}
