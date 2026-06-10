import type { CSSProperties } from 'react'

interface Props {
  agents: { id: string; name: string }[]
  selected: string | null
  onChange: (agentId: string | null) => void
}

export default function AgentFilterChips({ agents, selected, onChange }: Props) {
  if (agents.length === 0) return null

  return (
    <div style={styles.container}>
      <button
        style={{ ...styles.chip, ...(selected === null ? styles.active : {}) }}
        onClick={() => onChange(null)}
      >
        全部
      </button>
      {agents.map((a) => (
        <button
          key={a.id}
          style={{ ...styles.chip, ...(selected === a.id ? styles.active : {}) }}
          onClick={() => onChange(selected === a.id ? null : a.id)}
        >
          {a.name}
        </button>
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    padding: '8px 16px',
    flexShrink: 0,
  },
  chip: {
    padding: '5px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500,
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'all .2s',
  },
  active: {
    background: 'var(--primary)',
    color: '#fff',
  },
}
