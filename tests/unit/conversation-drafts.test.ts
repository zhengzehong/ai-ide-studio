import { describe, expect, test, vi } from 'vitest'
import { createConversationDraftStore } from '../../ui/src/components/chat/conversation-drafts.js'

describe('conversation draft store', () => {
  test('updates a target session draft after its composer is unmounted', () => {
    const store = createConversationDraftStore()
    store.replace('session-a', { text: '', images: [], files: [] })

    store.update('session-a', (draft) => ({
      ...draft,
      files: [{ localId: 'file-1', name: 'report.md', size: 12, status: 'uploaded', uploaded: { id: 'upload-1', name: 'report.md', mimeType: 'text/markdown', size: 12, path: 'report.md', relativePath: 'report.md' } }],
    }))

    expect(store.get('session-a').files[0]?.status).toBe('uploaded')
    expect(store.get('session-a').files[0]?.name).toBe('report.md')
  })

  test('revokes image previews when a draft is cleared or expires', () => {
    let now = 100
    const revoke = vi.fn()
    const store = createConversationDraftStore({ now: () => now, ttlMs: 10, revokeImage: revoke })
    store.replace('session-a', { text: '', images: [{ data: 'abc', mimeType: 'image/png', url: 'blob:one' }], files: [] })
    store.clear('session-a')
    expect(revoke).toHaveBeenCalledWith('blob:one')

    store.replace('session-b', { text: '', images: [{ data: 'def', mimeType: 'image/png', url: 'blob:two' }], files: [] })
    now = 111
    store.prune()
    expect(revoke).toHaveBeenCalledWith('blob:two')
  })

  test('does not expire the active session draft while it is still displayed', () => {
    let now = 100
    const revoke = vi.fn()
    const store = createConversationDraftStore({ now: () => now, ttlMs: 10, revokeImage: revoke })
    store.replace('session-a', { text: '', images: [{ data: 'abc', mimeType: 'image/png', url: 'blob:active' }], files: [] })
    now = 111
    store.prune(['session-a'])
    expect(store.get('session-a').images).toHaveLength(1)
    expect(revoke).not.toHaveBeenCalled()
  })
})
