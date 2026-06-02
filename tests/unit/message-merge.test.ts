import { describe, expect, test } from 'vitest'
import {
  appendFinalizedMessage,
  buildErrorAgentMessage,
  mergeMessagesById,
  mergeMessagesForSession,
  normalizeMessage,
  type MessageData,
} from '../../ui/src/stores/session-events.ts'

function msg(id: string, role = 'human', timestamp = '2026-01-01T00:00:00.000Z', sessionId = 'sess-1'): MessageData {
  return {
    id,
    session_id: sessionId,
    role,
    content: id,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    timestamp,
  }
}

describe('mergeMessagesForSession', () => {
  test('drops messages from the previously selected session when the new session has no history', () => {
    const merged = mergeMessagesForSession([], [msg('old-session-message', 'agent', '2026-01-01T00:00:00.000Z', 'sess-old')], 'sess-new')

    expect(merged).toEqual([])
  })

  test('keeps optimistic messages that belong to the selected session', () => {
    const local = msg('msg-local-pending', 'human', '2026-01-01T00:00:01.000Z', 'sess-new')
    const merged = mergeMessagesForSession([], [local, msg('old-session-message', 'agent', '2026-01-01T00:00:00.000Z', 'sess-old')], 'sess-new')

    expect(merged).toEqual([normalizeMessage(local)])
  })


  test('replaces optimistic human message with matching server message', () => {
    const local = {
      ...msg('msg-local-123', 'human', '2026-01-01T00:00:01.000Z', 'sess-new'),
      content: 'same prompt',
    }
    const server = {
      ...msg('msg-server-human', 'human', '2026-01-01T00:00:02.000Z', 'sess-new'),
      content: 'same prompt',
    }

    const merged = mergeMessagesForSession([server], [local], 'sess-new')

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('msg-server-human')
    expect(merged[0].content).toBe('same prompt')
  })

  test('replaces locally finalized agent reply with matching server message', () => {
    const local = {
      ...msg('msg-stream-agent', 'agent', '2026-01-01T00:00:03.000Z', 'sess-new'),
      content: 'same answer',
    }
    const server = {
      ...msg('msg-server-agent', 'agent', '2026-01-01T00:00:04.000Z', 'sess-new'),
      content: 'same answer',
    }

    const merged = mergeMessagesForSession([server], [local], 'sess-new')

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('msg-server-agent')
    expect(merged[0].content).toBe('same answer')
  })

  test('preserves full live tool calls when replacing a matching lightweight server message', () => {
    const fullToolJson = JSON.stringify([{ id: 'tool-live', title: 'tool', rawOutput: 'done' }])
    const local = {
      ...msg('msg-stream-agent', 'agent', '2026-01-01T00:00:03.000Z', 'sess-new'),
      content: 'same answer',
      tool_calls_json: fullToolJson,
      has_tool_calls: true,
      tool_call_count: 1,
    }
    const server = {
      ...msg('msg-server-agent', 'agent', '2026-01-01T00:00:04.000Z', 'sess-new'),
      content: 'same answer',
      has_tool_calls: true,
      tool_call_count: 1,
    }

    const merged = mergeMessagesForSession([server], [local], 'sess-new')

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('msg-server-agent')
    expect(merged[0].tool_calls_json).toBe(fullToolJson)
    expect(merged[0].parsedToolCalls?.[0].id).toBe('tool-live')
  })
})

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

describe('buildErrorAgentMessage', () => {
  test('uses the done message id so live fallback and server history merge into one message', () => {
    const message = buildErrorAgentMessage('sess-1', 'error-123', 'adapter failed')

    expect(message.id).toBe('error-123')
    expect(message.session_id).toBe('sess-1')
    expect(message.role).toBe('agent')
    expect(message.content).toContain('adapter failed')
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
