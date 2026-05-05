import { Hono } from 'hono'
import { ulid } from 'ulid'
import { insertTask, getTask, getLogsForTaskSince, getRecentTasks } from '../db/index.js'
import { apiKeyMiddleware } from '../auth.js'
import { config } from '../config.js'

function validateCreateTask(body: unknown): {
  repo: string
  baseBranch: string
  description: string
} {
  if (typeof body !== 'object' || body === null) throw new Error('Invalid body')
  const b = body as Record<string, unknown>
  if (typeof b.repo !== 'string' || !b.repo) throw new Error('repo is required')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(b.repo))
    throw new Error('repo must be in owner/repo format')
  if (typeof b.description !== 'string' || !b.description)
    throw new Error('description is required')
  return {
    repo: b.repo,
    baseBranch: typeof b.baseBranch === 'string' ? b.baseBranch : 'main',
    description: b.description,
  }
}

// In-memory rate limiter: max 20 task creations per IP per minute.
// Map is bounded so an attacker spraying X-Forwarded-For can't exhaust memory.
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_MAP_MAX = 10_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  // Evict empty buckets opportunistically — keeps the map from accumulating
  // one-shot IPs forever.
  if (timestamps.length === 0) rateLimitMap.delete(ip)

  if (timestamps.length >= RATE_LIMIT_MAX) return false

  // Cap total entries: when full, drop the oldest insertion (Map preserves insertion order).
  if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX && !rateLimitMap.has(ip)) {
    const oldest = rateLimitMap.keys().next().value
    if (oldest !== undefined) rateLimitMap.delete(oldest)
  }

  timestamps.push(now)
  rateLimitMap.set(ip, timestamps)
  return true
}

// Only honour X-Forwarded-For when explicitly trusted — otherwise it's attacker-controlled.
const TRUST_PROXY = config.trustProxy

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  if (TRUST_PROXY) {
    const xff = c.req.header('x-forwarded-for')
    if (xff) return xff.split(',')[0]!.trim()
  }
  return 'unknown'
}

export const tasksRouter = new Hono()

// API key auth — required when KALOS_API_KEY is set
tasksRouter.use('*', apiKeyMiddleware)

tasksRouter.post('/', async (c) => {
  const ip = clientIp(c)
  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Too many requests' }, 429)
  }
  let data: { repo: string; baseBranch: string; description: string }
  try {
    const body = await c.req.json<unknown>()
    data = validateCreateTask(body)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Invalid request' }, 400)
  }

  const id = ulid()
  insertTask({ id, ...data })
  return c.json({ id }, 201)
})

tasksRouter.get('/', (c) => {
  const tasks = getRecentTasks(20)
  return c.json(tasks)
})

tasksRouter.get('/:id', (c) => {
  const id = c.req.param('id')
  const task = getTask(id)
  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json(task)
})

tasksRouter.get('/:id/logs', async (c) => {
  const task = getTask(c.req.param('id'))
  if (!task) return c.json({ error: 'not found' }, 404)

  let interval: ReturnType<typeof setInterval> | undefined

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encode = (data: string) => new TextEncoder().encode(`data: ${data}\n\n`)

        let lastLogId = 0

        const flush = () => {
          const logs = getLogsForTaskSince(task.id, lastLogId)
          for (const log of logs) {
            controller.enqueue(encode(JSON.stringify({ line: log.line, ts: log.ts })))
            lastLogId = log.id
          }
        }

        flush()

        if (task.status === 'completed' || task.status === 'failed') {
          controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'))
          controller.close()
          return
        }

        interval = setInterval(() => {
          flush()
          const current = getTask(task.id)!
          if (current.status === 'completed' || current.status === 'failed') {
            flush()
            controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'))
            controller.close()
            clearInterval(interval)
          }
        }, 1000)
      },
      cancel() {
        clearInterval(interval)
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  )
})
