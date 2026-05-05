import { ulid } from 'ulid'
import { getCachedInstallationToken, getGithubConfig } from '../github/auth.js'
import { config } from '../config.js'
import type { Task } from '../db/index.js'
import type { Executor, ExecutionResult } from './executor.js'

/**
 * Runs the agent as a child process on the orchestrator host using Bun.spawn.
 *
 * Trade-offs vs DockerExecutor:
 * - No container isolation: the agent runs as the same OS user, with full access to
 *   the host filesystem and network. Intentional for single-user self-hosted setups
 *   where Docker is unavailable or undesired.
 * - No resource limits (memory, PID count, capabilities) — rely on OS defaults.
 * - On orchestrator restart, in-flight processes are orphaned and their tasks are
 *   marked failed (unlike Docker, we cannot re-attach after restart).
 */
export class ChildProcessExecutor implements Executor {
  private executions = new Map<string, ChildExecution>()

  async run(task: Task): Promise<{ executionId: string }> {
    const agentApiKey = config.llmApiKey
    if (!agentApiKey) throw new Error('Missing required env var: LLM_API_KEY')

    const githubConfig = getGithubConfig()
    const token = await getCachedInstallationToken(githubConfig)
    const isCiFix = task.ciFixAttempts > 0

    const baseEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) baseEnv[k] = v
    }

    const env: Record<string, string> = {
      ...baseEnv,
      TASK_ID: task.id,
      TASK_DESCRIPTION: task.description,
      REPO: task.repo,
      BASE_BRANCH: task.baseBranch,
      NEW_BRANCH: task.branch!,
      GITHUB_TOKEN: token,
      LLM_API_KEY: agentApiKey,
      ...(isCiFix ? { CHECKOUT_EXISTING_BRANCH: '1', FORCE_PUSH: '1' } : {}),
    }

    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'packages/agent/src/index.ts'],
      cwd: process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const id = ulid()
    const exec = new ChildExecution(proc)
    this.executions.set(id, exec)

    exec.start().catch((err: unknown) => {
      console.error(`[child-process-executor] driver error for ${id}:`, err)
      exec.forceDone(-1)
    })

    return { executionId: id }
  }

  async *logs(executionId: string): AsyncIterable<string> {
    const exec = this.executions.get(executionId)
    if (!exec) return

    let consumed = 0
    while (true) {
      while (consumed < exec.allLines.length) {
        yield exec.allLines[consumed++]!
      }
      if (exec.done) return
      await exec.notifierPromise
    }
  }

  async wait(executionId: string): Promise<ExecutionResult> {
    const exec = this.executions.get(executionId)
    if (!exec) return { exitCode: -1, stdout: '', stderr: '' }

    while (!exec.done) {
      await exec.notifierPromise
    }

    return {
      exitCode: exec.exitCode ?? -1,
      stdout: exec.stdoutText,
      stderr: exec.stderrText,
    }
  }

  async cleanup(executionId: string): Promise<void> {
    const exec = this.executions.get(executionId)
    if (!exec) return

    exec.forceDone(-1)
    try {
      exec.proc.kill('SIGTERM')
    } catch {
      // best-effort
    }

    this.executions.delete(executionId)
  }
}

class ChildExecution {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly allLines: string[] = []
  stdoutText = ''
  stderrText = ''
  done = false
  exitCode: number | null = null

  private _notifier = makeNotifier()

  get notifierPromise(): Promise<void> {
    return this._notifier.promise
  }

  constructor(proc: ReturnType<typeof Bun.spawn>) {
    this.proc = proc
  }

  private notify(): void {
    const old = this._notifier
    this._notifier = makeNotifier()
    old.resolve()
  }

  forceDone(code: number): void {
    if (this.done) return
    this.done = true
    this.exitCode = code
    this.notify()
  }

  async start(): Promise<void> {
    const [stdout, stderr] = await Promise.all([
      readLines(
        this.proc.stdout as ReadableStream<Uint8Array>,
        (line) => {
          this.allLines.push(line)
          this.notify()
        },
      ),
      readLines(
        this.proc.stderr as ReadableStream<Uint8Array>,
        (line) => {
          this.allLines.push(line)
          this.notify()
        },
      ),
    ])

    this.stdoutText = stdout
    this.stderrText = stderr

    const code = await this.proc.exited
    this.done = true
    this.exitCode = code
    this.notify()
  }
}

type Notifier = { promise: Promise<void>; resolve: () => void }

function makeNotifier(): Notifier {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const fullLines: string[] = []
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      fullLines.push(line)
      onLine(line)
    }
  }
  // Flush remaining (no trailing newline)
  if (buf.length > 0) {
    fullLines.push(buf)
    onLine(buf)
  }

  return fullLines.join('\n')
}
