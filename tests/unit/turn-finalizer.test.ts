import { describe, expect, test } from 'vitest'
import { createPendingTurn, finalizePendingTurn, updatePendingTurn } from '../../src/core/turn-finalizer.ts'
import { AUTONOMOUS_TURN_NOTICE } from '../../src/shared/autonomous-turn.ts'

describe('turn finalizer', () => {
  test('stores only the last reply as final content and keeps earlier replies in process thinking/tools', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '我先检查。' })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', toolCall: { id: 'tool-1', title: '读文件', status: 'completed' } })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '还要验证。' })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', toolCall: { id: 'tool-2', title: '查历史', status: 'completed' } })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '最终结论。' })

    const finalized = finalizePendingTurn(turn)

    expect(finalized).toEqual({
      messageId: 'msg-1',
      content: '最终结论。',
      thinking: null,
      toolCalls: [
        { id: 'tool-1', title: '读文件', status: 'completed' },
        { id: 'tool-2', title: '查历史', status: 'completed' },
      ],
    })
  })

  test('treats plan updates as process boundaries before the final reply', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'msg-1', role: 'agent', contentDelta: '先给一个初步判断。' })
    turn = updatePendingTurn(turn, {
      messageId: 'msg-1',
      role: 'system',
      plan: [{ content: '检查现状', status: 'completed', priority: 'medium' }],
    })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', role: 'agent', contentDelta: '最终结论。' })

    const finalized = finalizePendingTurn(turn)

    expect(finalized?.content).toBe('最终结论。')
  })

  test('keeps final text when an existing tool reports a late completion update', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, {
      messageId: 'msg-1',
      toolCall: { id: 'tool-1', title: '运行测试', status: 'in_progress' },
    })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '最终结论。' })
    turn = updatePendingTurn(turn, {
      messageId: 'msg-1',
      toolCallUpdate: { id: 'tool-1', status: 'completed', rawOutput: { exitCode: 0 } },
    })

    expect(finalizePendingTurn(turn)?.content).toBe('最终结论。')
  })

  test('keeps final text when a platform synthetic update uses a different audit id', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'msg-1', role: 'agent', contentDelta: '最终结论。' })
    turn = updatePendingTurn(turn, {
      messageId: 'msg-1',
      role: 'agent',
      toolCallUpdate: {
        id: 'tcall-audit-1',
        title: 'files.present',
        status: 'completed',
        rawOutput: { presentationId: 'files-1' },
      },
    }, { source: 'platform-synthetic' })

    expect(finalizePendingTurn(turn)?.content).toBe('最终结论。')
    expect(turn.processNotes).toEqual([])
  })

  test('still treats a first-seen tool update as a new process boundary', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '我继续检查。' })
    turn = updatePendingTurn(turn, {
      messageId: 'msg-1',
      toolCallUpdate: {
        id: 'tool-1',
        title: '运行测试',
        status: 'in_progress',
        rawInput: { command: 'npm test' },
      },
    })
    turn = updatePendingTurn(turn, { messageId: 'msg-1', contentDelta: '最终结论。' })

    expect(finalizePendingTurn(turn)?.content).toBe('最终结论。')
  })

  test('keeps the autonomous wake notice as content when a tool call opens the turn', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      role: 'agent',
      contentDelta: AUTONOMOUS_TURN_NOTICE,
      wakeNotice: true,
    })
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      toolCall: { id: 'tool-1', title: '运行检查', status: 'completed' },
    })

    const finalized = finalizePendingTurn(turn)

    expect(finalized).toEqual({
      messageId: 'auto-1',
      content: AUTONOMOUS_TURN_NOTICE,
      thinking: null,
      toolCalls: [{ id: 'tool-1', title: '运行检查', status: 'completed' }],
    })
    expect(turn.processNotes).toEqual([])
  })

  test('prepends the wake notice to the real reply of an autonomous turn', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      role: 'agent',
      contentDelta: AUTONOMOUS_TURN_NOTICE,
      wakeNotice: true,
    })
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      toolCall: { id: 'tool-1', title: '运行检查', status: 'completed' },
    })
    turn = updatePendingTurn(turn, { messageId: 'auto-1', contentDelta: '检查完成,全部通过。' })

    expect(finalizePendingTurn(turn)?.content).toBe(`${AUTONOMOUS_TURN_NOTICE}\n检查完成,全部通过。`)
  })

  test('routes merged wake-notice frames through the bypass and demotes their remainder like normal text', () => {
    let turn = createPendingTurn()
    // 合并场景:注记帧与后续正文共用同一 contentDelta 聚合键,到达时已拼成一条。
    // 余量按普通正文聚合,因此随后到来的 tool_call 仍会把它按过程边界降级(既有语义)。
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      role: 'agent',
      contentDelta: `${AUTONOMOUS_TURN_NOTICE}检查完成,全部通过。`,
      wakeNotice: true,
    })
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      toolCall: { id: 'tool-1', title: '运行检查', status: 'completed' },
    })

    const finalized = finalizePendingTurn(turn)

    expect(finalized?.content).toBe(AUTONOMOUS_TURN_NOTICE)
    expect(turn.processNotes).toEqual(['检查完成,全部通过。'])
  })

  test('demotes an unmarked opening text as before when the wake notice marker is absent', () => {
    let turn = createPendingTurn()
    turn = updatePendingTurn(turn, { messageId: 'auto-1', role: 'agent', contentDelta: AUTONOMOUS_TURN_NOTICE })
    turn = updatePendingTurn(turn, {
      messageId: 'auto-1',
      toolCall: { id: 'tool-1', title: '运行检查', status: 'completed' },
    })

    const finalized = finalizePendingTurn(turn)

    expect(finalized?.content).toBe('')
    expect(turn.processNotes).toEqual([AUTONOMOUS_TURN_NOTICE])
  })
})
