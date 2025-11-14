import { z } from '@hono/zod-openapi'

export const SessionCreateRequestSchema = z
  .object({
    title: z.string().max(255).optional().openapi({ example: 'New Chat' }),
  })
  .openapi('SessionCreateRequest')

export const SessionCreateResponseSchema = z
  .object({
    sessionId: z.coerce.string().openapi({ example: '123456789' }),
  })
  .openapi('SessionCreateResponse')

export const SessionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: z.string().datetime().optional(),
  })
  .openapi('SessionListQuery')

export const SessionListItemSchema = z.object({
  id: z.coerce.string().openapi({ example: '123456789' }),
  title: z.string(),
  status: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const SessionListResponseSchema = z
  .object({
    sessions: z.array(SessionListItemSchema),
  })
  .openapi('SessionListResponse')

export const MessageListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    afterId: z.coerce.string().optional().openapi({ example: '123456789' }),
  })
  .openapi('MessageListQuery')

export const MessageItemSchema = z.object({
  id: z.coerce.string().openapi({ example: '123456789' }),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  trace_id: z.string().length(32),
  content: z.any(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const MessageListResponseSchema = z
  .object({
    messages: z.array(MessageItemSchema),
  })
  .openapi('MessageListResponse')
