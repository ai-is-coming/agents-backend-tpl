import { z } from '@hono/zod-openapi'

// Request schema for POST /agent/chat
export const AgentChatRequestSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .openapi({
        example: 'What\'s the weather like in Beijing today?',
      }),
  })
  .openapi('AgentChatRequest')

// Response schema for POST /agent/chat
export const AgentChatResponseSchema = z
  .object({
    text: z.string().openapi({ example: 'The weather is sunny today.' }),
  })
  .openapi('AgentChatResponse')

