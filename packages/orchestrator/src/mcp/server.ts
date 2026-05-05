import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ulid } from 'ulid'
import { insertTask, getTask, getRecentTasks, getLogsForTaskSince } from '../db/index.js'

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

export const mcpServer = new McpServer({ name: 'kalos', version: '0.1.0' })

mcpServer.registerTool(
  'create_task',
  {
    description: 'Create a new Kalos agent task for a GitHub repository.',
    inputSchema: {
      repo: z.string().regex(REPO_RE, 'repo must be in owner/repo format'),
      description: z.string().min(1, 'description is required'),
      baseBranch: z.string().optional(),
    },
  },
  ({ repo, description, baseBranch }) => {
    const id = ulid()
    insertTask({ id, repo, description, baseBranch: baseBranch ?? 'main' })
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
    description: 'List recent Kalos tasks.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  },
  ({ limit }) => {
    const tasks = getRecentTasks(Math.min(limit ?? 20, 100))
    return { content: [{ type: 'text' as const, text: JSON.stringify(tasks) }] }
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
