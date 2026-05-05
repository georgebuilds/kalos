function requireInt(name: string, defaultVal: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultVal
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got '${raw}'`)
  return n
}

function requireBool(name: string, defaultVal: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultVal
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  throw new Error(`${name} must be '0', '1', 'false', or 'true', got '${raw}'`)
}

export const config = Object.freeze({
  executor: process.env['EXECUTOR'] ?? 'process',
  databaseUrl: process.env.DATABASE_URL ?? 'kalos.db',
  port: requireInt('PORT', 3000),
  workerPollIntervalMs: requireInt('WORKER_POLL_INTERVAL_MS', 2000),
  maxConcurrentTasks: requireInt('MAX_CONCURRENT_TASKS', 1),
  taskTimeoutMs: requireInt('TASK_TIMEOUT_MS', 600000),
  ciFixMaxAttempts: requireInt('CI_FIX_MAX_ATTEMPTS', 3),
  shutdownTimeoutMs: requireInt('SHUTDOWN_TIMEOUT_MS', 15000),
  dockerFetchTimeoutMs: requireInt('DOCKER_FETCH_TIMEOUT_MS', 30000),
  dockerSocket: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  agentImage: process.env.AGENT_IMAGE ?? 'kalos-agent:latest',
  kalosApiKey: process.env.KALOS_API_KEY,
  trustProxy: requireBool('KALOS_TRUST_PROXY', false),
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  llmApiKey: process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  // GitHub App vars: validated at call time by getGithubConfig() because the
  // setup wizard may configure them after process startup via the DB.
  githubAppId: process.env.GITHUB_APP_ID,
  githubAppPrivateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  githubInstallationId: process.env.GITHUB_INSTALLATION_ID,
})
