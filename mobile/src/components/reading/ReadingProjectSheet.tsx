import { Check, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ReadingProjectCount } from '@desktop/types/reading'

interface ReadingProjectSheetProps {
  open: boolean
  value: string | null | undefined
  options: ReadingProjectCount[]
  onSelect: (projectId: string | null | undefined) => void
  onClose: () => void
}

export function ReadingProjectSheet({ open, value, options, onSelect, onClose }: ReadingProjectSheetProps) {
  if (!open) return null
  const rows = [
    { key: '__all__', projectId: undefined, projectName: '全部项目', projectColor: null, count: options.reduce((sum, option) => sum + option.count, 0) },
    ...options.map((option) => ({ key: option.projectId ?? '__none__', ...option })),
  ]
  return (
    <div style={styles.layer} role="dialog" aria-modal="true" aria-label="按项目筛选">
      <button type="button" aria-label="关闭项目筛选" style={styles.backdrop} onClick={onClose} />
      <section style={styles.sheet}>
        <header style={styles.header}>
          <strong>按项目筛选</strong>
          <button type="button" className="pressable" style={styles.close} onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        <div style={styles.options}>
          {rows.map((option) => {
            const selected = option.projectId === value
            return (
              <button key={option.key} type="button" className="pressable" style={{ ...styles.option, ...(selected ? styles.selected : {}) }} onClick={() => { onSelect(option.projectId); onClose() }}>
                <span style={{ ...styles.dot, background: option.projectColor || 'var(--text-muted)' }} />
                <span style={styles.name}>{option.projectName || '未归类'}</span>
                <span style={styles.count}>{option.count}</span>
                {selected && <Check size={17} color="var(--primary)" />}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  layer: { position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end' },
  backdrop: { position: 'absolute', inset: 0, width: '100%', background: 'rgba(0,0,0,.3)' },
  sheet: { position: 'relative', width: '100%', maxHeight: '72vh', padding: '16px 16px calc(20px + var(--safe-bottom))', borderRadius: '20px 20px 0 0', background: 'var(--bg-card)', boxShadow: '0 -10px 30px rgba(0,0,0,.12)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 15 },
  close: { width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: 'var(--text-secondary)', background: 'var(--bg-input)' },
  options: { display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' },
  option: { minHeight: 46, display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', borderRadius: 'var(--radius)', color: 'var(--text-primary)', textAlign: 'left' },
  selected: { background: 'var(--primary-bg)' },
  dot: { width: 7, height: 7, borderRadius: '50%' },
  name: { flex: 1, fontSize: 14 },
  count: { color: 'var(--text-muted)', fontSize: 12 },
}
