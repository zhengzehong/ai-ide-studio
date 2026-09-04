import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import type { HotkeyAction } from '../../lib/hotkey-actions'
import { formatBinding, eventKey } from '../../lib/platform-key'
import { composeRecordedBinding } from '../../lib/hotkey-component-helpers'
import { useHotkeyStore } from '../../stores/hotkey.store'

interface HotkeyRecorderProps { action: HotkeyAction; value: string | null; customized: boolean }

export function HotkeyRecorder({ action, value, customized }: HotkeyRecorderProps): ReactNode {
  const setOverride = useHotkeyStore((state) => state.setOverride)
  const reset = useHotkeyStore((state) => state.reset)
  const [recording, setRecording] = useState(false)
  const [pendingChord, setPendingChord] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const firstKeyRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  useEffect(() => {
    if (!recording) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        firstKeyRef.current = null
        setPendingChord(false)
        setRecording(false)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        setOverride(action.id, null); setRecording(false); return
      }
      const key = eventKey(event)
      if (!key) return
      if (!pendingChord && key === 'g') {
        firstKeyRef.current = 'g'
        setPendingChord(true)
        timerRef.current = window.setTimeout(() => {
          firstKeyRef.current = null
          setPendingChord(false)
          setMessage('Chord timed out')
        }, 600)
        return
      }
      const nextBinding = composeRecordedBinding(firstKeyRef.current, key)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      firstKeyRef.current = null
      setPendingChord(false)
      const result = setOverride(action.id, nextBinding)
      if (!result.ok) setMessage(result.conflicts.join(', '))
      else { setMessage(result.conflicts.length > 0 ? `Reset: ${result.conflicts.join(', ')}` : null); setRecording(false) }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [action.id, pendingChord, recording, setOverride])

  useEffect(() => {
    if (recording) return undefined
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    firstKeyRef.current = null
    return undefined
  }, [recording])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: 'var(--text-1)' }}>{action.label}</div><div style={{ color: 'var(--text-3)', fontSize: 11 }}>{action.id}</div></div>
      {message && <span role="status" style={{ color: 'var(--yellow)', fontSize: 11 }}>{message}</span>}
      <button type="button" onClick={() => { setMessage(null); setPendingChord(false); firstKeyRef.current = null; setRecording(true) }} style={keyStyle(recording)}>{recording ? (pendingChord ? '按下第二个键…' : '按下新快捷键…') : formatBinding(value)}</button>
      {customized && <button type="button" onClick={() => { reset(action.id); setMessage(null) }} style={iconButton} title="恢复默认"><RotateCcw size={13} /></button>}
      {customized && <Check size={14} color="var(--green)" aria-label="已自定义" />}
    </div>
  )
}

const keyStyle = (active: boolean): React.CSSProperties => ({ minWidth: 76, border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 5, background: active ? 'var(--blue-light)' : 'var(--bg-2)', color: active ? 'var(--blue)' : 'var(--text-2)', padding: '5px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)', fontSize: 11 })
const iconButton: React.CSSProperties = { width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }
