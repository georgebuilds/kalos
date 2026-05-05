import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { cloneRepo, createBranch, commitAll, pushBranch, hasChanges } from './git.js'
import { runAgentLoop } from './loop.js'
import { getModel } from './llm/index.js'
import { openPullRequest } from './pr.js'

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

function loadSecrets(): { githubToken: string; llmApiKey: string } {
  if (existsSync(SECRETS_FILE)) {
    const raw = readFileSync(SECRETS_FILE, 'utf-8')
    unlinkSync(SECRETS_FILE) // Delete immediately so child processes cannot read it
    const s = JSON.parse(raw) as Record<string, string>
    return { githubToken: s.GITHUB_TOKEN ?? '', llmApiKey: s.LLM_API_KEY ?? '' }
  }
  // Fallback for local dev: read from env
  return {
    githubToken: process.env.GITHUB_TOKEN ?? '',
    llmApiKey: process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
  }
}

const WORKSPACE = '/workspace'

const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'LLM_API_KEY', 'GITHUB_TOKEN']

// Emit a PR_URL= sentinel on SIGTERM so the orchestrator records a meaningful
// failure reason ("timeout") rather than leaving the field blank.
process.on('SIGTERM', () => {
  console.log('[agent] received SIGTERM — shutting down')
  console.log('PR_URL=')
  process.exit(0)
})

async function main(): Promise<void> {
  const env = loadEnv()
  const secrets = loadSecrets()

  if (!secrets.githubToken) {
    console.error('[agent] Missing GITHUB_TOKEN')
    process.exit(1)
  }
  if (!secrets.llmApiKey) {
    console.error('[agent] Missing LLM_API_KEY')
    process.exit(1)
  }

  // Set LLM key so getModel() can initialise the SDK client (which captures the key
  // in a closure), then delete all secrets from process.env. Setting via JS assignment
  // does NOT appear in /proc/PID/environ (which is frozen at execve time).
  // Full fix for /proc/PID/environ: pass secrets via the file at SECRETS_FILE rather
  // than as container env vars (requires orchestrator-side change in worker.ts).
  process.env.LLM_API_KEY = secrets.llmApiKey
  const model = getModel()
  for (const name of SECRET_ENV_VARS) delete process.env[name]

  console.log(`[agent] Task: ${env.TASK_ID}`)
  console.log(`[agent] Repo: ${env.REPO}`)

  const CHECKOUT_EXISTING = process.env.CHECKOUT_EXISTING_BRANCH === '1'
  const FORCE_PUSH = process.env.FORCE_PUSH === '1'

  cloneRepo(env.REPO, secrets.githubToken, WORKSPACE, env.BASE_BRANCH)
  createBranch(env.NEW_BRANCH, env.BASE_BRANCH, WORKSPACE, CHECKOUT_EXISTING)

  const summary = await runAgentLoop({
    description: env.TASK_DESCRIPTION,
    repo: env.REPO,
    branch: env.NEW_BRANCH,
    model,
  })

  if (hasChanges(WORKSPACE)) {
    commitAll(`kalos: ${summary.slice(0, 60)}`, WORKSPACE)
  } else {
    console.log('[agent] No changes produced — exiting without PR')
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
    agentSummary: summary,
  })

  console.log(`[agent] PR: ${prUrl}`)
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
