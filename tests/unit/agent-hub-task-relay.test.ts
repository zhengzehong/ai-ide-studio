import { describe, expect, test } from 'vitest'
import { formatInboundPrompt, formatOutboundPrompt, extractResultText } from '../../src/core/agent-hub/task-relay.js'

describe('agent-hub task-relay 文本处理', () => {
  describe('formatInboundPrompt', () => {
    test('输出 [Agent Hub 请求] 格式,带来源,无工具提示', () => {
      const prompt = formatInboundPrompt(
        {
          parts: [
            { type: 'text', text: '帮我审合同' },
            { type: 'text', text: '关注风险点' },
          ],
        },
        {
          hubTaskId: 't1',
          sourceHubAgentId: 'h-1',
          sourceName: '产品经理 · c3d4 · 8110ac',
          pushUrl: 'http://hub/push',
          pushToken: 'token',
          localSessionId: 's1',
          contextId: 'ctx-1',
          receivedAt: 0,
        },
      )
      expect(prompt).toBe('[Agent Hub 请求]\n来自:产品经理 · c3d4 · 8110ac\n\n帮我审合同\n关注风险点')
      // 关键:inbound 不带任何工具提示
      expect(prompt).not.toContain('agent_hub.send')
    })

    test('没有 sourceName 时回退到 hubAgentId', () => {
      const prompt = formatInboundPrompt(
        { parts: [{ type: 'text', text: 'hi' }] },
        {
          hubTaskId: 't1',
          sourceHubAgentId: 'h-1',
          pushUrl: 'http://hub/push',
          pushToken: 'token',
          localSessionId: 's1',
          contextId: 'ctx-1',
          receivedAt: 0,
        },
      )
      expect(prompt).toBe('[Agent Hub 请求]\n来自:h-1\n\nhi')
    })

    test('过滤非 text part', () => {
      const prompt = formatInboundPrompt(
        {
          parts: [
            { type: 'data', text: 'should be ignored' },
            { type: 'text', text: 'real text' },
            { type: 'text', text: '' },
          ],
        },
        {
          hubTaskId: 't1',
          sourceHubAgentId: 'h-1',
          pushUrl: 'u',
          pushToken: 't',
          localSessionId: 's',
          contextId: 'c',
          receivedAt: 0,
        },
      )
      expect(prompt).toBe('[Agent Hub 请求]\n来自:h-1\n\nreal text')
    })

    test('无文本内容时显示占位', () => {
      const prompt = formatInboundPrompt(
        { parts: [] },
        {
          hubTaskId: 't1',
          sourceHubAgentId: 'h-1',
          pushUrl: 'u',
          pushToken: 't',
          localSessionId: 's',
          contextId: 'c',
          receivedAt: 0,
        },
      )
      expect(prompt).toBe('[Agent Hub 请求]\n来自:h-1\n\n(无内容)')
    })
  })

  describe('formatOutboundPrompt', () => {
    test('输出 [Agent Hub 回复] 格式,末尾带 agent_hub.send 工具提示', () => {
      const prompt = formatOutboundPrompt(
        {
          hubTaskId: 't1',
          targetHubAgentId: 'h-2',
          targetName: 'coder-prd · 公司Mac · ec72ef',
          message: '原始问题',
          contextId: 'ctx-1',
          sentAt: 0,
        },
        '2',
      )
      expect(prompt).toBe(
        '[Agent Hub 回复]\n来自:coder-prd · 公司Mac · ec72ef\n\n2\n\n---\n如需继续对话对方,可用 agent_hub.send 工具。',
      )
    })

    test('没有 targetName 时回退到 hubAgentId', () => {
      const prompt = formatOutboundPrompt(
        {
          hubTaskId: 't1',
          targetHubAgentId: 'h-2',
          targetName: '',
          message: '原始',
          contextId: 'ctx-1',
          sentAt: 0,
        },
        'ok',
      )
      expect(prompt).toContain('来自:h-2')
    })

    test('无结果文本时显示占位,但仍带工具提示', () => {
      const prompt = formatOutboundPrompt(
        {
          hubTaskId: 't1',
          targetHubAgentId: 'h-2',
          targetName: 'B',
          message: '原始',
          contextId: 'ctx-1',
          sentAt: 0,
        },
        '',
      )
      expect(prompt).toContain('(无结果内容)')
      expect(prompt).toContain('agent_hub.send')
    })
  })

  describe('extractResultText', () => {
    test('从 task.status.message.parts 提取文本', () => {
      const text = extractResultText({
        status: {
          message: {
            parts: [{ type: 'text', text: '审核完成' }, { type: 'text', text: '发现 3 个风险' }],
          },
        },
      })
      expect(text).toBe('审核完成\n发现 3 个风险')
    })

    test('没有 message 时返回默认占位', () => {
      const text = extractResultText({ status: {} })
      expect(text).toBe('(无结果内容)')
    })

    test('parts 为空时返回默认占位', () => {
      const text = extractResultText({ status: { message: { parts: [] } } })
      expect(text).toBe('(无结果内容)')
    })

    test('parts 只有非 text 时返回默认占位', () => {
      const text = extractResultText({
        status: { message: { parts: [{ type: 'data', text: 'x' }] } },
      })
      expect(text).toBe('(无结果内容)')
    })
  })
})
