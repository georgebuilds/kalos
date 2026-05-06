import { describe, test, expect, vi, beforeEach } from 'vitest'

const { mockInsertTask, mockGetTask, mockGetLogsForTaskSince, mockGetRecentTasks } = vi.hoisted(
  () => ({
    mockInsertTask: vi.fn(() => {}),
    mockGetTask: vi.fn((_id: string) => undefined as any),
    mockGetLogsForTaskSince: vi.fn(() => [] as any[]),
    mockGetRecentTasks: vi.fn(() => [] as any[]),
  }),
)

vi.mock('../db/index.js', () => ({
  insertTask: mockInsertTask,
  getTask: mockGetTask,
  getLogsForTaskSince: mockGetLogsForTaskSince,
  getRecentTasks: mockGetRecentTasks,
  // Stubs for the rest of the db exports.
  getTaskByBranch: () => undefined,
  updateTask: () => {},
  getPendingTasks: () => [],
  getRunningTasks: () => [],
  getNextPendingTask: () => null,
  getRunningTaskCount: () => 0,
  insertLog: () => {},
  getLogsForTask: () => [],
  getLogTailForTask: () => [],
  appendLogs: () => {},
  getSetting: () => null,
  setSetting: () => {},
  isSetupComplete: () => false,
  insertPrReview: () => {},
  tryRecordWebhookDelivery: () => true,
  cleanupOldData: () => {},
}))

const { tasksRouter } = await import('./tasks.js')

function request(path: string, init?: RequestInit) {
  return tasksRouter.request(path, init)
}

beforeEach(() => {
  mockInsertTask.mockClear()
  mockGetTask.mockClear()
  mockGetLogsForTaskSince.mockClear()
  mockGetRecentTasks.mockClear()
  delete process.env.KALOS_API_KEY
})

describe('POST / — validateCreateTask', () => {
  test('returns 400 when body is not JSON object', async () => {
    const res = await request('/', {
      method: 'POST',
      body: '"just a string"',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 when repo is missing', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ description: 'do something' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('repo')
  })

  test('returns 400 when repo is empty string', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: '', description: 'do something' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 when repo is wrong type', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 42, description: 'do something' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 when description is missing', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('description')
  })

  test('returns 400 when description is empty string', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: '' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('returns 201 with id for valid request', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'add tests' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  test('uses main as default baseBranch when not provided', async () => {
    await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const [insertArg] = mockInsertTask.mock.calls[0]! as unknown as [{ baseBranch: string }]
    expect(insertArg.baseBranch).toBe('main')
  })

  test('uses provided baseBranch', async () => {
    await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task', baseBranch: 'develop' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const [insertArg] = mockInsertTask.mock.calls[0]! as unknown as [{ baseBranch: string }]
    expect(insertArg.baseBranch).toBe('develop')
  })

  test('extra fields are ignored (not included in insertTask)', async () => {
    await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task', hacked: 'value' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const [insertArg] = mockInsertTask.mock.calls[0]! as unknown as [Record<string, unknown>]
    expect(insertArg.hacked).toBeUndefined()
  })

  test('returns 400 for repo with .. path traversal', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: '../evil', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for repo missing slash', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'noslash', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('accepts repo with dots and hyphens', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner-name/repo.git', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })
})

describe('API key auth', () => {
  test('returns 401 when KALOS_API_KEY is set and no key provided', async () => {
    process.env.KALOS_API_KEY = 'secret123'
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  test('returns 401 when KALOS_API_KEY is set and wrong key provided', async () => {
    process.env.KALOS_API_KEY = 'secret123'
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task' }),
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'wrong' },
    })
    expect(res.status).toBe(401)
  })

  test('allows request when correct API key is provided', async () => {
    process.env.KALOS_API_KEY = 'secret123'
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task' }),
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'secret123' },
    })
    expect(res.status).toBe(201)
  })

  test('allows request when KALOS_API_KEY is not set', async () => {
    const res = await request('/', {
      method: 'POST',
      body: JSON.stringify({ repo: 'owner/repo', description: 'task' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })
})

describe('GET /', () => {
  test('returns task list', async () => {
    mockGetRecentTasks.mockImplementation(() => [{ id: 'task-1' }])
    const res = await request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /:id', () => {
  test('returns 404 when task not found', async () => {
    mockGetTask.mockImplementation(() => undefined)
    const res = await request('/unknown-id')
    expect(res.status).toBe(404)
  })

  test('returns task when found', async () => {
    mockGetTask.mockImplementation(() => ({ id: 'task-1', status: 'pending' }))
    const res = await request('/task-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('task-1')
  })
})
