import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { rootAgent as defaultAgent } from '../agents'
import { AgentChatRequestSchema, AgentChatResponseSchema } from '../schemas/agent'

type ChatAgent = {
  generate: (input: { prompt: string }) => Promise<{ text: string }>
}

export const createAgentRouter = (agent: ChatAgent = defaultAgent) => {
  const router = new OpenAPIHono()

  const chatRoute = createRoute({
    method: 'post',
    path: '/chat',
    tags: ['Agent'],
    summary: 'Agent chat',
    request: {
      body: {
        content: {
          'application/json': {
            schema: AgentChatRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: AgentChatResponseSchema,
          },
        },
        description: 'Generate reply from agent',
      },
    },
  })

  router.openapi(chatRoute, async (c: any) => {
    const { prompt } = c.req.valid('json')
    const result = await agent.generate({ prompt })
    return c.json({ text: result.text })
  })

  return router
}

export default createAgentRouter()
