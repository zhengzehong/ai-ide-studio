import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

interface ModalBaseProps {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  width?: number
}

function ModalOverlay({ open, onClose, title, children, width = 360 }: ModalBaseProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={styles.overlay}
    >
      <div style={{ ...styles.dialog, width }}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
        </div>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  )
}

/* ── PromptDialog：替代 window.prompt ── */

interface PromptDialogProps {
  open: boolean
  title: string
  defaultValue?: string
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({ open, title, defaultValue = '', placeholder, onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setValue(defaultValue)
      setTimeout(() => inputRef.current?.select(), 50)
    })
    return () => { cancelled = true }
  }, [open, defaultValue])

  const handleSubmit = () => {
    if (value.trim()) onConfirm(value.trim())
  }

  return (
    <ModalOverlay open={open} onClose={onCancel} title={title}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
        placeholder={placeholder}
        autoFocus
        style={styles.input}
      />
      <div style={styles.actions}>
        <button type="button" onClick={onCancel} style={styles.btnSecondary}>取消</button>
        <button type="button" onClick={handleSubmit} disabled={!value.trim()} style={{ ...styles.btnPrimary, opacity: value.trim() ? 1 : 0.5 }}>确定</button>
      </div>
    </ModalOverlay>
  )
}

/* ── ConfirmDialog：替代 window.confirm ── */

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel = '确定', cancelLabel = '取消', danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <ModalOverlay open={open} onClose={onCancel} title={title}>
      <p style={styles.message}>{message}</p>
      <div style={styles.actions}>
        <button type="button" onClick={onCancel} style={styles.btnSecondary}>{cancelLabel}</button>
        <button type="button" onClick={onConfirm} style={danger ? styles.btnDanger : styles.btnPrimary}>{confirmLabel}</button>
      </div>
    </ModalOverlay>
  )
}

/* ── AlertDialog：替代 window.alert ── */

interface AlertDialogProps {
  open: boolean
  title: string
  message: string
  onClose: () => void
}

export function AlertDialog({ open, title, message, onClose }: AlertDialogProps) {
  return (
    <ModalOverlay open={open} onClose={onClose} title={title}>
      <p style={styles.message}>{message}</p>
      <div style={styles.actions}>
        <button type="button" onClick={onClose} style={styles.btnPrimary}>知道了</button>
      </div>
    </ModalOverlay>
  )
}

/* ── ContextMenu：右键弹出菜单 ── */

interface ContextMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.right > vw) menuRef.current.style.left = `${x - rect.width}px`
    if (rect.bottom > vh) menuRef.current.style.top = `${y - rect.height}px`
  }, [open, x, y])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 130,
        padding: 4,
        background: 'var(--bg-0)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => { item.onClick(); onClose() }}
          style={{
            display: 'block',
            width: '100%',
            padding: '7px 10px',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: item.danger ? 'var(--red)' : 'var(--text-1)',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            fontSize: 14,
            textAlign: 'left',
            opacity: item.disabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (!item.disabled) (e.currentTarget.style.background = 'var(--bg-1)') }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.3)',
    backdropFilter: 'blur(2px)',
  },
  dialog: {
    background: 'var(--bg-0)',
    borderRadius: 12,
    boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px 0',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-1)',
  },
  body: {
    padding: '14px 20px 18px',
  },
  message: {
    fontSize: 14,
    color: 'var(--text-2)',
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  input: {
    width: '100%',
    height: 40,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    fontSize: 14,
    color: 'var(--text-1)',
    background: 'var(--bg-1)',
    outline: 'none',
    marginBottom: 16,
    boxSizing: 'border-box',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnPrimary: {
    padding: '7px 18px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '7px 18px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    fontSize: 14,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '7px 18px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--red)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
}
