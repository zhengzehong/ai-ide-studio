import { useState, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

export interface FilterSelectOption {
  value: string
  label: string
}

interface Props {
  icon: ReactNode
  title: string
  value: string
  options: FilterSelectOption[]
  onChange: (value: string) => void
  compact?: boolean
}

export default function FilterSelectSheet({ icon, title, value, options, onChange, compact }: Props) {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value) ?? options[0]

  return (
    <>
      <button style={{ ...styles.trigger, ...(compact ? styles.triggerCompact : {}) }} onClick={() => setOpen(true)}>
        {icon}
        <span style={styles.triggerText}>{current?.label || title}</span>
        <ChevronDown size={14} color="var(--text-muted)" />
      </button>

      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
            <div style={styles.sheetHeader}>
              <span style={styles.sheetTitle}>{title}</span>
              <button style={styles.closeBtn} onClick={() => setOpen(false)}>
                <X size={20} color="var(--text-muted)" />
              </button>
            </div>
            <div style={styles.list}>
              {options.map((option) => {
                const active = option.value === value
                return (
                  <button
                    key={option.value}
                    style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <span style={styles.itemText}>{option.label}</span>
                    {active && <Check size={16} color="var(--primary)" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  trigger: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    padding: '0 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
  },
  triggerCompact: {
    flex: '0 0 auto',
    minWidth: 116,
  },
  triggerText: {
    minWidth: 0,
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
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
    justifyContent: 'space-between',
    gap: 12,
    textAlign: 'left',
    fontSize: 15,
    color: 'var(--text-primary)',
  },
  itemActive: {
    color: 'var(--primary)',
    fontWeight: 600,
    background: 'var(--primary-bg)',
  },
  itemText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
