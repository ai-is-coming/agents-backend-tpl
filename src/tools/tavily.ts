import { tool } from 'ai'
import { z } from 'zod'
import { createLogger } from '../utils/logger'

// Tavily Search tool covering all supported request fields.
// Reference: https://docs.tavily.com/documentation/api-reference/endpoint/search
export const tavilySearchTool = tool({
  description: 'Search the web using Tavily and return Tavily\'s structured response (answer, results, images, etc.)',
  inputSchema: z.object({
    // Required
    query: z.string().min(1).describe('The search query to execute with Tavily.'),

    // Optional (exposed so the model can choose)
    auto_parameters: z.boolean().optional().describe('Let Tavily auto-configure parameters for the query (beta).'),
    topic: z.enum(['general', 'news', 'finance']).optional().describe('Category of the search.'),
    search_depth: z.enum(['basic', 'advanced']).optional().describe('basic (1 credit) or advanced (2 credits).'),
    chunks_per_source: z.number().int().min(1).max(3).optional().describe('Max relevant chunks per source (advanced only).'),
    max_results: z.number().int().min(0).max(20).optional().describe('Max number of results to return.'),
    time_range: z.enum(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']).optional().describe('Filter by publish/update time.'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Only results after this date.'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Only results before this date.'),
    include_answer: z.union([z.boolean(), z.enum(['basic', 'advanced'])]).optional().describe('Include LLM-generated answer.'),
    include_raw_content: z.union([z.boolean(), z.enum(['markdown', 'text'])]).optional().describe('Include cleaned page content.'),
    include_images: z.boolean().optional().describe('Also perform image search and include results.'),
    include_image_descriptions: z.boolean().optional().describe('If include_images, add descriptive text for each image.'),
    include_favicon: z.boolean().optional().describe('Include favicon URL for each result.'),
    include_domains: z.array(z.string()).optional().describe('List of domains to specifically include (<= 300).'),
    exclude_domains: z.array(z.string()).optional().describe('List of domains to specifically exclude (<= 150).'),
    // Country list is large; allow string and rely on API validation.
    country: z.string().optional().describe('Boost results from a specific country (see docs for allowed values).'),
  }),
  execute: async (input) => {
    const log = createLogger('tool')

    // Read API key (support both TAVILY_API_KEY and TAVILY_KEY)
    const apiKey = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY || ''
    if (!apiKey) {
      log.error('TAVILY_API_KEY missing in environment')
      throw new Error('Tavily API key is not configured on the server')
    }

    // Build request body by omitting undefined values
    const body: Record<string, any> = {}
    for (const [k, v] of Object.entries(input)) {
      if (typeof v !== 'undefined') body[k] = v
    }

    log.info('tool call tavily search start')
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        log.error({ status: res.status, text }, 'tavily search http error')
        throw new Error(`Tavily search failed (${res.status})`)
      }

      const data = await res.json()
      // Return Tavily response as-is so the model has full context (answer, results, images, etc.)
      log.info('tool call tavily search end')
      return data
    } catch (err) {
      log.error({ err }, 'tool call tavily search error')
      throw err
    }
  },
})

