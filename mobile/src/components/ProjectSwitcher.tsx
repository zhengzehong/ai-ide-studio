import { useState, type CSSProperties } from 'react'
import { ChevronDown, FolderOpen, X } from 'lucide-react'

interface ProjectItem {
  id: string
  name: string
}

interface Props {
  projects: ProjectItem[]
  currentId: string | null
  onChange: (id: string | null) => void
}

export default function ProjectSwitcher({ projects, currentId, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const current = projects.find((p) => p.id === currentId)

  return (
    <>
      <button style={styles.trigger} onClick={() => setOpen(true)}>
        <FolderOpen size={16} color="var(--primary)" />
        <span style={styles.triggerText}>{current?.name || '所有项目'}</span>
        <ChevronDown size={14} color="var(--text-muted)" />
      </button>

      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHeader}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>切换项目</span>
              <button onClick={() => setOpen(false)}><X size={20} color="var(--text-muted)" /></button>
            </div>
            <div style={styles.list}>
              <button
                style={{ ...styles.item, ...(currentId === null ? styles.itemActive : {}) }}
                onClick={() => { onChange(null); setOpen(false) }}
              >
                所有项目
              </button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  style={{ ...styles.item, ...(currentId === p.id ? styles.itemActive : {}) }}
                  onClick={() => { onChange(p.id); setOpen(false) }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.35)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
    maxHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
  },
  sheetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border-light)',
  },
  list: {
    overflow: 'auto',
    padding: '8px 0',
  },
  item: {
    width: '100%',
    textAlign: 'left',
    padding: '14px 20px',
    fontSize: 15,
    color: 'var(--text-primary)',
    display: 'block',
  },
  itemActive: {
    color: 'var(--primary)',
    fontWeight: 600,
    background: 'var(--primary-bg)',
  },
}
