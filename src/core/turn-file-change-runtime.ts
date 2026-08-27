import { stableProcessItemId } from '../store/turn-process-items.js'
import type { FileChangeDetailData, ToolCallData } from '../types/ws-protocol.js'
import { FileChangeProcessQueue } from './file-change-process-queue.js'
import { calculateFileChangesInWorker } from './file-change-worker-client.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { turnProcessWriteQueue } from './persistence/turn-process-write-queue.js'

const log = createChildLogger('turn-file-change-runtime')
const queue = new FileChangeProcessQueue({
  calculate: calculateFileChangesInWorker,
  onError: (error, input) => {
    log.error({
      err: error,
      sessionId: input.sessionId,
      agentId: input.agentId,
      messageId: input.messageId,
      toolCallId: input.toolCall.id,
    }, 'file-change worker calculation failed; continuing turn without blocking')
  },
})

export function updateTurnFileChange(
  sessionId: string,
  agentId: string,
  messageId: string,
  toolCall: ToolCallData | undefined,
): void {
  if (!toolCall) return
  queue.update({
    sessionId,
    agentId,
    messageId,
    toolCall,
    onResult: (changes, calculatedToolCall) => persistFileChange(
      sessionId,
      agentId,
      messageId,
      calculatedToolCall,
      changes,
    ),
  })
}

export function drainTurnFileChanges(sessionId: string): Promise<void> {
  return queue.drain(sessionId)
}

export function finishTurnFileChanges(sessionId: string): void {
  queue.finish(sessionId)
}

export function resetTurnFileChanges(): void {
  queue.reset()
}

function persistFileChange(
  sessionId: string,
  agentId: string,
  messageId: string,
  toolCall: ToolCallData,
  changes: FileChangeDetailData,
): void {
  if (changes.files.length === 0) return
  turnProcessWriteQueue.upsert({
    id: stableProcessItemId(messageId, 'file_change', toolCall.id),
    sessionId,
    messageId,
    kind: 'file_change',
    status: toolCall.status ?? 'completed',
    title: '文件修改',
    summary: `修改 ${changes.files.length} 个文件，+${changes.totalAdded} -${changes.totalDeleted}`,
    preview: changes.files.map((file) => file.path).join(', '),
    detail: changes,
    meta: { toolCallId: toolCall.id },
  }, (item) => events.emit('session:process_item', {
    sessionId,
    agentId,
    item: {
      ...item,
      detail_json: undefined,
      has_detail: !!item.detail_json,
    },
  }))
}
