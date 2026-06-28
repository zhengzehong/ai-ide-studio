import { useEffect, useRef } from 'react'
import { useTimelineStore, type TimelineSummaryData } from '../../stores/timeline.store'

interface Props {
  sessionId: string
  onClose: () => void
  onJumpToTurn?: (turn: number) => void
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return '--:--'
  }
}

function getGapMinutes(a: string, b: string): number {
  try {
    return (new Date(b).getTime() - new Date(a).getTime()) / 60_000
  } catch {
    return 0
  }
}

function formatGap(minutes: number): string {
  if (minutes >= 60) return `间隔 ${(minutes / 60).toFixed(1)} 小时`
  return `间隔 ${Math.round(minutes)} 分钟`
}

function parseTurnStart(turns: string): number {
  const match = turns.match(/^(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

export function TimelinePopover({ sessionId, onClose, onJumpToTurn }: Props) {
  const { items, loading, refining, fetchTimeline, refineTimeline, generateTimeline } = useTimelineStore()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchTimeline(sessionId)
  }, [sessionId, fetchTimeline])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  const refined = items.filter((i) => i.status === 'refined')
  const raw = items.filter((i) => i.status === 'raw')
  const totalTurns = items.reduce((max, item) => {
    const parts = item.turns.split('-')
    const end = parseInt(parts[parts.length - 1], 10)
    return isNaN(end) ? max : Math.max(max, end)
  }, 0)

  const renderItems: (TimelineSummaryData | { type: 'gap'; text: string } | { type: 'divider' })[] = []

  for (let i = 0; i < refined.length; i++) {
    if (i > 0) {
      const gap = getGapMinutes(refined[i - 1].turn_start_at, refined[i].turn_start_at)
      if (gap >= 30) renderItems.push({ type: 'gap', text: formatGap(gap) })
    }
    renderItems.push(refined[i])
  }

  if (raw.length > 0) {
    renderItems.push({ type: 'divider' })
    for (const r of raw) renderItems.push(r)
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: 44,
        right: 8,
        width: 340,
        maxHeight: '70vh',
        background: 'var(--bg-0)',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 100,
        animation: 'tlPopIn .18s ease',
      }}
    >
      <style>{`@keyframes tlPopIn { from { opacity: 0; transform: translateY(-8px) scale(.97); } to { opacity: 1; transform: none; } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-light, #f3f4f6)' }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>📋 会话时间线</span>
        <button onClick={onClose} style={{ width: 22, height: 22, border: 'none', background: '#f3f4f6', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#9ca3af' }}>✕</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, padding: '8px 16px', background: '#fafbfc', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
        <span><b style={{ color: '#111827' }}>{totalTurns}</b> 轮</span>
        <span><b style={{ color: '#111827' }}>{refined.length}</b> 已整理</span>
        {raw.length > 0 && <span><b style={{ color: '#d97706' }}>{raw.length}</b> 未整理</span>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>加载中...</div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            暂无时间线数据
            <br />
            <button
              onClick={() => generateTimeline(sessionId)}
              style={{ marginTop: 8, padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer', fontSize: 13, color: '#374151' }}
            >
              生成历史时间线
            </button>
          </div>
        )}

        {renderItems.map((item, idx) => {
          if ('type' in item && item.type === 'gap') {
            return (
              <div key={`gap-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
                <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                <span style={{ fontSize: 10, color: '#d1d5db', whiteSpace: 'nowrap' }}>{item.text}</span>
                <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              </div>
            )
          }
          if ('type' in item && item.type === 'divider') {
            return (
              <div key={`div-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px' }}>
                <span style={{ flex: 1, height: 1, background: '#fed7aa' }} />
                <span style={{ fontSize: 10, color: '#d97706', whiteSpace: 'nowrap', fontWeight: 500 }}>
                  以下未整理（还差 {Math.max(0, 3 - raw.length)} 轮触发）
                </span>
                <span style={{ flex: 1, height: 1, background: '#fed7aa' }} />
              </div>
            )
          }

          const entry = item as TimelineSummaryData
          const isRaw = entry.status === 'raw'
          const turnStart = parseTurnStart(entry.turns)

          return (
            <div
              key={entry.id}
              onClick={() => { if (onJumpToTurn && turnStart > 0) onJumpToTurn(turnStart); onClose() }}
              style={{
                display: 'flex',
                gap: 10,
                padding: '9px 16px',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background .1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, flexShrink: 0, paddingTop: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: isRaw ? '#d1d5db' : '#2563eb', flexShrink: 0 }} />
                {idx < renderItems.length - 1 && <div style={{ flex: 1, width: 1, background: '#e5e7eb', marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>{formatTime(entry.turn_start_at)}</div>
                <div style={{ fontSize: 13, color: isRaw ? '#9ca3af' : '#111827', lineHeight: 1.55 }}>{entry.summary}</div>
                <div style={{ fontSize: 10, color: '#b0b5bf', marginTop: 2 }}>
                  T{entry.turns}
                  {isRaw && (
                    <span style={{ display: 'inline-block', fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#f3f4f6', color: '#9ca3af', marginLeft: 6 }}>未整理</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {raw.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid #f3f4f6' }}>
          <button
            onClick={() => refineTimeline(sessionId)}
            disabled={refining}
            style={{
              width: '100%',
              padding: 7,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              background: 'white',
              color: refining ? '#9ca3af' : '#374151',
              fontSize: 13,
              cursor: refining ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            {refining ? '⏳ 整理中...' : '✨ 整理全部'}
          </button>
        </div>
      )}

      <div style={{ padding: '6px 16px 10px', fontSize: 11, color: '#b0b5bf', textAlign: 'center' }}>
        每 3 轮自动整理
      </div>
    </div>
  )
}
