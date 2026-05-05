import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { mcpServer } from './server.js'
import { apiKeyMiddleware } from '../auth.js'

export const mcpRouter = new Hono()

mcpRouter.use('*', apiKeyMiddleware)

async function handleMcp(req: Request): Promise<Response> {
  // No sessionIdGenerator → stateless mode (2025-03-26 spec)
  const transport = new WebStandardStreamableHTTPServerTransport({})
  await mcpServer.connect(transport)
  return transport.handleRequest(req)
}

mcpRouter.post('/', (c) => handleMcp(c.req.raw))
mcpRouter.get('/', (c) => handleMcp(c.req.raw))
mcpRouter.delete('/', (c) => handleMcp(c.req.raw))

mcpRouter.all('/', (c) => c.text('Method Not Allowed', 405))
