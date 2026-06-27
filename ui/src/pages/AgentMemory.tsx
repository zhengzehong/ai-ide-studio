import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../stores/project.store'
import {
  useAgentMemoryStore,
  type AgentMemoryDimensionData,
  type AgentMemoryEntrySummary,
} from '../stores/agent-memory.store'
import { AgentList } from './agent-memory/AgentList'
import { DimensionList } from './agent-memory/DimensionList'
import { EntryList } from './agent-memory/EntryList'
import { DimensionModal } from './agent-memory/DimensionModal'
import { EntryModal } from './agent-memory/EntryModal'
import './agent-memory/agent-memory.css'

export default function AgentMemory() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId)

  const dimensions = useAgentMemoryStore((s) => s.dimensions)
  const entries = useAgentMemoryStore((s) => s.entries)
  const pinnedLimit = useAgentMemoryStore((s) => s.pinnedLimit)
  const loading = useAgentMemoryStore((s) => s.loading)
  const saving = useAgentMemoryStore((s) => s.saving)
  const error = useAgentMemoryStore((s) => s.error)
  const clearError = useAgentMemoryStore((s) => s.clearError)
  const fetchDimensions = useAgentMemoryStore((s) => s.fetchDimensions)
  const createDimension = useAgentMemoryStore((s) => s.createDimension)
  const updateDimension = useAgentMemoryStore((s) => s.updateDimension)
  const fetchEntries = useAgentMemoryStore((s) => s.fetchEntries)
  const getEntry = useAgentMemoryStore((s) => s.getEntry)
  const createEntry = useAgentMemoryStore((s) => s.createEntry)
  const updateEntry = useAgentMemoryStore((s) => s.updateEntry)
  const deleteEntry = useAgentMemoryStore((s) => s.deleteEntry)

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<Record<string, string>>({})
  const [dimModal, setDimModal] = useState<{ mode: 'create' | 'edit'; target: AgentMemoryDimensionData | null } | null>(null)
  const [entryModal, setEntryModal] = useState<{ mode: 'create' | 'edit'; target: AgentMemoryEntrySummary | null } | null>(null)

  useEffect(() => {
    if (!currentProjectId || !selectedAgentId) return
    fetchDimensions(currentProjectId, selectedAgentId)
    setSelectedDimensionId(null)
  }, [currentProjectId, selectedAgentId, fetchDimensions])

  const currentDimension = useMemo(
    () => dimensions.find((d) => d.id === selectedDimensionId) ?? null,
    [dimensions, selectedDimensionId],
  )

  useEffect(() => {
    if (!currentProjectId || !selectedAgentId || !currentDimension) {
      return
    }
    fetchEntries(currentProjectId, selectedAgentId, currentDimension.name)
  }, [currentProjectId, selectedAgentId, currentDimension, fetchEntries])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    entries.forEach((e) => e.tags.forEach((t) => s.add(t)))
    return [...s].sort()
  }, [entries])

  const pinnedCount = useMemo(() => entries.filter((e) => e.pinned).length, [entries])

  const handleExpand = async (entry: AgentMemoryEntrySummary) => {
    if (expandedContent[entry.id]) return
    if (!currentProjectId || !selectedAgentId) return
    try {
      const full = await getEntry(currentProjectId, selectedAgentId, entry.id)
      setExpandedContent((prev) => ({ ...prev, [entry.id]: full.content }))
    } catch {
      // ignore; user can retry
    }
  }

  const handleSaveDimension = async (input: { name: string; description: string; prompt: string }) => {
    if (!currentProjectId || !selectedAgentId) return
    if (dimModal?.mode === 'edit' && dimModal.target) {
      await updateDimension(currentProjectId, selectedAgentId, dimModal.target.id, input)
    } else {
      await createDimension(currentProjectId, selectedAgentId, input)
    }
    setDimModal(null)
  }

  const handleSaveEntry = async (input: { title: string; content: string; tags: string[] }) => {
    if (!currentProjectId || !selectedAgentId || !currentDimension) return
    const targetId = entryModal?.target?.id
    if (entryModal?.mode === 'edit' && targetId) {
      await updateEntry(currentProjectId, selectedAgentId, targetId, input)
      setExpandedContent((prev) => {
        const next = { ...prev }
        delete next[targetId]
        return next
      })
    } else {
      await createEntry(currentProjectId, selectedAgentId, {
        dimension: currentDimension.name,
        ...input,
      })
    }
    await fetchEntries(currentProjectId, selectedAgentId, currentDimension.name)
    setEntryModal(null)
  }

  const handleTogglePinned = async (entry: AgentMemoryEntrySummary) => {
    if (!currentProjectId || !selectedAgentId || !currentDimension) return
    await updateEntry(currentProjectId, selectedAgentId, entry.id, { pinned: !entry.pinned })
    await fetchEntries(currentProjectId, selectedAgentId, currentDimension.name)
  }

  const handleDeleteEntry = async (entry: AgentMemoryEntrySummary) => {
    if (!currentProjectId || !selectedAgentId || !currentDimension) return
    await deleteEntry(currentProjectId, selectedAgentId, entry.id)
    setExpandedContent((prev) => {
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    await fetchEntries(currentProjectId, selectedAgentId, currentDimension.name)
  }

  return (
    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
      {error ? (
        <div style={{ padding: 8, marginBottom: 8, background: 'var(--red-bg, #fff2f0)', border: '1px solid #fdcdc5', borderRadius: 6, color: 'var(--red)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={clearError} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--red)' }}>×</button>
        </div>
      ) : null}
      <div className="am-page">
        <AgentList selectedAgentId={selectedAgentId} onSelect={setSelectedAgentId} />
        <DimensionList
          dimensions={dimensions}
          selectedDimensionId={selectedDimensionId}
          entryCounts={{}}
          loading={loading}
          onSelect={setSelectedDimensionId}
          onCreate={() => setDimModal({ mode: 'create', target: null })}
          onEdit={(d) => setDimModal({ mode: 'edit', target: d })}
        />
        <EntryList
          entries={entries}
          pinnedLimit={pinnedLimit}
          pinnedCount={pinnedCount}
          loading={loading}
          saving={saving}
          allTags={allTags}
          dimensionName={currentDimension?.name ?? '条目'}
          onCreate={() => setEntryModal({ mode: 'create', target: null })}
          onEdit={(e) => setEntryModal({ mode: 'edit', target: e })}
          onDelete={handleDeleteEntry}
          onTogglePinned={handleTogglePinned}
          onExpand={handleExpand}
          expandedContent={expandedContent}
        />
      </div>
      <DimensionModal
        open={dimModal !== null}
        mode={dimModal?.mode ?? 'create'}
        dimension={dimModal?.target ?? null}
        saving={saving}
        onSave={handleSaveDimension}
        onClose={() => setDimModal(null)}
      />
      <EntryModal
        open={entryModal !== null}
        mode={entryModal?.mode ?? 'create'}
        entry={entryModal?.target ?? null}
        saving={saving}
        onSave={handleSaveEntry}
        onClose={() => setEntryModal(null)}
      />
    </div>
  )
}

