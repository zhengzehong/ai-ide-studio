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
})
