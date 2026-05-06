import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { cloneRepo, createBranch, commitAll, pushBranch, hasChanges } from './git.js'
import { runClaudeCode } from './claude.js'
import { openPullRequest } from './pr.js'
import { installToolchain } from './runtime.js'
import { resolveModelSlug, FALLBACK_MODEL_ID } from '@kalos/shared/models'

// Secrets may be injected via a file (preferred — keeps them out of /proc/PID/environ)
// or via environment variables (fallback for local dev).
const SECRETS_FILE = '/run/secrets/agent.json'

const REQUIRED_ENV = ['TASK_ID', 'TASK_DESCRIPTION', 'REPO', 'BASE_BRANCH', 'NEW_BRANCH'] as const

type Env = { [K in (typeof REQUIRED_ENV)[number]]: string }

function loadEnv(): Env {
  const env: Record<string, string> = {}
  for (const name of REQUIRED_ENV) {
    const value = process.env[name]
    if (!value) {
      console.error(`[agent] Missing required env var: ${name}`)
      process.exit(1)
    }
    env[name] = value
  }
  return env as Env
}

function loadSecrets(): { githubToken: string; anthropicApiKey: string } {
  if (existsSync(SECRETS_FILE)) {
    const raw = readFileSync(SECRETS_FILE, 'utf-8')
    unlinkSync(SECRETS_FILE) // Delete immediately so child processes cannot read it
    const s = JSON.parse(raw) as Record<string, string>
    return {
      githubToken: s.GITHUB_TOKEN ?? '',
      anthropicApiKey: s.ANTHROPIC_API_KEY ?? '',
    }
  }
  // Fallback for local dev: read from env.
  return {
    githubToken: process.env.GITHUB_TOKEN ?? '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  }
}

// Docker executor mounts /workspace; the process executor sets AGENT_WORKSPACE
// to a per-task host directory.
const WORKSPACE = process.env.AGENT_WORKSPACE ?? '/workspace'

const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN']

// Emit a PR_URL= sentinel on SIGTERM so the orchestrator records a meaningful
// failure reason ("timeout" / "cancelled") rather than leaving the field blank.
process.on('SIGTERM', () => {
  console.log('[agent] received SIGTERM — shutting down')
  console.log('PR_URL=')
  process.exit(0)
})

function currentHeadSha(workDir: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`git rev-parse HEAD failed: ${r.stderr?.toString()}`)
  return r.stdout.toString().trim()
}

async function main(): Promise<void> {
  const env = loadEnv()
  const secrets = loadSecrets()

  if (!secrets.githubToken) {
    console.error('[agent] Missing GITHUB_TOKEN')
    process.exit(1)
  }
  if (!secrets.anthropicApiKey) {
    console.error('[agent] Missing ANTHROPIC_API_KEY')
    process.exit(1)
  }

  // Resolve the requested model id against the registry. Default falls back to
  // the registry fallback if the orchestrator didn't pass one (older client).
  const modelId = process.env.KALOS_MODEL_ID ?? FALLBACK_MODEL_ID
  let modelSlug: string
  try {
    modelSlug = resolveModelSlug(modelId)
  } catch (err) {
    console.error(`[agent] ${(err as Error).message}`)
    process.exit(1)
  }

  console.log(`[agent] Task: ${env.TASK_ID}`)
  console.log(`[agent] Repo: ${env.REPO}`)
  console.log(`[agent] Model: ${modelId} (${modelSlug})`)

  const CHECKOUT_EXISTING = process.env.CHECKOUT_EXISTING_BRANCH === '1'
  const FORCE_PUSH = process.env.FORCE_PUSH === '1'

  // Ensure the workspace directory exists (process executor passes a fresh
  // per-task path; in docker /workspace is created by the Dockerfile).
  mkdirSync(WORKSPACE, { recursive: true })

  cloneRepo(env.REPO, secrets.githubToken, WORKSPACE, env.BASE_BRANCH)
  createBranch(env.NEW_BRANCH, env.BASE_BRANCH, WORKSPACE, CHECKOUT_EXISTING)

  // Resolve the project's pinned runtime versions via mise before we hand off
  // to Claude Code, so commands Claude runs (npm test, go test, etc.) see the
  // right node/go/php/etc.
  installToolchain(WORKSPACE)

  // Snapshot HEAD before the run so we can detect whether anything was
  // committed (either by us at the end, or by Claude itself mid-run).
  const baseHead = currentHeadSha(WORKSPACE)

  // Strip orchestrator-side secrets from process.env before invoking claude.
  // claude.ts also re-filters via safeEnv(), but stripping here means even a
  // bug in that filter doesn't leak GITHUB_TOKEN into the Claude subprocess.
  const apiKeyForClaude = secrets.anthropicApiKey
  for (const name of SECRET_ENV_VARS) delete process.env[name]

  const result = await runClaudeCode({
    workspace: WORKSPACE,
    prompt: env.TASK_DESCRIPTION,
    modelSlug,
    apiKey: apiKeyForClaude,
  })

  if (result.exitCode !== 0) {
    console.error(`[agent] Claude Code exited with code ${result.exitCode} (signal=${result.signal})`)
    console.log('PR_URL=')
    process.exit(result.exitCode ?? 1)
  }

  // Commit anything Claude left uncommitted in the working tree.
  if (hasChanges(WORKSPACE)) {
    const summary = env.TASK_DESCRIPTION.slice(0, 60)
    commitAll(`kalos: ${summary}`, WORKSPACE)
  }

  // If neither Claude nor we committed anything, there's no PR to open.
  const finalHead = currentHeadSha(WORKSPACE)
  if (finalHead === baseHead) {
    console.log('[agent] No commits produced — exiting without PR')
    console.log('PR_URL=')
    return
  }

  pushBranch(env.NEW_BRANCH, secrets.githubToken, WORKSPACE, FORCE_PUSH)

  const prUrl = await openPullRequest({
    token: secrets.githubToken,
    repo: env.REPO,
    branch: env.NEW_BRANCH,
    baseBranch: env.BASE_BRANCH,
    taskDescription: env.TASK_DESCRIPTION,
    agentSummary: `Task completed via Claude Code (${modelId}).`,
  })

  console.log(`[agent] PR: ${prUrl}`)
  console.log(`PR_URL=${prUrl}`)
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
