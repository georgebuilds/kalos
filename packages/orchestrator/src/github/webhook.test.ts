import { describe, test, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { verifyWebhookSignature } from './webhook.js'

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret'
  const payload = '{"action":"opened"}'

  test('accepts valid signature', () => {
    const sig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true)
  })

  test('rejects invalid signature', () => {
    expect(verifyWebhookSignature(payload, 'sha256=invalid', secret)).toBe(false)
  })

  test('rejects null signature', () => {
    expect(verifyWebhookSignature(payload, null, secret)).toBe(false)
  })

  test('rejects malformed signature (no prefix)', () => {
    expect(verifyWebhookSignature(payload, 'abc123', secret)).toBe(false)
  })
})
