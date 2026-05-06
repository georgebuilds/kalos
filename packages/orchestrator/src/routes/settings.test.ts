import { beforeEach, describe, expect, test, vi } from 'vitest'

const { mockGetDefaultModelId, mockSetDefaultModelId } = vi.hoisted(() => ({
  mockGetDefaultModelId: vi.fn(() => null as string | null),
  mockSetDefaultModelId: vi.fn((_id: string) => {}),
}))

vi.mock('../db/index.js', () => ({
  getDefaultModelId: mockGetDefaultModelId,
  setDefaultModelId: mockSetDefaultModelId,
}))

const { settingsRouter } = await import('./settings.js')

beforeEach(() => {
  mockGetDefaultModelId.mockReset()
  mockSetDefaultModelId.mockReset()
  delete process.env.KALOS_API_KEY
})

describe('GET /default_model', () => {
  test('returns null when nothing is set', async () => {
    mockGetDefaultModelId.mockImplementation(() => null)
    const res = await settingsRouter.request('/default_model')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.modelId).toBeNull()
    expect(body.model).toBeNull()
  })

  test('returns the registry entry alongside the id', async () => {
    mockGetDefaultModelId.mockImplementation(() => 'sonnet-4.6')
    const res = await settingsRouter.request('/default_model')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.modelId).toBe('sonnet-4.6')
    expect(body.model.label).toBe('Claude Sonnet 4.6')
  })
})

describe('PUT /default_model', () => {
  test('400 when modelId is missing', async () => {
    const res = await settingsRouter.request('/default_model', {
      method: 'PUT',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  test('400 when modelId is unknown', async () => {
    const res = await settingsRouter.request('/default_model', {
      method: 'PUT',
      body: JSON.stringify({ modelId: 'bogus' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    expect(mockSetDefaultModelId).not.toHaveBeenCalled()
  })

  test('persists a known modelId and echoes back', async () => {
    const res = await settingsRouter.request('/default_model', {
      method: 'PUT',
      body: JSON.stringify({ modelId: 'opus-4.7' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(mockSetDefaultModelId).toHaveBeenCalledWith('opus-4.7')
    const body = await res.json()
    expect(body.modelId).toBe('opus-4.7')
  })

  test('400 on invalid JSON body', async () => {
    const res = await settingsRouter.request('/default_model', {
      method: 'PUT',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})
