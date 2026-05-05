import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockPullsCreate = mock(async (_opts: unknown) => ({
  data: { html_url: 'https://github.com/owner/repo/pull/42' },
}))

mock.module('@octokit/rest', () => ({
  Octokit: class {
    pulls = { create: mockPullsCreate }
  },
}))

const { openPullRequest } = await import('./pr.js')

const BASE = {
  token: 'gh-test-token',
  repo: 'owner/repo',
  branch: 'kalos/task-abc',
  baseBranch: 'main',
  taskDescription: 'Add unit tests to the project',
  agentSummary: 'Created test files for all modules',
}

beforeEach(() => {
  mockPullsCreate.mockClear()
  mockPullsCreate.mockImplementation(async (_opts: unknown) => ({
    data: { html_url: 'https://github.com/owner/repo/pull/42' },
  }))
})

describe('openPullRequest', () => {
  test('returns the html_url from the created PR', async () => {
    const url = await openPullRequest(BASE)
    expect(url).toBe('https://github.com/owner/repo/pull/42')
  })

  test('passes owner and repo name separately from repo string', async () => {
    await openPullRequest({ ...BASE, repo: 'myorg/myrepo' })
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(call.owner).toBe('myorg')
    expect(call.repo).toBe('myrepo')
  })

  test('sets head to the feature branch and base to the base branch', async () => {
    await openPullRequest(BASE)
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(call.head).toBe(BASE.branch)
    expect(call.base).toBe(BASE.baseBranch)
  })

  test('uses taskDescription as the PR title', async () => {
    await openPullRequest(BASE)
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(call.title).toBe(BASE.taskDescription)
  })

  test('truncates title to 72 characters', async () => {
    const longDesc = 'a'.repeat(100)
    await openPullRequest({ ...BASE, taskDescription: longDesc })
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect((call.title as string).length).toBe(72)
  })

  test('title of 72 chars or fewer is not truncated', async () => {
    const desc = 'Short description'
    await openPullRequest({ ...BASE, taskDescription: desc })
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(call.title).toBe(desc)
  })

  test('body contains task description and agent summary', async () => {
    await openPullRequest(BASE)
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    const body = call.body as string
    expect(body).toContain(BASE.taskDescription)
    expect(body).toContain(BASE.agentSummary)
  })

  test('body contains Kalos attribution line', async () => {
    await openPullRequest(BASE)
    const call = mockPullsCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(call.body as string).toContain('Kalos')
  })
})
