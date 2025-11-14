import { weatherTool } from './weather'
import { tavilySearchTool } from './tavily'

export const tools = { weather: weatherTool } as const
export const webTools = { tavily: tavilySearchTool } as const
