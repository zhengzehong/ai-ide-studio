import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { MobileReadingCard } from '../../mobile/src/components/reading/MobileReadingCard'
import { MobileReadingContent } from '../../mobile/src/components/reading/MobileReadingContent'
import { ReadingProjectSheet } from '../../mobile/src/components/reading/ReadingProjectSheet'
import { resolveChatReturnTo } from '../../mobile/src/pages/ChatPage'
import type { ReadingItem } from '../../ui/src/types/reading'

describe('APP reading UI', () => {
  test('renders a compact card and project selection sheet', () => {
    const item = readingItem({ projectName: 'govclaw', projectColor: '#059669', status: 'unread' })
    const card = renderToStaticMarkup(createElement(MobileReadingCard, {
      item,
      archived: false,
      onOpen: vi.fn(),
      onStatus: vi.fn(),
    }))
    expect(card).toContain('govclaw')
    expect(card).toContain('未读')
    expect(card).toContain('归档')

    const sheet = renderToStaticMarkup(createElement(ReadingProjectSheet, {
      open: true,
      value: undefined,
      options: [{ projectId: 'proj-a', projectName: 'govclaw', projectColor: '#059669', count: 2 }],
      onSelect: vi.fn(),
      onClose: vi.fn(),
    }))
    expect(sheet).toContain('按项目筛选')
    expect(sheet).toContain('govclaw')
    expect(sheet).toContain('全部项目')
  })

  test('uses the connected server for local HTML and preserves URL fallback', () => {
    const html = renderToStaticMarkup(createElement(MobileReadingContent, {
      item: readingItem({ format: 'html', contentUrl: '/reading/read-1/?token=x' }),
      serverUrl: 'https://studio.example.com/',
      markdown: '',
      markdownLoading: false,
      markdownError: null,
      onOpenExternal: vi.fn(),
    }))
    expect(html).toContain('src="https://studio.example.com/reading/read-1/?token=x"')
    expect(html).toContain('allow-scripts allow-same-origin allow-forms allow-popups')

    const url = renderToStaticMarkup(createElement(MobileReadingContent, {
      item: readingItem({ format: 'url', contentUrl: null, externalUrl: 'https://example.com/docs' }),
      serverUrl: 'https://studio.example.com',
      markdown: '',
      markdownLoading: false,
      markdownError: null,
      onOpenExternal: vi.fn(),
    }))
    expect(url).toContain('src="https://example.com/docs"')
    expect(url).toContain('浏览器打开')
    expect(url).toContain('网站可能禁止嵌入')
  })
  test('returns from a source Session to the reading list', () => {
    expect(resolveChatReturnTo({ returnTo: '/reading' })).toBe('/reading')
  })

  test('refreshes the unread badge when the APP returns to the foreground', () => {
    const shell = readFileSync(resolve('mobile/src/components/MobileShell.tsx'), 'utf8')
    expect(shell).toContain("document.addEventListener('visibilitychange', refreshReadingOnForeground)")
    expect(shell).toContain('refreshReadingUnreadCount()')
  })
})

function readingItem(overrides: Partial<ReadingItem>): ReadingItem {
  return {
    id: 'read-1',
    projectId: 'proj-a',
    projectName: '项目',
    projectColor: null,
    sessionId: 'sess-a',
    sessionTitle: '来源会话',
    agentId: 'agent-a',
    agentName: 'Agent',
    agentIcon: null,
    title: '阅读条目',
    summary: '摘要内容',
    format: 'md',
    status: 'read',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    readAt: null,
    archivedAt: null,
    contentUrl: '/reading/read-1/?token=x',
    externalUrl: null,
    ...overrides,
  }
}
