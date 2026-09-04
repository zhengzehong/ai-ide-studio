import { useMemo, useState, type ReactNode } from 'react'
import { RotateCcw, Search, Keyboard } from 'lucide-react'
import { HOTKEY_ACTIONS } from '../../lib/hotkey-actions'
import { useHotkeyStore } from '../../stores/hotkey.store'
import { HotkeyRecorder } from '../../components/hotkey/HotkeyRecorder'

export function HotkeySection(): ReactNode {
  const overrides = useHotkeyStore((state) => state.overrides)
  const lastConflict = useHotkeyStore((state) => state.lastConflict)
  const resetAll = useHotkeyStore((state) => state.resetAll)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return HOTKEY_ACTIONS.filter((action) => !normalized || `${action.id} ${action.label}`.toLowerCase().includes(normalized))
  }, [query])
  return (
    <section id="hotkeys" style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard size={18} style={{ color: 'var(--blue)' }} /> Keyboard shortcuts
        </h2>
        <button type="button" onClick={resetAll} style={buttonStyle} title="Reset all shortcuts">
          <RotateCcw size={14} /> Reset all
        </button>
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions" style={{ ...inputStyle, paddingLeft: 30 }} />
      </div>
      {lastConflict.length > 0 && <div role="status" style={{ color: 'var(--yellow)', fontSize: 12, marginBottom: 8 }}>Conflicting shortcuts reset: {lastConflict.join(', ')}</div>}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-1)' }}>
        {filtered.map((action) => (
          <HotkeyRecorder key={action.id} action={action} value={Object.prototype.hasOwnProperty.call(overrides, action.id) ? overrides[action.id] : action.defaultKeys} customized={Object.prototype.hasOwnProperty.call(overrides, action.id)} />
        ))}
        {filtered.length === 0 && <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>No matching actions</div>}
      </div>
    </section>
  )
}

const buttonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-2)', padding: '6px 9px', cursor: 'pointer', fontSize: 12 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', height: 34, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', padding: '0 10px', outline: 'none' }
