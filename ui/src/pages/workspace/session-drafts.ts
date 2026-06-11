export interface WorkspacePendingImage {
  data: string
  mimeType: string
  preview: string
}

export interface WorkspaceSessionDraft {
  text: string
  images: WorkspacePendingImage[]
}

interface SessionDraftStoreOptions {
  revokePreview?: (preview: string) => void
}

const emptyDraft: WorkspaceSessionDraft = { text: '', images: [] }

function hasDraft(draft: WorkspaceSessionDraft): boolean {
  return draft.text.length > 0 || draft.images.length > 0
}

function cloneDraft(draft: WorkspaceSessionDraft): WorkspaceSessionDraft {
  return { text: draft.text, images: [...draft.images] }
}

export function createSessionDraftStore(options: SessionDraftStoreOptions = {}) {
  const drafts = new Map<string, WorkspaceSessionDraft>()
  const revokePreview = options.revokePreview

  const revokeImages = (images: WorkspacePendingImage[]): void => {
    if (!revokePreview) return
    for (const image of images) revokePreview(image.preview)
  }

  return {
    get(sessionId: string | null): WorkspaceSessionDraft {
      if (!sessionId) return cloneDraft(emptyDraft)
      return cloneDraft(drafts.get(sessionId) ?? emptyDraft)
    },
    save(sessionId: string | null, draft: WorkspaceSessionDraft): void {
      if (!sessionId) return
      const previous = drafts.get(sessionId)
      if (!hasDraft(draft)) {
        if (previous) revokeImages(previous.images)
        drafts.delete(sessionId)
        return
      }
      drafts.set(sessionId, cloneDraft(draft))
    },
    take(sessionId: string | null): WorkspaceSessionDraft {
      if (!sessionId) return cloneDraft(emptyDraft)
      const draft = drafts.get(sessionId)
      if (!draft) return cloneDraft(emptyDraft)
      drafts.delete(sessionId)
      return cloneDraft(draft)
    },
    clear(sessionId: string | null): void {
      if (!sessionId) return
      const previous = drafts.get(sessionId)
      if (previous) revokeImages(previous.images)
      drafts.delete(sessionId)
    },
    dispose(): void {
      for (const draft of drafts.values()) revokeImages(draft.images)
      drafts.clear()
    },
  }
}
