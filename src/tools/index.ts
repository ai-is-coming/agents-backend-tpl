import { tool } from 'ai'
import { z } from 'zod'
import { createLogger } from '../utils/logger'

export const weatherTool = tool({
  description: 'Get a mock weather forecast for a city',
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const log = createLogger('tool')
    log.info('tool call weather start')
    try {
      const result = { forecast: `Sunny 25°C in ${city} (mock)` }
      log.info('tool call weather end')
      return result
    } catch (err) {
      log.error({ err }, 'tool call weather error')
      throw err
    }
  },
})

export const tools = { weather: weatherTool } as const
