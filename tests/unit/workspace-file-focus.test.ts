import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../ui/src/components/file-viewer/FilePreview', () => ({
  FilePreview: () => createElement('div', { 'data-file-preview': true }, '文件内容'),
}))

import { WorkspaceCenterStage } from '../../ui/src/pages/workspace/WorkspaceCenterStage'

describe('Workspace file focus layout', () => {
  test('wires file mode into the focused center stage without the legacy placeholder', () => {
    const source = readFileSync(resolve(process.cwd(), 'ui/src/pages/Workspace.tsx'), 'utf8')

    expect(source).toContain('<WorkspaceCenterStage')
    expect(source).toContain("fileMode={sidebarTab === 'files'}")
    expect(source).not.toContain('文件浏览中')
    expect(source).not.toContain('width: 420')
  })

  test('replaces the visible chat stage with a flexible file stage', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCenterStage, {
      chat: createElement('div', { 'data-chat-content': true }, '会话内容'),
      file: { path: 'AGENTS.md', content: '# Title', kind: 'text', size: 7, extension: '.md', language: 'markdown', truncated: false },
      fileMode: true,
      onCloseFile: () => undefined,
      projectId: 'project-a',
    }))

    expect(html).toContain('data-workspace-pane="file"')
    expect(html).toContain('flex:1')
    expect(html).toContain('data-file-preview="true"')
    expect(html).toContain('data-workspace-pane="chat"')
    expect(html).toContain('display:none')
    expect(html).toContain('data-chat-content="true"')
  })

  test('shows only the chat stage in Session mode', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCenterStage, {
      chat: createElement('div', null, '会话内容'),
      file: null,
      fileMode: false,
      onCloseFile: () => undefined,
      projectId: 'project-a',
    }))

    expect(html).not.toContain('data-workspace-pane="file"')
    expect(html).toContain('data-workspace-pane="chat"')
    expect(html).toContain('display:flex')
  })

  test('shows a file selection state without restoring the conversation', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceCenterStage, {
      chat: createElement('div', null, '会话内容'),
      file: null,
      fileMode: true,
      onCloseFile: () => undefined,
      projectId: 'project-a',
    }))

    expect(html).toContain('从左侧选择文件')
    expect(html).toContain('aria-hidden="true"')
  })
})
