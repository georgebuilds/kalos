import { describe, test, expect } from 'vitest'

// Vitest scopes vi.mock() per-file, so we don't need to restore module mocks here.

// Set DATABASE_URL before the module is imported so it uses an in-memory DB.
process.env.DATABASE_URL = ':memory:'

const {
  insertTask,
  getTask,
  updateTask,
  getPendingTasks,
  getRunningTasks,
  getNextPendingTask,
  getRunningTaskCount,
  appendLogs,
  getLogsForTask,
  getLogsForTaskSince,
  getSetting,
  setSetting,
  isSetupComplete,
  getRecentTasks,
  getRecentTasksFiltered,
  getRepoSettings,
  setRepoModelId,
  clearRepoSettings,
  listRepoSettings,
  getDefaultModelId,
  setDefaultModelId,
} = await import('./index.js')

describe('insertTask / getTask', () => {
  test('inserts and retrieves a task with correct fields', () => {
    insertTask({ id: 'db-1', repo: 'owner/repo', baseBranch: 'main', description: 'do stuff' })
    const task = getTask('db-1')
    expect(task).toBeDefined()
    expect(task!.id).toBe('db-1')
    expect(task!.repo).toBe('owner/repo')
    expect(task!.baseBranch).toBe('main')
    expect(task!.description).toBe('do stuff')
    expect(task!.status).toBe('pending')
    expect(task!.branch).toBeNull()
    expect(task!.prUrl).toBeNull()
    expect(task!.containerId).toBeNull()
    expect(task!.error).toBeNull()
    expect(task!.completedAt).toBeNull()
    expect(typeof task!.createdAt).toBe('number')
    expect(typeof task!.updatedAt).toBe('number')
  })

  test('returns undefined for unknown id', () => {
    expect(getTask('nonexistent-id')).toBeUndefined()
  })
})

