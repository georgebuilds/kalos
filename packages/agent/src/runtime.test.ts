import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectToolchain, commandArgs, _setMiseAvailability } from './runtime.js'

const tmpDirs: string[] = []

function workspace(): string {
  const d = mkdtempSync(join(tmpdir(), 'kalos-runtime-'))
  tmpDirs.push(d)
  return d
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  _setMiseAvailability(null)
})

describe('detectToolchain', () => {
  test('returns empty when no manifests are present', () => {
    expect(detectToolchain(workspace())).toEqual([])
  })

  test('reads .tool-versions exclusively when present', () => {
    const ws = workspace()
    writeFileSync(join(ws, '.tool-versions'), 'node 20.11.0\ngo 1.23.4\nphp 8.3.1\n')
    // also add competing manifests — they must be ignored
    writeFileSync(join(ws, '.nvmrc'), '18.0.0')
    writeFileSync(join(ws, 'go.mod'), 'go 1.20\n')
    expect(detectToolchain(ws)).toEqual([
      { tool: 'node', version: '20.11.0' },
      { tool: 'go', version: '1.23.4' },
      { tool: 'php', version: '8.3.1' },
    ])
  })

  test('strips comments and blank lines from .tool-versions', () => {
    const ws = workspace()
    writeFileSync(
      join(ws, '.tool-versions'),
      '# pinned by ops\nnode 20.11.0  # latest LTS\n\ngo 1.23.4\n',
    )
    expect(detectToolchain(ws)).toEqual([
      { tool: 'node', version: '20.11.0' },
      { tool: 'go', version: '1.23.4' },
    ])
  })

  test('falls back to .nvmrc and trims a leading v', () => {
    const ws = workspace()
    writeFileSync(join(ws, '.nvmrc'), 'v18.19.0\n')
    expect(detectToolchain(ws)).toEqual([{ tool: 'node', version: '18.19.0' }])
  })

  test('reads go directive from go.mod', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'go.mod'), 'module example.com/foo\n\ngo 1.22\n\nrequire (\n)\n')
    expect(detectToolchain(ws)).toEqual([{ tool: 'go', version: '1.22' }])
  })

  test('reads php from composer.json require.php', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'composer.json'), JSON.stringify({ require: { php: '^8.2' } }))
    expect(detectToolchain(ws)).toEqual([{ tool: 'php', version: '8.2' }])
  })

  test('prefers composer.json config.platform.php over require.php', () => {
    const ws = workspace()
    writeFileSync(
      join(ws, 'composer.json'),
      JSON.stringify({
        require: { php: '^8.0' },
        config: { platform: { php: '8.3.0' } },
      }),
    )
    expect(detectToolchain(ws)).toEqual([{ tool: 'php', version: '8.3.0' }])
  })

  test('reads packageManager from package.json', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.5.0' }))
    expect(detectToolchain(ws)).toEqual([{ tool: 'pnpm', version: '9.5.0' }])
  })

  test('skips malformed json without throwing', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'composer.json'), '{ this is not json }')
    writeFileSync(join(ws, 'package.json'), '{ also not json }')
    expect(detectToolchain(ws)).toEqual([])
  })

  test('combines multiple sources when there is no .tool-versions', () => {
    const ws = workspace()
    writeFileSync(join(ws, '.nvmrc'), '20.11.0')
    writeFileSync(join(ws, 'go.mod'), 'go 1.23\n')
    writeFileSync(join(ws, 'composer.json'), JSON.stringify({ require: { php: '8.3' } }))
    expect(detectToolchain(ws)).toEqual([
      { tool: 'node', version: '20.11.0' },
      { tool: 'go', version: '1.23' },
      { tool: 'php', version: '8.3' },
    ])
  })
})

describe('commandArgs', () => {
  test('wraps in mise exec when mise is available', () => {
    _setMiseAvailability(true)
    expect(commandArgs('echo hi')).toEqual(['mise', 'exec', '--', 'sh', '-c', 'echo hi'])
  })

  test('falls back to plain sh when mise is unavailable', () => {
    _setMiseAvailability(false)
    expect(commandArgs('echo hi')).toEqual(['sh', '-c', 'echo hi'])
  })
})
