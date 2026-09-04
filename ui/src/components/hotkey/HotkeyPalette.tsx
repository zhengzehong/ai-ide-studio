import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { dispatchHotkeyAction, HOTKEY_ACTIONS } from '../../lib/hotkey-actions'
import { formatBinding } from '../../lib/platform-key'
import { resolveHotkey } from '../../lib/hotkey-registry'
import { useHotkeyStore } from '../../stores/hotkey.store'

export interface HotkeyPaletteProps { open: boolean; onClose: () => void }

export function HotkeyPalette({ open, onClose }: HotkeyPaletteProps) {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const overrides = useHotkeyStore((state) => state.overrides)
  const handleClose = useCallback((): void => {
    setQuery('')
    onClose()
  }, [onClose])
  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    const inWorkspace = location.pathname.includes('/workspace')
    return HOTKEY_ACTIONS.filter((action) => (
      (inWorkspace || (action.category !== 'workspace' && action.category !== 'session'))
      && (!value || `${action.id} ${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(value))
    ))
  }, [location.pathname, query])

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleClose, open])

  if (!open) return null
  return (
    <div data-hotkey-scope="modal" style={overlay} onMouseDown={handleClose}>
      <div role="dialog" aria-label="命令面板" style={panel} onMouseDown={(event) => event.stopPropagation()}>
        <div style={header}><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索动作或页面" style={input} /><button type="button" onClick={handleClose} style={closeButton} title="关闭"><X size={16} /></button></div>
        <div style={list}>
          {results.map((action) => <button key={action.id} type="button" onClick={() => { dispatchHotkeyAction(action.id); handleClose() }} style={item}><span>{action.label}</span><kbd>{formatBinding(resolveHotkey(action.id, overrides))}</kbd></button>)}
          {results.length === 0 && <div style={empty}>没有匹配的动作</div>}
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.18)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 86 }
const panel: React.CSSProperties = { width: 'min(560px, calc(100vw - 32px))', maxHeight: 'min(620px, calc(100vh - 120px))', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--border)' }
const input: React.CSSProperties = { flex: 1, height: 34, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-2)', color: 'var(--text-1)', padding: '0 10px', outline: 'none' }
const closeButton: React.CSSProperties = { width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }
const list: React.CSSProperties = { overflowY: 'auto', maxHeight: 520, padding: 6 }
const item: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-1)', textAlign: 'left', padding: '9px 10px', cursor: 'pointer', fontSize: 13 }
const empty: React.CSSProperties = { padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }
