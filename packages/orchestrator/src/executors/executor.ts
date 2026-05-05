import type { Task } from '../db/index.js'

export type { Task }

export interface ExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface Executor {
  /** Start running a task. Returns an execution ID for log streaming. */
  run(task: Task): Promise<{ executionId: string }>
  /** Async-iterable stream of log lines for a running execution. */
  logs(executionId: string): AsyncIterable<string>
  /** Block until the execution completes and return the result. */
  wait(executionId: string): Promise<ExecutionResult>
  /** Best-effort cleanup (kill process, remove temp dirs, etc). */
  cleanup(executionId: string): Promise<void>
}
