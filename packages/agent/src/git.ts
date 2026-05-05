function git(args: string[], workDir: string): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: workDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (!result.success) {
    throw new Error(result.stderr.toString())
  }
  return result.stdout.toString()
}

// Pass auth via header rather than URL so the token is never persisted in .git/config
function gitWithAuth(token: string, args: string[], workDir?: string): string {
  const result = Bun.spawnSync(
    ['git', '-c', `http.extraheader=AUTHORIZATION: bearer ${token}`, ...args],
    { ...(workDir ? { cwd: workDir } : {}), stdout: 'pipe', stderr: 'pipe' },
  )
  if (!result.success) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}

export function cloneRepo(repo: string, token: string, targetDir: string, branch?: string): void {
  const branchArgs = branch ? ['--branch', branch, '--single-branch'] : []
  gitWithAuth(token, ['clone', ...branchArgs, `https://github.com/${repo}.git`, targetDir])
  git(['config', 'user.email', 'kalos-agent'], targetDir)
  git(['config', 'user.name', 'kalos[bot]'], targetDir)
}

export function createBranch(branch: string, from: string, workDir: string, checkoutExisting = false): void {
  if (checkoutExisting) {
    git(['fetch', 'origin', branch], workDir)
    git(['checkout', branch], workDir)
    return
  }
  git(['checkout', '-b', branch, from], workDir)
}

export function commitAll(message: string, workDir: string): void {
  git(['add', '-A'], workDir)
  const check = Bun.spawnSync(['git', 'diff', '--cached', '--quiet'], { cwd: workDir })
  if (check.exitCode === 0) return
  git(['commit', '-m', message], workDir)
}

export function pushBranch(branch: string, token: string, workDir: string, force = false): void {
  const args = ['push', 'origin', branch]
  if (force) args.splice(2, 0, '--force-with-lease')
  gitWithAuth(token, args, workDir)
}

export function hasChanges(workDir: string): boolean {
  return git(['status', '--porcelain'], workDir).trim().length > 0
}
