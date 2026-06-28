import { type CSSProperties } from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <div style={styles.title}>{title}</div>
        <div style={styles.message}>{message}</div>
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            {cancelText}
          </button>
          <button
            style={{
              ...styles.confirmBtn,
              background: danger ? 'var(--error)' : 'var(--primary)',
            }}
            onClick={onConfirm}
          >
            {confirmText}
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
    padding: '20px 20px 8px',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    padding: '0 20px 20px',
    textAlign: 'center',
    lineHeight: 1.5,
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
    color: '#fff',
  },
}
