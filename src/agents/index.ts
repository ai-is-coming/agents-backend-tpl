import { generateText, stepCountIs, streamText } from 'ai'
import { tools, webTools } from '../tools'
import { getTelemetrySettings } from '../utils/tracer'
import { createLogger } from '../utils/logger'
import { getModel } from '../utils/model'

const system =
  'You are a helpful ai information assistant. Provide general information, not ai advice. Encourage users to consult professionals.'

export const rootAgent = {
  async generate({
    prompt,
    messages,
    stream,
    webSearch,
    provider,
    model,
    abortSignal,
  }: {
    prompt: string
    messages?: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: any }>
    stream?: boolean
    webSearch?: boolean
    provider?: string
    model?: string
    abortSignal?: AbortSignal
  }): Promise<{ text: string } | Response> {
    const log = createLogger('agent')
    log.info('agent call rootAgent start')

    // select model via util (provider/model aware)
    const selectedModel = getModel({ provider, model })

    // Conditionally enable web search tools
    const activeTools = webSearch ? { ...tools, ...webTools } : tools

    const common = {
      model: selectedModel,
      system,
      tools: activeTools,
      stopWhen: stepCountIs(5),
      experimental_telemetry: getTelemetrySettings('root-agent'),
      abortSignal,
    } as const

    if (stream) {
      const result = messages && messages.length
        ? streamText({ ...common, messages })
        : streamText({ ...common, prompt })
      log.info('agent call rootAgent end (stream)')
      // Return UI message stream so frontend can render tool steps, reasoning, etc.
      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        sendSources: false,
      })
    }

    const result = messages && messages.length
      ? await generateText({ ...common, messages })
      : await generateText({ ...common, prompt })

    log.info('agent call rootAgent end')
    return { text: result.text }
  },
}
