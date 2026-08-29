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

const sidebarProps = {
  loading: false,
  error: null,
  selectedSessionId: null,
  onRefresh: vi.fn(),
  onSelect: vi.fn(),
}

describe('统一工作台 UI', () => {
  test('动态签默认展示:双签 + 项目→Agent 三层分组 + 条目', () => {
    const html = renderToStaticMarkup(createElement(UpdatesSidebar, {
      ...sidebarProps,
      activityGroups: [group],
      pinnedItems: [pinned],
    }))
    expect(html).toContain('动态')
    expect(html).toContain('置顶')
    expect(html).toContain('AI IDE Studio')
    expect(html).toContain('编码 Agent')
    expect(html).toContain('统一工作台')
    expect(html).not.toContain('置顶会话')
  })

  test('置顶签展示全部 dock 条目(不再过滤动态重复)', () => {
    const html = renderToStaticMarkup(createElement(UpdatesSidebar, {
      ...sidebarProps,
      activityGroups: [group],
      pinnedItems: [pinned],
      defaultTab: 'pin',
    }))
    expect(html).toContain('置顶会话')
    expect(html).toContain('GovClaw')
    expect(html).toContain('测试 Agent')
    expect(html).not.toContain('统一工作台')
  })

  test('动态里的置顶会话只出现一次并带 📌 角标', () => {
    const html = renderToStaticMarkup(createElement(UpdatesSidebar, {
      ...sidebarProps,
      activityGroups: [group],
      pinnedItems: [{ ...pinned, sessionId: 'session-1', sessionTitle: '统一工作台' }],
    }))
    expect(html.match(/>统一工作台</g)).toHaveLength(1)
    expect(html).toContain('📌')
  })

  test('动态签空态与置顶签空态各有出口', () => {
    const dynEmpty = renderToStaticMarkup(createElement(UpdatesSidebar, {
      ...sidebarProps,
      activityGroups: [],
      pinnedItems: [],
    }))
    expect(dynEmpty).toContain('没有新动态')
    const pinEmpty = renderToStaticMarkup(createElement(UpdatesSidebar, {
      ...sidebarProps,
      activityGroups: [],
      pinnedItems: [],
      defaultTab: 'pin',
    }))
    expect(pinEmpty).toContain('还没有置顶会话')
  })

  test('预览面板默认打开「最后回复」签,空态有出口', () => {
    const html = renderToStaticMarkup(createElement(UpdatesPreviewPanel, {
      messages: [],
      projectId: 'project-1',
      sessionId: 'session-1',
      collapsed: false,
      onToggle: vi.fn(),
    }))
    expect(html).toContain('最后回复')
    expect(html).toContain('当前会话还没有最终回复')
  })

  test('重复文件路径的签保持 data-file-key 互不冲突', () => {
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
      sessionId: 'session-1',
      collapsed: false,
      onToggle: vi.fn(),
    }))

    expect(html).toContain('data-file-key="presentation-a:docs/report.md"')
    expect(html).toContain('data-file-key="presentation-b:docs/report.md"')
  })

  test('交互面板渲染在输入卡之上', () => {
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
    expect(source.indexOf('<InteractionPanel')).toBeLessThan(source.indexOf('<footer className="wb-composer">'))
  })

  test('会话组件不再引用未定义的设计 token', () => {
    const cssFiles = [
      '../../ui/src/pages/updates/updates-sidebar.css',
      '../../ui/src/pages/updates/updates-content.css',
      '../../ui/src/pages/updates/updates-preview-tabs.css',
      '../../ui/src/pages/updates/updates-page.css',
    ]
    for (const file of cssFiles) {
      const css = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(css).not.toContain('var(--primary)')
      expect(css).not.toContain('var(--text-4)')
    }
  })

  test('中栏与右栏 flex 均分(各 flex:1 1 0%,保证 1:1 不受侧栏挤占)', () => {
    // flex-basis 百分比按含侧栏的整行解析,50% 会让右栏恒宽出一个侧栏;
    // 两栏必须都是 basis 0 + grow 1 才是真正的剩余空间均分
    const conversation = readFileSync(new URL('../../ui/src/pages/updates/updates-content.css', import.meta.url), 'utf8')
    const preview = readFileSync(new URL('../../ui/src/pages/updates/updates-preview-tabs.css', import.meta.url), 'utf8')
    expect(conversation).toMatch(/\.wb-conversation\{[^}]*flex:1\b/)
    expect(preview).toMatch(/\.wb-preview\{[^}]*flex:1 1 0%/)
    expect(preview).not.toMatch(/flex:\s*0 1 \d+%/)
  })
})
