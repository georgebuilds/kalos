import { Octokit } from '@octokit/rest'

function isOctokitError(err: unknown): err is { status: number } {
  return typeof err === 'object' && err !== null && 'status' in err
}

export async function openPullRequest(opts: {
  token: string
  repo: string
  branch: string
  baseBranch: string
  taskDescription: string
  agentSummary: string
}): Promise<string> {
  const [owner, repoName] = opts.repo.split('/') as [string, string]
  const octokit = new Octokit({ auth: opts.token })

  const body = [
    '## Task',
    opts.taskDescription,
    '',
    '## Changes',
    opts.agentSummary,
    '',
    '---',
    '*Opened by [Kalos](https://github.com/georgebuilds/kalos)*',
  ].join('\n')

  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo: repoName,
      title: opts.taskDescription.slice(0, 72),
      body,
      head: opts.branch,
      base: opts.baseBranch,
    })
    return data.html_url
  } catch (err: unknown) {
    if (isOctokitError(err) && err.status === 422) {
      const { data } = await octokit.pulls.list({
        owner,
        repo: repoName,
        head: `${owner}:${opts.branch}`,
        state: 'open',
      })
      if (data[0]) return data[0].html_url
    }
    throw err
  }
}
