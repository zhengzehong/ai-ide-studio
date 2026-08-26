import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import TurnContent from '../../mobile/src/components/chat/TurnContent.tsx'
import { PresentedFilesOverlay } from '../../mobile/src/components/file-viewer/PresentedFilesOverlay.tsx'
import { FileDetail } from '../../mobile/src/components/file-viewer/FileDetail.tsx'
import { MarkdownView } from '../../mobile/src/components/file-viewer/MarkdownView.tsx'
import type { MessageData } from '../../ui/src/stores/session-events.ts'

const presentation = {
  kind: 'files' as const,
  presentationId: 'files-mobile',
  projectId: 'project-1',
  title: '本次交付',
  files: [
    { path: 'docs/report.md', title: '分析报告', name: 'report.md', extension: '.md', size: 100, kind: 'text' as const, language: 'markdown' },
    { path: 'docs/plan.md', title: '实施方案', name: 'plan.md', extension: '.md', size: 80, kind: 'text' as const, language: 'markdown' },
  ],
  createdAt: '2026-07-23T00:00:00.000Z',
}

describe('mobile files presentation', () => {
  test('renders a Windows file link as an internal resource action', () => {
    const Component = TurnContent as unknown as ComponentType<Record<string, unknown>>
    const message: MessageData = {
      id: 'msg-resource', session_id: 'sess-1', role: 'agent',
      content: '[打开报告](D:/reports/result.md)',
      thinking: null, tool_calls_json: null, decision_json: null,
      presentations_json: null, timestamp: '2026-08-26T00:00:00.000Z', status: 'completed',
    }
    const html = renderToStaticMarkup(createElement(Component, {
      message,
      onOpenResource: async () => ({
        path: 'D:/reports/result.md', name: 'result.md', kind: 'file', absolute: true,
      }),
    }))

    expect(html).toContain('aria-label="打开项目资源：D:/reports/result.md"')
    expect(html).toContain('打开报告')
  })

  test('renders a persisted multi-file presentation outside process history', () => {
    const Component = TurnContent as unknown as ComponentType<Record<string, unknown>>
    const message: MessageData = {
      id: 'msg-files', session_id: 'sess-1', role: 'agent', content: 'Done',
      thinking: null, tool_calls_json: null, decision_json: null,
      presentations_json: JSON.stringify([presentation]), parsedPresentations: [presentation],
      timestamp: '2026-07-23T00:00:01.000Z', status: 'completed', process_item_count: 1,
    }
    const html = renderToStaticMarkup(createElement(Component, { message }))

    expect(html).toContain('本次交付')
    expect(html).toContain('分析报告')
    expect(html).toContain('实施方案')
    expect(html).toContain('2 个文件')
  })

  test('deduplicates history when the realtime tool block has the same presentation id', () => {
    const Component = TurnContent as unknown as ComponentType<Record<string, unknown>>
    const message: MessageData = {
      id: 'msg-files', session_id: 'sess-1', role: 'agent', content: '',
      thinking: null, tool_calls_json: null, decision_json: null,
      presentations_json: JSON.stringify([presentation]), parsedPresentations: [presentation],
      timestamp: '2026-07-23T00:00:01.000Z', status: 'completed',
      processBlocks: [{
        id: 'tool-files', kind: 'tool',
        toolCall: { id: 'tool-files', title: 'files.present', status: 'completed', rawOutput: JSON.stringify(presentation) },
      }],
    }
    const html = renderToStaticMarkup(createElement(Component, { message }))

    expect(html.match(/本次交付/g)).toHaveLength(1)
  })

  test('renders the final Codex gateway wrapper', () => {
    const Component = TurnContent as unknown as ComponentType<Record<string, unknown>>
    const codexPresentation = { ...presentation, title: 'Codex wrapped files' }
    const message: MessageData = {
      id: 'msg-files-codex', session_id: 'sess-1', role: 'agent', content: 'Done',
      thinking: null, tool_calls_json: null, decision_json: null,
      presentations_json: null,
      timestamp: '2026-08-03T00:00:01.000Z', status: 'completed',
      processBlocks: [{
        id: 'tool-files-codex', kind: 'tool',
        toolCall: {
          id: 'tool-files-codex',
          title: 'ai-ide-tools.files.present',
          status: 'completed',
          rawInput: { server: 'ai-ide-tools', tool: 'files.present', arguments: {} },
          rawOutput: { result: { content: [{ type: 'text', text: JSON.stringify(codexPresentation) }] }, error: null },
        },
      }],
    }
    const html = renderToStaticMarkup(createElement(Component, { message }))

    expect(html).toContain('Codex wrapped files')
  })

  test('offers every presented file as a full-screen switch target', () => {
    const html = renderToStaticMarkup(createElement(PresentedFilesOverlay, {
      presentation,
      onClose: () => undefined,
    }))

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="选择文件"')
    expect(html).toContain('分析报告')
    expect(html).toContain('实施方案')
  })

  test('renders touch-friendly audio and markdown absolute images with explicit project scope', () => {
    const audioHtml = renderToStaticMarkup(createElement(FileDetail, {
      projectId: 'project-1',
      file: {
        path: 'D:/media/voice.mp3', content: '', size: 100, extension: '.mp3',
        language: 'plaintext', truncated: false, kind: 'audio',
      },
      loading: false,
      error: null,
      onBack: () => undefined,
      embedded: true,
    }))
    const markdownHtml = renderToStaticMarkup(createElement(MarkdownView, {
      content: '![现场](file:///D:/images/site.png)',
      projectId: 'project-1',
      documentPath: 'D:/docs/report.md',
    }))

    expect(audioHtml).toContain('<audio')
    expect(audioHtml).toContain('controls=""')
    expect(markdownHtml).toContain('data-resource-path="file:///D:/images/site.png"')
  })
})
