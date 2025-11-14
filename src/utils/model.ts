import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV2 } from '@ai-sdk/provider'

// simple pluggable registry so future providers can be added without changing call sites
export type ProviderFactory = (opts: { model?: string }) => LanguageModelV2
const registry = new Map<string, ProviderFactory>()

// built-in providers
registry.set('deepseek', ({ model }) => {
  const deepseek = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL,
  })
  return deepseek(model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat')
})

registry.set('openai', ({ model }) => {
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  })
  return openai(model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini')
})

export function registerProvider(name: string, factory: ProviderFactory) {
  registry.set(name, factory)
}

export function getModel(opts: { provider?: string; model?: string }) {
  const providerName = opts.provider ?? process.env.DEFAULT_PROVIDER ?? 'deepseek'
  const factory = registry.get(providerName)
  if (!factory) {
    throw new Error(`Unsupported provider: ${providerName}`)
  }
  return factory({ model: opts.model })
}
