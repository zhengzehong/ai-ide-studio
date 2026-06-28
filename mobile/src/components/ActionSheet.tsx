import { type CSSProperties, type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface ActionItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

interface Props {
  open: boolean
  title: string
  items: ActionItem[]
  onClose: () => void
}

export default function ActionSheet({ open, title, items, onClose }: Props) {
  if (!open) return null
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.sheetHeader}>
          <span style={styles.sheetTitle}>{title}</span>
          <button style={styles.closeBtn} onClick={onClose}>
            <X size={20} color="var(--text-muted)" />
          </button>
        </div>
        <div style={styles.list}>
          {items.map((item) => (
            <button
              key={item.key}
              style={{ ...styles.item, color: item.danger ? 'var(--error)' : 'var(--text-primary)' }}
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              {item.icon && <span style={styles.itemIcon}>{item.icon}</span>}
              <span style={styles.itemText}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
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
    maxHeight: '62vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
  },
  sheetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border-light)',
  },
  sheetTitle: {
    fontWeight: 600,
    fontSize: 16,
  },
  closeBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    overflow: 'auto',
    padding: '8px 0 calc(8px + var(--safe-bottom))',
  },
  item: {
    width: '100%',
    minHeight: 48,
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    fontSize: 15,
  },
  itemIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
