import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ToolSpec = { tool: string; version: string }

let _miseCheck: boolean | null = null

export function hasMise(): boolean {
  if (_miseCheck !== null) return _miseCheck
  try {
    const result = Bun.spawnSync(['mise', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    _miseCheck = result.exitCode === 0
  } catch {
    // Bun.spawnSync throws ENOENT when the executable isn't on PATH.
    _miseCheck = false
  }
  return _miseCheck
}

// Test seam — lets unit tests force a known answer without invoking mise.
export function _setMiseAvailability(available: boolean | null): void {
  _miseCheck = available
}

/**
 * Read the toolchain manifests in `workspace` and return the (tool, version)
 * pairs the project wants. Priority:
 *
 *   1. .tool-versions  — canonical, multi-tool, agnostic
 *   2. .nvmrc / .node-version  — node only
 *   3. go.mod `go` directive  — go only
 *   4. composer.json `require.php`  — php only
 *   5. package.json `packageManager`  — npm/pnpm/yarn/bun pin
 *
 * If `.tool-versions` is present we trust it exclusively; the other files
 * only contribute when there is no `.tool-versions`.
 */
export function detectToolchain(workspace: string): ToolSpec[] {
  const tv = join(workspace, '.tool-versions')
  if (existsSync(tv)) return parseToolVersions(readFileSync(tv, 'utf-8'))

  const specs: ToolSpec[] = []

  for (const f of ['.nvmrc', '.node-version']) {
    const p = join(workspace, f)
    if (existsSync(p)) {
      const v = readFileSync(p, 'utf-8').trim().replace(/^v/, '')
      if (v) specs.push({ tool: 'node', version: v })
      break
    }
  }

  const goMod = join(workspace, 'go.mod')
  if (existsSync(goMod)) {
    const m = readFileSync(goMod, 'utf-8').match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m)
    if (m) specs.push({ tool: 'go', version: m[1]! })
  }

  const composer = join(workspace, 'composer.json')
  if (existsSync(composer)) {
    try {
      const c = JSON.parse(readFileSync(composer, 'utf-8')) as {
        require?: { php?: string }
        config?: { platform?: { php?: string } }
      }
      const phpReq = c.config?.platform?.php ?? c.require?.php
      const m = phpReq?.match(/(\d+\.\d+(?:\.\d+)?)/)
      if (m) specs.push({ tool: 'php', version: m[1]! })
    } catch {
      // malformed JSON — skip silently
    }
  }

  const pkg = join(workspace, 'package.json')
  if (existsSync(pkg)) {
    try {
      const p = JSON.parse(readFileSync(pkg, 'utf-8')) as { packageManager?: string }
      const m = p.packageManager?.match(/^(npm|pnpm|yarn|bun)@(\d+\.\d+(?:\.\d+)?)/)
      if (m) specs.push({ tool: m[1]!, version: m[2]! })
    } catch {
      // malformed JSON — skip silently
    }
  }

  return specs
}

function parseToolVersions(text: string): ToolSpec[] {
  const specs: ToolSpec[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [tool, version] = line.split(/\s+/)
    if (tool && version) specs.push({ tool, version })
  }
  return specs
}

/**
 * Install whatever versions the workspace's manifests ask for. Idempotent —
 * subsequent runs against a warm `MISE_DATA_DIR` are near-instant. No-op if
 * mise is unavailable or no manifests were detected.
 */
export function installToolchain(workspace: string): void {
  if (!hasMise()) {
    console.log('[runtime] mise not found in PATH — toolchain pinning disabled')
    return
  }
  const specs = detectToolchain(workspace)
  if (specs.length === 0) {
    console.log('[runtime] no toolchain manifests detected — using host defaults')
    return
  }
  console.log(`[runtime] mise install — ${specs.map((s) => `${s.tool}@${s.version}`).join(' ')}`)
  const result = Bun.spawnSync(['mise', 'install'], {
    cwd: workspace,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    console.warn(
      `[runtime] mise install exited ${result.exitCode} — agent will fall back to whatever is on PATH`,
    )
  }
}

/**
 * Wrap a shell command so the workspace's pinned toolchain takes precedence.
 * Falls back to plain `sh -c` when mise isn't installed (tests, minimal hosts).
 */
export function commandArgs(command: string): string[] {
  return hasMise() ? ['mise', 'exec', '--', 'sh', '-c', command] : ['sh', '-c', command]
}
