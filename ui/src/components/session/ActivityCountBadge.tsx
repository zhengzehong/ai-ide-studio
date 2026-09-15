import type { ReactElement } from 'react'

export interface ActivityCountTitles {
  running?: string
  unread?: string
  total?: string
}

export interface ActivityCountBadgeProps {
  running: number
  unread: number
  total: number
  titles?: ActivityCountTitles
}

/** >99 折叠为 99+，与项目级徽标一致。 */
function formatActivityCount(value: number): string {
  return value > 99 ? '99+' : String(value)
}

/**
 * 活动数字徽标，与侧边栏 agent 行原有规则逐像素对齐（绿、黄可并存；都为 0 时退化为灰+总数）：
 * 有在跑 → 绿点+在跑数；有未读 → 黄点+未读数；两者都为 0 且总数 > 0 → 灰点+总数。
 * agent 行与团队条目共用，保证团队条目与普通会话机制一致、样式不再两处漂移。
 */
export function ActivityCountBadge({ running, unread, total, titles }: ActivityCountBadgeProps): ReactElement | null {
  if (running <= 0 && unread <= 0 && total <= 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {running > 0 && (
        <span title={titles?.running ?? '运行中会话'} style={badgeStyle('var(--green)', 600)}>
          <span style={dotStyle('var(--green)')} />
          {formatActivityCount(running)}
        </span>
      )}
      {unread > 0 && (
        <span title={titles?.unread ?? '未读会话'} style={badgeStyle('var(--yellow)', 600)}>
          <span style={dotStyle('var(--yellow)')} />
          {formatActivityCount(unread)}
        </span>
      )}
      {running === 0 && unread === 0 && total > 0 && (
        <span title={titles?.total ?? '会话总数'} style={badgeStyle('var(--text-3)', 500)}>
          <span style={dotStyle('var(--text-3)', 0.5)} />
          {formatActivityCount(total)}
        </span>
      )}
    </div>
  )
}

function badgeStyle(color: string, fontWeight: number): React.CSSProperties {
  return { fontSize: 11, fontWeight, display: 'inline-flex', alignItems: 'center', gap: 3, color }
}

function dotStyle(background: string, opacity?: number): React.CSSProperties {
  return { width: 7, height: 7, borderRadius: '50%', background, flexShrink: 0, ...(opacity === undefined ? {} : { opacity }) }
}
