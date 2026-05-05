import { describe, test, expect } from 'bun:test'
import { parseDockerLogs } from './client.js'

describe('parseDockerLogs', () => {
  function makeFrame(streamType: number, message: string): Buffer {
    const msgBuf = Buffer.from(message)
    const header = Buffer.alloc(8)
    header[0] = streamType
    header.writeUInt32BE(msgBuf.length, 4)
    return Buffer.concat([header, msgBuf])
  }

  test('parses a single stdout frame', () => {
    const frame = makeFrame(1, 'hello world\n')
    expect(parseDockerLogs(frame)).toBe('hello world\n')
  })

  test('parses multiple frames', () => {
    const buf = Buffer.concat([makeFrame(1, 'line one\n'), makeFrame(2, 'line two\n')])
    expect(parseDockerLogs(buf)).toBe('line one\nline two\n')
  })

  test('returns empty string for empty buffer', () => {
    expect(parseDockerLogs(Buffer.alloc(0))).toBe('')
  })
})
