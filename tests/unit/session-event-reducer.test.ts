import { describe, expect, test } from 'vitest'
import { clearPlanOnTurnDone, reduceSessionEvents } from '../../ui/src/stores/session-events.ts'

function ev(sequence: number, type: string, payload: unknown) {
  return {
    id: `evt-${sequence}`,
    session_id: 'sess-1',
    agent_id: 'agent-1',
    acp_session_id: null,
    message_id: null,
    type,
    role: null,
    payload_json: JSON.stringify(payload),
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
  }
}

describe('reduceSessionEvents', () => {
  test('从事件流还原 plan、capabilities、pending 状态和有序 active turn', () => {
    const state = reduceSessionEvents([
      ev(1, 'message.chunk', { messageId: 'old-msg', role: 'agent', contentDelta: '旧回复' }),
      ev(2, 'tool.call', { messageId: 'old-msg', toolCall: { id: 'tool-old', title: '旧工具', status: 'completed' } }),
      ev(3, 'message.done', { messageId: 'old-msg' }),
      ev(4, 'plan.update', { plan: [{ content: '调研 ACP', status: 'completed', priority: 'high' }] }),
      ev(5, 'config.update', {
        configOptions: [
          { id: 'model', category: 'model', type: 'select', name: '模型', currentValue: 'gpt-test', options: [{ value: 'gpt-test', name: 'GPT Test' }] },
          { id: 'effort', category: 'thought_level', type: 'select', name: '思考强度', currentValue: 'high', options: [{ value: 'high', name: '高' }] },
        ],
      }),
      ev(6, 'permission.request', { permissionRequest: { id: 'perm-1', toolCall: { id: 'tool-1', title: '写文件' }, options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }] } }),
      ev(7, 'permission.result', { requestId: 'perm-1', optionId: 'allow' }),
      ev(8, 'message.chunk', { messageId: 'new-msg', role: 'agent', contentDelta: '先检查' }),
      ev(9, 'tool.call', { messageId: 'new-msg', toolCall: { id: 'tool-2', title: '运行命令', status: 'in_progress' } }),
      ev(10, 'tool.update', { messageId: 'new-msg', toolCall: { id: 'tool-2', terminalOutputDelta: 'hello\n', progressDelta: '开始' } }),
    ])

    expect(state.plan).toHaveLength(1)
    expect(state.capabilities.currentModelId).toBe('gpt-test')
    expect(state.capabilities.models[0].name).toBe('GPT Test')
    expect(state.pendingPermissions).toHaveLength(0)
    expect(state.streamingMessage?.finalAnswer).toBe('')
    expect(state.streamingMessage?.processBlocks.map((block) => block.kind)).toEqual(['note', 'tool'])
    expect(state.streamingMessage?.processBlocks[0]).toMatchObject({ kind: 'note', text: '先检查' })
    expect(state.streamingMessage?.toolCalls[0].terminalOutput).toBe('hello\n')
    expect(state.streamingMessage?.toolCalls[0].progress).toEqual(['开始'])
  })

  test('clears live plan after a normal turn ends', () => {
    const state = reduceSessionEvents([
      ev(1, 'plan.update', {
        plan: [
          { content: 'run tests', status: 'completed', priority: 'medium' },
          { content: 'summarize result', status: 'in_progress', priority: 'medium' },
        ],
      }),
      ev(2, 'message.done', { messageId: 'done-sess-1', stopReason: 'end_turn' }),
    ])

    expect(state.plan).toEqual([])
  })

  test('clears live plan after a cancelled or failed turn', () => {
    const plan = [
      { content: 'inspect failure', status: 'in_progress', priority: 'medium' },
      { content: 'report result', status: 'pending', priority: 'medium' },
    ]

    expect(plan).toHaveLength(2)
    expect(clearPlanOnTurnDone()).toEqual([])
  })
})
