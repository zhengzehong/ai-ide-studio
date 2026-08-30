import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { ConversationPane } from '../../ui/src/components/chat/ConversationPane.js'
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
})
