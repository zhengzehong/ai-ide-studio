import { describe, expect, test } from 'vitest'
import {
  appendFinalizedMessage,
  buildErrorAgentMessage,
  mergeMessagesById,
  mergeMessagesForSession,
  mergeToolCall,
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
    const fullToolJson = JSON.stringify([{ id: 'tool-live', title: 'Read file', rawOutput: 'done' }])
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



  test('lightweight server history preserves local process blocks from the just-finished turn', () => {
    const local = {
      ...msg('agent-live-process', 'agent', '2026-01-01T00:00:02.000Z'),
      content: 'final answer',
      processBlocks: [{ id: 'note-1', kind: 'note' as const, text: 'checked first' }],
      finalAnswer: 'final answer',
    }
    const serverLight = {
      ...msg('agent-live-process', 'agent', '2026-01-01T00:00:02.000Z'),
      content: 'final answer',
    }

    const merged = mergeMessagesById([serverLight], [local])

    expect(merged).toHaveLength(1)
    expect(merged[0].processBlocks).toEqual(local.processBlocks)
    expect(merged[0].finalAnswer).toBe('final answer')
    expect(merged[0].processDefaultOpen).toBeUndefined()
  })

  test('lightweight server history preserves local turn stats from the just-finished turn', () => {
    const statsJson = JSON.stringify({ inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedSeconds: 2, costAmount: 0.001 })
    const local = {
      ...msg('agent-live-stats', 'agent', '2026-01-01T00:00:02.000Z'),
      decision_json: statsJson,
    }
    const serverLight = {
      ...msg('agent-live-stats', 'agent', '2026-01-01T00:00:02.000Z'),
      decision_json: null,
    }

    const merged = mergeMessagesById([serverLight], [local])

    expect(merged).toHaveLength(1)
    expect(merged[0].decision_json).toBe(statsJson)
    expect(merged[0].parsedDecision).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedSeconds: 2, costAmount: 0.001 })
  })

  test('lightweight server history exposes file-change summary metadata', () => {
    const fileChangesJson = JSON.stringify({
      files: [{ path: 'src/app.ts', changeType: 'M', addedLines: 1, deletedLines: 1 }],
      totalAdded: 1,
      totalDeleted: 1,
    })
    const serverLight = {
      ...msg('agent-file-changes', 'agent', '2026-01-01T00:00:02.000Z'),
      file_changes_json: fileChangesJson,
      has_file_changes: true,
      file_change_count: 1,
    }

    const merged = mergeMessagesById([serverLight], [])

    expect(merged).toHaveLength(1)
    expect(merged[0].file_changes_json).toBe(fileChangesJson)
    expect(merged[0].has_file_changes).toBe(true)
    expect(merged[0].file_change_count).toBe(1)
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
  test('replaces a same-id live reply instead of appending a duplicate', () => {
    const liveAgent = {
      ...msg('msg-turn', 'agent', '2026-01-01T00:00:00.000Z'),
      content: 'partial',
      status: 'running',
      processBlocks: [{ id: 'note-live', kind: 'note' as const, text: 'live note' }],
      finalAnswer: 'partial',
    }
    const finalAgent = {
      ...msg('msg-turn', 'agent', '2026-01-01T00:00:02.000Z'),
      content: 'final answer',
      status: 'completed',
      processBlocks: [{ id: 'note-final', kind: 'note' as const, text: 'final note' }],
      finalAnswer: 'final answer',
    }

    const merged = appendFinalizedMessage([liveAgent], finalAgent)

    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('msg-turn')
    expect(merged[0].content).toBe('final answer')
    expect(merged[0].processBlocks).toEqual(finalAgent.processBlocks)
    expect(merged[0].finalAnswer).toBe('final answer')
  })

  test('same-id final message preserves existing process details when the incoming row is lightweight', () => {
    const localProcess = [{ id: 'note-local', kind: 'note' as const, text: 'kept process' }]
    const existing = {
      ...msg('msg-turn-light', 'agent', '2026-01-01T00:00:00.000Z'),
      content: 'old local final',
      processBlocks: localProcess,
      finalAnswer: 'old local final',
    }
    const lightweightFinal = {
      ...msg('msg-turn-light', 'agent', '2026-01-01T00:00:02.000Z'),
      content: 'server final',
      status: 'completed',
    }

    const merged = appendFinalizedMessage([existing], lightweightFinal)

    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('server final')
    expect(merged[0].processBlocks).toEqual(localProcess)
    expect(merged[0].finalAnswer).toBe('old local final')
  })
})

describe('mergeToolCall', () => {
  test('does not let generic tool update titles overwrite a meaningful title', () => {
    const merged = mergeToolCall(
      { id: 'tool-1', title: 'filesystem.read_text_file src/app.ts', status: 'in_progress' },
      { id: 'tool-1', title: '工具调用 #abc123', status: 'completed' },
    )

    expect(merged.title).toBe('filesystem.read_text_file src/app.ts')
    expect(merged.status).toBe('completed')
  })

  test('treats mojibake generic tool titles as non-meaningful', () => {
    const merged = mergeToolCall(
      { id: 'tool-1', title: 'filesystem.read_text_file src/app.ts' },
      { id: 'tool-1', title: '宸ュ叿璋冪敤 #abc123' },
    )

    expect(merged.title).toBe('filesystem.read_text_file src/app.ts')
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

  test('pre-parses file-change summaries', () => {
    const normalized = normalizeMessage({
      ...msg('agent-with-file-changes', 'agent'),
      file_changes_json: JSON.stringify({
        files: [{ path: 'src/app.ts', changeType: 'M', addedLines: 1, deletedLines: 1 }],
        totalAdded: 1,
        totalDeleted: 1,
      }),
    })

    expect(normalized.has_file_changes).toBe(true)
    expect(normalized.file_change_count).toBe(1)
    expect(normalized.parsedFileChanges?.files[0]?.path).toBe('src/app.ts')
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
