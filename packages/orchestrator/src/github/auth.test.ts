import { describe, test, expect, beforeAll } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { signAppJwt } from './auth.js'

describe('signAppJwt', () => {
  let pem: string

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  })

  test('returns a three-part JWT', () => {
    const jwt = signAppJwt('12345', pem)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)
  })

  test('JWT header decodes to RS256', () => {
    const jwt = signAppJwt('12345', pem)
    const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString())
    expect(header.alg).toBe('RS256')
    expect(header.typ).toBe('JWT')
  })

  test('JWT payload contains correct iss', () => {
    const jwt = signAppJwt('99999', pem)
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
    expect(payload.iss).toBe('99999')
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })
})
