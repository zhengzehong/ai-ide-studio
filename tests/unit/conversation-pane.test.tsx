import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { ConversationPane } from '../../ui/src/components/chat/ConversationPane.js'
import { canSendConversation } from '../../ui/src/components/chat/conversation-composer-utils.js'
import type { ConversationAdapter } from '../../ui/src/components/chat/conversation-types.js'

function adapter(overrides: Partial<ConversationAdapter> = {}): ConversationAdapter {
  return {
    sessionId: 'session-1', agentName: 'Agent', agentRuntime: 'claude', sessionTitle: '测试会话',
    messages: [], streamingMessage: null, loading: false, error: null, running: false, sending: false,
    hasMoreMessages: false, loadingOlderMessages: false, pendingPermissions: [], pendingElicitations: [], interactionError: null,
    capabilities: { models: [], currentModelId: null, modes: [], currentModeId: null, supportsImages: true, configOptions: [], commands: [] }, usage: null,
    sendPrompt: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined), loadOlderMessages: vi.fn(async () => undefined),
    loadMessageProcess: vi.fn(async () => undefined), loadFileChanges: vi.fn(async () => undefined), loadProcessItemDetail: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined), respondElicitation: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('shared conversation pane', () => {
  test('renders empty, loading, error, and composer states through one adapter', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, { adapter: adapter(), onOpenPreview: vi.fn(), onOpenFiles: vi.fn() }))
    expect(html).toContain('暂无消息')
    expect(html).toContain('输入消息')
    expect(html).toContain('data-conversation-pane')
  })

  test('renders historical process, file changes, and usage from adapter data', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        usage: { contextSize: 1000, contextUsed: 100 },
        messages: [{ id: 'm1', session_id: 'session-1', role: 'agent', content: '完成', thinking: null, tool_calls_json: null, decision_json: null, timestamp: '2026-08-30T00:00:00Z', process_item_count: 1, has_tool_calls: true, processDefaultOpen: true, processBlocks: [{ id: 'p1', kind: 'tool', toolCall: { id: 't1', title: '读取文件', status: 'completed' } }] }],
      }),
      onOpenPreview: vi.fn(), onOpenFiles: vi.fn(),
    }))
    expect(html).toContain('执行过程')
    expect(html).toContain('读取文件')
    expect(html).toContain('100')
  })

  test('renders Workspace-style per-turn statistics for historical agent messages', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        messages: [{ id: 'm-stats', session_id: 'session-1', role: 'agent', content: '完成', thinking: null, tool_calls_json: null, decision_json: JSON.stringify({ inputTokens: 1200, outputTokens: 800, cachedReadTokens: 400, costAmount: 0.0123, elapsedSeconds: 62 }), timestamp: '2026-08-30T00:00:00Z' }],
      }),
    }))
    expect(html).toContain('输入')
    expect(html).toContain('输出')
    expect(html).toContain('缓存')
    expect(html).toContain('1m2s')
    expect(html).toContain('$0.0123')
  })

  test('renders recovery event timeline when persisted messages are unavailable', () => {
    const events = [
      {
        id: 'event-user', session_id: 'session-1', message_id: 'message-1', type: 'message.user',
        payload_json: JSON.stringify({ messageId: 'message-1', content: '请检查项目' }), sequence: 1, created_at: '2026-08-30T00:00:00Z',
      },
      {
        id: 'event-tool', session_id: 'session-1', message_id: 'message-1', type: 'tool.call',
        payload_json: JSON.stringify({ messageId: 'message-1', toolCall: { id: 'tool-1', title: '读取文件', status: 'completed' } }), sequence: 2, created_at: '2026-08-30T00:00:01Z',
      },
      {
        id: 'event-reply', session_id: 'session-1', message_id: 'message-1', type: 'message.chunk',
        payload_json: JSON.stringify({ messageId: 'message-1', role: 'agent', contentDelta: '检查完成' }), sequence: 3, created_at: '2026-08-30T00:00:02Z',
      },
      {
        id: 'event-done', session_id: 'session-1', message_id: 'message-1', type: 'message.done',
        payload_json: JSON.stringify({ messageId: 'message-1' }), sequence: 4, created_at: '2026-08-30T00:00:03Z',
      },
    ]
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({ messages: [], events }),
    }))
    expect(html).toContain('请检查项目')
    expect(html).toContain('读取文件')
    expect(html).toContain('检查完成')
  })

  test('renders authenticated historical image attachments', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        messages: [{ id: 'm-image', session_id: 'session-1', role: 'human', content: '看图', thinking: null, tool_calls_json: null, decision_json: null, attachments_json: null, timestamp: '2026-08-30T00:00:00Z', parsedAttachments: [{ data: 'aGVsbG8=', mimeType: 'image/png', name: 'shot.png' }] }],
      }),
    }))
    expect(html).toContain('alt="shot.png"')
    expect(html).toContain('data:image/png;base64,aGVsbG8=')
  })

  test('blocks sending while a regular attachment is still uploading', () => {
    const base = adapter()
    expect(canSendConversation(base.sessionId, false, '继续处理', [{ localId: 'file-1', name: 'report.md', size: 10, status: 'uploading' }], [])).toBe(false)
    expect(canSendConversation(base.sessionId, false, '继续处理', [{ localId: 'file-1', name: 'report.md', size: 10, status: 'uploaded', uploaded: { id: 'upload-1', name: 'report.md', mimeType: 'text/markdown', size: 10, path: 'report.md', relativePath: 'report.md' } }], [])).toBe(true)
    expect(canSendConversation(base.sessionId, true, '继续处理', [], [])).toBe(false)
  })

  test('uses the Workspace-style composer controls instead of native select controls', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        usage: { contextSize: 1000, contextUsed: 200 },
        capabilities: {
          models: [{ modelId: 'model-1', name: 'Max' }],
          currentModelId: 'model-1',
          modes: [{ modeId: 'mode-1', name: '命令', description: '执行模式' }],
          currentModeId: 'mode-1',
          supportsImages: true,
          configOptions: [{ id: 'effort', name: '思考强度', type: 'string', category: 'thought_level', currentValue: 'max', options: [{ value: 'max', name: 'Max' }] }],
          commands: [{ name: 'review', description: '检查当前改动', input: null }],
        },
      }),
    }))
    expect(html).toContain('conversation-composer-shell')
    expect(html).toContain('conversation-toolbar-button')
    expect(html).toContain('conversation-send')
    expect(html).not.toContain('<select')
  })

  test('keeps the composer dimensions, menu positioning, and context control aligned with Workspace', () => {
    const css = readFileSync(new URL('../../ui/src/components/chat/conversation-pane.css', import.meta.url), 'utf8')
    expect(css).toContain('border-radius:12px')
    expect(css).toContain('min-height:56px')
    expect(css).toContain('transform:translateY(-100%)')
    expect(css).toContain('.conversation-context')
    expect(css).not.toContain('var(--primary)')
    expect(css).not.toContain('var(--text-4)')
  })

  test('shows one generating status for an empty streaming turn', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        streamingMessage: { id: 'stream-1', role: 'agent', processBlocks: [], finalAnswer: '', content: '', thinking: '', toolCalls: [], done: false },
      }),
    }))
    expect(html).not.toContain('正在处理...')
    expect((html.match(/conversation-streaming-label/g) || []).length).toBe(1)
  })

  test('uses the streaming stage in the single generating status', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        streamingMessage: { id: 'stream-2', role: 'agent', processBlocks: [], finalAnswer: '', content: '', thinking: '', toolCalls: [], done: false, stage: '执行工具' },
      }),
    }))
    expect(html).toContain('执行工具')
    expect(html).not.toContain('生成中')
  })

  test('uses the streaming sender name for aggregated team replies', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        streamingMessage: { id: 'stream-member', role: 'agent', processBlocks: [], finalAnswer: '成员回复', content: '成员回复', thinking: '', toolCalls: [], done: false, senderName: '测试成员' },
      }),
    }))
    expect(html).toContain('测试成员')
    expect((html.match(/<strong>测试成员<\/strong>/g) || []).length).toBe(1)
  })

  test('does not render an empty bubble when the streaming turn only has a stage block', () => {
    const html = renderToStaticMarkup(createElement(ConversationPane, {
      adapter: adapter({
        streamingMessage: {
          id: 'stream-3', role: 'agent', finalAnswer: '', content: '', thinking: '', toolCalls: [], done: false,
          stage: '执行工具', processBlocks: [{ id: 'stage-1', kind: 'stage', text: '执行工具' }],
        },
      }),
    }))
    expect(html).not.toContain('conversation-bubble')
    expect((html.match(/conversation-streaming-label/g) || []).length).toBe(1)
  })
})
