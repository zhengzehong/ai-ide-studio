import type { AgentMemoryDimensionData } from '../../stores/agent-memory.store'

interface DimensionListProps {
  dimensions: AgentMemoryDimensionData[]
  selectedDimensionId: string | null
  entryCounts: Record<string, number>
  loading: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onEdit: (dim: AgentMemoryDimensionData) => void
}

export function DimensionList({
  dimensions,
  selectedDimensionId,
  entryCounts,
  loading,
  onSelect,
  onCreate,
  onEdit,
}: DimensionListProps) {
  return (
    <aside className="am-col">
      <div className="am-header">
        <div>
          <div className="am-eyebrow">维度</div>
          <h2>维度</h2>
        </div>
        <button type="button" className="am-icon-btn" title="新建维度" onClick={onCreate}>+</button>
      </div>
      <div className="am-list">
        {loading && dimensions.length === 0 ? (
          <div className="am-empty">加载中…</div>
        ) : dimensions.length === 0 ? (
          <div className="am-empty">暂无维度,点 + 新建</div>
        ) : (
          dimensions.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`am-item${d.id === selectedDimensionId ? ' is-active' : ''}`}
              onClick={() => onSelect(d.id)}
            >
              <span className="am-item-title">
                {d.name}
                <span className="am-item-count">{entryCounts[d.id] ?? 0}</span>
              </span>
              <span className="am-item-meta">{d.description || ''}</span>
            </button>
          ))
        )}
      </div>
      {selectedDimensionId && dimensions.find((d) => d.id === selectedDimensionId) ? (
        <div className="am-footer-action">
          <button
            type="button"
            className="am-btn"
            onClick={() => onEdit(dimensions.find((d) => d.id === selectedDimensionId)!)}
          >
            编辑当前维度
          </button>
        </div>
      ) : null}
    </aside>
  )
}
