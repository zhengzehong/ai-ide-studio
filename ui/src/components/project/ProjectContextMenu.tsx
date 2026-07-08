import { useEffect, useRef } from 'react'

export interface ProjectContextMenuItem {
  label: string
  danger?: boolean
  dividerAfter?: boolean
  onClick: () => void
}

interface ProjectContextMenuProps {
  open: boolean
  x: number
  y: number
  items: ProjectContextMenuItem[]
  onClose: () => void
}

export function ProjectContextMenu({ open, x, y, items, onClose }: ProjectContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', esc)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.right > vw) ref.current.style.left = `${Math.max(8, x - rect.width)}px`
    if (rect.bottom > vh) ref.current.style.top = `${Math.max(8, y - rect.height)}px`
  }, [open, x, y])

  if (!open) return null

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 160,
        padding: 4,
        background: 'var(--bg-0)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          <button
            type="button"
            onClick={() => { item.onClick(); onClose() }}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderRadius: 5,
              background: 'transparent',
              color: item.danger ? 'var(--red)' : 'var(--text-1)',
              cursor: 'pointer',
              fontSize: 13,
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.danger ? 'rgba(245, 63, 63, 0.08)' : 'var(--bg-1)'
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {item.label}
          </button>
          {item.dividerAfter && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />}
        </div>
      ))}
    </div>
  )
}

export function buildProjectContextMenuItems(opts: {
  isPinned: boolean
  onTogglePin: () => void
  onCopyPath: () => void
  onEdit: () => void
  onDelete: () => void
}): ProjectContextMenuItem[] {
  return [
    { label: opts.isPinned ? '取消固定' : '固定到 Tab 栏', onClick: opts.onTogglePin },
    { label: '复制路径', onClick: opts.onCopyPath, dividerAfter: true },
    { label: '编辑项目', onClick: opts.onEdit },
    { label: '删除项目', onClick: opts.onDelete, danger: true },
  ]
}
