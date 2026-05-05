import { createDockerClient } from '../docker/client.js'
import { getCachedInstallationToken, getGithubConfig } from '../github/auth.js'
import { config } from '../config.js'
import { withRetry, sleep } from '../queue/utils.js'
import type { Task } from '../db/index.js'
import type { Executor, ExecutionResult } from './executor.js'

type DataNotifier = {
  promise: Promise<void>
  resolve: () => void
}

function makeNotifier(): DataNotifier {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type DockerExecution = {
  containerId: string
  aborted: boolean
  allLines: string[]
  stdout: string
  done: boolean
  exitCode: number | null
  notifier: DataNotifier
}

export class DockerExecutor implements Executor {
  private executions = new Map<string, DockerExecution>()

  private getOrCreate(executionId: string): DockerExecution {
    const existing = this.executions.get(executionId)
    if (existing) return existing

    // On-demand registration — used by reconcile to re-attach to existing containers.
    // For DockerExecutor, executionId is the Docker container ID.
    const exec: DockerExecution = {
      containerId: executionId,
      aborted: false,
      allLines: [],
      stdout: '',
      done: false,
      exitCode: null,
      notifier: makeNotifier(),
    }
    this.executions.set(executionId, exec)
    this.drive(exec).catch((err: unknown) => {
      console.error(`[docker-executor] driver error for ${executionId}:`, err)
      if (!exec.done) {
        exec.done = true
        exec.exitCode = -1
        this.notify(exec)
      }
    })
    return exec
  }

  private notify(exec: DockerExecution): void {
    const old = exec.notifier
    exec.notifier = makeNotifier()
    old.resolve()
  }

  private async drive(exec: DockerExecution): Promise<void> {
    const docker = createDockerClient()
    let lastLogFetch = 0

    while (!exec.aborted) {
      const info = await withRetry(() => docker.inspectContainer(exec.containerId))

      if (info.State.Status !== 'running') {
        const finalLogs = await withRetry(() =>
          docker.getContainerLogs(exec.containerId, lastLogFetch),
        )
        try {
          await docker.removeContainer(exec.containerId)
        } catch {
          // best-effort
        }

        const newLines = finalLogs.split('\n').filter((l) => l.trim().length > 0)
        exec.allLines.push(...newLines)
        exec.stdout += finalLogs
        exec.exitCode = info.State.ExitCode
        exec.done = true
        this.notify(exec)
        return
      }

      const fetchAt = Math.floor(Date.now() / 1000)
      const logs = await withRetry(() =>
        docker.getContainerLogs(exec.containerId, lastLogFetch),
      )
      if (logs.trim().length > 0) {
        const newLines = logs.split('\n').filter((l) => l.trim().length > 0)
        exec.allLines.push(...newLines)
        exec.stdout += logs
        this.notify(exec)
      }
      // Advance by 1 to avoid re-fetching logs in the same second (Docker since is inclusive).
      lastLogFetch = fetchAt + 1

      await sleep(2000)
    }
  }

  async run(task: Task): Promise<{ executionId: string }> {
    const agentApiKey = config.llmApiKey
    if (!agentApiKey) throw new Error('Missing required env var: LLM_API_KEY')

    const githubConfig = getGithubConfig()
    const token = await getCachedInstallationToken(githubConfig)
    const isCiFix = task.ciFixAttempts > 0

    const docker = createDockerClient()
    const container = await docker.createContainer({
      image: config.agentImage,
      env: {
        TASK_ID: task.id,
        TASK_DESCRIPTION: task.description,
        REPO: task.repo,
        BASE_BRANCH: task.baseBranch,
        NEW_BRANCH: task.branch!,
        GITHUB_TOKEN: token,
        LLM_API_KEY: agentApiKey,
        // Shared mise cache so node/bun/go/php downloads are reused across tasks.
        MISE_DATA_DIR: '/cache/mise',
        ...(isCiFix ? { CHECKOUT_EXISTING_BRANCH: '1', FORCE_PUSH: '1' } : {}),
      },
      // Named volume — Docker auto-creates on first reference. The image's
      // pre-seeded /cache/mise contents are copied into the volume on its
      // very first mount; subsequent mounts reuse whatever the volume holds.
      binds: [`${config.toolchainVolume}:/cache/mise`],
      memoryBytes: 512 * 1024 * 1024,
      capDrop: ['ALL'],
    })
    await docker.startContainer(container.id)

    const exec: DockerExecution = {
      containerId: container.id,
      aborted: false,
      allLines: [],
      stdout: '',
      done: false,
      exitCode: null,
      notifier: makeNotifier(),
    }
    this.executions.set(container.id, exec)

    this.drive(exec).catch((err: unknown) => {
      console.error(`[docker-executor] driver error for ${container.id}:`, err)
      if (!exec.done) {
        exec.done = true
        exec.exitCode = -1
        this.notify(exec)
      }
    })

    return { executionId: container.id }
  }

  async *logs(executionId: string): AsyncIterable<string> {
    const exec = this.getOrCreate(executionId)
    let consumed = 0

    while (true) {
      while (consumed < exec.allLines.length) {
        yield exec.allLines[consumed++]!
      }
      if (exec.done) return
      await exec.notifier.promise
    }
  }

  async wait(executionId: string): Promise<ExecutionResult> {
    const exec = this.getOrCreate(executionId)

    while (!exec.done) {
      await exec.notifier.promise
    }

    return { exitCode: exec.exitCode ?? -1, stdout: exec.stdout, stderr: '' }
  }

  async cleanup(executionId: string): Promise<void> {
    const exec = this.executions.get(executionId)
    if (!exec) return

    exec.aborted = true
    // Signal waiters immediately so logs() and wait() can return.
    if (!exec.done) {
      exec.done = true
      exec.exitCode = -1
      this.notify(exec)
    }

    const docker = createDockerClient()
    try {
      await docker.stopContainer(exec.containerId)
    } catch {
      // best-effort
    }
    try {
      await docker.removeContainer(exec.containerId)
    } catch {
      // best-effort
    }

    this.executions.delete(executionId)
  }
}
