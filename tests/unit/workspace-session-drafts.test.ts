import { describe, expect, test, vi } from 'vitest'
import { createSessionDraftStore, type WorkspacePendingImage } from '../../ui/src/pages/workspace/session-drafts.ts'

function image(preview: string): WorkspacePendingImage {
  return { data: `data-${preview}`, mimeType: 'image/png', preview }
}

describe('workspace session drafts', () => {
  test('restores drafts by session and leaves empty sessions empty', () => {
    const drafts = createSessionDraftStore()
    const aImages = [image('blob:a')]

    drafts.save('sess-a', { text: 'A draft', images: aImages })

    expect(drafts.get('sess-b')).toEqual({ text: '', images: [] })
    expect(drafts.get('sess-a')).toEqual({ text: 'A draft', images: aImages })
  })

  test('clears only the sent session draft', () => {
    const drafts = createSessionDraftStore()

    drafts.save('sess-a', { text: 'A draft', images: [image('blob:a')] })
    drafts.save('sess-b', { text: 'B draft', images: [image('blob:b')] })
    drafts.clear('sess-a')

    expect(drafts.get('sess-a')).toEqual({ text: '', images: [] })
    expect(drafts.get('sess-b')).toEqual({ text: 'B draft', images: [image('blob:b')] })
  })

  test('takes a draft without revoking transferred image previews', () => {
    const revokePreview = vi.fn()
    const drafts = createSessionDraftStore({ revokePreview })
    const aImages = [image('blob:a')]

    drafts.save('sess-a', { text: 'A draft', images: aImages })

    expect(drafts.take('sess-a')).toEqual({ text: 'A draft', images: aImages })
    expect(drafts.get('sess-a')).toEqual({ text: '', images: [] })
    expect(revokePreview).not.toHaveBeenCalled()
  })

  test('revokes image previews when clearing or disposing drafts', () => {
    const revokePreview = vi.fn()
    const drafts = createSessionDraftStore({ revokePreview })

    drafts.save('sess-a', { text: 'A draft', images: [image('blob:a1'), image('blob:a2')] })
    drafts.save('sess-b', { text: 'B draft', images: [image('blob:b')] })
    drafts.clear('sess-a')
    drafts.dispose()

    expect(revokePreview).toHaveBeenCalledTimes(3)
    expect(revokePreview).toHaveBeenNthCalledWith(1, 'blob:a1')
    expect(revokePreview).toHaveBeenNthCalledWith(2, 'blob:a2')
    expect(revokePreview).toHaveBeenNthCalledWith(3, 'blob:b')
  })
})
