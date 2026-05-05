import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false
  const match = signature.match(/^sha256=([0-9a-f]+)$/)
  if (!match) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(match[1]!, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
