import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

// Hash both inputs to a fixed-width digest before comparing so the
// timingSafeEqual path always runs regardless of input lengths — a bare
// length check would leak the secret's length via early-return timing.
export function safeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest()
  const bh = createHash('sha256').update(b).digest()
  return timingSafeEqual(ah, bh)
}

export async function apiKeyMiddleware(c: Context, next: Next): Promise<Response | void> {
  const apiKey = process.env.KALOS_API_KEY
  if (apiKey) {
    const provided = c.req.header('X-Api-Key') ?? ''
    if (!safeEqual(provided, apiKey)) return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
