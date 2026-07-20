import type * as acp from '@agentclientprotocol/sdk'
import type { ImageAttachment, TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeSessionActorScheduler } from '../actors/session-actor.js'
import type { AcpRuntimeClientRouter } from './acp-runtime-client.js'

interface PromptSession {
  acpSessionId: string
  active: boolean
}

interface PromptAgent {
  connection: acp.ClientSideConnection
  exitPromise: Promise<never>
  router: AcpRuntimeClientRouter
}

export function enqueueSdkPrompt(input: {
  actors: RuntimeSessionActorScheduler
  agentId: string
  sessionId: string
  content: string
  images?: ImageAttachment[]
  diagnostics?: { turnId?: string; messageId?: string }
  getSession: () => PromptSession
  getAgent: () => PromptAgent
  publishDone: (event: {
    sessionId: string
    agentId: string
    messageId: string
    turnId?: string
    stopReason: string
    turnUsage?: TurnUsageData
  }) => Promise<void>
}): Promise<void> {
  return input.actors.enqueue(
    input.sessionId,
    async () => {
      const session = input.getSession()
      const agent = input.getAgent()
      const messageId = input.diagnostics?.messageId ?? `message-${Date.now()}`
      const blocks: acp.ContentBlock[] = [{ type: 'text', text: input.content }]
      for (const image of input.images ?? []) {
        blocks.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }
      session.active = true
      agent.router.beginTurn(input.sessionId, messageId, input.diagnostics?.turnId)
      try {
        const result = await Promise.race([
          agent.connection.prompt({ sessionId: session.acpSessionId, prompt: blocks }),
          agent.exitPromise,
        ])
        await input.publishDone({
          sessionId: input.sessionId,
          agentId: input.agentId,
          messageId,
          turnId: input.diagnostics?.turnId,
          stopReason: result.stopReason,
          turnUsage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                totalTokens: result.usage.totalTokens,
                cachedReadTokens: result.usage.cachedReadTokens ?? undefined,
                thoughtTokens: result.usage.thoughtTokens ?? undefined,
              }
            : undefined,
        })
      } finally {
        session.active = false
        agent.router.endTurn(input.sessionId)
      }
    },
    { payloadBytes: Buffer.byteLength(input.content, 'utf8') },
  )
}
