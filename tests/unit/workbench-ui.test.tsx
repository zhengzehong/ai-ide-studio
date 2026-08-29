import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { InteractionPanel } from '../../ui/src/components/global-assistant/GlobalAssistantInteractions.js'
import { UpdatesSidebar } from '../../ui/src/pages/UpdatesSidebar.js'
import { UpdatesPreviewPanel } from '../../ui/src/pages/UpdatesPreviewPanel.js'
import type { SessionDockItem } from '../../ui/src/stores/session-dock.store.js'
import type { WidgetAgentProjectActivityGroup } from '../../ui/src/stores/widget.store.js'

const group: WidgetAgentProjectActivityGroup = {
  groupId: 'agent-1:project-1',
  agentId: 'agent-1',
  agentName: '编码 Agent',
  agentIcon: null,
  projectId: 'project-1',
  projectName: 'AI IDE Studio',
  activityAt: '2026-08-29T08:00:00.000Z',
  sessions: [{
    sessionId: 'session-1',
    taskId: 'task-1',
    taskTitle: '修复动态页面',
    taskStatus: 'running',
    sessionTitle: '统一工作台',
    status: 'active',
    stage: '实现页面',
    running: true,
    unread: false,
    attentionState: 'running',
    activityAt: '2026-08-29T08:00:00.000Z',
  }],
}

const pinned: SessionDockItem = {
  sessionId: 'session-2',
  sessionTitle: '置顶会话',
  stage: '',
  agentId: 'agent-2',
  agentName: '测试 Agent',
  agentIcon: 'bot',
  agentAvatarUrl: null,
  projectId: 'project-2',
  projectName: 'GovClaw',
  projectColor: null,
  projectIcon: null,
  activityState: 'idle',
  unread: false,
  lastActivityAt: '2026-08-29T07:00:00.000Z',
  sortOrder: 1,
  addedAt: '2026-08-28T07:00:00.000Z',
}

describe('统一工作台 UI', () => {
  test('renders dynamic and pinned sessions with project ownership', () => {
    const html = renderToStaticMarkup(createElement(UpdatesSidebar, {
      activityGroups: [group],
      pinnedItems: [pinned],
      loading: false,
      error: null,
      selectedSessionId: null,
      onRefresh: vi.fn(),
      onSelect: vi.fn(),
    }))
    expect(html).toContain('会话动态')
    expect(html).toContain('AI IDE Studio')
    expect(html).toContain('统一工作台')
    expect(html).toContain('置顶会话')
    expect(html).toContain('GovClaw')
  })

  test('does not duplicate a session that is both dynamic and pinned', () => {
    const html = renderToStaticMarkup(createElement(UpdatesSidebar, {
      activityGroups: [group],
      pinnedItems: [{ ...pinned, sessionId: 'session-1', sessionTitle: '统一工作台' }],
      loading: false,
      error: null,
      selectedSessionId: null,
      onRefresh: vi.fn(),
      onSelect: vi.fn(),
    }))
    expect(html.match(/统一工作台/g)).toHaveLength(1)
  })

  test('shows an empty preview when no session output exists', () => {
    const html = renderToStaticMarkup(createElement(UpdatesPreviewPanel, {
      messages: [],
      projectId: 'project-1',
      collapsed: false,
      onToggle: vi.fn(),
    }))
    expect(html).toContain('当前会话还没有最终回复')
    expect(html).toContain('会话预览')
    expect(html).toContain('最后回复')
    expect(html).toContain('产物 0')
  })

  test('keeps repeated file paths distinct across presentations', () => {
    const html = renderToStaticMarkup(createElement(UpdatesPreviewPanel, {
      messages: [{
        id: 'message-1',
        session_id: 'session-1',
        role: 'agent',
        content: '完成',
        thinking: null,
        tool_calls_json: null,
        decision_json: null,
        timestamp: '2026-08-29T08:00:00.000Z',
        parsedPresentations: [
          { kind: 'files', presentationId: 'presentation-a', projectId: 'project-1', title: '第一版', createdAt: '2026-08-29T08:00:00.000Z', files: [{ path: 'docs/report.md', title: '报告 A', name: 'report.md', extension: '.md', size: 10, kind: 'text', language: 'markdown' }] },
          { kind: 'files', presentationId: 'presentation-b', projectId: 'project-1', title: '第二版', createdAt: '2026-08-29T09:00:00.000Z', files: [{ path: 'docs/report.md', title: '报告 B', name: 'report.md', extension: '.md', size: 12, kind: 'text', language: 'markdown' }] },
        ],
      }],
      projectId: 'project-1',
      collapsed: false,
      onToggle: vi.fn(),
    }))

    expect(html).toContain('data-file-key="presentation-a:docs/report.md"')
    expect(html).toContain('data-file-key="presentation-b:docs/report.md"')
  })

  test('shows pending Agent interactions above the composer', () => {
    const html = renderToStaticMarkup(createElement(InteractionPanel, {
      permission: {
        id: 'permission-1',
        toolCall: { id: 'tool-1', title: '写入文件' },
        options: [{ optionId: 'allow-once', name: '允许一次', kind: 'allow_once' }],
      },
      onRespondPermission: vi.fn(),
      onRespondElicitation: vi.fn(),
    }))
    expect(html).toContain('需要确认工具调用')
    expect(html).toContain('允许一次')

    const source = readFileSync(new URL('../../ui/src/pages/UpdatesConversation.tsx', import.meta.url), 'utf8')
    expect(source.indexOf('<InteractionPanel')).toBeGreaterThan(-1)
    expect(source.indexOf('<InteractionPanel')).toBeLessThan(source.indexOf('<footer className="workbench-composer">'))
  })
})
