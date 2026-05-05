import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHmac } from 'node:crypto'

const mockReviewPullRequest = mock(async (_payload: unknown) => {})

mock.module('../github/review.js', () => ({
  reviewPullRequest: mockReviewPullRequest,
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
})
