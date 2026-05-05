import { Hono } from 'hono'
import { verifyWebhookSignature } from '../github/webhook.js'
import { reviewPullRequest } from '../github/review.js'
import { queueCiFixIfEligible } from '../github/ci-fix.js'
import { insertPrReview, tryRecordWebhookDelivery } from '../db/index.js'

type CheckRunPayload = {
  action: string
  check_run: {
    id: number
    name: string
    conclusion: string | null
    html_url: string
    output: {
      title: string | null
      summary: string | null
      text: string | null
    }
    check_suite: {
      head_branch: string
    }
  }
  repository: {
    full_name: string
  }
}

function isCheckRunPayload(p: Record<string, unknown>): p is CheckRunPayload {
  if (typeof p.action !== 'string') return false
  const cr = p.check_run
  if (cr === null || typeof cr !== 'object') return false
  const crObj = cr as Record<string, unknown>
  if (crObj.check_suite === null || typeof crObj.check_suite !== 'object') return false
  const suite = crObj.check_suite as Record<string, unknown>
  if (typeof suite.head_branch !== 'string') return false
  const repo = p.repository
  if (repo === null || typeof repo !== 'object') return false
  const repoObj = repo as Record<string, unknown>
  if (typeof repoObj.full_name !== 'string' || !repoObj.full_name.includes('/')) return false
  return true
}

type PullRequestPayload = Parameters<typeof reviewPullRequest>[0]

function isPullRequestPayload(payload: Record<string, unknown>): payload is PullRequestPayload {
  const pr = payload.pull_request
  const repo = payload.repository
  return (
    typeof payload.action === 'string' &&
    typeof payload.number === 'number' &&
    pr !== null &&
    typeof pr === 'object' &&
    typeof (pr as Record<string, unknown>).title === 'string' &&
    typeof (pr as Record<string, unknown>).diff_url === 'string' &&
    typeof (pr as Record<string, unknown>).html_url === 'string' &&
    repo !== null &&
    typeof repo === 'object' &&
    typeof (repo as Record<string, unknown>).full_name === 'string' &&
    ((repo as Record<string, unknown>).full_name as string).includes('/')
  )
}

export const webhooksRouter = new Hono()

webhooksRouter.post('/github', async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook secret not configured' }, 500)

  const rawBody = await c.req.text()
  const signature = c.req.header('X-Hub-Signature-256') ?? null
  const event = c.req.header('X-GitHub-Event')
  const deliveryId = c.req.header('X-GitHub-Delivery')

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return c.json({ error: 'invalid signature' }, 401)
  }

  // Dedup redeliveries (GitHub re-fires on transient errors). Check after
  // signature verification so unauthenticated callers can't pollute the table.
  if (deliveryId && !tryRecordWebhookDelivery(deliveryId)) {
    return c.json({ ok: true, duplicate: true })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return c.json({ error: 'invalid JSON' }, 400)
  }

  if (event === 'pull_request') {
    const action = payload.action as string
    if (action === 'opened' || action === 'synchronize') {
      if (!isPullRequestPayload(payload)) {
        console.error('[webhook] pull_request payload missing required fields')
        return c.json({ error: 'invalid payload' }, 400)
      }
      const { pull_request: pr, repository, number: pullNumber } = payload
      reviewPullRequest(payload)
        .then(() =>
          insertPrReview({
            repo: repository.full_name,
            pullNumber,
            sha: pr.head.sha,
            status: 'success',
          }),
        )
        .catch((err: Error) => {
          console.error('[webhook] review failed:', err.message)
          insertPrReview({
            repo: repository.full_name,
            pullNumber,
            sha: pr.head.sha,
            status: 'failed',
            error: err.message,
          })
        })
    }
  }

  if (event === 'check_run') {
    if (!isCheckRunPayload(payload)) return c.json({ ok: true })

    const { action, check_run: cr, repository } = payload
    const FAILING_CONCLUSIONS = ['failure', 'timed_out', 'action_required']

    if (action !== 'completed' || !FAILING_CONCLUSIONS.includes(cr.conclusion ?? '')) {
      return c.json({ ok: true })
    }

    const branch = cr.check_suite.head_branch
    if (!branch.startsWith('kalos/task-')) return c.json({ ok: true })

    queueCiFixIfEligible({ branch, checkRun: cr, repo: repository.full_name }).catch((err: Error) => {
      console.error('[webhook] ci-fix dispatch failed:', err.message)
    })
  }

  return c.json({ ok: true })
})
