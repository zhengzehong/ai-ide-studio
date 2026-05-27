import { describe, expect, test } from 'vitest'
import { appendFinalizedMessage, mergeMessagesById, type MessageData } from '../../ui/src/stores/session-events.ts'

function msg(id: string, role = 'human', timestamp = '2026-01-01T00:00:00.000Z'): MessageData {
  return {
    id,
    session_id: 'sess-1',
    role,
    content: id,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    timestamp,
  }
}

describe('mergeMessagesById', () => {
  test('保留本地已追加但服务端列表尚未返回的消息', () => {
    const merged = mergeMessagesById([msg('old')], [msg('old'), msg('local-new', 'human', '2026-01-01T00:00:01.000Z')])

    expect(merged.map(m => m.id)).toEqual(['old', 'local-new'])
  })

  test('服务端同 id 消息覆盖本地临时版本', () => {
    const server = { ...msg('agent-1', 'agent'), content: 'server', thinking: 'done' }
    const local = { ...msg('agent-1', 'agent'), content: 'local' }
    const merged = mergeMessagesById([server], [local])

    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('server')
    expect(merged[0].thinking).toBe('done')
  })
})

describe('appendFinalizedMessage', () => {
  test('追加重复 ACP messageId 的新回复时不删除历史回复', () => {
    const oldAgent = msg('msg-reused', 'agent', '2026-01-01T00:00:00.000Z')
    const nextAgent = { ...msg('msg-reused', 'agent', '2026-01-01T00:00:02.000Z'), content: 'new answer' }
    const merged = appendFinalizedMessage([oldAgent, msg('human-2', 'human', '2026-01-01T00:00:01.000Z')], nextAgent)

    expect(merged).toHaveLength(3)
    expect(merged[0].id).toBe('msg-reused')
    expect(merged[2].id).not.toBe('msg-reused')
    expect(merged[2].content).toBe('new answer')
  })
})
