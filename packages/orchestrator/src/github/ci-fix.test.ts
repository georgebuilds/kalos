import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../config.js', () => ({
  config: { ciFixMaxAttempts: 3 },
}))

const { mockGetTaskByBranch, mockInsertTask, mockUpdateTask } = vi.hoisted(() => ({
  mockGetTaskByBranch: vi.fn((_branch: string) => undefined as any),
  mockInsertTask: vi.fn((_task: any) => {}),
  mockUpdateTask: vi.fn((_id: string, _updates: any) => {}),
}))

vi.mock('../db/index.js', () => ({
  getTaskByBranch: mockGetTaskByBranch,
  insertTask: mockInsertTask,
  updateTask: mockUpdateTask,
  // Stubs for the rest of the db exports so partial mocks don't blow up other paths.
  getTask: () => undefined,
  getPendingTasks: () => [],
  getRunningTasks: () => [],
  getNextPendingTask: () => null,
  getRunningTaskCount: () => 0,
  insertLog: () => {},
  getLogsForTask: () => [],
  getLogsForTaskSince: () => [],
  getLogTailForTask: () => [],
  appendLogs: () => {},
  getSetting: () => null,
  setSetting: () => {},
  isSetupComplete: () => false,
  getRecentTasks: () => [],
  insertPrReview: () => {},
  tryRecordWebhookDelivery: () => true,
  cleanupOldData: () => {},
}))

const { queueCiFixIfEligible } = await import('./ci-fix.js')

const BASE_CHECK_RUN = {
  id: 1,
  name: 'CI / test',
  conclusion: 'failure' as string | null,
  html_url: 'https://github.com/owner/repo/actions/runs/1',
  output: { title: null as string | null, summary: null as string | null, text: null as string | null },
}

const BASE_TASK = {
  id: 'TASK01',
  repo: 'owner/repo',
  baseBranch: 'main',
  description: 'Fix the bug',
  status: 'completed' as const,
  branch: 'kalos/task-TASK01',
  prUrl: null,
  containerId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  completedAt: Date.now(),
  error: null,
  ciFixAttempts: 0,
  parentTaskId: null,
}

beforeEach(() => {
  mockGetTaskByBranch.mockClear()
  mockInsertTask.mockClear()
  mockUpdateTask.mockClear()
})

describe('queueCiFixIfEligible', () => {
  test('bails silently when no task found for branch', async () => {
    mockGetTaskByBranch.mockReturnValue(undefined)
    await queueCiFixIfEligible({ branch: 'kalos/task-NOTFOUND', checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockInsertTask).not.toHaveBeenCalled()
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  test('bails when task is pending', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, status: 'pending' })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockInsertTask).not.toHaveBeenCalled()
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  test('bails when task is running', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, status: 'running' })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockInsertTask).not.toHaveBeenCalled()
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  test('bails when ciFixAttempts >= ciFixMaxAttempts', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, ciFixAttempts: 3 })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockInsertTask).not.toHaveBeenCalled()
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  test('inserts new task with incremented ciFixAttempts', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, ciFixAttempts: 1 })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockInsertTask).toHaveBeenCalledTimes(1)
    const inserted = mockInsertTask.mock.calls[0]![0]
    expect(inserted.ciFixAttempts).toBe(2)
  })

  test('parentTaskId points to root when task has no parent', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, ciFixAttempts: 0, parentTaskId: null })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    const inserted = mockInsertTask.mock.calls[0]![0]
    expect(inserted.parentTaskId).toBe('TASK01')
  })

  test('parentTaskId always points to root when task already has a parent', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK, ciFixAttempts: 1, parentTaskId: 'ROOT01' })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    const inserted = mockInsertTask.mock.calls[0]![0]
    expect(inserted.parentTaskId).toBe('ROOT01')
  })

  test('closes the original task with failed status', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    expect(mockUpdateTask).toHaveBeenCalledTimes(1)
    const [id, updates] = mockUpdateTask.mock.calls[0]!
    expect(id).toBe('TASK01')
    expect(updates.status).toBe('failed')
    expect(typeof updates.error).toBe('string')
  })

  test('new task preserves branch name', async () => {
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: BASE_CHECK_RUN, repo: 'owner/repo' })
    const inserted = mockInsertTask.mock.calls[0]![0]
    expect(inserted.branch).toBe('kalos/task-TASK01')
  })

  test('new task description contains CI failure context', async () => {
    const cr = { ...BASE_CHECK_RUN, output: { title: 'Test failed', summary: 'npm test exited 1', text: null } }
    mockGetTaskByBranch.mockReturnValue({ ...BASE_TASK })
    await queueCiFixIfEligible({ branch: BASE_TASK.branch!, checkRun: cr, repo: 'owner/repo' })
    const inserted = mockInsertTask.mock.calls[0]![0]
    expect(inserted.description).toContain('CI Failure')
    expect(inserted.description).toContain('Test failed')
    expect(inserted.description).toContain('npm test exited 1')
  })
})
