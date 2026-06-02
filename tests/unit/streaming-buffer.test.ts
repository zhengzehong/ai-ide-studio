import { describe, expect, test } from 'vitest'
import { StreamingBuffer } from '../../ui/src/stores/streaming-buffer.ts'

describe('StreamingBuffer', () => {
  test('merges multiple content and thinking chunks into one flush', () => {
    const buffer = new StreamingBuffer()

    buffer.push({ messageId: 'msg-1', contentDelta: '你' })
    buffer.push({ contentDelta: '好' })
    buffer.push({ thinking: '思考' })

    const snapshot = buffer.flush()

    expect(snapshot?.messageId).toBe('msg-1')
    expect(snapshot?.contentDelta).toBe('你好')
    expect(snapshot?.thinking).toBe('思考')
    expect(buffer.flush()).toBeNull()
  })

  test('merges multiple updates for the same tool id', () => {
    const buffer = new StreamingBuffer()

    buffer.push({ toolCallUpdate: { id: 'tool-1', title: '运行命令', status: 'in_progress', terminalOutputDelta: 'a' } })
    buffer.push({ toolCallUpdate: { id: 'tool-1', title: '运行命令', status: 'completed', terminalOutputDelta: 'b', progressDelta: '完成' } })

    const snapshot = buffer.flush()

    expect(snapshot?.toolCallUpdates).toHaveLength(1)
    expect(snapshot?.toolCallUpdates[0].terminalOutput).toBe('ab')
    expect(snapshot?.toolCallUpdates[0].progress).toEqual(['完成'])
    expect(snapshot?.toolCallUpdates[0].status).toBe('completed')
  })
})
