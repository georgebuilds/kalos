import { Hono } from 'hono'
import { MODELS } from '@kalos/shared/models'
import { apiKeyMiddleware } from '../auth.js'

export const modelsRouter = new Hono()
modelsRouter.use('*', apiKeyMiddleware)

modelsRouter.get('/', (c) => {
  return c.json(MODELS)
})
