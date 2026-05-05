import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function apiKeyMiddleware(c: Context, next: Next): Promise<Response | void> {
  const apiKey = process.env.KALOS_API_KEY
  if (apiKey) {
    const provided = c.req.header('X-Api-Key') ?? ''
    if (!safeEqual(provided, apiKey)) return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
