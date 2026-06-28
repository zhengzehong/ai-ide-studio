import type { CSSProperties } from 'react'
import { fmtTokens } from '@desktop/pages/workspace/helpers'
import { useChatStore } from '../../stores/chat.store'

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// total 为 0 或缺失时不渲染:服务端在首条 usage 下发前,contextSize 可能未就绪。
export default function ContextCircle() {
  const usage = useChatStore(s => s.usage)
  const total = usage?.contextSize
  if (!total || total <= 0) return null
  const used = usage?.contextUsed ?? 0
  const pct = Math.min(100, (used / total) * 100)
  const dash = (CIRCUMFERENCE * pct) / 100
  const color = pct > 80 ? 'var(--error)' : pct > 50 ? '#f59e0b' : 'var(--primary)'
  const title = `上下文: ${fmtTokens(used)} / ${fmtTokens(total)}`
  return (
    <div style={styles.wrap} title={title}>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
          strokeDashoffset={CIRCUMFERENCE * 0.25}
          strokeLinecap="round"
        />
      </svg>
      <span style={styles.text}>
        {fmtTokens(used)}/{fmtTokens(total)}
      </span>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  text: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1,
  },
}
