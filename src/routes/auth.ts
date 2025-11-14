import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { LoginRequestSchema, LoginResponseSchema } from '../schemas/auth'
import type { AppEnv } from '../types/hono'
import { createLogger } from '../utils/logger'

const log = createLogger('auth')

const router = new OpenAPIHono<AppEnv>()

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Auth'],
  summary: 'User login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: LoginResponseSchema,
        },
      },
      description: 'Login successful',
    },
    400: {
      description: 'Invalid email format',
    },
  },
})

router.openapi(loginRoute, async (c) => {
  const { email } = c.req.valid('json')

  log.info({ email }, 'User login')

  // For now, just return email as token
  return c.json({ token: email })
})

export default router
