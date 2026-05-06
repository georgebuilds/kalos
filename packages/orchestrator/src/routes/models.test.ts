import { beforeEach, describe, expect, test } from 'vitest'
import { modelsRouter } from './models.js'

beforeEach(() => {
  delete process.env.KALOS_API_KEY
})

describe('GET /', () => {
  test('returns the registry as JSON', async () => {
    const res = await modelsRouter.request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; slug: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    for (const m of body) {
      expect(typeof m.id).toBe('string')
      expect(typeof m.slug).toBe('string')
    }
  })

  test('honors KALOS_API_KEY when set', async () => {
    process.env.KALOS_API_KEY = 'secret-models'
    const fail = await modelsRouter.request('/')
    expect(fail.status).toBe(401)
    const ok = await modelsRouter.request('/', { headers: { 'X-Api-Key': 'secret-models' } })
    expect(ok.status).toBe(200)
  })
})
