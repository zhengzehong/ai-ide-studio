import { eventStore } from '../store/sessions.js'

/**
 * 终稿只读还原(2026-09-17 sess-d83044f2 事故修复,#4)。
 *
 * 场景:消息行被"误归属的终帧"提前置为 completed,真实回答的流式分片继续到达,
 * 但写入侧 `AND status='running'` 守卫会静默拒收(现已改为留痕)——内容只留在
 * session_events 里。本模块按 messageId 把 message.chunk 分片合并还原真实终稿。
 *
 * 约束:纯只读,不写库、不放开写入守卫;调用方决定如何展示/使用。
 */
export interface RecoveredMessageDraft {
  messageId: string
  content: string
  chunkCount: number
  lastChunkAt: string | null
}

export function recoverMessageDraftFromEvents(
  sessionId: string,
  messageId: string,
): RecoveredMessageDraft | null {
  const chunks = eventStore.listMessageChunks(sessionId, messageId)
  if (chunks.length === 0) return null

  let content = ''
  let lastChunkAt: string | null = null
  for (const chunk of chunks) {
    const payload = parsePayload(chunk.payload_json)
    const delta = typeof payload?.contentDelta === 'string' ? payload.contentDelta : ''
    const full = typeof payload?.content === 'string' ? payload.content : ''
    // 与 UI 的流式合并口径一致:有增量用增量,否则用整段快照。
    content += delta || full
    lastChunkAt = chunk.created_at
  }

  return { messageId, content, chunkCount: chunks.length, lastChunkAt }
}

function parsePayload(json: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}
