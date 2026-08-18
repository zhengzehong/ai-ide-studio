import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { SecretaryOverview as DesktopOverview } from '../../ui/src/pages/secretary/SecretaryOverview'
import { SecretaryOverview as MobileOverview } from '../../mobile/src/components/SecretaryOverview'
import type { SecretaryData, SecretaryRunData } from '../../ui/src/stores/secretary.store'

const secretary: SecretaryData = {
  id: 'secretary-1', projectId: 'project-1', name: '研发秘书', definitionPrompt: '汇总研发进展', reportPrompt: '',
  executionAgentId: 'agent-1', runtimeSessionId: 'runtime-1', chatSessionId: 'chat-1', enabled: true,
  observeAll: true, observedAgentIds: [], triggers: [{ id: 'trigger-1', type: 'cron', cron: '30 18 * * *', enabled: true }],
  lastRunAt: '2026-08-17T10:30:00.000Z', lastError: null, unreadCount: 2, chatUnread: true,
  createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T10:30:00.000Z',
}

const runs: SecretaryRunData[] = [{
  id: 'run-1', eventType: 'cron', sourceId: null, status: 'failed', error: '构建失败',
  createdAt: '2026-08-17T10:30:00.000Z', startedAt: '2026-08-17T10:30:01.000Z',
  finishedAt: '2026-08-17T10:30:04.000Z', elapsedMs: 3000,
}]

describe('secretary execution history UI', () => {
  test('desktop overview exposes both linked Sessions and recent run errors', () => {
    const html = renderToStaticMarkup(createElement(DesktopOverview, {
      secretary, executionAgentName: 'GLM5 PRD', runs, runsLoading: false,
      onOpenRuntime: vi.fn(), onOpenChat: vi.fn(),
    }))
    expect(html).toContain('后台执行会话')
    expect(html).toContain('秘书对话')
    expect(html).toContain('最近执行')
    expect(html).toContain('构建失败')
    expect(html).toContain('30 18 * * *')
    expect(html).toContain('data-chat-unread="true"')
    expect(html).toContain('新回复')
  })

  test('mobile overview keeps the same history and Session entry semantics', () => {
    const html = renderToStaticMarkup(createElement(MobileOverview, {
      secretary, runs, loading: false, onOpenRuntime: vi.fn(), onOpenChat: vi.fn(),
    }))
    expect(html).toContain('后台执行会话')
    expect(html).toContain('秘书对话')
    expect(html).toContain('失败 · 定时')
    expect(html).toContain('构建失败')
    expect(html).toContain('data-chat-unread="true"')
  })
})
