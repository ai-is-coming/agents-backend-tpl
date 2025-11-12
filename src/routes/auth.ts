import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { LoginRequestSchema, LoginResponseSchema } from '../schemas/auth'
import { createLogger } from '../utils/logger'

const log = createLogger('auth')

const router = new OpenAPIHono()

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

router.openapi(loginRoute, async (c: any) => {
  const { email } = c.req.valid('json')

  log.info({ email }, 'User login')

  // For now, just return email as token
  return c.json({ token: email })
})

export default router

