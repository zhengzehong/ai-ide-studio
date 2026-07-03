import { describe, expect, test } from 'vitest'
import {
  formatInboundPrompt,
  formatOutboundPrompt,
  extractResultText,
  type InboundTask,
  type OutboundTask,
} from '../../src/core/agent-hub/task-relay.js'

// formatInboundPrompt / formatOutboundPrompt 在函数内读 process.env.AGENT_HUB_PROTOCOL_DOC_URL,
// 测试环境 shell 可能已设此 env,导致 url 非空。断言不依赖 url 具体值,
// 用 toContain 验证关键文案,toMatch 验证结构。

describe('agent-hub task-relay 文本处理', () => {
  describe('formatInboundPrompt', () => {
    test('输出 [Agent Hub 请求] 格式,带来源 + 直接输出提示 + 规范 url 占位', () => {
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
      expect(prompt).toContain('[Agent Hub 请求]')
      expect(prompt).toContain('来自:产品经理 · c3d4 · 8110ac')
      expect(prompt).toContain('帮我审合同\n关注风险点')
      expect(prompt).toContain('直接输出结果即可,系统自动回调。不要用 agent_hub.send 回发。')
      expect(prompt).toContain('规范:')
      // 关键:inbound 不带"可用 agent_hub.send"这种鼓励回发的提示
      expect(prompt).not.toContain('可用 agent_hub.send')
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
      expect(prompt).toContain('来自:h-1')
      expect(prompt).toContain('hi')
      expect(prompt).toContain('不要用 agent_hub.send 回发。')
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
      expect(prompt).toContain('real text')
      expect(prompt).not.toContain('should be ignored')
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
      expect(prompt).toContain('(无内容)')
    })

    test('在 env 设了 AGENT_HUB_PROTOCOL_DOC_URL 时提示带 url', () => {
      const originalUrl = process.env.AGENT_HUB_PROTOCOL_DOC_URL
      process.env.AGENT_HUB_PROTOCOL_DOC_URL = 'http://test-url/protocol.md'
      try {
        const prompt = formatInboundPrompt(
          { parts: [{ type: 'text', text: 'hi' }] },
          {
            hubTaskId: 't1',
            sourceHubAgentId: 'h-1',
            pushUrl: 'u',
            pushToken: 't',
            localSessionId: 's',
            contextId: 'c',
            receivedAt: 0,
          } as InboundTask,
        )
        expect(prompt).toContain('规范:http://test-url/protocol.md')
      } finally {
        if (originalUrl === undefined) delete process.env.AGENT_HUB_PROTOCOL_DOC_URL
        else process.env.AGENT_HUB_PROTOCOL_DOC_URL = originalUrl
      }
    })
  })

  describe('formatOutboundPrompt', () => {
    test('输出 [Agent Hub 回复] 格式,末尾带 agent_hub.send 工具提示 + 规范 url', () => {
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
      expect(prompt).toContain('[Agent Hub 回复]')
      expect(prompt).toContain('来自:coder-prd · 公司Mac · ec72ef')
      expect(prompt).toContain('2')
      expect(prompt).toContain('如需继续对话对方,可用 agent_hub.send。')
      expect(prompt).toContain('规范:')
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

    test('在 env 设了 AGENT_HUB_PROTOCOL_DOC_URL 时提示带 url', () => {
      const originalUrl = process.env.AGENT_HUB_PROTOCOL_DOC_URL
      process.env.AGENT_HUB_PROTOCOL_DOC_URL = 'http://test-url/protocol.md'
      try {
        const prompt = formatOutboundPrompt(
          {
            hubTaskId: 't1',
            targetHubAgentId: 'h-2',
            targetName: 'B',
            message: '原始',
            contextId: 'ctx-1',
            sentAt: 0,
          } as OutboundTask,
          'result',
        )
        expect(prompt).toContain('规范:http://test-url/protocol.md')
      } finally {
        if (originalUrl === undefined) delete process.env.AGENT_HUB_PROTOCOL_DOC_URL
        else process.env.AGENT_HUB_PROTOCOL_DOC_URL = originalUrl
      }
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
