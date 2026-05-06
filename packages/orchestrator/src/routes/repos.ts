import { Hono } from 'hono'
import {
  getRepoSettings,
  setRepoModelId,
  clearRepoSettings,
  listRepoSettings,
} from '../db/index.js'
import { getModel } from '@kalos/shared/models'
import { apiKeyMiddleware } from '../auth.js'

export const reposRouter = new Hono()
reposRouter.use('*', apiKeyMiddleware)

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function repoFromParams(c: { req: { param: (k: string) => string } }): string | null {
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  if (!owner || !repo) return null
  const full = `${owner}/${repo}`
  if (!REPO_RE.test(full) || full.includes('..')) return null
  return full
}

reposRouter.get('/', (c) => {
  return c.json(listRepoSettings())
})

reposRouter.get('/:owner/:repo/settings', (c) => {
  const repo = repoFromParams(c)
  if (!repo) return c.json({ error: 'Invalid repo path' }, 400)
  const settings = getRepoSettings(repo)
  return c.json(settings ?? { repo, modelId: null })
})

reposRouter.put('/:owner/:repo/settings', async (c) => {
  const repo = repoFromParams(c)
  if (!repo) return c.json({ error: 'Invalid repo path' }, 400)
  let body: unknown
  try {
    body = await c.req.json<unknown>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const b = body as Record<string, unknown> | null
  if (!b) return c.json({ error: 'Invalid body' }, 400)
  if (b.modelId !== null && (typeof b.modelId !== 'string' || !b.modelId)) {
    return c.json({ error: 'modelId must be a non-empty string or null' }, 400)
  }
  if (b.modelId !== null && !getModel(b.modelId as string)) {
    return c.json({ error: `Unknown modelId: ${b.modelId}` }, 400)
  }
  setRepoModelId(repo, (b.modelId as string | null) ?? null)
  return c.json({ repo, modelId: (b.modelId as string | null) ?? null })
})

reposRouter.delete('/:owner/:repo/settings', (c) => {
  const repo = repoFromParams(c)
  if (!repo) return c.json({ error: 'Invalid repo path' }, 400)
  clearRepoSettings(repo)
  return c.json({ ok: true })
})
