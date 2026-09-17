import type * as acp from '@agentclientprotocol/sdk'
import { createChildLogger } from '../shared/logger.js'
import { recordPromptHeartbeat } from '../core/prompt-diagnostics.js'
import { hasMeaningfulToolTitle } from '../core/tool-title.js'
import { shouldCreateToolFromUpdate } from '../core/tool-calls.js'
import type { ToolCallData } from '../types/ws-protocol.js'
import { mapToolCallUpdate } from './update-mapper.js'

const log = createChildLogger('tool-heartbeat')

// ACP currently drops SDK heartbeat=true, but preserves Claude progress metadata.
function heartbeatParent(update: acp.ToolCallUpdate): string | null {
  if (update.status !== 'in_progress' || update.title || update.kind
    || update.rawInput != null || update.rawOutput != null
    || update.content?.length || update.locations?.length) return null
  const claude = record(record(update._meta)?.claudeCode)
  const response = record(claude?.toolResponse)
  const elapsed = response?.elapsedTimeSeconds
  if (claude?.heartbeat === true) return update.toolCallId.match(/^(.+)-heartbeat-\d+$/)?.[1] ?? update.toolCallId
  if (typeof claude?.toolName !== 'string' || typeof elapsed !== 'number'
    || !Number.isFinite(elapsed) || elapsed < 0) return null
  return update.toolCallId.match(/^(.+)-heartbeat-\d+$/)?.[1] ?? null
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** One tracker per active Session turn; never retains tool inputs or outputs. */
export class ToolHeartbeatTracker {
  private readonly tools = new Map<string, Pick<ToolCallData, 'id' | 'title' | 'status'>>()
  private readonly seen = new Set<string>()

  constructor(private readonly context: { agentId: string; sessionId: string; messageId: string }) {}

  record(tool: ToolCallData): void {
    const previous = this.tools.get(tool.id)
    this.tools.set(tool.id, {
      id: tool.id,
      title: hasMeaningfulToolTitle(tool.title) ? tool.title : previous?.title ?? tool.title,
      status: tool.status ?? previous?.status,
    })
  }

  mapUpdate(update: acp.ToolCallUpdate): ToolCallData | null {
    const parentId = heartbeatParent(update)
    // A real tool explicitly registered under a similar ID must keep its identity.
    if (parentId && (parentId === update.toolCallId || !this.tools.has(update.toolCallId))) {
      const parent = this.tools.get(parentId)
      if (!parent || parent.status === 'completed' || parent.status === 'failed') {
        log.debug({ ...this.context, toolCallId: update.toolCallId, parentId, status: parent?.status }, 'Ignored orphan or late tool heartbeat')
        return null
      }
      if (!this.seen.has(parentId)) {
        this.seen.add(parentId)
        log.info({ ...this.context, parentId }, 'Tool heartbeats associated with existing call')
      }
      log.debug({ ...this.context, toolCallId: update.toolCallId, parentId }, 'Tool heartbeat received')
      // 心跳是"回合仍活着"的独立证据:看门狗自动收敛(级别 b)对它投否决票。
      recordPromptHeartbeat(this.context.sessionId)
      parent.status = 'in_progress'
      return { id: parentId, title: parent.title, status: 'in_progress' }
    }
    const mapped = mapToolCallUpdate(update)
    if (this.tools.has(mapped.id) || shouldCreateToolFromUpdate(mapped)) this.record(mapped)
    return mapped
  }
}
