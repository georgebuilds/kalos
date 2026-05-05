import { describe, test, expect } from 'bun:test'
import { hasChanges } from './git.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

describe('hasChanges', () => {
  const testDir = '/tmp/kalos-git-test'

  function spawnGit(args: string[], cwd: string) {
    const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    if (!result.success) throw new Error(result.stderr.toString())
  }

  test('returns false on clean repo', () => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    spawnGit(['init'], testDir)
    spawnGit(
      [
        '-c',
        'user.email=test@test.com',
        '-c',
        'user.name=Test',
        'commit',
        '--allow-empty',
        '-m',
        'init',
      ],
      testDir,
    )
    expect(hasChanges(testDir)).toBe(false)
    rmSync(testDir, { recursive: true, force: true })
  })

  test('returns true with uncommitted changes', () => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    spawnGit(['init'], testDir)
    spawnGit(
      [
        '-c',
        'user.email=test@test.com',
        '-c',
        'user.name=Test',
        'commit',
        '--allow-empty',
        '-m',
        'init',
      ],
      testDir,
    )
    writeFileSync(join(testDir, 'test.txt'), 'hello')
    expect(hasChanges(testDir)).toBe(true)
    rmSync(testDir, { recursive: true, force: true })
  })
})
