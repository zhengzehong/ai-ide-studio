import { useEffect, useRef, useState } from 'react'

interface RecentPathSuggestionsProps {
  paths: string[]
  onSelect: (path: string) => void
  onClose?: () => void
  align?: 'left' | 'right'
}

export function RecentPathSuggestions({ paths, onSelect, onClose, align = 'left' }: RecentPathSuggestionsProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!paths.length) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose?.()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [paths.length, onClose])

  if (!paths.length) {
    return (
      <div
        ref={ref}
        style={{
          position: 'absolute',
          top: '100%',
          [align]: 0,
          marginTop: 4,
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          zIndex: 20,
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--text-3)',
          minWidth: 240,
        }}
      >
        暂无最近使用的路径
      </div>
    )
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        [align]: 0,
        marginTop: 4,
        background: 'var(--bg-0)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        zIndex: 20,
        maxHeight: 200,
        overflowY: 'auto',
        minWidth: 280,
        right: align === 'right' ? 0 : undefined,
      }}
    >
      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
        最近使用的路径
      </div>
      {paths.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          title={p}
          style={{
            display: 'block',
            width: '100%',
            padding: '7px 10px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--text-2)',
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

export function RecentPathSuggestionsButton({
  paths,
  onSelect,
  label = '最近使用 ▾',
}: {
  paths: string[]
  onSelect: (path: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!paths.length}
        style={{
          padding: '7px 10px',
          border: '1px solid var(--border)',
          background: 'var(--bg-1)',
          borderRadius: 6,
          cursor: paths.length ? 'pointer' : 'not-allowed',
          fontSize: 12,
          color: 'var(--text-2)',
          whiteSpace: 'nowrap',
          opacity: paths.length ? 1 : 0.5,
        }}
      >
        {label}
      </button>
      {open && (
        <RecentPathSuggestions
          paths={paths}
          onSelect={(p) => {
            onSelect(p)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
          align="right"
        />
      )}
    </div>
  )
}
