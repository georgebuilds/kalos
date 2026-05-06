import {
  getRunningTaskCount,
  getNextPendingTask,
  updateTask,
  appendLogs,
  getLogTailForTask,
  getTask,
  getRepoSettings,
  getDefaultModelId,
  type Task,
} from '../db/index.js'
import { FALLBACK_MODEL_ID } from '@kalos/shared/models'
import { createExecutor } from '../executors/index.js'
import type { ExecutionResult } from '../executors/executor.js'
import { parsePrUrl, sleep } from './utils.js'
import { config } from '../config.js'

export const executor = createExecutor()

let shuttingDown = false

/**
 * Resolve which model a task should run under. Precedence:
 *
 *   1. task.modelId           — per-task override (POST /tasks { modelId })
 *   2. repo_settings.modelId  — per-repo default (PUT /repos/:o/:r/settings)
 *   3. settings.default_model_id — global default (set by wizard / TUI)
 *   4. FALLBACK_MODEL_ID      — registry fallback so dispatch never throws
 *                                on a fresh install
 */
export function resolveTaskModel(task: Task): string {
  if (task.modelId) return task.modelId
  const repo = getRepoSettings(task.repo)
  if (repo?.modelId) return repo.modelId
  const def = getDefaultModelId()
  if (def) return def
  return FALLBACK_MODEL_ID
}

/**
 * Stream logs to the DB and wait for an execution to complete, then update
 * the task record. Called by dispatchTask for new executions and by
 * reconcileOnStartup for re-attached Docker containers.
 */
export async function monitorTask(task: Task, executionId: string): Promise<void> {
  const logStream = streamLogs(task.id, executionId)

  const timeoutSignal = sleep(config.taskTimeoutMs).then((): null => null)

  const result: ExecutionResult | null = await Promise.race([
    executor.wait(executionId),
    timeoutSignal,
  ])

  if (result === null) {
    // Timed out — cancel the execution then record failure (unless the user
    // already cancelled, in which case keep the cancel status).
    await executor.cleanup(executionId)
    await logStream
    const current = getTask(task.id)
    if (current?.status !== 'cancelled') {
      updateTask(task.id, { status: 'failed', error: 'timeout', completedAt: Date.now() })
    }
    return
  }

  if (shuttingDown) {
    // cleanup was already called by stopWorker.
    await logStream
    updateTask(task.id, {
      status: 'failed',
      error: 'orchestrator shutdown',
      completedAt: Date.now(),
    })
    return
  }

  await logStream

  // If the task was cancelled while running, monitorTask will see exitCode=-1
  // from the cleanup() call. Don't overwrite the cancel status.
  const current = getTask(task.id)
  if (current?.status === 'cancelled') return

  const ts = Date.now()
  if (result.exitCode === 0) {
    const prUrl = parsePrUrl(result.stdout)
    updateTask(task.id, { status: 'completed', prUrl, completedAt: ts })
  } else {
    const tail = getLogTailForTask(task.id, 5)
      .map((l) => l.line)
      .join('\n')
    updateTask(task.id, { status: 'failed', error: tail, completedAt: ts })
  }

}

async function streamLogs(taskId: string, executionId: string): Promise<void> {
  for await (const line of executor.logs(executionId)) {
    appendLogs(taskId, line)
  }
}

