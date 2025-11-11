import { generateText, stepCountIs } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { tools } from '../tools'
import { getTelemetrySettings } from '../utils/tracer'
import { createLogger } from '../utils/logger'

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL,
})

const model = deepseek(process.env.DEEPSEEK_MODEL ?? 'deepseek-chat')
const system =
  'You are a helpful ai information assistant. Provide general information, not ai advice. Encourage users to consult professionals.'

export const rootAgent = {
  async generate({ prompt }: { prompt: string }): Promise<{ text: string }> {
    const log = createLogger('agent')
    log.info('agent call rootAgent start')

    const result = await generateText({
      model,
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
