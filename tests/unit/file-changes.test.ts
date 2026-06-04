import { describe, expect, test } from 'vitest'
import {
  buildFileChangesFromToolCalls,
  parseFileChangesJson,
} from '../../src/store/file-changes.js'
import type { ToolCallData } from '../../src/types/ws-protocol.js'

describe('ACP file changes', () => {
  test('extracts only ACP diff content and ignores locations', () => {
    const toolCalls: ToolCallData[] = [
      {
        id: 'read-1',
        title: 'Read file',
        locations: [{ path: 'src/read-only.ts', line: 4 }],
      },
      {
        id: 'edit-1',
        title: 'Edit file',
        content: [
          {
            type: 'diff',
            path: 'src/app.ts',
            oldText: 'export const value = 1\nconsole.log(value)\n',
            newText: 'export const value = 2\nconsole.log(value)\n',
          },
        ],
      },
    ]

    const changes = buildFileChangesFromToolCalls(toolCalls)

    expect(changes.files).toHaveLength(1)
    expect(changes.files[0]).toMatchObject({
      path: 'src/app.ts',
      changeType: 'M',
      addedLines: 1,
      deletedLines: 1,
    })
    expect(changes.totalAdded).toBe(1)
    expect(changes.totalDeleted).toBe(1)
  })

  test('deduplicates summaries by file while keeping detail segments', () => {
    const toolCalls: ToolCallData[] = [
      {
        id: 'edit-1',
        title: 'Edit file',
        content: [{ type: 'diff', path: 'src/app.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }],
      },
      {
        id: 'edit-2',
        title: 'Edit file',
        content: [{ type: 'diff', path: 'src/app.ts', oldText: 'a\nB\nc', newText: 'a\nB\nc\nd' }],
      },
    ]

    const changes = buildFileChangesFromToolCalls(toolCalls)

    expect(changes.files).toHaveLength(1)
    expect(changes.files[0]).toMatchObject({
      path: 'src/app.ts',
      changeType: 'M',
      addedLines: 2,
      deletedLines: 1,
    })
    expect(changes.files[0]?.segments).toHaveLength(2)
  })

  test('classifies added and deleted files from old/new text presence', () => {
    const toolCalls: ToolCallData[] = [
      {
        id: 'write-1',
        title: 'Write file',
        content: [{ type: 'diff', path: 'src/new.ts', newText: 'hello\nworld' }],
      },
      {
        id: 'delete-1',
        title: 'Delete file',
        content: [{ type: 'diff', path: 'src/old.ts', oldText: 'bye\nworld', newText: '' }],
      },
    ]

    const changes = buildFileChangesFromToolCalls(toolCalls)

    expect(changes.files.map((file) => [file.path, file.changeType, file.addedLines, file.deletedLines])).toEqual([
      ['src/new.ts', 'A', 2, 0],
      ['src/old.ts', 'D', 0, 2],
    ])
  })

  test('parses persisted summaries defensively', () => {
    expect(parseFileChangesJson(null)).toBeUndefined()
    expect(parseFileChangesJson('{bad json')).toBeUndefined()
    expect(parseFileChangesJson(JSON.stringify({ files: [{ path: 'src/a.ts' }], totalAdded: 1, totalDeleted: 0 }))).toEqual({
      files: [{ path: 'src/a.ts' }],
      totalAdded: 1,
      totalDeleted: 0,
    })
  })
})
