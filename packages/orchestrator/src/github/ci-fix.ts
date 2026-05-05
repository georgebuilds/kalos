import { ulid } from 'ulid'
import { getTaskByBranch, insertTask, updateTask } from '../db/index.js'
import { config } from '../config.js'

type CheckRunSummary = {
  id: number
  name: string
  conclusion: string | null
  html_url: string
  output: { title: string | null; summary: string | null; text: string | null }
}

export async function queueCiFixIfEligible(opts: {
  branch: string
  checkRun: CheckRunSummary
  repo: string
}): Promise<void> {
  if (config.ciFixMaxAttempts === 0) return

  const task = getTaskByBranch(opts.branch)
  if (!task) {
    console.log(`[ci-fix] no task found for branch ${opts.branch}`)
    return
  }
  if (task.status === 'pending' || task.status === 'running') {
    console.log(`[ci-fix] task ${task.id} is ${task.status} — skipping`)
    return
  }
  if (task.ciFixAttempts >= config.ciFixMaxAttempts) {
    console.log(`[ci-fix] max attempts reached for branch ${opts.branch}`)
    return
  }

  const lines = [
    `## CI Failure — Attempt ${task.ciFixAttempts + 1} of ${config.ciFixMaxAttempts}`,
    ``,
    `Check: **${opts.checkRun.name}** — ${opts.checkRun.conclusion}`,
    `URL: ${opts.checkRun.html_url}`,
  ]
  if (opts.checkRun.output.title) lines.push(``, `**${opts.checkRun.output.title}**`)
  if (opts.checkRun.output.summary) lines.push(``, opts.checkRun.output.summary)
  if (opts.checkRun.output.text) lines.push(``, opts.checkRun.output.text.slice(0, 4000))
  const failureContext = lines.join('\n')

  const description = [
    task.description,
    ``,
    `---`,
    failureContext,
    ``,
    `The branch \`${opts.branch}\` already exists with your previous changes on it.`,
    `Check out that branch (do NOT create a new one), review the CI failure above, fix the issue, and push.`,
  ].join('\n')

  const id = ulid()
  insertTask({
    id,
    repo: task.repo,
    baseBranch: task.baseBranch,
    description,
    branch: opts.branch,
    ciFixAttempts: task.ciFixAttempts + 1,
    parentTaskId: task.parentTaskId ?? task.id,
  })

  updateTask(task.id, {
    status: 'failed',
    error: `CI failed — queued fix attempt #${task.ciFixAttempts + 1}`,
  })
}
