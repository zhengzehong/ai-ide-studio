import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const wsMock = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const {
  decodeChatResourceHref,
  encodeChatResourceHref,
  isChatResourceReference,
} = await import('../../ui/src/services/chat-resource-links.ts')
const { useFileSystemStore } = await import('../../mobile/src/stores/filesystem.store.ts')
const { useFileSystemStore: useDesktopFileSystemStore } = await import('../../ui/src/stores/filesystem.store.ts')
const { MarkdownRenderer } = await import('../../ui/src/components/MarkdownRenderer.tsx')

describe('chat resource links', () => {
  beforeEach(() => {
    wsMock.request.mockReset()
    wsMock.request.mockResolvedValue([])
    useFileSystemStore.getState().reset()
    useDesktopFileSystemStore.getState().reset()
  })

  test.each([
    'D:/reports/result.md',
    String.raw`\\server\share\report.md`,
    'file:///D:/reports/result.md',
    'docs/report.md',
  ])('classifies %s as an internal resource', (reference) => {
    expect(isChatResourceReference(reference)).toBe(true)
    expect(decodeChatResourceHref(encodeChatResourceHref(reference))).toBe(reference)
  })

  test.each(['https://example.com', 'mailto:test@example.com', '#section', 'javascript:alert(1)'])(
    'leaves %s outside internal resource handling',
    (reference) => expect(isChatResourceReference(reference)).toBe(false),
  )

  test('loads an absolute directory as the mobile file-tree root', async () => {
    await (useFileSystemStore.getState().initTree as (projectId: string, rootPath?: string) => Promise<void>)(
      'project-1',
      'D:/reports',
    )

    expect(wsMock.request).toHaveBeenCalledWith({
      type: 'fs.list',
      projectId: 'project-1',
      dirPath: 'D:/reports',
    })
  })

  test('preserves external links and renders Windows paths as internal actions on PC', () => {
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, {
      content: '[本地报告](D:/reports/result.md) [官网](https://example.com)',
      onOpenResource: async () => ({
        path: 'D:/reports/result.md', name: 'result.md', kind: 'file', absolute: true,
      }),
    }))

    expect(html).toContain('aria-label="打开项目资源：D:/reports/result.md"')
    expect(html).toContain('href="https://example.com"')
  })

  test('does not let a pending project-root request replace a directory link result', async () => {
    let resolveRoot: (value: unknown) => void = () => undefined
    let resolveDirectory: (value: unknown) => void = () => undefined
    const rootRequest = new Promise((resolve) => { resolveRoot = resolve })
    const directoryRequest = new Promise((resolve) => { resolveDirectory = resolve })
    wsMock.request.mockImplementation((message: Record<string, unknown>) => (
      message.dirPath ? directoryRequest : rootRequest
    ))
    useDesktopFileSystemStore.getState().activateProject('project-1')

    const root = useDesktopFileSystemStore.getState().fetchTree('project-1', { force: true })
    const directory = useDesktopFileSystemStore.getState().openDirectoryByPath('project-1', 'D:/reports')
    resolveDirectory([{ name: 'inside.md', path: 'D:/reports/inside.md', type: 'file' }])
    await directory
    resolveRoot([{ name: 'root.md', path: 'root.md', type: 'file' }])
    await root

    expect(useDesktopFileSystemStore.getState().rootPath).toBe('D:/reports')
    expect(useDesktopFileSystemStore.getState().tree.map((entry) => entry.name)).toEqual(['inside.md'])
  })
})
