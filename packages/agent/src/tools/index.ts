import { tool } from 'ai'
import { z } from 'zod'
import {
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
  lstatSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, sep } from 'node:path'
import { commitAll, hasChanges } from '../git.js'
import { commandArgs } from '../runtime.js'

const MAX_OUTPUT_BYTES = 256 * 1024

// Read at call time so tests can set AGENT_WORKSPACE after module load.
function workspace(): string {
  return process.env.AGENT_WORKSPACE ?? '/workspace'
}

// Resolve symlinks in workspace root so containment checks work (e.g. macOS /tmp → /private/tmp).
function workspaceReal(): string {
  const ws = workspace()
  try {
    return realpathSync(ws)
  } catch {
    return ws
  }
}

const RUN_COMMAND_TIMEOUT_MS = parseInt(process.env.RUN_COMMAND_TIMEOUT_MS ?? '120000')

function truncate(text: string, label: string): string {
  const buf = Buffer.from(text)
  if (buf.length <= MAX_OUTPUT_BYTES) return text
  return (
    buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf8') +
    `\n[truncated — ${buf.length - MAX_OUTPUT_BYTES} more bytes in ${label}]`
  )
}

const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'LLM_API_KEY', 'GITHUB_TOKEN']

function resolvePath(p: string): string {
  if (p.includes('..')) throw new Error(`path not allowed: ${p}`)
  return join(workspace(), p)
}

function assertInWorkspace(real: string, p: string): void {
  const wsReal = workspaceReal()
  if (real !== wsReal && !real.startsWith(wsReal + sep)) {
    throw new Error(`path not allowed: ${p}`)
  }
}

// For read/list: resolve symlinks and verify the real path stays inside workspace
function resolveRealPath(p: string): string {
  const abs = resolvePath(p)
  if (existsSync(abs)) {
    const real = realpathSync(abs)
    assertInWorkspace(real, p)
    return real
  }
  return abs
}

export const read_file = tool({
  description: 'Read the contents of a file in the workspace',
  parameters: z.object({ path: z.string() }),
  execute: async ({ path }) => {
    try {
      const real = resolveRealPath(path)
      if (!existsSync(real)) return 'file not found'
      return truncate(readFileSync(real, 'utf-8'), path)
    } catch (err) {
      return `error: ${(err as Error).message}`
    }
  },
})

export const write_file = tool({
  description: 'Write content to a file in the workspace, creating directories as needed',
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }) => {
    if (Buffer.byteLength(content) > MAX_OUTPUT_BYTES) {
      return `error: content exceeds 256 KB limit (${Buffer.byteLength(content)} bytes)`
    }
    const abs = resolvePath(path)
    const dir = dirname(abs)
    mkdirSync(dir, { recursive: true })
    // Verify the parent directory doesn't escape workspace via symlinks
    assertInWorkspace(realpathSync(dir), path)
    // Block writes through symlinks — a symlink target could be outside workspace
    try {
      if (lstatSync(abs).isSymbolicLink()) throw new Error(`path not allowed: ${path}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    writeFileSync(abs, content)
    return `written: ${path}`
  },
})

export const delete_file = tool({
  description: 'Delete a file in the workspace',
  parameters: z.object({ path: z.string() }),
  execute: async ({ path }) => {
    try {
      const abs = resolvePath(path)
      // Block deleting through symlinks — resolve target first
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) throw new Error(`path not allowed: ${path}`)
      if (stat.isDirectory()) return 'error: path is a directory'
      assertInWorkspace(realpathSync(abs), path)
      unlinkSync(abs)
      return `deleted: ${path}`
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'file not found'
      return `error: ${(err as Error).message}`
    }
  },
})

export const list_directory = tool({
  description: 'List files and directories at a path in the workspace',
  parameters: z.object({ path: z.string() }),
  execute: async ({ path }) => {
    try {
      const abs = resolveRealPath(path)
      const entries = readdirSync(abs)
      return entries
        .map((e) => {
          try {
            return statSync(join(abs, e)).isDirectory() ? `${e}/` : e
          } catch {
            return e
          }
        })
        .join('\n')
    } catch (err) {
      return `error: ${(err as Error).message}`
    }
  },
})

export const run_command = tool({
  description: 'Run a shell command inside the workspace',
  parameters: z.object({ command: z.string() }),
  execute: async ({ command }) => {
    const safeEnv = { ...process.env }
    for (const key of SECRET_ENV_VARS) delete safeEnv[key]
    const [argv0, ...argv] = commandArgs(command)
    const result = spawnSync(argv0!, argv, {
      cwd: workspace(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: RUN_COMMAND_TIMEOUT_MS,
      env: safeEnv,
    })
    if (result.status !== 0) {
      return truncate(result.stderr?.toString() || `exit code ${result.status}`, 'stderr')
    }
    return truncate(result.stdout.toString(), 'stdout')
  },
})

export const git_commit = tool({
  description: 'Stage all changes and create a git commit in the workspace',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => {
    const ws = workspace()
    const changed = hasChanges(ws)
    commitAll(message, ws)
    return changed ? `committed: ${message}` : 'nothing to commit'
  },
})

export const complete = tool({
  description: 'Signal that the task is complete with a short summary of what was done',
  parameters: z.object({ summary: z.string() }),
  execute: async ({ summary }) => {
    return summary
  },
})

export const tools = {
  read_file,
  write_file,
  delete_file,
  list_directory,
  run_command,
  git_commit,
  complete,
}
