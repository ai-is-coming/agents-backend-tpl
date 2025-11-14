import type { UIMessage } from 'ai'
import { convertToModelMessages, generateText, stepCountIs, streamText } from 'ai'
import { rootAgentPrompt } from '../prompts/root-agent'
import { tools, webTools } from '../tools'
import { createLogger } from '../utils/logger'
import { getModel } from '../utils/model'
import { getTelemetrySettings } from '../utils/tracer'

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
    messages?: UIMessage[]
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
      system: rootAgentPrompt,
      tools: activeTools,
      stopWhen: stepCountIs(5),
      experimental_telemetry: getTelemetrySettings('root-agent'),
      abortSignal,
    } as const

    if (stream) {
      const result = messages?.length
        ? streamText({
            ...common,
            messages: convertToModelMessages(messages),
            onFinish: () => {
              log.info('agent call rootAgent end (stream)')
            },
          })
        : streamText({
            ...common,
            prompt,
            onFinish: () => {
              log.info('agent call rootAgent end (stream)')
            },
          })
      // Return UI message stream so frontend can render tool steps, reasoning, etc.
      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        sendSources: false,
      })
    }

    const result = messages?.length
      ? await generateText({ ...common, messages: convertToModelMessages(messages) })
      : await generateText({ ...common, prompt })

    log.info('agent call rootAgent end')
    return { text: result.text }
  },
}
