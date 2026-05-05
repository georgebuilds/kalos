import { describe, test, expect } from 'bun:test'
import { parsePrUrl, withRetry } from './utils.js'

describe('parsePrUrl', () => {
  test('returns null when input has no PR_URL line', () => {
    expect(parsePrUrl('some output\nno url here')).toBeNull()
  })

  test('returns the URL from a matching line', () => {
    const logs = 'doing work\nPR_URL=https://github.com/owner/repo/pull/42\ndone'
    expect(parsePrUrl(logs)).toBe('https://github.com/owner/repo/pull/42')
  })

  test('uses the last match when multiple PR_URL lines exist', () => {
    const logs = [
      'PR_URL=https://github.com/owner/repo/pull/1',
      'PR_URL=https://github.com/owner/repo/pull/99',
    ].join('\n')
    expect(parsePrUrl(logs)).toBe('https://github.com/owner/repo/pull/99')
  })

  test('strips trailing whitespace from the URL', () => {
    const logs = 'PR_URL=https://github.com/owner/repo/pull/5   \n'
    expect(parsePrUrl(logs)).toBe('https://github.com/owner/repo/pull/5')
  })

  test('rejects non-github URLs', () => {
    expect(parsePrUrl('PR_URL=https://gitlab.com/owner/repo/pull/1')).toBeNull()
  })

  test('rejects PR_URL=not-a-url', () => {
    expect(parsePrUrl('PR_URL=not-a-url')).toBeNull()
  })

  test('rejects github URL missing /pull/ segment', () => {
    expect(parsePrUrl('PR_URL=https://github.com/owner/repo/issues/1')).toBeNull()
  })

  test('rejects URL with spaces (adversarial injection)', () => {
    expect(parsePrUrl('PR_URL=https://github.com/owner/repo/pull/1 extra')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parsePrUrl('')).toBeNull()
  })

  test('matches line even in multiline logs with surrounding noise', () => {
    const logs = [
      'Starting agent...',
      'Cloning repository',
      'Making changes',
      'PR_URL=https://github.com/acme/myapp/pull/123',
      'Completed',
    ].join('\n')
    expect(parsePrUrl(logs)).toBe('https://github.com/acme/myapp/pull/123')
  })

  test('returns null for PR_URL= with empty value (SIGTERM sentinel)', () => {
    expect(parsePrUrl('PR_URL=')).toBeNull()
  })
})

describe('withRetry', () => {
  test('returns result immediately when fn succeeds on first try', async () => {
    const result = await withRetry(async () => 'ok')
    expect(result).toBe('ok')
  })

  test('retries on transient failure and returns on second try', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        if (++calls < 2) throw new Error('transient')
        return 'recovered'
      },
      3,
      1,
    )
    expect(result).toBe('recovered')
    expect(calls).toBe(2)
  })

  test('throws immediately without retrying when isRetryable returns false', async () => {
    let calls = 0
    const err = new Error('non-retryable')
    await expect(
      withRetry(async () => { calls++; throw err }, 3, 1, () => false),
    ).rejects.toThrow('non-retryable')
    expect(calls).toBe(1)
  })

  test('throws last error after all retries are exhausted', async () => {
    let calls = 0
    await expect(
      withRetry(async () => { calls++; throw new Error(`attempt ${calls}`) }, 3, 1),
    ).rejects.toThrow('attempt 3')
    expect(calls).toBe(3)
  })

  test('default isRetryable treats HTTP 5xx as retryable', async () => {
    let calls = 0
    const err = Object.assign(new Error('server error'), { status: 503 })
    await expect(
      withRetry(async () => { calls++; throw err }, 2, 1),
    ).rejects.toThrow('server error')
    expect(calls).toBe(2)
  })

  test('default isRetryable treats HTTP 4xx as not retryable', async () => {
    let calls = 0
    const err = Object.assign(new Error('bad request'), { status: 400 })
    await expect(
      withRetry(async () => { calls++; throw err }, 3, 1),
    ).rejects.toThrow('bad request')
    expect(calls).toBe(1)
  })
})
