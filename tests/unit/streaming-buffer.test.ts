import { describe, expect, test } from 'vitest'
import { StreamingBuffer } from '../../ui/src/stores/streaming-buffer.ts'

describe('StreamingBuffer ordered entries', () => {
  test('preserves content and tool order inside a batched flush', () => {
    const buffer = new StreamingBuffer()

    buffer.push({ messageId: 'msg-1', contentDelta: '先说明。' })
    buffer.push({ messageId: 'msg-1', toolCall: { id: 'tool-1', title: '读文件' } })
    buffer.push({ messageId: 'msg-1', contentDelta: '再验证。' })
    buffer.push({ messageId: 'msg-1', toolCall: { id: 'tool-2', title: '查历史' } })
    buffer.push({ messageId: 'msg-1', contentDelta: '最终结论。' })

    const snapshot = buffer.flush()

    expect(snapshot?.entries.map((entry) => entry.kind)).toEqual(['reply', 'toolCall', 'reply', 'toolCall', 'reply'])
    expect(snapshot?.entries.map((entry) => entry.kind === 'reply' ? entry.text : entry.toolCall.id)).toEqual([
      '先说明。',
      'tool-1',
      '再验证。',
      'tool-2',
      '最终结论。',
    ])
  })
})
