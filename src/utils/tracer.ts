import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { createLogger } from './logger'


/* OpenTelemetry tracer bootstrap with env-based config.
 * - Enable/disable via TRACER_ENABLED (true/false/1/0/yes/no)
 * - Configure OTLP endpoint via TRACER_OTLP_ENDPOINT (preferred),
 *   or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT / OTLP_ENDPOINT
 * - Optional service name via TRACER_SERVICE_NAME or OTEL_SERVICE_NAME (default: ai-agents)
 * - Optional sampling via TRACER_SAMPLE_RATIO (0..1, default 1)
 * - Optional input/output recording via TRACER_RECORD_INPUTS / TRACER_RECORD_OUTPUTS (default false)
 */

// NOTE: Using static imports for @opentelemetry/* as requested. Ensure deps are installed when TRACER_ENABLED=true.

let tracerRef: any | undefined

function truthyEnv(val: string | undefined): boolean {
  if (!val) return false
  const v = val.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function getEnv(key: string, def?: string): string | undefined {
  const v = process.env[key]
  return v == null || v === '' ? def : v
}

function getOtlpEndpoint(): string | undefined {
  return (
    getEnv('TRACER_OTLP_ENDPOINT') ||
    getEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ||
    getEnv('OTEL_EXPORTER_OTLP_ENDPOINT') ||
    getEnv('OTLP_ENDPOINT')
  )
}

function getServiceName(): string {
  return getEnv('TRACER_SERVICE_NAME') || getEnv('OTEL_SERVICE_NAME') || 'ai-agents'
}

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined
  // Format: key1=value1,key2=value2
  const headers: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const [k, ...rest] = part.split('=')
    if (!k) continue
    const key = k.trim()
    const value = rest.join('=').trim()
    if (key && value) headers[key] = value
  }
  return Object.keys(headers).length ? headers : undefined
}

function getOtlpHeaders(): Record<string, string> | undefined {
  return parseHeaders(getEnv('TRACER_OTLP_HEADERS') || getEnv('OTEL_EXPORTER_OTLP_HEADERS'))
}

function getSampleRatio(): number {
  const raw = getEnv('TRACER_SAMPLE_RATIO')
  if (!raw) return 1.0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1.0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

export function telemetryEnabled(): boolean {
  return truthyEnv(getEnv('TRACER_ENABLED')) || truthyEnv(getEnv('AI_TELEMETRY_ENABLED'))
}

const log = createLogger('telemetry')

export async function initTracer(): Promise<void> {
  if (!telemetryEnabled()) {
    log.info('disabled via env (TRACER_ENABLED=false).')
    return
  }

  const endpoint = getOtlpEndpoint()
  if (!endpoint) {
    log.warn('TRACER_ENABLED=true but no OTLP endpoint configured. Set TRACER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT.')
  }

  try {
    const serviceName = getServiceName()
    const sampleRatio = getSampleRatio()

    const exporterOptions: any = {}
    if (endpoint) exporterOptions.url = endpoint
    const headers = getOtlpHeaders()
    if (headers) exporterOptions.headers = headers
    const exporter = new OTLPTraceExporter(exporterOptions)

    const provider = new NodeTracerProvider({
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version || 'unknown',
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    })

    // Register as the global tracer provider
    provider.register()
    tracerRef = provider.getTracer(serviceName)

    log.info({
      endpoint: endpoint || '(default exporter endpoint)',
      service: serviceName,
      sampleRatio,
    }, 'initialized')
  } catch (err) {
    log.warn({ err }, 'failed to initialize; telemetry will be disabled.')
    tracerRef = undefined
  } finally {
    // no-op
  }
}

function recordInputsDefault(): boolean {
  // Be conservative by default
  return truthyEnv(getEnv('TRACER_RECORD_INPUTS'))
}

function recordOutputsDefault(): boolean {
  // Be conservative by default
  return truthyEnv(getEnv('TRACER_RECORD_OUTPUTS'))
}

export function getTelemetrySettings(functionId?: string): any | undefined {
  if (!telemetryEnabled()) return undefined
  // Only enable if tracer was initialized successfully
  const ready = !!tracerRef
  return {
    isEnabled: ready,
    recordInputs: recordInputsDefault(),
    recordOutputs: recordOutputsDefault(),
    functionId,
    tracer: tracerRef,
    metadata: {
      service: getServiceName(),
      env: process.env.NODE_ENV || 'development',
    },
  }
}

export function getTracer(): any | undefined {
  return tracerRef
}

