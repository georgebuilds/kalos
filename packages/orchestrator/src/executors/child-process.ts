import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

type AgentChildProcess = ChildProcessByStdio<null, Readable, Readable>
import { mkdirSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { getCachedInstallationToken, getGithubConfig } from '../github/auth.js'
import { config } from '../config.js'
import type { Task } from '../db/index.js'
import type { Executor, ExecutionResult } from './executor.js'

/**
 * Runs the agent as a child process on the orchestrator host using node:child_process.spawn.
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
    const agentApiKey = config.anthropicApiKey
    if (!agentApiKey) throw new Error('Missing required env var: ANTHROPIC_API_KEY')

    const githubConfig = getGithubConfig()
    const token = await getCachedInstallationToken(githubConfig)
    const isCiFix = task.ciFixAttempts > 0

    // Per-task workspace lives under config.workspaceRoot. The shared mise
    // data dir lets every task reuse downloaded language runtimes.
    const workspace = join(config.workspaceRoot, task.id)
    mkdirSync(workspace, { recursive: true })
    mkdirSync(config.toolchainDir, { recursive: true })

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
      ANTHROPIC_API_KEY: agentApiKey,
      // Resolved kalos model id; agent maps to Claude Code --model slug.
      ...(task.modelId ? { KALOS_MODEL_ID: task.modelId } : {}),
      AGENT_WORKSPACE: workspace,
      MISE_DATA_DIR: config.toolchainDir,
      ...(isCiFix ? { CHECKOUT_EXISTING_BRANCH: '1', FORCE_PUSH: '1' } : {}),
    }

    const proc = spawn('npx', ['tsx', 'packages/agent/src/index.ts'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const id = ulid()
    const exec = new ChildExecution(proc, workspace)
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

    try {
      rmSync(exec.workspace, { recursive: true, force: true })
    } catch (err) {
      console.warn(`[child-process-executor] failed to remove workspace ${exec.workspace}:`, err)
    }

    this.executions.delete(executionId)
  }
}

class ChildExecution {
  readonly proc: AgentChildProcess
  readonly workspace: string
  readonly allLines: string[] = []
  stdoutText = ''
  stderrText = ''
  done = false
  exitCode: number | null = null

  private _notifier = makeNotifier()

  get notifierPromise(): Promise<void> {
    return this._notifier.promise
  }

  constructor(proc: AgentChildProcess, workspace: string) {
    this.proc = proc
    this.workspace = workspace
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
      readLines(this.proc.stdout, (line) => {
        this.allLines.push(line)
        this.notify()
      }),
      readLines(this.proc.stderr, (line) => {
        this.allLines.push(line)
        this.notify()
      }),
    ])

    this.stdoutText = stdout
    this.stderrText = stderr

    const code = await new Promise<number>((resolve) => {
      if (this.proc.exitCode !== null) {
        resolve(this.proc.exitCode)
        return
      }
      this.proc.once('exit', (exitCode) => resolve(exitCode ?? -1))
    })
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
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): Promise<string> {
  const fullLines: string[] = []
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    fullLines.push(line)
    onLine(line)
  }
  return fullLines.join('\n')
}
