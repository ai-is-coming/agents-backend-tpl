import { generateText, stepCountIs, streamText } from 'ai'
import { tools } from '../tools'
import { getTelemetrySettings } from '../utils/tracer'
import { createLogger } from '../utils/logger'
import { getModel } from '../utils/model'

const system =
  'You are a helpful ai information assistant. Provide general information, not ai advice. Encourage users to consult professionals.'

export const rootAgent = {
  async generate({
    prompt,
    stream,
    webSearch,
    provider,
    model,
  }: {
    prompt: string
    stream?: boolean
    webSearch?: boolean
    provider?: string
    model?: string
  }): Promise<{ text: string } | Response> {
    const log = createLogger('agent')
    log.info('agent call rootAgent start')

    // select model via util (provider/model aware)
    const selectedModel = getModel({ provider, model })

    if (stream) {
      const result = streamText({
        model: selectedModel,
        system,
        prompt,
        tools,
        stopWhen: stepCountIs(5),
        experimental_telemetry: getTelemetrySettings('root-agent'),
      })
      log.info('agent call rootAgent end (stream)')
      // Return UI message stream so frontend can render tool steps, reasoning, etc.
      return result.toUIMessageStreamResponse({
        sendReasoning: true,
        sendSources: false,
      })
    }

    const result = await generateText({
      model: selectedModel,
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(5),
      experimental_telemetry: getTelemetrySettings('root-agent'),
    })

    log.info('agent call rootAgent end')
    return { text: result.text }
  },
}
