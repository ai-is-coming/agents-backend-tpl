import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { prisma } from '../db/prisma'
import {
  MessageListQuerySchema,
  MessageListResponseSchema,
  SessionCreateRequestSchema,
  SessionCreateResponseSchema,
  SessionListQuerySchema,
  SessionListResponseSchema,
} from '../schemas/session'
import type { AppEnv } from '../types/hono'
import { createLogger } from '../utils/logger'
import { getOrCreateUserByToken } from '../utils/user'

const log = createLogger('session')

const router = new OpenAPIHono<AppEnv>()

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

router.openapi(createRouteDef, async (c) => {
  const { title } = c.req.valid('json')
  try {
    const user = await getOrCreateUserByToken(c)
    const session = await prisma.chat_sessions.create({
      data: { user_id: user.id, title: title ?? 'New Chat', status: 1 },
    })
    return c.json({ sessionId: session.id.toString() })
  } catch (err) {
    log.error({ err }, 'Failed to create session')
    // biome-ignore lint/suspicious/noExplicitAny: Error response not in OpenAPI schema
    return c.json({ error: 'Internal Server Error' }, 500) as any
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

router.openapi(listRouteDef, async (c) => {
  const { limit, before } = c.req.valid('query')
  try {
    const user = await getOrCreateUserByToken(c)
    const where: { user_id: bigint; updated_at?: { lt: Date } } = { user_id: user.id }
    if (before) where.updated_at = { lt: new Date(before) }
    const sessions = await prisma.chat_sessions.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: limit,
      select: { id: true, title: true, status: true, created_at: true, updated_at: true },
    })
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id.toString(),
        title: s.title,
        status: s.status,
        created_at: s.created_at?.toISOString() ?? new Date().toISOString(),
        updated_at: s.updated_at?.toISOString() ?? new Date().toISOString(),
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

router.openapi(msgListRouteDef, async (c) => {
  const idStr = c.req.param('id')
  let sessionId: bigint
  try {
    sessionId = BigInt(idStr)
    if (sessionId <= 0n) return c.json({ error: 'Invalid session id' }, 400)
  } catch {
    return c.json({ error: 'Invalid session id format' }, 400)
  }
  const { limit, afterId } = c.req.valid('query')
  try {
    const user = await getOrCreateUserByToken(c)
    const session = await prisma.chat_sessions.findFirst({
      where: { id: sessionId, user_id: user.id },
    })
    if (!session) return c.json({ error: 'Session not found' }, 404)

    const where: { session_id: bigint; id?: { gt: bigint } } = { session_id: sessionId }
    if (typeof afterId !== 'undefined') where.id = { gt: BigInt(afterId) }

    const messages = await prisma.chat_messages.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, role: true, trace_id: true, content: true, created_at: true, updated_at: true },
    })

    return c.json({
      messages: messages.map((m) => ({
        id: m.id.toString(),
        role: m.role as 'user' | 'assistant' | 'tool',
        trace_id: m.trace_id,
        content: m.content,
        created_at: m.created_at?.toISOString() ?? new Date().toISOString(),
        updated_at: m.updated_at?.toISOString() ?? new Date().toISOString(),
      })),
    })
  } catch (err) {
    log.error({ err }, 'Failed to list messages')
    return c.json({ messages: [] })
  }
})

export default router
