import { useState, type CSSProperties } from 'react'
import { ListChecks, ChevronDown, ChevronRight, CheckCircle2, Circle, Loader } from 'lucide-react'
import type { PlanEntry } from '@desktop/stores/session-events'

export default function PlanBar({ plan }: { plan: PlanEntry[] }) {
  const [expanded, setExpanded] = useState(false)
  if (plan.length === 0) return null

  const completed = plan.filter(p => p.status === 'completed').length

  return (
    <div style={styles.bar}>
      <button style={styles.header} onClick={() => setExpanded(!expanded)}>
        <ListChecks size={15} color="var(--primary)" />
        <span style={styles.title}>计划 ({completed}/{plan.length})</span>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${plan.length > 0 ? (completed / plan.length) * 100 : 0}%` }} />
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div style={styles.list}>
          {plan.map((item, i) => (
            <div key={i} style={styles.item}>
              {item.status === 'completed'
                ? <CheckCircle2 size={14} color="var(--success)" />
                : item.status === 'in_progress'
                  ? <Loader size={14} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
                  : <Circle size={14} color="var(--text-muted)" />}
              <span style={{ ...styles.itemText, ...(item.status === 'completed' ? styles.completed : {}) }}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  bar: {
    background: 'var(--primary-bg)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    width: '100%',
    textAlign: 'left',
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--primary)',
    whiteSpace: 'nowrap',
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: 'rgba(108, 92, 231, 0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    background: 'var(--primary)',
    transition: 'width .3s',
  },
  list: {
    padding: '0 16px 10px',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '3px 0',
  },
  itemText: {
    fontSize: 13,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  },
  completed: {
    color: 'var(--text-muted)',
    textDecoration: 'line-through',
  },
}
