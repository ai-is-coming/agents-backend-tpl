import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { createLogger } from '../utils/logger'
import { prisma } from '../db/prisma'
import { getOrCreateUserByToken } from '../utils/user'
import {
  SessionCreateRequestSchema,
  SessionCreateResponseSchema,
  SessionListQuerySchema,
  SessionListResponseSchema,
  MessageListQuerySchema,
  MessageListResponseSchema,
} from '../schemas/session'

const log = createLogger('session')

const router = new OpenAPIHono()

const createRouteDef = createRoute({
  method: 'post',
  path: '/create',
  tags: ['Session'],
  summary: 'Create a new chat session',
  request: {
    body: {
      content: {
        'application/json': { schema: SessionCreateRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Session created',
      content: { 'application/json': { schema: SessionCreateResponseSchema } },
    },
  },
})

router.openapi(createRouteDef, async (c: any) => {
  const { title } = c.req.valid('json')
  try {
    const user = await getOrCreateUserByToken(c)
    const session = await prisma.chatSession.create({
      data: { user_id: user.id, title: title ?? 'New Chat', status: 1 },
    })
    return c.json({ sessionId: session.id })
  } catch (err) {
    log.error({ err }, 'Failed to create session')
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

const listRouteDef = createRoute({
  method: 'get',
  path: '/list',
  tags: ['Session'],
  summary: 'List sessions for current user',
  request: {
    query: SessionListQuerySchema,
  },
  responses: {
    200: {
      description: 'List of sessions',
      content: { 'application/json': { schema: SessionListResponseSchema } },
    },
  },
})

router.openapi(listRouteDef, async (c: any) => {
  const { limit, before } = c.req.valid('query')
  try {
    const user = await getOrCreateUserByToken(c)
    const where: any = { user_id: user.id }
    if (before) where.updated_at = { lt: new Date(before) }
    const sessions = await prisma.chatSession.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: limit,
      select: { id: true, title: true, status: true, created_at: true, updated_at: true },
    })
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        created_at: s.created_at.toISOString(),
        updated_at: s.updated_at.toISOString(),
      })),
    })
  } catch (err) {
    log.error({ err }, 'Failed to list sessions')
    return c.json({ sessions: [] })
  }
})

const msgListRouteDef = createRoute({
  method: 'get',
  path: '/:id/msg/list',
  tags: ['Session'],
  summary: 'List messages for a session',
  request: {
    params: z.object({ id: z.string() }),
    query: MessageListQuerySchema,
  },
  responses: {
    200: {
      description: 'List of messages',
      content: { 'application/json': { schema: MessageListResponseSchema } },
    },
    404: { description: 'Session not found' },
  },
})

router.openapi(msgListRouteDef, async (c: any) => {
  const idStr = c.req.param('id')
  const sessionId = Number(idStr)
  if (!Number.isFinite(sessionId) || sessionId <= 0) return c.json({ error: 'Invalid session id' }, 400)
  const { limit, afterId } = c.req.valid('query')
  try {
    const user = await getOrCreateUserByToken(c)
    const session = await prisma.chatSession.findFirst({ where: { id: sessionId, user_id: user.id } })
    if (!session) return c.json({ error: 'Session not found' }, 404)

    const where: any = { session_id: sessionId }
    if (typeof afterId !== 'undefined') where.id = { gt: BigInt(afterId) }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, role: true, trace_id: true, content: true, created_at: true, updated_at: true },
    })

    return c.json({
      messages: messages.map((m) => ({
        id: Number(m.id),
        role: m.role as any,
        trace_id: m.trace_id,
        content: m.content,
        created_at: m.created_at.toISOString(),
        updated_at: m.updated_at.toISOString(),
      })),
    })
  } catch (err: any) {
    log.error({ err }, 'Failed to list messages')
    return c.json({ messages: [] })
  }
})

export default router

