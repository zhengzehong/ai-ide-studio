import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { ReadingCard } from '../../ui/src/pages/reading/ReadingCard'
import { ReadingListPanel } from '../../ui/src/pages/reading/ReadingListPanel'
import { ReadingReaderContent } from '../../ui/src/pages/reading/ReadingReader'
import type { ReadingItem } from '../../ui/src/types/reading'

const markdownItem = item({
  id: 'read-md',
  title: 'Rust Agent Loop',
  summary: '工具调用和上下文管理',
  format: 'md',
  status: 'unread',
  projectId: 'proj-a',
  projectName: 'govclaw',
  projectColor: '#059669',
  sessionId: 'sess-a',
  sessionTitle: '架构讨论',
  agentName: 'Dev-Codex',
  contentUrl: '/reading/read-md/?token=x',
})

describe('PC reading UI', () => {
  test('renders loading, error, empty, and data list states with archive controls', () => {
    const base = {
      archived: false,
      query: '',
      projectId: undefined,
      projectOptions: [],
      onQueryChange: vi.fn(),
      onProjectChange: vi.fn(),
      onToggleArchive: vi.fn(),
      onRefresh: vi.fn(),
      onSelect: vi.fn(),
      onStatus: vi.fn(),
      selectedId: null,
    }
    expect(renderToStaticMarkup(createElement(ReadingListPanel, { ...base, items: [], loading: true, error: null }))).toContain('正在加载阅读列表')
    expect(renderToStaticMarkup(createElement(ReadingListPanel, { ...base, items: [], loading: false, error: '读取失败' }))).toContain('读取失败')
    expect(renderToStaticMarkup(createElement(ReadingListPanel, { ...base, items: [], loading: false, error: null }))).toContain('没有待读内容')
    const data = renderToStaticMarkup(createElement(ReadingListPanel, { ...base, items: [markdownItem], loading: false, error: null }))
    expect(data).toContain('Rust Agent Loop')
    expect(data).toContain('govclaw')
    expect(data).toContain('归档')
    expect(data).toContain('搜索标题、摘要或来源会话')
  })

  test('shows unread and archived cards with the right single-card action', () => {
    const unread = renderToStaticMarkup(createElement(ReadingCard, {
      item: markdownItem,
      selected: true,
      archived: false,
      onOpen: vi.fn(),
      onStatus: vi.fn(),
    }))
    expect(unread).toContain('reading-card--unread')
    expect(unread).toContain('MD')
    expect(unread).toContain('归档')

    const archived = renderToStaticMarkup(createElement(ReadingCard, {
      item: { ...markdownItem, status: 'archived' },
      selected: false,
      archived: true,
      onOpen: vi.fn(),
      onStatus: vi.fn(),
    }))
    expect(archived).toContain('恢复')
  })

  test('renders Markdown, local HTML, and external URL reading branches', () => {
    const markdown = renderToStaticMarkup(createElement(ReadingReaderContent, {
      item: markdownItem,
      markdown: '# 标题\n\n正文',
      markdownLoading: false,
      markdownError: null,
      onArchive: vi.fn(),
      onReturn: vi.fn(),
      onOpenExternal: vi.fn(),
    }))
    expect(markdown).toContain('标题')
    expect(markdown).toContain('回到会话')

    const html = renderToStaticMarkup(createElement(ReadingReaderContent, {
      item: item({ ...markdownItem, id: 'read-html', format: 'html', contentUrl: '/reading/read-html/?token=x' }),
      markdown: '',
      markdownLoading: false,
      markdownError: null,
      onArchive: vi.fn(),
      onReturn: vi.fn(),
      onOpenExternal: vi.fn(),
    }))
    expect(html).toContain('src="/reading/read-html/?token=x"')
    expect(html).toContain('allow-scripts allow-same-origin allow-forms allow-popups')

    const url = renderToStaticMarkup(createElement(ReadingReaderContent, {
      item: item({ ...markdownItem, id: 'read-url', format: 'url', contentUrl: null, externalUrl: 'https://example.com/docs' }),
      markdown: '',
      markdownLoading: false,
      markdownError: null,
      onArchive: vi.fn(),
      onReturn: vi.fn(),
      onOpenExternal: vi.fn(),
    }))
    expect(url).toContain('src="https://example.com/docs"')
    expect(url).toContain('在浏览器打开')
    expect(url).toContain('部分网站可能禁止嵌入')
  })
})

function item(overrides: Partial<ReadingItem>): ReadingItem {
  return {
    id: 'read-1',
    projectId: null,
    projectName: null,
    projectColor: null,
    sessionId: null,
    sessionTitle: null,
    agentId: null,
    agentName: null,
    agentIcon: null,
    title: '阅读条目',
    summary: '',
    format: 'md',
    status: 'read',
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    readAt: null,
    archivedAt: null,
    contentUrl: null,
    externalUrl: null,
    ...overrides,
  }
}
