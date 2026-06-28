import { useEffect, useState, type CSSProperties } from 'react'

interface Props {
  open: boolean
  initialTitle: string
  onConfirm: (title: string) => void
  onCancel: () => void
}

export default function RenameDialog({ open, initialTitle, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initialTitle)

  useEffect(() => {
    if (open) setValue(initialTitle)
  }, [open, initialTitle])

  if (!open) return null

  const trimmed = value.trim()
  const canConfirm = trimmed.length > 0 && trimmed !== initialTitle

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <div style={styles.title}>重命名会话</div>
        <input
          style={styles.input}
          autoFocus
          value={value}
          placeholder="输入新的会话标题"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canConfirm) onConfirm(trimmed)
            if (event.key === 'Escape') onCancel()
          }}
        />
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            取消
          </button>
          <button
            style={{ ...styles.confirmBtn, opacity: canConfirm ? 1 : 0.45 }}
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm(trimmed)}
          >
            保存
          </button>
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
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 320,
    background: 'var(--bg-card)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    padding: '20px 20px 12px',
    textAlign: 'center',
  },
  input: {
    margin: '0 20px 20px',
    width: 'calc(100% - 40px)',
    height: 38,
    padding: '0 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    outline: 'none',
  },
  actions: {
    display: 'flex',
    borderTop: '1px solid var(--border-light)',
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    fontSize: 15,
    color: 'var(--text-secondary)',
    borderRight: '1px solid var(--border-light)',
  },
  confirmBtn: {
    flex: 1,
    height: 46,
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--primary)',
  },
}
