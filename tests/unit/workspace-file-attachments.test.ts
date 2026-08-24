import { describe, expect, test } from 'vitest'
import {
  appendWorkspaceFilePaths,
  createWorkspaceFileLocalId,
  partitionWorkspaceFiles,
  type WorkspaceUploadedFile,
} from '../../ui/src/pages/workspace/workspace-file-attachments.ts'

describe('Workspace file attachments', () => {
  test('creates local ids with randomUUID when the browser supports it', () => {
    expect(createWorkspaceFileLocalId({ randomUUID: () => 'uuid-1' })).toBe('file-uuid-1')
  })

  test('creates local ids in non-secure HTTP contexts without randomUUID', () => {
    expect(createWorkspaceFileLocalId({})).toMatch(/^file-[a-z0-9]+-[a-z0-9]+$/)
  })

  test('keeps images on the existing image path and separates regular files', () => {
    const image = { type: 'image/png', name: 'screen.png' } as File
    const document = { type: 'application/pdf', name: 'spec.pdf' } as File

    expect(partitionWorkspaceFiles([image, document])).toEqual({
      images: [image],
      files: [document],
    })
  })

  test('appends server paths to the Prompt without changing an empty file list', () => {
    const files: WorkspaceUploadedFile[] = [{
      id: 'upload-1',
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      size: 12,
      path: 'C:\\data-prd\\attachments\\sessions\\p\\s\\u\\spec.pdf',
      relativePath: 'attachments/sessions/p/s/u/spec.pdf',
    }]

    expect(appendWorkspaceFilePaths('请分析', [])).toBe('请分析')
    expect(appendWorkspaceFilePaths('请分析', files)).toContain('请分析\n\n[文件附件]')
    expect(appendWorkspaceFilePaths('请分析', files)).toContain(files[0].path)
    expect(appendWorkspaceFilePaths('', files)).toContain('原始文件名: spec.pdf')
  })
})
