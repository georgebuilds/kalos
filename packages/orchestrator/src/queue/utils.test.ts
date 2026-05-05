import { describe, test, expect } from 'bun:test'
import { parsePrUrl } from './utils.js'

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
})
