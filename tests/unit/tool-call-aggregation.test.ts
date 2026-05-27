import { describe, expect, test } from 'vitest'
import { mergeToolCall, shouldCreateToolFromUpdate } from '../../src/core/tool-calls.js'
import { mergeToolCall as mergeUiToolCall, shouldCreateToolFromUpdate as shouldCreateUiToolFromUpdate, reduceSessionEvents } from '../../ui/src/stores/session-events.ts'

describe('tool update aggregation', () => {
  test('ignores status-only completed updates without a preceding tool call', () => {
    expect(shouldCreateToolFromUpdate({ id: 'tool-1', title: '工具调用', status: 'completed' })).toBe(false)
    expect(shouldCreateUiToolFromUpdate({ id: 'tool-1', title: '工具调用', status: 'completed' })).toBe(false)

    const state = reduceSessionEvents([
      {
        id: 'evt-1',
        session_id: 'sess-1',
        agent_id: 'agent-1',
        acp_session_id: null,
        message_id: 'msg-1',
        type: 'tool.update',
        role: 'agent',
        payload_json: JSON.stringify({ messageId: 'msg-1', toolCall: { id: 'tool-1', title: '工具调用', status: 'completed' } }),
        sequence: 1,
        created_at: new Date().toISOString(),
      },
    ])

    expect(state.streamingMessage).toBeNull()
  })

  test('does not overwrite a useful title with a generic update title', () => {
    const merged = mergeToolCall({ id: 'tool-1', title: 'Read file', status: 'in_progress' }, { id: 'tool-1', title: '工具调用', status: 'completed' })
    const uiMerged = mergeUiToolCall({ id: 'tool-1', title: 'Read file', status: 'in_progress' }, { id: 'tool-1', title: '工具调用', status: 'completed' })

    expect(merged.title).toBe('Read file')
    expect(uiMerged.title).toBe('Read file')
    expect(merged.status).toBe('completed')
    expect(uiMerged.status).toBe('completed')
  })
})
