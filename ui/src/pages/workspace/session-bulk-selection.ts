export interface BatchSessionItem {
  id: string
  isPrimary: boolean
  isRunning: boolean
  isCurrent: boolean
}

export function canSelectSessionForBatchDelete(session: BatchSessionItem): boolean {
  return !session.isPrimary && !session.isRunning && !session.isCurrent
}

export function batchDeletableSessionIds(sessions: BatchSessionItem[]): string[] {
  return sessions.filter(canSelectSessionForBatchDelete).map((session) => session.id)
}

export function toggleBatchSessionSelection(selectedIds: string[], session: BatchSessionItem): string[] {
  if (!canSelectSessionForBatchDelete(session)) return selectedIds
  return selectedIds.includes(session.id)
    ? selectedIds.filter((id) => id !== session.id)
    : [...selectedIds, session.id]
}