async function dispatchTask(task: Task): Promise<void> {
  const branchName = task.branch ?? `kalos/task-${task.id}`
  const resolvedModel = resolveTaskModel(task)

  // Take ownership of the row BEFORE awaiting executor.run. The await can take
  // 10+ seconds in docker mode (image pull / container create), and a cancel
  // request landing in that window would otherwise see status=pending, mark
  // the task cancelled, then have its cancellation silently overwritten by
  // the post-await `status=running` write. Marking running first means cancel
  // sees the truth, sets status=cancelled, and we detect that after the await.
  updateTask(task.id, {
    status: 'running',
    branch: branchName,
    modelId: resolvedModel,
  })

  let executionId: string
  try {
    const result = await executor.run({ ...task, branch: branchName, modelId: resolvedModel })
    executionId = result.executionId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If a cancel landed while we were awaiting executor.run, keep the
    // cancellation status — don't overwrite with 'failed'.
    if (getTask(task.id)?.status !== 'cancelled') {
      updateTask(task.id, {
        status: 'failed',
        error: `dispatch failed: ${msg}`,
        completedAt: Date.now(),
      })
    }
    return
  }

  // Cancel may have fired while executor.run was in-flight. The execution is
  // already running on the host, so we have to tear it down explicitly.
  if (getTask(task.id)?.status === 'cancelled') {
    await executor.cleanup(executionId)
    return
  }

  updateTask(task.id, { containerId: executionId })

  const monitor = monitorTask(task, executionId).catch((err: unknown) => {
    console.error(`[worker] Error watching task ${task.id}:`, err)
  })
  inFlight.set(task.id, { executionId, promise: monitor })
  monitor.finally(() => inFlight.delete(task.id))
}

/**
 * Cancel a pending or running task. Returns true if cancellation took effect,
 * false if the task is unknown or already in a terminal state.
 *
 * Three states the task can be in when cancel arrives:
 *
 *   1. Pending      — mark cancelled in DB; the worker tick will skip it.
 *   2. Running, dispatched but not yet in inFlight (executor.run still
 *      awaiting) — mark cancelled in DB; dispatchTask sees this after the
 *      await and tears down the execution itself.
 *   3. Running, in inFlight — mark cancelled in DB (so monitorTask doesn't
 *      overwrite the status when executor.wait resolves with exitCode=-1),
 *      then ask the executor to tear down the container/process now.
 */
export async function cancelTask(taskId: string): Promise<boolean> {
  const task = getTask(taskId)
  if (!task) return false
  if (task.status !== 'pending' && task.status !== 'running') return false

  updateTask(taskId, { status: 'cancelled', completedAt: Date.now() })

  const entry = inFlight.get(taskId)
  if (entry) {
    await executor.cleanup(entry.executionId)
  }

  return true
}

async function tick(): Promise<void> {
  const running = getRunningTaskCount()

  if (running >= config.maxConcurrentTasks) {
    process.stdout.write(
      `\x1b[2m[worker] tick — running: ${running}/${config.maxConcurrentTasks}, at capacity\x1b[0m\n`,
    )
    return
  }

  const task = getNextPendingTask()
  process.stdout.write(
    `\x1b[2m[worker] tick — running: ${running}/${config.maxConcurrentTasks}, pending: ${task ? 1 : 0}\x1b[0m\n`,
  )

  if (!task) return
  await dispatchTask(task)
}

let polling = false
let intervalId: ReturnType<typeof setInterval> | null = null
const inFlight = new Map<string, { executionId: string; promise: Promise<void> }>()

export function startWorker(): void {
  // Reset the flag in case startWorker is called again after stopWorker (tests
  // do this; production normally only starts once). Without this, tick() bails
  // immediately because shuttingDown stays true after the first stop.
  shuttingDown = false
  console.log('[worker] Polling loop started')
  intervalId = setInterval(async () => {
    if (polling || shuttingDown) return
    polling = true
    try {
      await tick()
    } catch (err) {
      console.error('[worker] tick error:', err)
    } finally {
      polling = false
    }
  }, config.workerPollIntervalMs)
}

export async function stopWorker(): Promise<void> {
  shuttingDown = true
  if (intervalId) clearInterval(intervalId)

  // Signal all in-flight executions to stop.
  await Promise.allSettled(
    [...inFlight.values()].map(({ executionId }) =>
      executor.cleanup(executionId).catch((err: unknown) => {
        console.error('[worker] cleanup error during shutdown:', err)
      }),
    ),
  )

  // Wait for all monitoring promises to settle, with a hard cap.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, config.shutdownTimeoutMs))
  await Promise.race([
    Promise.allSettled([...inFlight.values()].map((e) => e.promise)),
    timeout,
  ])
}
