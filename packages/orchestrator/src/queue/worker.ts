import {
  getRunningTaskCount,
  getNextPendingTask,
  updateTask,
  appendLogs,
  getLogTailForTask,
  type Task,
} from '../db/index.js'
import { createExecutor } from '../executors/index.js'
import type { ExecutionResult } from '../executors/executor.js'
import { parsePrUrl, sleep } from './utils.js'
import { config } from '../config.js'

export const executor = createExecutor()

let shuttingDown = false

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
    // Timed out — cancel the execution then record failure.
    await executor.cleanup(executionId)
    await logStream
    updateTask(task.id, { status: 'failed', error: 'timeout', completedAt: Date.now() })
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

  let executionId: string
  try {
    const result = await executor.run({ ...task, branch: branchName })
    executionId = result.executionId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateTask(task.id, {
      status: 'failed',
      error: `dispatch failed: ${msg}`,
      completedAt: Date.now(),
    })
    return
  }

  updateTask(task.id, { status: 'running', branch: branchName, containerId: executionId })

  const monitor = monitorTask(task, executionId).catch((err: unknown) => {
    console.error(`[worker] Error watching task ${task.id}:`, err)
  })
  inFlight.set(task.id, { executionId, promise: monitor })
  monitor.finally(() => inFlight.delete(task.id))
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
