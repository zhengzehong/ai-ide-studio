import type { CSSProperties, HTMLAttributes } from 'react'
import { agentGradient } from '../../theme'

/**
 * 动态页/会话页共用的列表视觉基元(v5 轻分组)。
 * 两页的分组卡片、头像、会话行必须从这里取样式,保证"动态和会话样式两边一样"。
 */

export function agentInitials(name: string): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (/^[A-Za-z]/.test(trimmed)) {
    const parts = trimmed.split(/[\s\-_/]+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return trimmed.slice(0, 2).toUpperCase()
  }
  return trimmed.slice(0, 2)
}

/** 渐变 agent 头像:同一 agentId 在动态页/会话页取到同一配色 */
export function AgentAvatar({ agentId, name, size = 36 }: { agentId: string; name: string; size?: number }) {
  const [from, to] = agentGradient(agentId)
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 3.2),
        background: `linear-gradient(135deg, ${from}, ${to})`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: Math.round(size * 0.34),
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: 0.5,
      }}
    >
      {agentInitials(name)}
    </span>
  )
}

function chipColors(color: string | null | undefined): { bg: string; fg: string } {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return { bg: `${color}1a`, fg: color }
  return { bg: 'var(--primary-bg)', fg: 'var(--primary)' }
}

/** 跨项目标识 chip:项目色软底 + 图标 + 项目名(动态页分组头右侧) */
export function ProjectChip({ name, icon, color }: { name: string; icon?: string | null; color?: string | null }) {
  const { bg, fg } = chipColors(color)
  return (
    <span style={{ ...chipStyles.chip, background: bg, color: fg }}>
      <span aria-hidden style={chipStyles.icon}>{icon || '📦'}</span>
      <span style={chipStyles.name}>{name}</span>
    </span>
  )
}

/** 相对时间:刚刚 / N分钟前 / N小时前 / M/D */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}分钟前`
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}小时前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export const groupStyles: Record<string, CSSProperties> = {
  group: {
    margin: '8px 10px',
    background: 'var(--bg-card)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  headPlain: {
    cursor: 'default',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sub: {
    marginTop: 1,
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  badgeRow: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    flexShrink: 0,
  },
  idleText: {
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 400,
  },
  chevron: {
    width: 16,
    height: 16,
    color: 'var(--text-muted)',
    flexShrink: 0,
    transition: 'transform .25s ease',
  },
  chevronCollapsed: {
    transform: 'rotate(-90deg)',
  },
  body: {
    maxHeight: 2000,
    overflow: 'hidden',
    transition: 'max-height .3s ease',
  },
  bodyCollapsed: {
    maxHeight: 0,
  },
  bodyEmpty: {
    padding: 16,
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
}

export const badgeStyles: Record<string, CSSProperties> = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    flexShrink: 0,
  },
}

const chipStyles: Record<string, CSSProperties> = {
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
    maxWidth: 130,
  },
  icon: {
    fontSize: 12,
    lineHeight: 1,
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}

export const rowStyles: Record<string, CSSProperties> = {
  row: {
    position: 'relative',
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    padding: '11px 14px 11px 12px',
    borderTop: '0.5px solid var(--border-light)',
    cursor: 'pointer',
    transition: 'background .15s',
    textAlign: 'left',
    touchAction: 'pan-y',
  },
  dotCol: {
    width: 20,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    fontWeight: 400,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  titleStrong: {
    fontWeight: 600,
  },
  time: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 400,
    color: 'var(--text-muted)',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    minWidth: 0,
  },
  label: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 600,
  },
  metaSep: {
    flexShrink: 0,
    color: 'var(--text-muted)',
  },
  metaText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-secondary)',
  },
}

export type RowPointerHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave'
>

interface ListRowProps extends RowPointerHandlers {
  title: string
  /** 未读等需要强调的标题加粗 */
  strong?: boolean
  time?: string
  /** 状态词:执行中 / 有新回复 / 可用... */
  label: string
  /** 状态词与左侧圆点同色 */
  labelColor: string
  /** 执行中呼吸点 */
  pulse?: boolean
  /** 第二行的补充说明(任务名/阶段) */
  detail?: string
  onClick?: () => void
}

/** 会话行:左侧状态点列 + 标题/时间 + 状态词/补充说明,两页共用 */
export function ListRow(props: ListRowProps) {
  return (
    <div
      className="pressable"
      style={rowStyles.row}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onPointerLeave={props.onPointerLeave}
    >
      <span style={rowStyles.dotCol}>
        <span
          aria-hidden
          className={props.pulse ? 'breathe' : undefined}
          style={{ ...rowStyles.dot, background: props.labelColor }}
        />
      </span>
      <span style={rowStyles.main}>
        <span style={rowStyles.top}>
          <span style={{ ...rowStyles.title, ...(props.strong ? rowStyles.titleStrong : {}) }}>{props.title}</span>
          {props.time ? <span style={rowStyles.time}>{props.time}</span> : null}
        </span>
        <span style={rowStyles.meta}>
          <span style={{ ...rowStyles.label, color: props.labelColor }}>{props.label}</span>
          {props.detail ? (
            <>
              <span style={rowStyles.metaSep} aria-hidden>·</span>
              <span style={rowStyles.metaText}>{props.detail}</span>
            </>
          ) : null}
        </span>
      </span>
    </div>
  )
}
