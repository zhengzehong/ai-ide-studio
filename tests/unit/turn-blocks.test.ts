import { describe, expect, test } from 'vitest'
import {
  applyTurnEntry,
  createEmptyTurn,
  processBlocksForCompletedTurn,
  turnFromEntries,
  turnFromEvents,
  turnFromProcessItems,
  type TurnEntry,
} from '../../ui/src/stores/turn-blocks.ts'
import type { SessionEventData } from '../../ui/src/stores/session-events.ts'

function entry(sequence: number, input: Omit<TurnEntry, 'sequence'>): TurnEntry {
  return { sequence, ...input }
}

function ev(sequence: number, type: string, payload: unknown, messageId = 'msg-agent-1'): SessionEventData {
  return {
    id: `evt-${sequence}`,
    session_id: 'sess-1',
    agent_id: 'agent-1',
    acp_session_id: null,
    message_id: messageId,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
  }
}

describe('turn block reducer', () => {
  test('keeps thinking and tools in process while exposing only the last reply as final answer', () => {
    const turn = turnFromEntries('msg-agent-1', [
      entry(1, { kind: 'thinking', text: '先判断问题。' }),
      entry(2, { kind: 'reply', text: '我先读代码。' }),
      entry(3, { kind: 'toolCall', toolCall: { id: 'tool-1', title: '读文件', status: 'in_progress' } }),
      entry(4, { kind: 'toolUpdate', toolCall: { id: 'tool-1', title: '读文件', status: 'completed' } }),
      entry(5, { kind: 'reply', text: '还需要查历史。' }),
      entry(6, { kind: 'toolCall', toolCall: { id: 'tool-2', title: '查历史', status: 'completed' } }),
      entry(7, { kind: 'reply', text: '最终原因是消息被压平。' }),
    ])

    expect(turn.finalAnswer).toBe('最终原因是消息被压平。')
    expect(turn.processBlocks.map((block) => block.kind)).toEqual(['thinking', 'note', 'tool', 'note', 'tool'])
    expect(turn.processBlocks.filter((block) => block.kind === 'note').map((block) => block.text)).toEqual([
      '我先读代码。',
      '还需要查历史。',
    ])
    expect(turn.processBlocks.find((block) => block.kind === 'tool')?.toolCall.status).toBe('completed')
  })

  test('demotes a final-answer candidate back into process when another tool arrives', () => {
    let turn = createEmptyTurn('msg-agent-1')
    turn = applyTurnEntry(turn, entry(1, { kind: 'toolCall', toolCall: { id: 'tool-1', title: '读文件' } }))
    turn = applyTurnEntry(turn, entry(2, { kind: 'reply', text: '看起来是 A。' }))
    expect(turn.finalAnswer).toBe('看起来是 A。')

    turn = applyTurnEntry(turn, entry(3, { kind: 'toolCall', toolCall: { id: 'tool-2', title: '继续验证' } }))

    expect(turn.finalAnswer).toBe('')
    expect(turn.processBlocks.map((block) => block.kind)).toEqual(['tool', 'note', 'tool'])
    expect(turn.processBlocks[1]).toMatchObject({ kind: 'note', text: '看起来是 A。' })
  })

  test('reconstructs process and final answer from session events', () => {
    const turn = turnFromEvents('msg-agent-1', [
      ev(1, 'thinking.chunk', { messageId: 'msg-agent-1', thinking: '先思考。' }),
      ev(2, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '先说明。' }),
      ev(3, 'tool.call', { messageId: 'msg-agent-1', toolCall: { id: 'tool-1', title: '读文件', status: 'in_progress' } }),
      ev(4, 'tool.update', { messageId: 'msg-agent-1', toolCall: { id: 'tool-1', title: '读文件', status: 'completed', terminalOutputDelta: 'ok\n' } }),
      ev(5, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: '正式结论。' }),
      ev(6, 'message.done', { messageId: 'msg-agent-1' }),
    ])

    expect(turn.processBlocks.map((block) => block.kind)).toEqual(['thinking', 'note', 'tool'])
    expect(turn.finalAnswer).toBe('正式结论。')
    const tool = turn.processBlocks.find((block) => block.kind === 'tool')
    expect(tool?.toolCall.terminalOutput).toBe('ok\n')
  })

  test('accepts the done event that closes the selected message turn even when done uses its own id', () => {
    const turn = turnFromEvents('msg-agent-1', [
      ev(1, 'message.chunk', { messageId: 'msg-agent-1', role: 'agent', contentDelta: 'final answer.' }, 'msg-agent-1'),
      ev(2, 'message.done', { messageId: 'done-sess-1', turnUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, 'done-sess-1'),
    ])

    expect(turn.done).toBe(true)
    expect(turn.turnStats?.totalTokens).toBe(3)
    expect(turn.finalAnswer).toBe('final answer.')
  })

  test('drops lifecycle-only stage blocks from completed turn process', () => {
    const stageOnly = turnFromEntries('msg-agent-1', [
      entry(1, { kind: 'stage', text: 'thinking...' }),
      entry(2, { kind: 'reply', text: 'final answer.' }),
    ])

    expect(processBlocksForCompletedTurn(stageOnly)).toEqual([])

    const withTool = turnFromEntries('msg-agent-1', [
      entry(1, { kind: 'stage', text: 'thinking...' }),
      entry(2, { kind: 'reply', text: 'checking.' }),
      entry(3, { kind: 'toolCall', toolCall: { id: 'tool-1', title: 'Read file' } }),
      entry(4, { kind: 'reply', text: 'final answer.' }),
    ])

    expect(processBlocksForCompletedTurn(withTool).map((block) => block.kind)).toEqual(['note', 'tool'])
  })

  test('restores ACP plan blocks from lightweight process items without detail JSON', () => {
    const turn = turnFromProcessItems('msg-agent-1', [
      {
        id: 'tpi-plan-1',
        session_id: 'sess-1',
        message_id: 'msg-agent-1',
        sequence: 1,
        kind: 'plan',
        status: 'running',
        title: '计划',
        summary: '计划 2 项',
        preview: 'completed 1 · in_progress 1',
        content: JSON.stringify({
          plan: [
            { content: '检查现状', status: 'completed', priority: 'medium' },
            { content: '实现修复', status: 'in_progress', priority: 'high' },
          ],
        }),
        meta_json: null,
        created_at: '2026-06-05T00:00:00.000Z',
        updated_at: '2026-06-05T00:00:00.000Z',
        has_detail: true,
      },
    ])

    expect(turn.processBlocks).toHaveLength(1)
    expect(turn.processBlocks[0]).toMatchObject({
      kind: 'plan',
      summary: '计划 2 项',
      plan: [
        { content: '检查现状', status: 'completed', priority: 'medium' },
        { content: '实现修复', status: 'in_progress', priority: 'high' },
      ],
    })
  })

})
