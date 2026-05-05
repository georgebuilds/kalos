import { getRunningTasks, updateTask } from '../db/index.js'
import { createDockerClient } from '../docker/client.js'
import { lastLines, parsePrUrl, withRetry } from './utils.js'
import { monitorTask } from './worker.js'

export async function reconcileOnStartup(): Promise<void> {
  const running = getRunningTasks()

  if (running.length === 0) {
    console.log('[reconcile] nothing to reconcile')
    return
  }

  const driver = process.env['EXECUTOR'] ?? 'process'

  if (driver !== 'docker') {
    // Child processes don't survive orchestrator restarts — fail all orphans.
    for (const task of running) {
      updateTask(task.id, {
        status: 'failed',
        error: 'orchestrator restarted: process state lost',
        completedAt: Date.now(),
      })
    }
    console.log(`[reconcile] failed ${running.length} orphaned task(s) (process executor)`)
    return
  }

  // Docker executor: containers may still be running — inspect and re-attach.
  const docker = createDockerClient()
  let recovered = 0
  let failed = 0

  for (const task of running) {
    if (!task.containerId) {
      updateTask(task.id, {
        status: 'failed',
        error: 'orphaned: no container id',
        completedAt: Date.now(),
      })
      failed++
      continue
    }

    try {
      const info = await withRetry(() => docker.inspectContainer(task.containerId!))
      const { Status, ExitCode } = info.State

      if (Status === 'running') {
        // Re-attach via the executor's on-demand registration: calling logs/wait
        // on an unknown executionId starts the driver for the existing container.
        monitorTask(task, task.containerId).catch((err: unknown) => {
          console.error(`[reconcile] Error re-attaching task ${task.id}:`, err)
        })
        recovered++
        continue
      }

      if (Status === 'exited' || Status === 'dead') {
        const logs = await withRetry(() => docker.getContainerLogs(task.containerId!))
        await withRetry(() => docker.removeContainer(task.containerId!))
        const ts = Date.now()

        if (ExitCode === 0) {
          const prUrl = parsePrUrl(logs)
          updateTask(task.id, { status: 'completed', prUrl, completedAt: ts })
          recovered++
        } else {
          updateTask(task.id, { status: 'failed', error: lastLines(logs, 5), completedAt: ts })
          failed++
        }
        continue
      }

      // created, paused, restarting, removing — unrecoverable states.
      try {
        await withRetry(() => docker.removeContainer(task.containerId!))
      } catch (cleanupErr) {
        console.error(`[reconcile] cleanup failed for ${task.containerId}:`, cleanupErr)
      }
      updateTask(task.id, {
        status: 'failed',
        error: `unrecoverable container state: ${Status}`,
        completedAt: Date.now(),
      })
      failed++
    } catch {
      updateTask(task.id, {
        status: 'failed',
        error: 'orphaned: container not found',
        completedAt: Date.now(),
      })
      failed++
    }
  }

  console.log(
    `[reconcile] found ${running.length} orphaned tasks — ${recovered} recovered, ${failed} failed`,
  )
}

