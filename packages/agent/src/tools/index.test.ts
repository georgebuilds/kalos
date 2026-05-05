import { describe, test, expect, afterAll } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const TEST_WORKSPACE_RAW = `/tmp/kalos-tools-test-${process.pid}`
mkdirSync(TEST_WORKSPACE_RAW, { recursive: true })
// Resolve symlinks (e.g. macOS /tmp → /private/tmp) so pwd comparisons work.
const TEST_WORKSPACE = realpathSync(TEST_WORKSPACE_RAW)
process.env.AGENT_WORKSPACE = TEST_WORKSPACE

const { read_file, write_file, delete_file, list_directory, run_command, complete } = await import('./index.js')

// ToolExecutionOptions stub — the execute functions don't use the options arg
const opts = { toolCallId: 'test', messages: [] as any[] }

afterAll(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true })
})

describe('path sanitization (resolvePath)', () => {
  test('read_file rejects path containing ..', async () => {
    const result = await read_file.execute!({ path: '../etc/passwd' }, opts)
    expect(result).toContain('path not allowed')
  })

  test('write_file rejects path containing ..', async () => {
    await expect(
      write_file.execute!({ path: '../../evil.sh', content: 'bad' }, opts),
    ).rejects.toThrow('path not allowed')
  })
})

describe('read_file', () => {
  test('returns file contents', async () => {
    writeFileSync(join(TEST_WORKSPACE, 'hello.txt'), 'world')
    const result = await read_file.execute!({ path: 'hello.txt' }, opts)
    expect(result).toBe('world')
  })

  test('returns "file not found" for a missing file', async () => {
    const result = await read_file.execute!({ path: 'does-not-exist.txt' }, opts)
    expect(result).toBe('file not found')
  })
})

describe('write_file', () => {
  test('writes content and returns confirmation', async () => {
    const result = await write_file.execute!({ path: 'output.txt', content: 'hello' }, opts)
    expect(result).toBe('written: output.txt')
  })

  test('written content is readable via read_file', async () => {
    await write_file.execute!({ path: 'roundtrip.txt', content: 'check me' }, opts)
    const result = await read_file.execute!({ path: 'roundtrip.txt' }, opts)
    expect(result).toBe('check me')
  })

  test('creates intermediate directories', async () => {
    const result = await write_file.execute!({ path: 'nested/sub/file.txt', content: 'deep' }, opts)
    expect(result).toBe('written: nested/sub/file.txt')
    const readBack = await read_file.execute!({ path: 'nested/sub/file.txt' }, opts)
    expect(readBack).toBe('deep')
  })
})

describe('list_directory', () => {
  test('lists files in the workspace root', async () => {
    const result = await list_directory.execute!({ path: '.' }, opts)
    expect(result).toContain('hello.txt')
    expect(result).toContain('output.txt')
  })

  test('marks directories with a trailing slash', async () => {
    const result = await list_directory.execute!({ path: '.' }, opts)
    expect(result).toContain('nested/')
  })

  test('lists files inside a subdirectory', async () => {
    const result = await list_directory.execute!({ path: 'nested/sub' }, opts)
    expect(result).toContain('file.txt')
  })
})

describe('run_command', () => {
  test('runs a command and returns stdout', async () => {
    const result = await run_command.execute!({ command: 'echo hello' }, opts)
    expect(result.trim()).toBe('hello')
  })

  test('returns stderr output on failure', async () => {
    const result = await run_command.execute!(
      { command: 'ls /nonexistent-path-xyz 2>&1; exit 1' },
      opts,
    )
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('strips secret env vars from the child process', async () => {
    process.env.ANTHROPIC_API_KEY = 'should-not-leak'
    process.env.LLM_API_KEY = 'also-secret'
    process.env.GITHUB_TOKEN = 'token-secret'
    const result = await run_command.execute!(
      {
        command:
          'echo "${ANTHROPIC_API_KEY:-EMPTY1} ${LLM_API_KEY:-EMPTY2} ${GITHUB_TOKEN:-EMPTY3}"',
      },
      opts,
    )
    expect(result).toContain('EMPTY1')
    expect(result).toContain('EMPTY2')
    expect(result).toContain('EMPTY3')
    expect(result).not.toContain('should-not-leak')
  })

  test('executes command in the workspace directory', async () => {
    const result = await run_command.execute!({ command: 'pwd' }, opts)
    expect(result.trim()).toBe(TEST_WORKSPACE)
  })
})

describe('write_file size limit', () => {
  test('returns error when content exceeds 256 KB', async () => {
    const content = 'a'.repeat(256 * 1024 + 1)
    const result = await write_file.execute!({ path: 'too-big.txt', content }, opts)
    expect(result).toContain('error')
    expect(result).toContain('256 KB')
  })
})

describe('delete_file', () => {
  test('deletes an existing file and confirms it is gone', async () => {
    await write_file.execute!({ path: 'to-delete.txt', content: 'bye' }, opts)
    const result = await delete_file.execute!({ path: 'to-delete.txt' }, opts)
    expect(result).toBe('deleted: to-delete.txt')
    const check = await read_file.execute!({ path: 'to-delete.txt' }, opts)
    expect(check).toBe('file not found')
  })

  test('returns file not found for a nonexistent file', async () => {
    const result = await delete_file.execute!({ path: 'does-not-exist.txt' }, opts)
    expect(result).toBe('file not found')
  })

  test('returns error when path is a directory', async () => {
    const result = await delete_file.execute!({ path: 'nested' }, opts)
    expect(result).toContain('error')
    expect(result).toContain('directory')
  })

  test('rejects path containing ..', async () => {
    const result = await delete_file.execute!({ path: '../evil.txt' }, opts)
    expect(result).toContain('path not allowed')
  })
})

describe('list_directory error handling', () => {
  test('returns error for a nonexistent directory', async () => {
    const result = await list_directory.execute!({ path: 'no-such-dir' }, opts)
    expect(result).toContain('error')
  })
})

describe('complete', () => {
  test('returns the summary unchanged', async () => {
    const result = await complete.execute!({ summary: 'All done!' }, opts)
    expect(result).toBe('All done!')
  })
})
