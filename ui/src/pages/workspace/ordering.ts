export interface WorkspaceOrderedItem {
  id: string
  sort_order?: number | null
  created_at?: string | null
  started_at?: string | null
}

export interface NestedOrderDragEvent {
  preventDefault: () => void
  stopPropagation: () => void
}

export function prepareNestedOrderDragEvent(event: NestedOrderDragEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

export function sortWorkspaceItems<T extends WorkspaceOrderedItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER
    const orderB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    const timeA = Date.parse(a.created_at ?? a.started_at ?? '') || 0
    const timeB = Date.parse(b.created_at ?? b.started_at ?? '') || 0
    if (timeA !== timeB) return timeA - timeB
    return a.id.localeCompare(b.id)
  })
}

export function moveItemById(ids: string[], id: string, targetIndex: number): string[] {
  const fromIndex = ids.indexOf(id)
  if (fromIndex < 0 || fromIndex === targetIndex) return ids
  const next = [...ids]
  const [item] = next.splice(fromIndex, 1)
  const boundedTarget = Math.max(0, Math.min(targetIndex, next.length))
  next.splice(boundedTarget, 0, item)
  return next
}
