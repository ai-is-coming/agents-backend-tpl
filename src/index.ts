import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import agentRoutes from './routes/agent'
import { logEnvOnStartup } from './utils/env'
import { initTracer } from './utils/tracer'
import { createLogger } from './utils/logger'
import { traceIdMiddleware } from './middleware/trace'

// Log env and initialize telemetry early
logEnvOnStartup()
// Fire-and-forget; no need to block startup
void initTracer()

const app = new OpenAPIHono()

// Attach trace id middleware (W3C traceparent + X-Trace-ID)
app.use('*', traceIdMiddleware())


app.get('/', (c: any) => {
  return c.text('Hello Hono!')
})

app.route('/agent', agentRoutes)

// OpenAPI documentation
app.doc('/docs.json', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'AI Agents API',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Agent', description: 'Agent APIs' },
  ],
})

// Swagger UI
app.get('/docs', swaggerUI({ url: '/docs.json' }))

const port = Number(process.env.PORT) || 3000
Bun.serve({ port, fetch: app.fetch })
const log = createLogger('app')
log.info(`server ready at http://localhost:${port}`)
