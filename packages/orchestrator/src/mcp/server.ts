import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ulid } from 'ulid'
import {
  insertTask,
  getTask,
  getRecentTasksFiltered,
  getLogsForTaskSince,
  TASK_STATUSES,
  type TaskStatus,
} from '../db/index.js'
import { cancelTask } from '../queue/worker.js'
import { getModel } from '@kalos/shared/models'

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/
const TASK_STATUS_VALUES = TASK_STATUSES as readonly TaskStatus[]

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

export const mcpServer = new McpServer({ name: 'kalos', version: '0.1.0' })

mcpServer.registerTool(
  'create_task',
  {
    description: 'Create a new Kalos agent task for a GitHub repository.',
    inputSchema: {
      repo: z
        .string()
        .regex(REPO_RE, 'repo must be in owner/repo format')
        .refine((r) => !r.includes('..'), { message: 'repo must not contain ..' }),
      description: z.string().min(1, 'description is required'),
      baseBranch: z
        .string()
        .regex(BRANCH_RE, 'baseBranch contains disallowed characters')
        .refine((b) => !b.startsWith('-'), { message: "baseBranch must not start with '-'" })
        .refine((b) => !b.includes('..'), { message: "baseBranch must not contain '..'" })
        .optional(),
      modelId: z.string().optional(),
    },
  },
  ({ repo, description, baseBranch, modelId }) => {
    if (modelId !== undefined && !getModel(modelId)) {
      return toolError(`Unknown modelId: ${modelId}`)
    }
    const id = ulid()
    insertTask({
      id,
      repo,
      description,
      baseBranch: baseBranch ?? 'main',
      modelId: modelId ?? null,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify({ id }) }] }
  },
)

mcpServer.registerTool(
  'get_task',
  {
    description: 'Get the status and details of a Kalos task by ID.',
    inputSchema: { id: z.string() },
  },
  ({ id }) => {
    const task = getTask(id)
    if (!task) return toolError(`Task not found: ${id}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(task) }] }
  },
)

mcpServer.registerTool(
  'list_tasks',
  {
    description:
      'List recent Kalos tasks. Pass `status` to filter (e.g. ["pending","running"] for active jobs).',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional(),
      status: z
        .array(z.enum(TASK_STATUS_VALUES as [TaskStatus, ...TaskStatus[]]))
        .optional(),
    },
  },
  ({ limit, status }) => {
    const tasks = getRecentTasksFiltered(status ?? null, Math.min(limit ?? 20, 100))
    return { content: [{ type: 'text' as const, text: JSON.stringify(tasks) }] }
  },
)

mcpServer.registerTool(
  'cancel_task',
  {
    description:
      'Cancel a pending or running Kalos task. Returns the new status. ' +
      'Returns an error if the task is already in a terminal state or unknown.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const task = getTask(id)
    if (!task) return toolError(`Task not found: ${id}`)
    const ok = await cancelTask(id)
    if (!ok) return toolError(`Task is not cancellable in status: ${task.status}`)
    const updated = getTask(id)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ id, status: updated?.status ?? 'cancelled' }),
        },
      ],
    }
  },
)

mcpServer.registerTool(
  'get_task_logs',
  {
    description: 'Get logs for a Kalos task, with optional cursor for pagination.',
    inputSchema: {
      id: z.string(),
      since: z.number().int().min(0).optional(),
    },
  },
  ({ id, since }) => {
    const task = getTask(id)
    if (!task) return toolError(`Task not found: ${id}`)
    const cursor = since ?? 0
    const logs = getLogsForTaskSince(id, cursor)
    const nextCursor = logs.length > 0 ? logs[logs.length - 1]!.id : cursor
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ logs, nextCursor }) }],
    }
  },
)
