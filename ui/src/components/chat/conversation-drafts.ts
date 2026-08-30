import type { ImageAttachmentInfo } from '../../stores/session-events'
import type { WorkspacePendingFile } from '../../pages/workspace/workspace-file-attachments'

export interface ConversationDraft {
  text: string
  images: ImageAttachmentInfo[]
  files: WorkspacePendingFile[]
}

interface ConversationDraftStoreOptions {
  now?: () => number
  ttlMs?: number
  revokeImage?: (url: string) => void
}

interface StoredDraft extends ConversationDraft {
  updatedAt: number
}

const emptyDraft: ConversationDraft = { text: '', images: [], files: [] }
const defaultTtlMs = 30 * 60 * 1000

function cloneDraft(draft: ConversationDraft): ConversationDraft {
  return { text: draft.text, images: [...draft.images], files: [...draft.files] }
}

function hasContent(draft: ConversationDraft): boolean {
  return draft.text.length > 0 || draft.images.length > 0 || draft.files.length > 0
}

function imageUrls(images: ImageAttachmentInfo[]): Set<string> {
  return new Set(images.map((image) => image.url).filter((url): url is string => !!url && url.startsWith('blob:')))
}

export function createConversationDraftStore(options: ConversationDraftStoreOptions = {}) {
  const drafts = new Map<string, StoredDraft>()
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? defaultTtlMs
  const revokeImage = options.revokeImage ?? ((url: string) => URL.revokeObjectURL(url))

  const revokeRemovedImages = (previous: ImageAttachmentInfo[], next: ImageAttachmentInfo[]): void => {
    const retained = imageUrls(next)
    for (const url of imageUrls(previous)) {
      if (!retained.has(url)) revokeImage(url)
    }
  }

  const clear = (sessionId: string | null): void => {
    if (!sessionId) return
    const previous = drafts.get(sessionId)
    if (previous) {
      for (const url of imageUrls(previous.images)) revokeImage(url)
      drafts.delete(sessionId)
    }
  }

  const replace = (sessionId: string | null, draft: ConversationDraft): void => {
    if (!sessionId) return
    const previous = drafts.get(sessionId)
    if (!hasContent(draft)) {
      clear(sessionId)
      return
    }
    if (previous) revokeRemovedImages(previous.images, draft.images)
    drafts.set(sessionId, { ...cloneDraft(draft), updatedAt: now() })
  }

  const get = (sessionId: string | null): ConversationDraft => {
    if (!sessionId) return cloneDraft(emptyDraft)
    const draft = drafts.get(sessionId)
    return draft ? cloneDraft(draft) : cloneDraft(emptyDraft)
  }

  const update = (sessionId: string | null, updater: (draft: ConversationDraft) => ConversationDraft): ConversationDraft => {
    if (!sessionId) return cloneDraft(emptyDraft)
    const next = updater(get(sessionId))
    replace(sessionId, next)
    return cloneDraft(next)
  }

  return {
    get,
    replace,
    update,
    clear,
    prune(excludedSessionIds: readonly string[] = []): void {
      const cutoff = now() - ttlMs
      const excluded = new Set(excludedSessionIds)
      for (const [sessionId, draft] of drafts) {
        if (!excluded.has(sessionId) && draft.updatedAt <= cutoff) clear(sessionId)
      }
    },
    dispose(): void {
      for (const [sessionId] of drafts) clear(sessionId)
    },
  }
}

export const conversationDrafts = createConversationDraftStore()
