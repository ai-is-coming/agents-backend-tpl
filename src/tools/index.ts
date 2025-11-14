import { tavilySearchTool } from './tavily'
import { weatherTool } from './weather'

export const tools = { weather: weatherTool } as const
export const webTools = { tavily: tavilySearchTool } as const
