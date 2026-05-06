/**
 * End-to-end smoke test for the queue worker. Wires up the real DB (in-memory
 * SQLite), the real worker polling loop, and a stubbed Executor — exercises:
 *
 *   POST /tasks  →  dispatchTask  →  executor.run  →  monitorTask  →  status updates
 *
 * Catches wiring regressions (route → DB → worker → executor → status writeback)
 * without needing real claude / git / github credentials.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Set env BEFORE any orchestrator module loads. WORKER_POLL_INTERVAL_MS keeps
// the polling loop snappy so the test doesn't sit on a 2s tick.
process.env.DATABASE_URL = ':memory:'
process.env.WORKER_POLL_INTERVAL_MS = '15'
process.env.MAX_CONCURRENT_TASKS = '2'

const { stubExecutor } = vi.hoisted(() => {
  type Outcome = {
    exitCode: number
    stdout: string
    stderr: string
    logLines: string[]
  }

  // Mutable per-test outcome — set with stubExecutor.__setNextOutcome().
  let nextOutcome: Outcome = {
    exitCode: 0,
    stdout: 'PR_URL=https://github.com/owner/repo/pull/123',
    stderr: '',
    logLines: ['[stub] starting', '[stub] working', '[stub] PR_URL=https://github.com/owner/repo/pull/123'],
  }

  const stub = {
    run: vi.fn(async (_task: unknown) => ({ executionId: 'exec-1' })),
    logs: async function* () {
      for (const line of nextOutcome.logLines) {
        yield line
      }
    },
    wait: vi.fn(async () => ({
      exitCode: nextOutcome.exitCode,
      stdout: nextOutcome.stdout,
      stderr: nextOutcome.stderr,
    })),
    cleanup: vi.fn(async () => {}),
    __setNextOutcome(o: Outcome) {
      nextOutcome = o
    },
  }

  return { stubExecutor: stub }
})

vi.mock('../executors/index.js', () => ({
  createExecutor: () => stubExecutor,
}))

const { insertTask, getTask, setDefaultModelId } = await import('../db/index.js')
const { startWorker, stopWorker, cancelTask, resolveTaskModel } = await import('./worker.js')

beforeEach(() => {
  stubExecutor.run.mockClear()
  stubExecutor.wait.mockClear()
  stubExecutor.cleanup.mockClear()
  setDefaultModelId('sonnet-4.6')
})

afterEach(async () => {
  await stopWorker()
})

async function waitForStatus(id: string, target: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (getTask(id)?.status === target) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`Task ${id} did not reach status=${target} within ${timeoutMs}ms (current=${getTask(id)?.status})`)
}

describe('worker smoke — happy path', () => {
  test('pending task gets dispatched, runs, and lands on completed with prUrl + resolved model', async () => {
    stubExecutor.__setNextOutcome({
      exitCode: 0,
      stdout: 'PR_URL=https://github.com/owner/repo/pull/42',
      stderr: '',
      logLines: ['[stub] PR_URL=https://github.com/owner/repo/pull/42'],
    })

    insertTask({ id: 'smoke-happy', repo: 'owner/repo', baseBranch: 'main', description: 'do thing' })
    startWorker()

    await waitForStatus('smoke-happy', 'completed')

    const final = getTask('smoke-happy')
    expect(final?.status).toBe('completed')
    expect(final?.prUrl).toBe('https://github.com/owner/repo/pull/42')
    // Worker resolved the model from the global default and persisted it.
    expect(final?.modelId).toBe('sonnet-4.6')
    // Executor.run was called with the resolved model on the task.
    const runArg = stubExecutor.run.mock.calls[0]![0] as { modelId: string | null }
    expect(runArg.modelId).toBe('sonnet-4.6')
  })
})

describe('worker smoke — failure path', () => {
  test('non-zero exit lands the task on failed with the log tail as error', async () => {
    stubExecutor.__setNextOutcome({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      logLines: ['[stub] starting', '[stub] kaboom — agent crashed'],
    })

    insertTask({ id: 'smoke-fail', repo: 'owner/repo', baseBranch: 'main', description: 'fail me' })
    startWorker()

    await waitForStatus('smoke-fail', 'failed')
    const final = getTask('smoke-fail')
    expect(final?.status).toBe('failed')
    expect(final?.error ?? '').toContain('kaboom')
  })
})

describe('worker smoke — cancellation', () => {
  test('cancelling a pending task marks it cancelled without dispatching', async () => {
    insertTask({ id: 'smoke-cancel-pending', repo: 'owner/repo', baseBranch: 'main', description: 'pending' })
    // Worker not started → task stays pending. Cancel should mark it cancelled
    // immediately without ever dispatching.
    const ok = await cancelTask('smoke-cancel-pending')
    expect(ok).toBe(true)
    expect(getTask('smoke-cancel-pending')?.status).toBe('cancelled')
    expect(stubExecutor.run).not.toHaveBeenCalled()
  })

  test('cancelling an unknown task returns false', async () => {
    const ok = await cancelTask('does-not-exist')
    expect(ok).toBe(false)
  })

  test('cancelling a completed task returns false', async () => {
    stubExecutor.__setNextOutcome({
      exitCode: 0,
      stdout: 'PR_URL=https://github.com/owner/repo/pull/9',
      stderr: '',
      logLines: [],
    })
    insertTask({ id: 'smoke-cancel-done', repo: 'owner/repo', baseBranch: 'main', description: 'do' })
    startWorker()
    await waitForStatus('smoke-cancel-done', 'completed')
    const ok = await cancelTask('smoke-cancel-done')
    expect(ok).toBe(false)
  })
})

describe('worker smoke — model resolution', () => {
  test('per-task modelId beats global default', () => {
    insertTask({
      id: 'smoke-model',
      repo: 'owner/repo',
      baseBranch: 'main',
      description: 'pick me',
      modelId: 'opus-4.7',
    })
    const t = getTask('smoke-model')!
    expect(resolveTaskModel(t)).toBe('opus-4.7')
  })
})
