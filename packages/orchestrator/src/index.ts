import { Hono } from 'hono'
import { config } from './config.js'
import { tasksRouter } from './routes/tasks.js'
import { webhooksRouter } from './routes/webhooks.js'
import { uiRouter } from './routes/ui.js'
import { mcpRouter } from './mcp/router.js'
import { reconcileOnStartup } from './queue/reconcile.js'
import { startWorker, stopWorker } from './queue/worker.js'
import { isSetupComplete } from './db/index.js'
import { runWizard } from './wizard/index.js'

if (!isSetupComplete()) {
  await runWizard()
}

// Warn loudly at startup if the process executor is selected but mise is
// missing — the agent will fall back to host PATH, which usually means tests
// that depend on a pinned runtime version (.tool-versions, .nvmrc, go.mod,
// composer.json) won't run against the version the project asked for.
if (config.executor === 'process' && !isMiseAvailable()) {
  console.warn(
    '[orchestrator] mise is not on PATH — toolchain pinning is disabled. ' +
      'Tests will run against whatever node/bun/go/php is already installed.',
  )
  console.warn(
    '[orchestrator] Install with: curl https://mise.run | sh   (https://mise.jdx.dev)',
  )
}

try {
  await reconcileOnStartup()
} catch (err) {
  console.error('[orchestrator] reconcile failed (continuing startup):', err)
}

const app = new Hono()

app.route('/', uiRouter)
app.route('/tasks', tasksRouter)
app.route('/webhooks', webhooksRouter)
app.route('/mcp', mcpRouter)

app.get('/health', (c) => c.json({ ok: true }))

startWorker()

const server = Bun.serve({
  fetch: app.fetch,
  port: config.port,
})
console.log(`Kalos running on http://localhost:${config.port}`)

async function shutdown() {
  console.log('[orchestrator] Shutting down…')
  server.stop(true)
  await stopWorker()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

function isMiseAvailable(): boolean {
  try {
    const r = Bun.spawnSync(['mise', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    return r.exitCode === 0
  } catch {
    // Bun.spawnSync throws ENOENT when the executable isn't on PATH.
    return false
  }
}
