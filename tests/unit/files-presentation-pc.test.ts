import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { TurnContentView } from '../../ui/src/components/chat/TurnContentView.tsx'
import { FilesPresentationCard } from '../../ui/src/components/chat/FilesPresentationCard.tsx'
import { normalizeMessage, type MessageData } from '../../ui/src/stores/session-events.ts'

const presentation = {
  kind: 'files' as const,
  presentationId: 'files-pc',
  projectId: 'project-1',
  title: '本次交付',
  files: [
    { path: 'docs/report.md', title: '分析报告', name: 'report.md', extension: '.md', size: 100, kind: 'text' as const, language: 'markdown' },
    { path: 'docs/plan.md', title: '实施方案', name: 'plan.md', extension: '.md', size: 80, kind: 'text' as const, language: 'markdown' },
  ],
  createdAt: '2026-07-23T00:00:00.000Z',
}

describe('PC files presentation', () => {
  test('normalizes a persisted multi-file presentation', () => {
    const message = normalizeMessage({
      id: 'msg-files', session_id: 'sess-1', role: 'agent', content: 'Done',
      thinking: null, tool_calls_json: null, decision_json: null,
      presentations_json: JSON.stringify([presentation]),
      timestamp: '2026-07-23T00:00:01.000Z', status: 'completed', process_item_count: 1,
    } as MessageData)

    expect(message.parsedPresentations).toEqual([presentation])
  })

  test('renders persisted files outside the collapsed process panel', () => {
    const Component = TurnContentView as unknown as ComponentType<Record<string, unknown>>
    const html = renderToStaticMarkup(createElement(Component, {
      processBlocks: [],
      finalAnswer: 'Done',
      isStreaming: false,
      processCount: 1,
      processLoaded: false,
      filesPresentations: [presentation],
      renderProcessBlock: () => null,
      renderFilesPresentation: (item: typeof presentation) => createElement('span', null, `${item.title} ${item.files.length} 个文件`),
    }))

    expect(html).toContain('本次交付')
    expect(html).toContain('2 个文件')
  })

  test('deduplicates a persisted summary when the realtime tool block is present', () => {
    const rawOutput = JSON.stringify(presentation)
    const Component = TurnContentView as unknown as ComponentType<Record<string, unknown>>
    const html = renderToStaticMarkup(createElement(Component, {
      processBlocks: [{
        id: 'tool-files',
        kind: 'tool',
        toolCall: { id: 'tool-files', title: 'files.present', status: 'completed', rawOutput },
      }],
      finalAnswer: '',
      isStreaming: false,
      filesPresentations: [presentation],
      renderProcessBlock: () => createElement('span', null, '实时文件卡片'),
      renderFilesPresentation: () => createElement('span', null, '历史文件卡片'),
    }))

    expect(html).toContain('实时文件卡片')
    expect(html).not.toContain('历史文件卡片')
  })

  test('renders a compact card for multiple files', () => {
    const html = renderToStaticMarkup(createElement(FilesPresentationCard, {
      presentation,
      onOpen: () => undefined,
    }))

    expect(html).toContain('本次交付')
    expect(html).toContain('分析报告')
    expect(html).toContain('实施方案')
    expect(html).toContain('2 个文件')
  })
})
