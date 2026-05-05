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
