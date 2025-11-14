import type { Env, Context as HonoContext } from 'hono'

export type AppEnv = {
  Variables: {
    traceId: string
    token: string
  }
} & Env

export type AppContext = HonoContext<AppEnv>
