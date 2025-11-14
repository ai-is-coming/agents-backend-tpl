import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { UIMessage } from 'ai'
import { rootAgent as defaultAgent } from '../agents'
import { prisma } from '../db/prisma'
import { AgentChatRequestSchema, AgentChatResponseSchema } from '../schemas/agent'
import type { AppEnv } from '../types/hono'
import { createLogger } from '../utils/logger'
import { getOrCreateUserByToken } from '../utils/user'

const log = createLogger('agent')

// Type for JSON values that can be stored in Prisma
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

// Type definitions for message content
type MessageContent =
  | { text: string }
  | {
      type: 'tool'
      toolCallId: string
      name: string
      status?: string
      input?: JsonValue
      inputText?: string
      output?: JsonValue
      errorText?: string
      toolName?: string
    }

type HistoryMessage = {
  role: string
  content: JsonValue
}

type ChatAgent = {
  // biome-ignore lint/suspicious/noExplicitAny: messages type varies based on agent implementation
  generate: (input: any) => Promise<Response | { text: string }>
}

// Track active streaming runs per session to support server-side cancellation
type ActiveRun = { runKey: string; cancel: () => void }
const activeRuns = new Map<string, ActiveRun>()

export const createAgentRouter = (agent: ChatAgent = defaultAgent) => {
  const router = new OpenAPIHono<AppEnv>()

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

  // biome-ignore lint/suspicious/noExplicitAny: Returns Response for streaming, not compatible with OpenAPI schema
  router.openapi(chatRoute, async (c): Promise<any> => {
    const { sessionId: sessionIdStr, prompt, stream, webSearch, provider, model } = c.req.valid('json')
    const traceId = c.get('traceId') ?? ''.padStart(32, '0')
    const token = c.get('token')

    try {
      // If no auth token (e.g., unit tests), skip persistence and ownership checks
      if (!token) {
        const result = await agent.generate({ prompt, stream, webSearch, provider, model })
        if (result instanceof Response) return result
        return c.json({ text: result.text })
      }

      // Convert sessionId from string to BigInt for database queries
      let sessionId: bigint
      try {
        sessionId = BigInt(sessionIdStr)
        if (sessionId <= 0n) {
          return c.json({ error: 'Invalid session ID' }, 400)
        }
      } catch {
        return c.json({ error: 'Invalid session ID format' }, 400)
      }

      // Verify ownership and persist user message
      const user = await getOrCreateUserByToken(c)
      const session = await prisma.chat_sessions.findFirst({
        where: { id: sessionId, user_id: user.id },
      })
      if (!session) return c.json({ error: 'Forbidden' }, 403)

      // If session was created without a title, set it to the first 50 chars of the first prompt
      if (!session.title || session.title === 'New Chat') {
        const newTitle = (prompt || '').trim().slice(0, 50)
        if (newTitle) {
          await prisma.chat_sessions.update({ where: { id: sessionId }, data: { title: newTitle } })
        }
      }

      // Cancel any previous active run for this session (superseded by new prompt)
      {
        const sessionKey = sessionId.toString()
        const prev = activeRuns.get(sessionKey)
        if (prev) {
          try {
            prev.cancel()
          } catch {}
          activeRuns.delete(sessionKey)
        }
      }

      await prisma.chat_messages.create({
        data: {
          session_id: sessionId,
          role: 'user',
          trace_id: traceId,
          content: { text: prompt } as MessageContent,
        },
      })

      // Prepare recent conversation context (user/assistant only), limit via env CHAT_HISTORY_LIMIT
      // TODO: Properly convert tool messages to UIMessage format
      const limitFromEnv = Number(process.env.CHAT_HISTORY_LIMIT)
      const historyLimit = Number.isFinite(limitFromEnv) && limitFromEnv > 0 ? Math.min(limitFromEnv, 1000) : 50

      const history = await prisma.chat_messages.findMany({
        where: { session_id: sessionId, role: { in: ['user', 'assistant'] } },
        orderBy: { id: 'desc' },
        take: historyLimit,
        select: { id: true, role: true, content: true },
      })
      history.reverse()

      const messagesForModel: UIMessage[] = []
      for (const m of history) {
        const histMsg = m as HistoryMessage & { id: bigint }
        const anyContent = histMsg.content

        const text =
          typeof anyContent === 'object' &&
          anyContent !== null &&
          !Array.isArray(anyContent) &&
          'text' in anyContent &&
          typeof anyContent.text === 'string'
            ? anyContent.text
            : typeof anyContent === 'string'
              ? anyContent
              : JSON.stringify(anyContent)

        messagesForModel.push({
          id: histMsg.id.toString(),
          role: histMsg.role as 'user' | 'assistant',
          parts: [{ type: 'text', text }],
        })
      }

      // Abort controller to propagate explicit cancellation to the agent/LLM
      const serverAbort = new AbortController()

      const result = await agent.generate({
        prompt,
        stream,
        webSearch,
        provider,
        model,
        abortSignal: serverAbort.signal,
        messages: messagesForModel,
      })

      if (result instanceof Response) {
        // Pass through the stream to the client while accumulating assistant text,
        // then persist the assistant message when the stream finishes.
        const res = result
        const contentType = res.headers.get('content-type') || ''
        const body = res.body
        if (!body) {
          await prisma.chat_sessions.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
          return res
        }

        const [toClient, toPersist] = body.tee()
        const readerClient = toClient.getReader()
        const readerPersist = toPersist.getReader()
        const decoder = new TextDecoder()

        // Register this run for server-side cancellation (supersede on next prompt)
        const runKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const sessionKey = sessionId.toString()
        activeRuns.set(sessionKey, {
          runKey,
          cancel: () => {
            try {
              readerClient.cancel()
            } catch {}
            try {
              readerPersist.cancel()
            } catch {}
            try {
              serverAbort.abort()
            } catch {}
          },
        })

        // Accumulator for the CURRENT assistant text segment (pre-tool or post-tool)
        let accText = ''
        let assistantMsgId: bigint | null = null
        let lastPersistedLen = 0
        let lastPersistAt = Date.now()

        // Tool call state keyed by toolCallId
        const toolState = new Map<
          string,
          {
            id: bigint | null
            name?: string
            status?: string
            inputText?: string
            input?: JsonValue
            output?: JsonValue
            errorText?: string
            lastLen?: number
            lastAt?: number
          }
        >()

        const persistAssistant = async () => {
          try {
            await prisma.chat_sessions.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
            if (!accText || accText.length === lastPersistedLen) return
            if (assistantMsgId == null) {
              const m = await prisma.chat_messages.create({
                data: {
                  session_id: sessionId,
                  role: 'assistant',
                  trace_id: traceId,
                  content: { text: accText } as MessageContent,
                },
                select: { id: true },
              })
              assistantMsgId = m.id
            } else {
              await prisma.chat_messages.update({
                where: { id: assistantMsgId },
                data: { content: { text: accText } as MessageContent },
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
            await prisma.chat_sessions.update({ where: { id: sessionId }, data: { updated_at: new Date() } })
            const st = toolState.get(toolCallId)
            if (!st) return
            const content: MessageContent = {
              type: 'tool',
              toolCallId,
              name: st.name || '',
              status: st.status || 'input-streaming',
              input: typeof st.input !== 'undefined' ? st.input : st.inputText || undefined,
              output: typeof st.output !== 'undefined' ? st.output : undefined,
              errorText: st.errorText,
            }
            const curLen = JSON.stringify(content).length
            const shouldWrite =
              force ||
              typeof st.lastLen !== 'number' ||
              curLen - (st.lastLen || 0) >= 64 ||
              Date.now() - (st.lastAt || 0) >= 300
            if (!shouldWrite) return

            if (st.id == null) {
              const m = await prisma.chat_messages.create({
                data: { session_id: sessionId, role: 'tool', trace_id: traceId, content },
                select: { id: true },
              })
              st.id = m.id
            } else {
              await prisma.chat_messages.update({ where: { id: st.id }, data: { content } })
            }
            st.lastLen = curLen
            st.lastAt = Date.now()
          } catch {
            // ignore tool persist errors
          }
        }

        // Background persist loop: continue accumulating and saving even if client disconnects
        const _persistLoop = (async () => {
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
                  let idx2 = buffer2.indexOf('\n\n')
                  while (idx2 !== -1) {
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
                              if (typeof obj.delta === 'string') {
                                accText += obj.delta
                                newTextAdded = true
                              }
                              break
                            case 'text':
                              if (typeof obj.text === 'string') {
                                accText += obj.text
                                newTextAdded = true
                              }
                              break
                            case 'tool-input-start': {
                              // finalize current text segment before tool
                              await flushAssistantAndReset()
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, {
                                  id: null,
                                  name: obj.toolName || '',
                                  status: 'input-streaming',
                                  lastLen: 0,
                                  lastAt: 0,
                                })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.status = 'input-streaming'
                                await persistTool(id, true)
                              }
                              break
                            }
                            case 'tool-input-delta': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, {
                                  id: null,
                                  name: obj.toolName || '',
                                  status: 'input-streaming',
                                  lastLen: 0,
                                  lastAt: 0,
                                })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.inputText = (st.inputText || '') + (obj.delta || '')
                                st.status = 'input-streaming'
                                await persistTool(id)
                              }
                              break
                            }
                            case 'tool-input-available': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.input = obj.input
                                st.status = 'input-available'
                                await persistTool(id, true)
                              }
                              break
                            }
                            case 'tool-input-error': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.input = obj.input ?? st.input
                                st.errorText = obj.errorText || 'Tool input error'
                                st.status = 'output-error'
                                await persistTool(id, true)
                              }
                              break
                            }
                            case 'tool-output-available': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.output = obj.output
                                st.status = 'output-available'
                                await persistTool(id, true)
                              }
                              break
                            }
                            case 'tool-output-error': {
                              const id = String(obj.toolCallId || obj.id || '')
                              if (!toolState.has(id)) {
                                toolState.set(id, { id: null, name: obj.toolName || '', lastLen: 0, lastAt: 0 })
                              }
                              const st = toolState.get(id)
                              if (st) {
                                st.name = obj.toolName || st.name
                                st.errorText = obj.errorText || 'Tool execution error'
                                st.status = 'output-error'
                                await persistTool(id, true)
                              }
                              break
                            }
                            default:
                              if (typeof obj.text === 'string') {
                                accText += obj.text
                                newTextAdded = true
                              } else if (typeof obj.delta === 'string') {
                                accText += obj.delta
                                newTextAdded = true
                              } else if (obj?.choices?.[0]?.delta?.content) {
                                accText += obj.choices[0].delta.content
                                newTextAdded = true
                              }
                              break
                          }
                        } else if (typeof obj === 'string') {
                          accText += obj
                          newTextAdded = true
                        }
                      } catch {
                        // Not JSON – append as plain text
                        accText += data
                        newTextAdded = true
                      }
                    }
                    idx2 = buffer2.indexOf('\n\n')
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
                if (
                  accText.length - lastPersistedLen >= charThreshold ||
                  now - (lastPersistAt ?? 0) >= timeThresholdMs
                ) {
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
            const cur = activeRuns.get(sessionKey)
            if (cur && cur.runKey === runKey) {
              activeRuns.delete(sessionKey)
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
            try {
              await readerClient.cancel()
            } catch {}
            // Ensure latest accumulated text is saved promptly
            await persistAssistant()
          },
        })

        const headers = new Headers(res.headers)
        return new Response(stream, { status: res.status, headers })
      }

      await prisma.chat_messages.create({
        data: {
          session_id: sessionId,
          role: 'assistant',
          trace_id: traceId,
          content: { text: result.text } as MessageContent,
        },
      })
      await prisma.chat_sessions.update({ where: { id: sessionId }, data: { updated_at: new Date() } })

      return c.json({ text: result.text })
    } catch (err) {
      log.error({ err, sessionId: sessionIdStr, prompt: prompt?.substring(0, 100) }, 'Failed to process chat request')
      return c.json({ error: 'Internal Server Error' }, 500)
    }
  })

  return router
}

export default createAgentRouter()
