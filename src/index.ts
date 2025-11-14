import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware } from './middleware/auth'
import { traceIdMiddleware } from './middleware/trace'
import agentRoutes from './routes/agent'
import authRoutes from './routes/auth'
import sessionRoutes from './routes/session'
import type { AppContext, AppEnv } from './types/hono'
import { logEnvOnStartup } from './utils/env'
import { createLogger } from './utils/logger'
import { initTracer } from './utils/tracer'

// runMigrations will be imported dynamically inside bootstrap to avoid type resolution issues

async function bootstrap() {
  // Log env and initialize telemetry early
  logEnvOnStartup()
  // Fire-and-forget; no need to block startup
  void initTracer()

  const log = createLogger('app')

  // Run DB migrations before serving
  try {
    const mod = (await import('./db/migrate')) as { runMigrations: () => Promise<void> }
    await mod.runMigrations()
  } catch (err) {
    log.error({ err }, 'Database migration failed on startup')
    process.exit(1)
  }

  const app = new OpenAPIHono<AppEnv>()

  // Attach trace id middleware (W3C traceparent + X-Trace-ID)
  app.use('*', traceIdMiddleware())

  // Attach auth middleware (checks Bearer token, with whitelist)
  app.use('*', authMiddleware())

  app.get('/', (c: AppContext) => {
    return c.text('Hello Hono!')
  })

  app.route('/auth', authRoutes)
  app.route('/agent', agentRoutes)
  app.route('/session', sessionRoutes)

  const servers = []
  if (process.env.DOCS_BASE_URL) {
    servers.push({ url: process.env.DOCS_BASE_URL, description: 'Configured via API_BASE_URL' })
  }

  // OpenAPI documentation
  app.doc('docs.json', {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'AI Agents API',
    },
    servers: servers,
    tags: [
      { name: 'Auth', description: 'Authentication APIs' },
      { name: 'Agent', description: 'Agent APIs' },
      { name: 'Session', description: 'Session APIs' },
    ],
  })

  // Swagger UI
  app.get('/docs', swaggerUI({ url: 'docs.json' }))

  const port = Number(process.env.PORT) || 3000
  Bun.serve({ port, fetch: app.fetch })
  log.info(`server ready at http://127.0.0.1:${port}`)
}

void bootstrap()
