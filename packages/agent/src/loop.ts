import { generateText, type LanguageModel } from 'ai'
import { tools } from './tools/index.js'

export async function runAgentLoop(task: {
  description: string
  repo: string
  branch: string
  model: LanguageModel
}): Promise<string> {
  const system = `You are Kalos, an autonomous coding agent. You have been given a task to complete on a software repository.

You have access to tools to read and write files, run commands, commit changes, and signal completion.

Guidelines:
- Start by exploring the repository structure with list_directory to understand the codebase
- Read relevant files before making changes
- Make focused, minimal changes that directly address the task
- Run tests or linting if config files suggest they exist (package.json scripts, Makefile, etc.)
- Commit your changes with a clear, conventional commit message
- When you are done, call the \`complete\` tool with a short summary of what you did
- If you cannot complete the task, call \`complete\` with an explanation of why

You are running on branch: ${task.branch}
Repository: ${task.repo}`

  const result = await generateText({
    model: task.model,
    tools,
    maxSteps: 50,
    system,
    prompt: task.description,
  })

  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === 'complete') {
        return toolResult.result as string
      }
    }
  }

  return 'Agent finished (max steps reached)'
}
