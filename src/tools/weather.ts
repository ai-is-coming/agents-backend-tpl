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
      // simulate latency for UI pending state
      await new Promise((r) => setTimeout(r, 3000))
      const result = { forecast: `Sunny 25°C in ${city} (mock)` }
      log.info('tool call weather end')
      return result
    } catch (err) {
      log.error({ err }, 'tool call weather error')
      throw err
    }
  },
})
