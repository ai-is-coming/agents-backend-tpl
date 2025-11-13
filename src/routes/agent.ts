import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { rootAgent as defaultAgent } from '../agents'
import { AgentChatRequestSchema, AgentChatResponseSchema } from '../schemas/agent'
import { prisma } from '../db/prisma'
import { getOrCreateUserByToken } from '../utils/user'

type ChatAgent = {
  generate: (input: {
    prompt: string
    stream?: boolean
    webSearch?: boolean
    provider?: string
    model?: string
    abortSignal?: AbortSignal
  }) => Promise<Response | { text: string }>
}


// Track active streaming runs per session to support server-side cancellation
type ActiveRun = { runKey: string; cancel: () => void }
const activeRuns = new Map<number, ActiveRun>()

export const createAgentRouter = (agent: ChatAgent = defaultAgent) => {
  const router = new OpenAPIHono()

  const chatRoute = createRoute({
    method: 'post',
    path: '/chat',
    tags: ['Agent'],
    summary: 'Agent chat',
    request: {
      body: {
        content: {
          'application/json': {
            schema: AgentChatRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: AgentChatResponseSchema,
          },
        },
        description: 'Generate reply from agent',
      },
    },
  })

  router.openapi(chatRoute, async (c: any) => {
    const { sessionId, prompt, stream, webSearch, provider, model } = c.req.valid('json')
    const traceId = (c.get('traceId') as string | undefined) ?? ''.padStart(32, '0')
    const token = c.get('token') as string | undefined

    try {
      // If no auth token (e.g., unit tests), skip persistence and ownership checks
      if (!token) {
        const result = await agent.generate({ prompt, stream, webSearch, provider, model })
        if (result instanceof Response) return result
        return c.json({ text: result.text })
      }

      // Verify ownership and persist user message
      const user = await getOrCreateUserByToken(c)
      const session = await prisma.chatSession.findFirst({ where: { id: sessionId, user_id: user.id } })
      if (!session) return c.json({ error: 'Forbidden' }, 403)

      // If session was created without a title, set it to the first 50 chars of the first prompt
      if (!session.title || session.title === 'New Chat') {
        const newTitle = (prompt || '').trim().slice(0, 50)
        if (newTitle) {
          await prisma.chatSession.update({ where: { id: sessionId }, data: { title: newTitle } })
        }
      }

      // Cancel any previous active run for this session (superseded by new prompt)
      {
        const prev = activeRuns.get(sessionId)
        if (prev) {
          try { prev.cancel() } catch {}
          activeRuns.delete(sessionId)
        }
      }


      await prisma.chatMessage.create({
        data: {
          session_id: sessionId,
          role: 'user',
          trace_id: traceId,
          content: { text: prompt } as any,
        },
      })

	      // Abort controller to propagate explicit cancellation to the agent/LLM
	      const serverAbort = new AbortController()


      const result = await agent.generate({ prompt, stream, webSearch, provider, model, abortSignal: serverAbort.signal })

      if (result instanceof Response) {
        // Pass through the stream to the client while accumulating assistant text,
        // then persist the assistant message when the stream finishes.
        const res = result
        const contentType = res.headers.get('content-type') || ''
        const body = res.body
        if (!body) {
          await prisma.chatSession.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
          return res
        }

        const [toClient, toPersist] = body.tee()
        const readerClient = toClient.getReader()
        const readerPersist = toPersist.getReader()
        const decoder = new TextDecoder()

        // Register this run for server-side cancellation (supersede on next prompt)
        const runKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        activeRuns.set(sessionId, {
          runKey,
          cancel: () => {
            try { readerClient.cancel() } catch {}
            try { readerPersist.cancel() } catch {}
            try { serverAbort.abort() } catch {}
          },
        })


        // Accumulator for the CURRENT assistant text segment (pre-tool or post-tool)
        let accText = ''
        let assistantMsgId: number | null = null
        let lastPersistedLen = 0
        let lastPersistAt = Date.now()

        // Tool call state keyed by toolCallId
        const toolState = new Map<string, {
          id: number | null
          name?: string
          status?: string
          inputText?: string
          input?: any
          output?: any
          errorText?: string
          lastLen?: number
          lastAt?: number
        }>()

        const persistAssistant = async () => {
          try {
            await prisma.chatSession.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
            if (!accText || accText.length === lastPersistedLen) return
            if (assistantMsgId == null) {
              const m = await prisma.chatMessage.create({
                data: {
                  session_id: sessionId,
                  role: 'assistant',
                  trace_id: traceId,
                  content: { text: accText } as any,
                },
                select: { id: true },
              })
              assistantMsgId = m.id
            } else {
              await prisma.chatMessage.update({
                where: { id: assistantMsgId },
                data: { content: { text: accText } as any },
              })
            }
            lastPersistedLen = accText.length
          } catch {
            // swallow DB errors to not break stream
          }
        }

        const flushAssistantAndReset = async () => {
          // finalize current assistant text segment and start a new one later
          await persistAssistant()
          accText = ''
          assistantMsgId = null
          lastPersistedLen = 0
          lastPersistAt = Date.now()
        }

        const persistTool = async (toolCallId: string, force = false) => {
          try {
            await prisma.chatSession.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
            const st = toolState.get(toolCallId)
            if (!st) return
            const content = {
              type: 'tool',
              toolCallId,
              name: st.name || '',
              status: st.status || 'input-streaming',
              input: typeof st.input !== 'undefined' ? st.input : (st.inputText || undefined),
              output: typeof st.output !== 'undefined' ? st.output : undefined,
              errorText: st.errorText,
            } as any
            const curLen = JSON.stringify(content).length
            const shouldWrite = force || typeof st.lastLen !== 'number' || curLen - (st.lastLen || 0) >= 64 || (Date.now() - (st.lastAt || 0)) >= 300
            if (!shouldWrite) return

            if (st.id == null) {
              const m = await prisma.chatMessage.create({
                data: { session_id: sessionId, role: 'tool', trace_id: traceId, content },
                select: { id: true },
              })
              st.id = m.id
            } else {
              await prisma.chatMessage.update({ where: { id: st.id }, data: { content } })
            }
            st.lastLen = curLen
            st.lastAt = Date.now()
          } catch {
            // ignore tool persist errors
          }
        }


        // Background persist loop: continue accumulating and saving even if client disconnects
        const persistLoop = (async () => {
          try {
            let buffer2 = ''
            while (true) {
              const { done, value } = await readerPersist.read()
              if (done) break
              let newTextAdded = false
              try {
                const chunk = decoder.decode(value, { stream: true })
                if (contentType.includes('text/event-stream')) {
                  buffer2 += chunk
                  let idx2
                  while ((idx2 = buffer2.indexOf('\n\n')) !== -1) {
                    const frame = buffer2.slice(0, idx2)
                    buffer2 = buffer2.slice(idx2 + 2)
                    const lines = frame.split('\n')
                    for (const line of lines) {
                      const trimmed = line.trim()
                      if (!trimmed.startsWith('data:')) continue
                      const data = trimmed.slice(5).trimStart()
                      if (!data || data === '[DONE]') continue
                      try {
                        const obj = JSON.parse(data)
                        if (obj && typeof obj === 'object') {
                          switch (obj.type) {
                            case 'text-delta':
                              if (typeof obj.delta === 'string') { accText += obj.delta; newTextAdded = true }
                              break
                            case 'text':
                              if (typeof obj.text === 'string') { accText += obj.text; newTextAdded = true }
                              break
                            case 'tool-input-start': {
                              // finalize current text segment before tool
                              await flushAssistantAndReset()
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', status: 'input-streaming', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.status = 'input-streaming'
                              await persistTool(id, true)
                              break
                            }
                            case 'tool-input-delta': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', status: 'input-streaming', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.inputText = (st.inputText || '') + (obj.delta || '')
                              st.status = 'input-streaming'
                              await persistTool(id)
                              break
                            }
                            case 'tool-input-available': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.input = obj.input
                              st.status = 'input-available'
                              await persistTool(id, true)
                              break
                            }
                            case 'tool-input-error': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.input = obj.input ?? st.input
                              st.errorText = obj.errorText || 'Tool input error'
                              st.status = 'output-error'
                              await persistTool(id, true)
                              break
                            }
                            case 'tool-output-available': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.output = obj.output
                              st.status = 'output-available'
                              await persistTool(id, true)
                              break
                            }
                            case 'tool-output-error': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              const st = toolState.get(id)!
                              st.name = obj.toolName || st.name
                              st.errorText = obj.errorText || 'Tool execution error'
                              st.status = 'output-error'
                              await persistTool(id, true)
                              break
                            }
                            default:
                              if (typeof obj.text === 'string') { accText += obj.text; newTextAdded = true }
                              else if (typeof obj.delta === 'string') { accText += obj.delta; newTextAdded = true }
                              else if (obj?.choices?.[0]?.delta?.content) { accText += obj.choices[0].delta.content; newTextAdded = true }
                              break
                          }
                        } else if (typeof obj === 'string') {
                          accText += obj
                          newTextAdded = true
                        }
                      } catch {
                        // Not JSON – append as plain text
                        accText += data; newTextAdded = true
                      }
                    }
                  }
                } else {
                  // Non-SSE response: treat as plain text
                  accText += chunk
                  newTextAdded = true
                }
              } catch {
                // ignore parse errors
              }

              if (newTextAdded) {
                const now = Date.now()
                const charThreshold = 64
                const timeThresholdMs = 300
                if ((accText.length - lastPersistedLen) >= charThreshold || (now - (lastPersistAt ?? 0)) >= timeThresholdMs) {
                  await persistAssistant()
                  lastPersistAt = now
                }
              }
            }
          } finally {
            // finalize current text segment and flush all tool states
            await persistAssistant()
            for (const id of Array.from(toolState.keys())) {
              await persistTool(id, true)
            }
            // cleanup active run if still current
            const cur = activeRuns.get(sessionId)
            if (cur && cur.runKey === runKey) {
              activeRuns.delete(sessionId)
            }
          }
        })()

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await readerClient.read()
                if (done) break
                // Relay to client
                controller.enqueue(value)
              }
            } finally {
              controller.close()
            }
          },
          async cancel() {
            // Client disconnected: stop client branch, background loop continues
            try { await readerClient.cancel() } catch {}
            // Ensure latest accumulated text is saved promptly
            await persistAssistant()
          },
        })

        const headers = new Headers(res.headers)
        return new Response(stream, { status: res.status, headers })
      }

      await prisma.chatMessage.create({
        data: {
          session_id: sessionId,
          role: 'assistant',
          trace_id: traceId,
          content: { text: result.text } as any,
        },
      })
      await prisma.chatSession.update({ where: { id: sessionId }, data: { updated_at: new Date() } })

      return c.json({ text: result.text })
    } catch (err) {
      return c.json({ error: 'Internal Server Error' }, 500)
    }
  })

  return router
}

export default createAgentRouter()
