import { DockerExecutor } from './docker.js'
import { ChildProcessExecutor } from './child-process.js'
import type { Executor } from './executor.js'

export type { Executor, ExecutionResult } from './executor.js'

export function createExecutor(): Executor {
  const driver = process.env['EXECUTOR'] ?? 'process'
  if (driver === 'docker') return new DockerExecutor()
  if (driver === 'process') return new ChildProcessExecutor()
  throw new Error(`Unknown EXECUTOR driver: ${driver}`)
}
