import { context as otelContext, propagation, SpanKind, SpanStatusCode, TraceFlags, trace } from '@opentelemetry/api'
import { RandomIdGenerator } from '@opentelemetry/sdk-trace-base'
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'

const otelIdGen = new RandomIdGenerator()

export function traceIdMiddleware(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    // Build a simple carrier from request headers for OTEL extraction
    const carrier: Record<string, string> = {}
    c.req.raw.headers.forEach((v, k) => {
      carrier[k] = v
    })

    // 1) Try extract from traceparent/others via W3C propagator
    let parentCtx = propagation.extract(otelContext.active(), carrier)
    let sc = trace.getSpanContext(parentCtx)

    // 2) If only X-Trace-ID is provided, synthesize a remote parent so we keep the same traceId
    const xTrace = c.req.header('x-trace-id') || c.req.header('X-Trace-ID')
    const isValidTrace = (id?: string) => !!id && /^[0-9a-f]{32}$/i.test(id) && !/^0{32}$/i.test(id)
    if ((!sc || !isValidTrace(sc.traceId)) && isValidTrace(xTrace || undefined)) {
      parentCtx = trace.setSpanContext(parentCtx, {
        traceId: (xTrace as string).toLowerCase(),
        spanId: otelIdGen.generateSpanId(),
        traceFlags: TraceFlags.SAMPLED,
      })
      sc = trace.getSpanContext(parentCtx)
    }

    // 3) Start a server span as the active span for the request
    const tracer = trace.getTracer('http-server')
    const url = new URL(c.req.url)
    const span = tracer.startSpan(
      `${c.req.method} ${url.pathname}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': c.req.method,
          'url.path': url.pathname,
          'url.query': url.search,
          'server.address': url.hostname,
          ...(url.port ? { 'server.port': Number(url.port) } : {}),
          'user_agent.original': c.req.header('user-agent') || '',
        },
      },
      parentCtx
    )

    const spanCtx = span.spanContext()
    const traceId = spanCtx.traceId

    // Make trace info available to handlers and return to client
    c.set('traceId', traceId)
    c.header('X-Trace-ID', traceId)

    // Run downstream within the span context
    await otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      try {
        await next()
        const status = c.res?.status ?? 200
        span.setAttribute('http.response.status_code', status)
        if (status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR })
        }
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        span.end()
      }
    })
  })
}
