import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { createAgentRouter } from '../../src/routes/agent'

// Fake agent for unit testing to avoid real API calls
const fakeAgent = {
  async generate({ prompt }: { prompt: string; stream?: boolean; webSearch?: boolean; provider?: string; model?: string }) {
    return { text: `MOCK: ${prompt}` }
  },
}

describe('POST /agent/chat', () => {
  it('returns text from the agent', async () => {
    const app = new Hono()
    app.route('/agent', createAgentRouter(fakeAgent))

    const res = await app.request('/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 1, prompt: 'Hello' }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.text).toBe('MOCK: Hello')
  })
})

