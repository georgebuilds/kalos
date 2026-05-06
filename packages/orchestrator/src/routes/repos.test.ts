import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  mockGetRepoSettings,
  mockSetRepoModelId,
  mockClearRepoSettings,
  mockListRepoSettings,
} = vi.hoisted(() => ({
  mockGetRepoSettings: vi.fn((_r: string) => null as { repo: string; modelId: string | null } | null),
  mockSetRepoModelId: vi.fn((_r: string, _m: string | null) => {}),
  mockClearRepoSettings: vi.fn((_r: string) => {}),
  mockListRepoSettings: vi.fn(() => [] as Array<{ repo: string; modelId: string | null }>),
}))

vi.mock('../db/index.js', () => ({
  getRepoSettings: mockGetRepoSettings,
  setRepoModelId: mockSetRepoModelId,
  clearRepoSettings: mockClearRepoSettings,
  listRepoSettings: mockListRepoSettings,
}))

const { reposRouter } = await import('./repos.js')

beforeEach(() => {
  mockGetRepoSettings.mockReset()
  mockSetRepoModelId.mockReset()
  mockClearRepoSettings.mockReset()
  mockListRepoSettings.mockReset()
  delete process.env.KALOS_API_KEY
})

describe('GET /', () => {
  test('returns the configured repo list', async () => {
    mockListRepoSettings.mockImplementation(() => [
      { repo: 'aaa/early', modelId: 'opus-4.7' },
      { repo: 'zzz/late', modelId: null },
    ])
    const res = await reposRouter.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].repo).toBe('aaa/early')
  })
})

describe('GET /:owner/:repo/settings', () => {
  test('returns the row when present', async () => {
    mockGetRepoSettings.mockImplementation((r) => ({ repo: r, modelId: 'haiku-4.5' }))
    const res = await reposRouter.request('/owner/repo/settings')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repo: 'owner/repo', modelId: 'haiku-4.5' })
  })

  test('returns a default row when no override is configured', async () => {
    mockGetRepoSettings.mockImplementation(() => null)
    const res = await reposRouter.request('/owner/repo/settings')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repo: 'owner/repo', modelId: null })
  })

  test('rejects path traversal in the repo segment', async () => {
    const res = await reposRouter.request('/..%2Fevil/repo/settings')
    expect(res.status).toBe(400)
  })
})

describe('PUT /:owner/:repo/settings', () => {
  test('400 when modelId is unknown', async () => {
    const res = await reposRouter.request('/owner/repo/settings', {
      method: 'PUT',
      body: JSON.stringify({ modelId: 'bogus' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    expect(mockSetRepoModelId).not.toHaveBeenCalled()
  })

  test('persists a known modelId', async () => {
    const res = await reposRouter.request('/owner/repo/settings', {
      method: 'PUT',
      body: JSON.stringify({ modelId: 'sonnet-4.6' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(mockSetRepoModelId).toHaveBeenCalledWith('owner/repo', 'sonnet-4.6')
  })

  test('null modelId clears the override (keeps row)', async () => {
    const res = await reposRouter.request('/owner/repo/settings', {
      method: 'PUT',
      body: JSON.stringify({ modelId: null }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(mockSetRepoModelId).toHaveBeenCalledWith('owner/repo', null)
  })

  test('400 when modelId is the wrong type (e.g. number)', async () => {
    const res = await reposRouter.request('/owner/repo/settings', {
      method: 'PUT',
      body: JSON.stringify({ modelId: 42 }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /:owner/:repo/settings', () => {
  test('drops the row entirely', async () => {
    const res = await reposRouter.request('/owner/repo/settings', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(mockClearRepoSettings).toHaveBeenCalledWith('owner/repo')
  })
})
