import { Hono } from 'hono'
import { getDefaultModelId, setDefaultModelId } from '../db/index.js'
import { getModel } from '@kalos/shared/models'
import { apiKeyMiddleware } from '../auth.js'

export const settingsRouter = new Hono()
settingsRouter.use('*', apiKeyMiddleware)

settingsRouter.get('/default_model', (c) => {
  const id = getDefaultModelId()
  return c.json({ modelId: id, model: id ? getModel(id) ?? null : null })
})

settingsRouter.put('/default_model', async (c) => {
  let body: unknown
  try {
    body = await c.req.json<unknown>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const b = body as Record<string, unknown> | null
  if (!b || typeof b.modelId !== 'string' || !b.modelId) {
    return c.json({ error: 'modelId is required' }, 400)
  }
  if (!getModel(b.modelId)) {
    return c.json({ error: `Unknown modelId: ${b.modelId}` }, 400)
  }
  setDefaultModelId(b.modelId)
  return c.json({ modelId: b.modelId })
})
