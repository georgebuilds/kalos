export function lastLines(text: string, n: number): string {
  return text.split('\n').slice(-n).join('\n')
}

const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/

export function parsePrUrl(logs: string): string | null {
  // Use the last match so early injected lines don't win.
  const matches = [...logs.matchAll(/^PR_URL=(.+)$/gm)]
  if (matches.length === 0) return null
  const candidate = matches[matches.length - 1]![1]!.trim()
  return GITHUB_PR_URL_RE.test(candidate) ? candidate : null
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    return (err as { status: number }).status >= 500
  }
  return true
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 500,
  isRetryable: (err: unknown) => boolean = defaultIsRetryable,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err)) throw err
      if (attempt < retries - 1) {
        const jitter = 1 + (Math.random() * 0.4 - 0.2)
        await sleep(baseDelayMs * 2 ** attempt * jitter)
      }
    }
  }
  throw lastErr
}
