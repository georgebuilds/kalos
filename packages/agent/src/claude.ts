import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * Strip secrets that should never be visible to Claude Code's Bash tool.
 * Claude Code inherits our env by default; we lock it down to just the
 * Anthropic API key + harmless PATH/HOME/etc. so a prompt-injected `env`
 * call can't leak the GitHub token or anything else.
 */
function safeEnv(): Record<string, string> {
  const allow = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TERM',
    'LANG',
    'LC_ALL',
    'TZ',
    'TMPDIR',
    'MISE_DATA_DIR',
    'ANTHROPIC_API_KEY',
  ])
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && allow.has(k)) out[k] = v
  }
  return out
}

export type ClaudeRunResult = {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

/**
 * Run Claude Code in headless mode against `workspace` with `prompt`. Streams
 * stream-json events to our stdout so the orchestrator captures them in the
 * task log. Resolves when claude exits.
 *
 * Caller is responsible for everything around the Claude invocation: cloning
 * the repo, creating the branch (already done before this fires), committing
 * any leftover dirty state, pushing, and opening the PR.
 */
export function runClaudeCode(opts: {
  workspace: string
  prompt: string
  modelSlug: string
  apiKey: string
}): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const env = safeEnv()
    env.ANTHROPIC_API_KEY = opts.apiKey

    const args = [
      '-p',
      opts.prompt,
      '--model',
      opts.modelSlug,
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--verbose',
    ]

    const proc = spawn('claude', args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Pipe stream-json events line-by-line to our stdout. The orchestrator's
    // appendLogs splits on \n, so we want one event per line — readline gives
    // us that even if claude writes partial chunks.
    const stdoutRl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
    stdoutRl.on('line', (line) => {
      process.stdout.write(`[claude] ${line}\n`)
    })

    const stderrRl = createInterface({ input: proc.stderr, crlfDelay: Infinity })
    stderrRl.on('line', (line) => {
      process.stderr.write(`[claude:err] ${line}\n`)
    })

    proc.on('error', reject)
    proc.on('exit', (code, signal) => {
      resolve({ exitCode: code, signal })
    })
  })
}
