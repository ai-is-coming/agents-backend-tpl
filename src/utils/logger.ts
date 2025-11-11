import pino from 'pino'
import { context as otelContext, trace } from '@opentelemetry/api'

function truthyEnv(val: string | undefined): boolean {
  if (!val) return false
  const v = val.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function getServiceName(): string {
  return (
    process.env.TRACER_SERVICE_NAME ||
    process.env.OTEL_SERVICE_NAME ||
    'ai-agents'
  )
}

function buildCaller(): string {
  try {
    const err = new Error()
    // Drop this function and logger internals from the stack
    const stack = (err.stack || '').split('\n').slice(2)
    for (const line of stack) {
      // Example formats:
      //   at /path/file.ts:10:5
      //   at FunctionName (/path/file.ts:10:5)
      //   at Object.method (/path/file.ts:10:5)
      const cleaned = line.trim()
      if (!cleaned) continue
      if (cleaned.includes('/utils/logger.ts')) continue
      if (cleaned.includes('node_modules/pino')) continue
      const m1 = cleaned.match(/\((.*):(\d+):(\d+)\)/)
      if (m1) return `${m1[1]}:${m1[2]}`
      const m2 = cleaned.match(/at (.*):(\d+):(\d+)/)
      if (m2) return `${m2[1]}:${m2[2]}`
    }
  } catch {
    // ignore
  }
  return 'unknown'
}

const enableCaller = truthyEnv(process.env.LOG_CALLER)
const isPretty = truthyEnv(process.env.LOG_PRETTY)
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

const transport = isPretty
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        singleLine: true,
        hideObject: true,
        messageFormat: '{msg}',
      },
    }
  : undefined

export const logger = pino({
  level,
  base: {
    service: getServiceName(),
    env: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    logMethod(args: any[], method: any) {
      const caller = enableCaller ? buildCaller() : undefined
      const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)

      // Read active OpenTelemetry span traceId (if any)
      let traceId: string | undefined
      try {
        const span = trace.getSpan(otelContext.active() as any)
        traceId = span?.spanContext().traceId
      } catch {
        // ignore
      }

      // Determine scope from child bindings
      let scope: string | undefined
      try {
        const b = (this as any)?.bindings?.()
        scope = b?.scope
      } catch {
        // ignore
      }

      // Build prefix and extra string (pretty mode)
      const prefix = `[${scope || 'app'}]`

      let extraStr = ''
      let ctxIndex = -1
      if (isPretty) {
        // find first context object
        for (let i = 0; i < args.length; i++) {
          if (isObj(args[i])) { ctxIndex = i; break }
        }

        // service/env/caller first
        const svc = getServiceName()
        const env = process.env.NODE_ENV || 'development'
        const headPairs: string[] = [
          `service:${svc}`,
          `env:${env}`,
          ...(traceId ? [`tid:${traceId}`] : []),
          ...(caller ? [`caller:${caller}`] : [])
        ]

        const tailPairs: string[] = []
        if (ctxIndex >= 0) {
          const ctx = args[ctxIndex] as Record<string, any>
          const reserved = new Set(['caller', 'service', 'env', 'scope', 'pid', 'hostname', 'time', 'level'])
          const entries = Object.entries(ctx).filter(([k]) => !reserved.has(k))
          entries.sort(([a], [b]) => a.localeCompare(b))
          for (const [k, v] of entries) {
            const val = v instanceof Error ? v.message : (typeof v === 'object' ? JSON.stringify(v) : String(v))
            tailPairs.push(`${k}:${val}`)
          }
          // Clear object keys to avoid pino-pretty printing them again
          for (const k of Object.keys(ctx)) delete (ctx as any)[k]
        }

        const allPairs = [...headPairs, ...tailPairs]
        if (allPairs.length) {
          const WHITE = '\x1b[37m'
          const RESET = '\x1b[0m'
          extraStr = ` ${WHITE}[extra]${allPairs.join(' ')}${RESET}`
        }
      } else {
        // Attach caller/traceId fields in JSON mode (if present)
        const extras: Record<string, any> = {}
        if (caller) extras.caller = caller
        if (traceId) extras.tid = traceId
        if (Object.keys(extras).length) {
          if (args.length > 0 && isObj(args[0])) {
            for (const [k, v] of Object.entries(extras)) {
              if (!(args[0] as any)[k]) (args[0] as any)[k] = v
            }
          } else {
            args.unshift(extras)
          }
        }
      }

      // Prefix message string and append extra; scope must be directly before msg (e.g., [scope]msg)
      let msgIndex = -1
      for (let i = args.length - 1; i >= 0; i--) {
        if (typeof args[i] === 'string') { msgIndex = i; break }
      }
      if (msgIndex >= 0) {
        let combined = prefix + (args[msgIndex] as string) + extraStr
        if (isPretty) combined = '\b ' + combined // overwrite the colon after level and insert a space
        args[msgIndex] = isPretty ? (combined.endsWith('\n') ? combined : combined + '\n') : combined
      } else {
        let combined = (prefix + extraStr).trim()
        if (isPretty) combined = '\b ' + combined // same colon overwrite when no explicit msg string
        args.push(isPretty ? (combined.endsWith('\n') ? combined : combined + '\n') : combined)
      }

      return (method as any).apply(this, args as any)
    },
  },
  transport,
})

export function createLogger(scope: string) {
  return logger.child({ scope })
}

export type Logger = typeof logger