describe('updateTask', () => {
  test('updates status and branch', () => {
    insertTask({ id: 'db-2', repo: 'owner/repo', baseBranch: 'main', description: 'task 2' })
    updateTask('db-2', { status: 'running', branch: 'kalos/task-db-2' })
    const task = getTask('db-2')
    expect(task!.status).toBe('running')
    expect(task!.branch).toBe('kalos/task-db-2')
  })

  test('updates prUrl and completedAt on completion', () => {
    insertTask({ id: 'db-3', repo: 'owner/repo', baseBranch: 'main', description: 'task 3' })
    const ts = Date.now()
    updateTask('db-3', {
      status: 'completed',
      prUrl: 'https://github.com/owner/repo/pull/1',
      completedAt: ts,
    })
    const task = getTask('db-3')
    expect(task!.status).toBe('completed')
    expect(task!.prUrl).toBe('https://github.com/owner/repo/pull/1')
    expect(task!.completedAt).toBe(ts)
  })

  test('sets error and status on failure', () => {
    insertTask({ id: 'db-4', repo: 'owner/repo', baseBranch: 'main', description: 'task 4' })
    updateTask('db-4', { status: 'failed', error: 'something went wrong' })
    const task = getTask('db-4')
    expect(task!.status).toBe('failed')
    expect(task!.error).toBe('something went wrong')
  })

  test('updates updatedAt on each call', () => {
    insertTask({ id: 'db-5', repo: 'owner/repo', baseBranch: 'main', description: 'task 5' })
    const before = getTask('db-5')!.updatedAt
    updateTask('db-5', { status: 'running' })
    const after = getTask('db-5')!.updatedAt
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('getPendingTasks', () => {
  test('returns all pending tasks', () => {
    const pending = getPendingTasks()
    expect(pending.every((t) => t.status === 'pending')).toBe(true)
    expect(pending.some((t) => t.id === 'db-1')).toBe(true)
  })

  test('does not include running/completed/failed tasks', () => {
    const pending = getPendingTasks()
    expect(pending.some((t) => t.id === 'db-2')).toBe(false)
    expect(pending.some((t) => t.id === 'db-3')).toBe(false)
    expect(pending.some((t) => t.id === 'db-4')).toBe(false)
  })
})

describe('getNextPendingTask', () => {
  test('returns the oldest pending task', () => {
    const next = getNextPendingTask()
    expect(next).toBeDefined()
    expect(next!.status).toBe('pending')
    // db-1 was inserted first among pending
    expect(next!.id).toBe('db-1')
  })
})

describe('getRunningTasks / getRunningTaskCount', () => {
  test('returns running tasks only', () => {
    const running = getRunningTasks()
    expect(running.every((t) => t.status === 'running')).toBe(true)
    expect(running.some((t) => t.id === 'db-2')).toBe(true)
  })

  test('count matches the running task list length', () => {
    expect(getRunningTaskCount()).toBe(getRunningTasks().length)
  })
})

describe('appendLogs / getLogsForTask / getLogsForTaskSince', () => {
  test('splits on newlines and stores each line', () => {
    appendLogs('db-1', 'line one\nline two\nline three')
    const logs = getLogsForTask('db-1')
    expect(logs.length).toBe(3)
    expect(logs[0]!.line).toBe('line one')
    expect(logs[1]!.line).toBe('line two')
    expect(logs[2]!.line).toBe('line three')
    expect(logs.every((l) => l.taskId === 'db-1')).toBe(true)
  })

  test('skips empty lines', () => {
    const before = getLogsForTask('db-1').length
    appendLogs('db-1', '\n\n   \n')
    // Only blank/whitespace lines — none should be inserted
    // (filter is `line.length > 0`, whitespace passes — verify behavior)
    const after = getLogsForTask('db-1')
    // The original code filters `line.length > 0`, so ' ' and '   ' are kept
    // but truly empty lines '' are skipped. Only '\n' splits produce '' entries.
    expect(after.length).toBe(before)
  })

  test('does nothing for fully empty input', () => {
    const before = getLogsForTask('db-1').length
    appendLogs('db-1', '')
    expect(getLogsForTask('db-1').length).toBe(before)
  })

  test('getLogsForTaskSince returns only logs after given id', () => {
    const all = getLogsForTask('db-1')
    expect(all.length).toBeGreaterThan(0)
    const firstId = all[0]!.id
    const since = getLogsForTaskSince('db-1', firstId)
    expect(since.length).toBe(all.length - 1)
    expect(since.every((l) => l.id > firstId)).toBe(true)
  })

  test('getLogsForTaskSince returns all logs when afterId is 0', () => {
    const all = getLogsForTask('db-1')
    const since = getLogsForTaskSince('db-1', 0)
    expect(since.length).toBe(all.length)
  })
})

describe('getSetting / setSetting / isSetupComplete', () => {
  test('getSetting returns null for unknown key', () => {
    expect(getSetting('no_such_key')).toBeNull()
  })

  test('setSetting and getSetting roundtrip', () => {
    setSetting('my_key', 'hello')
    expect(getSetting('my_key')).toBe('hello')
  })

  test('setSetting overwrites existing value', () => {
    setSetting('my_key', 'updated')
    expect(getSetting('my_key')).toBe('updated')
  })

  test('isSetupComplete is false by default', () => {
    expect(isSetupComplete()).toBe(false)
  })

  test('isSetupComplete returns true after setting setup_complete=true', () => {
    setSetting('setup_complete', 'true')
    expect(isSetupComplete()).toBe(true)
  })
})

describe('getRecentTasks', () => {
  test('returns tasks in descending creation order', () => {
    const tasks = getRecentTasks(10)
    for (let i = 1; i < tasks.length; i++) {
      expect(tasks[i - 1]!.createdAt).toBeGreaterThanOrEqual(tasks[i]!.createdAt)
    }
  })

  test('respects the limit parameter', () => {
    expect(getRecentTasks(2).length).toBeLessThanOrEqual(2)
  })

  test('defaults to 20', () => {
    expect(getRecentTasks().length).toBeLessThanOrEqual(20)
  })
})

describe('getRecentTasksFiltered', () => {
  test('null/empty filter falls back to getRecentTasks', () => {
    const all = getRecentTasksFiltered(null, 100)
    expect(all.length).toBe(getRecentTasks(100).length)
    const empty = getRecentTasksFiltered([], 100)
    expect(empty.length).toBe(getRecentTasks(100).length)
  })

  test('single status filter returns only tasks in that status', () => {
    const pending = getRecentTasksFiltered(['pending'], 100)
    expect(pending.every((t) => t.status === 'pending')).toBe(true)
  })

  test('multi status filter returns the union (e.g. "active jobs")', () => {
    const active = getRecentTasksFiltered(['pending', 'running'], 100)
    expect(active.every((t) => t.status === 'pending' || t.status === 'running')).toBe(true)
  })

  test('respects the limit parameter', () => {
    expect(getRecentTasksFiltered(['pending'], 1).length).toBeLessThanOrEqual(1)
  })
})

describe('insertTask with modelId', () => {
  test('roundtrips modelId on the row', () => {
    insertTask({
      id: 'db-model-1',
      repo: 'owner/repo',
      baseBranch: 'main',
      description: 'pick a model',
      modelId: 'opus-4.7',
    })
    expect(getTask('db-model-1')!.modelId).toBe('opus-4.7')
  })

  test('defaults modelId to null when omitted', () => {
    insertTask({
      id: 'db-model-2',
      repo: 'owner/repo',
      baseBranch: 'main',
      description: 'no model',
    })
    expect(getTask('db-model-2')!.modelId).toBeNull()
  })

  test('updateTask can set modelId after insert', () => {
    insertTask({
      id: 'db-model-3',
      repo: 'owner/repo',
      baseBranch: 'main',
      description: 'late binding',
    })
    updateTask('db-model-3', { modelId: 'haiku-4.5' })
    expect(getTask('db-model-3')!.modelId).toBe('haiku-4.5')
  })
})

describe('default model setting', () => {
  test('returns null before set', () => {
    expect(getDefaultModelId()).toBeNull()
  })

  test('roundtrips through setDefaultModelId', () => {
    setDefaultModelId('sonnet-4.6')
    expect(getDefaultModelId()).toBe('sonnet-4.6')
  })

  test('setDefaultModelId overwrites previous value', () => {
    setDefaultModelId('opus-4.7')
    expect(getDefaultModelId()).toBe('opus-4.7')
  })
})

describe('repo settings', () => {
  test('returns null for an unknown repo', () => {
    expect(getRepoSettings('not/known')).toBeNull()
  })

  test('setRepoModelId / getRepoSettings roundtrip', () => {
    setRepoModelId('owner/repo', 'haiku-4.5')
    expect(getRepoSettings('owner/repo')).toEqual({ repo: 'owner/repo', modelId: 'haiku-4.5' })
  })

  test('setRepoModelId(null) keeps the row but clears the override', () => {
    setRepoModelId('owner/repo2', 'opus-4.7')
    setRepoModelId('owner/repo2', null)
    expect(getRepoSettings('owner/repo2')).toEqual({ repo: 'owner/repo2', modelId: null })
  })

  test('clearRepoSettings drops the row', () => {
    setRepoModelId('owner/repo3', 'sonnet-4.6')
    clearRepoSettings('owner/repo3')
    expect(getRepoSettings('owner/repo3')).toBeNull()
  })

  test('listRepoSettings returns all configured repos sorted', () => {
    clearRepoSettings('owner/repo')
    clearRepoSettings('owner/repo2')
    setRepoModelId('zzz/late', 'haiku-4.5')
    setRepoModelId('aaa/early', 'opus-4.7')
    const all = listRepoSettings()
    const repos = all.map((r) => r.repo)
    expect(repos[0]).toBe('aaa/early')
    expect(repos[repos.length - 1]).toBe('zzz/late')
  })
})
