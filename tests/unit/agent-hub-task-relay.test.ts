import { describe, expect, test } from 'vitest'
import { formatInboundPrompt, extractResultText } from '../../src/core/agent-hub/task-relay.js'

describe('agent-hub task-relay 文本处理', () => {
  describe('formatInboundPrompt', () => {
    test('从 message.parts 拼出文本,带来源前缀', () => {
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
      expect(prompt).toBe('[Hub 请求 from 产品经理 · c3d4 · 8110ac]: 帮我审合同\n关注风险点')
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
      expect(prompt).toBe('[Hub 请求 from h-1]: hi')
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
      expect(prompt).toBe('[Hub 请求 from h-1]: real text')
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
