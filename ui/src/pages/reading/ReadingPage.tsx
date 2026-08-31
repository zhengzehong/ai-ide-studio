import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readingWorkspacePath } from '../../services/reading-client'
import { useReadingStore } from '../../stores/reading.store'
import type { ReadingItem } from '../../types/reading'
import { ReadingListPanel } from './ReadingListPanel'
import { ReadingReader } from './ReadingReader'
import './reading.css'

export function ReadingPage() {
  const navigate = useNavigate()
  const items = useReadingStore((state) => state.items)
  const projectCounts = useReadingStore((state) => state.projectCounts)
  const loading = useReadingStore((state) => state.loading)
  const error = useReadingStore((state) => state.error)
  const load = useReadingStore((state) => state.load)
  const updateStatus = useReadingStore((state) => state.updateStatus)
  const [archived, setArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load({ status: archived ? 'archived' : 'active', query, projectId })
    }, query ? 180 : 0)
    return () => window.clearTimeout(timer)
  }, [archived, load, projectId, query])

  useEffect(() => {
    const refresh = () => void load({ status: archived ? 'archived' : 'active', query, projectId }, { silent: true })
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [archived, load, projectId, query])

  const effectiveSelectedId = selectedId && items.some((item) => item.id === selectedId)
    ? selectedId
    : items[0]?.id ?? null
  const selected = useMemo(
    () => items.find((item) => item.id === effectiveSelectedId) ?? null,
    [effectiveSelectedId, items],
  )

  const selectItem = (item: ReadingItem): void => {
    setSelectedId(item.id)
    if (item.status === 'unread') void updateStatus(item.id, 'read')
  }

  return (
    <div className="reading-page">
      <ReadingListPanel
        items={items}
        loading={loading}
        error={error}
        archived={archived}
        query={query}
        projectId={projectId}
        projectOptions={projectCounts}
        selectedId={effectiveSelectedId}
        onQueryChange={setQuery}
        onProjectChange={setProjectId}
        onToggleArchive={() => { setArchived((value) => !value); setSelectedId(null) }}
        onRefresh={() => void load({ status: archived ? 'archived' : 'active', query, projectId })}
        onSelect={selectItem}
        onStatus={(item) => void updateStatus(item.id, archived ? 'read' : 'archived')}
      />
      <ReadingReader
        item={selected}
        onArchive={(item) => void updateStatus(item.id, 'archived')}
        onReturn={(item) => {
          if (item.projectId && item.sessionId) navigate(readingWorkspacePath(item.projectId, item.sessionId))
        }}
        onOpenExternal={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
      />
    </div>
  )
}
