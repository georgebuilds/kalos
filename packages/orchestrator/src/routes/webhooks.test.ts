import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const { mockReviewPullRequest, mockQueueCiFixIfEligible } = vi.hoisted(() => ({
  mockReviewPullRequest: vi.fn(async (_payload: unknown) => {}),
  mockQueueCiFixIfEligible: vi.fn(async (_opts: unknown) => {}),
}))

vi.mock('../github/review.js', () => ({
  reviewPullRequest: mockReviewPullRequest,
}))

vi.mock('../github/ci-fix.js', () => ({
  queueCiFixIfEligible: mockQueueCiFixIfEligible,
}))

vi.mock('../db/index.js', () => ({
  insertPrReview: () => {},
  tryRecordWebhookDelivery: () => true,
}))

const { webhooksRouter } = await import('./webhooks.js')

const SECRET = 'test-webhook-secret'

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: string, opts: { event?: string; sig?: string | null } = {}) {
  const { event = 'push', sig = sign(body, SECRET) } = opts
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) headers['X-Hub-Signature-256'] = sig
  if (event) headers['X-GitHub-Event'] = event
  return webhooksRouter.request('/github', { method: 'POST', body, headers })
}

const validPrBody = JSON.stringify({
  action: 'opened',
  number: 42,
  pull_request: {
    title: 'Add feature',
    body: 'Description',
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main' },
    diff_url: 'https://github.com/owner/repo/pull/42.diff',
    html_url: 'https://github.com/owner/repo/pull/42',
  },
  repository: { full_name: 'owner/repo' },
})

beforeEach(() => {
  mockReviewPullRequest.mockClear()
  mockQueueCiFixIfEligible.mockClear()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
})

describe('POST /github', () => {
  test('returns 500 when GITHUB_WEBHOOK_SECRET is not set', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET
    const body = '{}'
    const res = await webhooksRouter.request('/github', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('secret')
  })

  test('returns 401 when signature is missing', async () => {
    const res = await makeRequest('{}', { sig: null })
    expect(res.status).toBe(401)
  })

  test('returns 401 when signature is invalid', async () => {
    const res = await makeRequest('{}', { sig: 'sha256=badhash' })
    expect(res.status).toBe(401)
  })

  test('returns 401 when signature uses wrong secret', async () => {
    const body = '{}'
    const wrongSig = sign(body, 'different-secret')
    const res = await makeRequest(body, { sig: wrongSig })
    expect(res.status).toBe(401)
  })

  test('returns 200 for non-pull_request event without triggering review', async () => {
    const body = JSON.stringify({ action: 'pushed' })
    const res = await makeRequest(body, { event: 'push' })
    expect(res.status).toBe(200)
    expect(mockReviewPullRequest).not.toHaveBeenCalled()
  })

  test('returns 200 for pull_request closed action without triggering review', async () => {
    const body = JSON.stringify({ ...JSON.parse(validPrBody), action: 'closed' })
    const res = await makeRequest(body, { event: 'pull_request' })
    expect(res.status).toBe(200)
    expect(mockReviewPullRequest).not.toHaveBeenCalled()
  })

  test('triggers review for opened pull_request', async () => {
    const res = await makeRequest(validPrBody, { event: 'pull_request' })
    expect(res.status).toBe(200)
    // reviewPullRequest is fire-and-forget; yield to event loop
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockReviewPullRequest).toHaveBeenCalledTimes(1)
  })

  test('triggers review for synchronize pull_request', async () => {
    const body = JSON.stringify({ ...JSON.parse(validPrBody), action: 'synchronize' })
    const res = await makeRequest(body, { event: 'pull_request' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockReviewPullRequest).toHaveBeenCalledTimes(1)
  })

  test('returns 400 for pull_request event with missing required fields', async () => {
    const body = JSON.stringify({
      action: 'opened',
      number: 1,
      pull_request: null,
      repository: null,
    })
    const res = await makeRequest(body, { event: 'pull_request' })
    expect(res.status).toBe(400)
  })

  test('returns 200 with ok:true on success', async () => {
    const body = JSON.stringify({ action: 'star' })
    const res = await makeRequest(body, { event: 'star' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  test('returns 400 for pull_request event missing head.sha', async () => {
    const body = JSON.stringify({
      action: 'opened',
      number: 1,
      pull_request: {
        title: 'feat',
        body: null,
        head: { ref: 'my-branch' }, // missing sha
        base: { ref: 'main' },
        diff_url: 'https://github.com/owner/repo/pull/1.diff',
        html_url: 'https://github.com/owner/repo/pull/1',
      },
      repository: { full_name: 'owner/repo' },
    })
    const res = await makeRequest(body, { event: 'pull_request' })
    expect(res.status).toBe(400)
  })
})

const validCheckRunBody = JSON.stringify({
  action: 'completed',
  check_run: {
    id: 1,
    name: 'CI / test',
    conclusion: 'failure',
    html_url: 'https://github.com/owner/repo/actions/runs/1',
    output: { title: null, summary: null, text: null },
    check_suite: { head_branch: 'kalos/task-ABC123' },
  },
  repository: { full_name: 'owner/repo' },
})

describe('check_run event', () => {
  test('ignores check_run for non-kalos branch', async () => {
    const body = JSON.stringify({
      ...JSON.parse(validCheckRunBody),
      check_run: {
        ...JSON.parse(validCheckRunBody).check_run,
        check_suite: { head_branch: 'feature/my-branch' },
      },
    })
    const res = await makeRequest(body, { event: 'check_run' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockQueueCiFixIfEligible).not.toHaveBeenCalled()
  })

  test('ignores check_run with non-completed action', async () => {
    const body = JSON.stringify({ ...JSON.parse(validCheckRunBody), action: 'created' })
    const res = await makeRequest(body, { event: 'check_run' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockQueueCiFixIfEligible).not.toHaveBeenCalled()
  })

  test('ignores check_run with passing conclusion', async () => {
    const parsed = JSON.parse(validCheckRunBody)
    const body = JSON.stringify({
      ...parsed,
      check_run: { ...parsed.check_run, conclusion: 'success' },
    })
    const res = await makeRequest(body, { event: 'check_run' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockQueueCiFixIfEligible).not.toHaveBeenCalled()
  })

  test('calls queueCiFixIfEligible for failing kalos/task-* branch', async () => {
    const res = await makeRequest(validCheckRunBody, { event: 'check_run' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockQueueCiFixIfEligible).toHaveBeenCalledTimes(1)
    const [opts] = mockQueueCiFixIfEligible.mock.calls[0]! as [{ branch: string; repo: string }]
    expect(opts.branch).toBe('kalos/task-ABC123')
    expect(opts.repo).toBe('owner/repo')
  })

  test('calls queueCiFixIfEligible for timed_out conclusion', async () => {
    const parsed = JSON.parse(validCheckRunBody)
    const body = JSON.stringify({
      ...parsed,
      check_run: { ...parsed.check_run, conclusion: 'timed_out' },
    })
    const res = await makeRequest(body, { event: 'check_run' })
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockQueueCiFixIfEligible).toHaveBeenCalledTimes(1)
  })
})
