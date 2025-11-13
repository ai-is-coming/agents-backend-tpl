import { z } from '@hono/zod-openapi'

// Request schema for POST /agent/chat (JSON body)
export const AgentChatRequestSchema = z
  .object({
    sessionId: z.number().int().positive().openapi({ example: 123 }),
    prompt: z
      .string()
      .min(1)
      .openapi({
        example: "What's the weather like in Beijing today?",
      }),
    // moved from query into JSON body
    stream: z.coerce.boolean().default(true).openapi({
      description: 'Whether to stream the response',
      example: true,
    }),
    webSearch: z.coerce.boolean().default(false).openapi({
      description: 'Enable web search (if supported by provider/model)',
      example: false,
    }),
    provider: z
      .string()
      .default('deepseek')
      .openapi({ description: 'LLM provider', example: 'deepseek' }),
    model: z
      .string()
      .optional()
      .openapi({ description: 'Model id (provider-specific)', example: 'deepseek-chat' }),
  })
  .openapi('AgentChatRequest')

// Deprecated: kept for backward compatibility if needed
export const AgentChatQuerySchema = z
  .object({
    stream: z.coerce.boolean().optional(),
    webSearch: z.coerce.boolean().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  })
  .openapi('AgentChatQuery')

// Response schema for POST /agent/chat
export const AgentChatResponseSchema = z
  .object({
    text: z.string().openapi({ example: 'The weather is sunny today.' }),
  })
  .openapi('AgentChatResponse')
