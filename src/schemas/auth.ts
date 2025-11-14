import { z } from '@hono/zod-openapi'

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({
    example: 'user@ai.com',
    description: 'User email address',
  }),
})

export const LoginResponseSchema = z.object({
  token: z.string().openapi({
    example: 'user@ai.com',
    description: 'Authentication token',
  }),
})

export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
