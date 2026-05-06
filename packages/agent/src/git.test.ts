import { describe, test, expect } from 'vitest'
import { hasChanges } from './git.js'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

describe('hasChanges', () => {
  const testDir = '/tmp/kalos-git-test'

  function spawnGit(args: string[], cwd: string) {
    const result = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    if (result.status !== 0) throw new Error(result.stderr?.toString() ?? `git ${args.join(' ')} exited with ${result.status}`)
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
