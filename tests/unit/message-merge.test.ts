import { describe, expect, test } from 'vitest'
import { appendFinalizedMessage, mergeMessagesById, normalizeMessage, type MessageData } from '../../ui/src/stores/session-events.ts'

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
  test('keeps local messages that the server has not returned yet', () => {
    const merged = mergeMessagesById([msg('old')], [msg('old'), msg('local-new', 'human', '2026-01-01T00:00:01.000Z')])

    expect(merged.map(m => m.id)).toEqual(['old', 'local-new'])
  })

  test('lightweight server history does not replace full tool calls already visible in the current turn', () => {
    const fullToolJson = JSON.stringify([{ id: 'tool-live', title: '????', rawOutput: 'done' }])
    const local = {
      ...msg('agent-live', 'agent', '2026-01-01T00:00:02.000Z'),
      tool_calls_json: fullToolJson,
      has_tool_calls: true,
      tool_call_count: 1,
    }
    const serverLight = {
      ...msg('agent-live', 'agent', '2026-01-01T00:00:02.000Z'),
      tool_calls_json: null,
      has_tool_calls: true,
      tool_call_count: 1,
    }

    const merged = mergeMessagesById([serverLight], [local])

    expect(merged).toHaveLength(1)
    expect(merged[0].tool_calls_json).toBe(fullToolJson)
    expect(merged[0].parsedToolCalls?.[0].id).toBe('tool-live')
  })

  test('server message with full content replaces local temporary version', () => {
    const server = { ...msg('agent-1', 'agent'), content: 'server', thinking: 'done' }
    const local = { ...msg('agent-1', 'agent'), content: 'local' }
    const merged = mergeMessagesById([server], [local])

    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('server')
    expect(merged[0].thinking).toBe('done')
  })
})

describe('appendFinalizedMessage', () => {
  test('appends a new reply even when ACP reuses a message id', () => {
    const oldAgent = msg('msg-reused', 'agent', '2026-01-01T00:00:00.000Z')
    const nextAgent = { ...msg('msg-reused', 'agent', '2026-01-01T00:00:02.000Z'), content: 'new answer' }
    const merged = appendFinalizedMessage([oldAgent, msg('human-2', 'human', '2026-01-01T00:00:01.000Z')], nextAgent)

    expect(merged).toHaveLength(3)
    expect(merged[0].id).toBe('msg-reused')
    expect(merged[2].id).not.toBe('msg-reused')
    expect(merged[2].content).toBe('new answer')
  })
})

describe('normalizeMessage', () => {
  test('pre-parses attachments and preserves lightweight tool metadata', () => {
    const normalized = normalizeMessage({
      ...msg('agent-with-tools', 'agent'),
      attachments_json: JSON.stringify([{ data: 'abc', mimeType: 'image/png' }]),
      has_tool_calls: true,
      tool_call_count: 3,
    })

    expect(normalized.parsedAttachments).toEqual([{ data: 'abc', mimeType: 'image/png' }])
    expect(normalized.has_tool_calls).toBe(true)
    expect(normalized.tool_call_count).toBe(3)
    expect(normalized.parsedToolCalls).toBeUndefined()
  })

  test('derives tool metadata from full tool JSON', () => {
    const normalized = normalizeMessage({
      ...msg('agent-full-tools', 'agent'),
      tool_calls_json: JSON.stringify([{ id: 'tool-1', title: '???' }]),
    })

    expect(normalized.has_tool_calls).toBe(true)
    expect(normalized.tool_call_count).toBe(1)
    expect(normalized.parsedToolCalls?.[0].id).toBe('tool-1')
  })
})
