import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { Clock3, Loader2 } from 'lucide-react'
import { fmtTokens } from '../../pages/workspace/helpers'
import { elapsedSecondsBetween, formatCompactDuration } from '../../utils/duration'
import type { TurnStats } from './turn-stats'

interface Props {
  stats?: TurnStats | null
  streaming?: boolean
  startedAt?: string | null
  elapsedSeconds?: number
}

const chipStyle: CSSProperties = {
  padding: '3px 8px', borderRight: '1px solid var(--border)', fontSize: 12,
  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3,
}

export function TurnStatsFooter({ stats, streaming = false, startedAt, elapsedSeconds }: Props): ReactElement | null {
  const [now, setNow] = useState(Date.now)
  const start = startedAt ? Date.parse(startedAt) : NaN
  const timed = streaming && elapsedSeconds == null && Number.isFinite(start)
  useEffect(() => {
    if (!timed) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [timed, startedAt])
  const liveElapsed = timed ? elapsedSecondsBetween(startedAt, new Date(Math.max(now, start)).toISOString()) : undefined
  const elapsed = stats?.elapsedSeconds ?? elapsedSeconds ?? liveElapsed
  if (elapsed == null && stats?.inputTokens == null && stats?.outputTokens == null && !stats?.cachedReadTokens && stats?.costAmount == null) return null
  return <div className="turn-stats-footer" style={{ display: 'flex', width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap', alignItems: 'center', gap: 0, marginTop: 6, fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden' }}>
    {elapsed != null && <span style={{ ...chipStyle, fontWeight: 600, color: 'var(--text-2)' }}>
      {streaming ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Clock3 size={11} />}
      {formatCompactDuration(elapsed)}
    </span>}
    {stats?.inputTokens != null && <span style={chipStyle}>输入 <b style={{ color: 'var(--text-2)' }}>{fmtTokens(stats.inputTokens)}</b></span>}
    {stats?.outputTokens != null && <span style={chipStyle}>输出 <b style={{ color: 'var(--text-2)' }}>{fmtTokens(stats.outputTokens)}</b></span>}
    {!!stats?.cachedReadTokens && stats.cachedReadTokens > 0 && <span style={chipStyle}>缓存 <b style={{ color: 'var(--text-2)' }}>{fmtTokens(stats.cachedReadTokens)}</b></span>}
    {stats?.costAmount != null && <span style={{ ...chipStyle, borderRight: 'none' }}>${stats.costAmount.toFixed(4)}</span>}
  </div>
}
