/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Bot, ChevronDown, Loader2, MoreHorizontal, Settings2, Trash2 } from 'lucide-react'
import type { TeamChatMember } from './team-view-cache'
import type { Snapshot } from './team-chat-state'

/** 团队成员级模型配置（后端 team.member.config.* 下发，前端只展示不计算生效模型）。 */
export interface TeamMemberModelConfig {
  modelProfileMode: 'inherit' | 'fixed' | 'system'
  modelProfileId: string | null
  systemPromptOverride: string | null
  runtime: string
  effective: { name: string; source: string }
  /** 不继承任何档案时的解析结果（Agent 原配置 → 系统默认），供「使用系统默认」策略预览。 */
  fallback: { name: string; source: string }
}

export interface TeamDockMember extends TeamChatMember {
  modelConfig?: TeamMemberModelConfig
}

/** 成员实时状态：从现有团队会话快照推导（streaming / 等权限 / done），不新增 WebSocket 事件。 */
export interface TeamMemberLiveStatus {
  running: boolean
  waiting: boolean
  label: string
}

export function deriveMemberStatus(snapshot: Pick<Snapshot, 'streaming' | 'permissions' | 'elicitations'> | undefined): TeamMemberLiveStatus {
  if (!snapshot) return { running: false, waiting: false, label: '空闲' }
  if (snapshot.permissions.length > 0 || snapshot.elicitations.length > 0) return { running: true, waiting: true, label: '等待权限' }
  const streaming = snapshot.streaming
  if (streaming && !streaming.done) {
    const stage = streaming.stage?.trim()
    // 与消息流头部一致：有 stage 显示 stage（如「正在检查…」），无内容则「正在思考...」，否则执行中。
    if (stage && !streaming.finalAnswer) return { running: true, waiting: false, label: stage }
    const hasBody = streaming.content.trim() !== '' || streaming.processBlocks.some((block) => block.kind !== 'stage')
    if (!hasBody && streaming.thinking.trim() !== '') return { running: true, waiting: false, label: '正在思考...' }
    return { running: true, waiting: false, label: '执行中' }
  }
  return { running: false, waiting: false, label: '空闲' }
}

const AVATAR_COLORS = ['var(--blue)', 'var(--purple)', 'var(--green)', '#0891b2', 'var(--yellow)', '#64748b']

interface TeamAgentDockProps {
  members: TeamDockMember[]
  statusBySessionId: Record<string, TeamMemberLiveStatus>
  onLocate: (member: TeamDockMember) => void
  onOpenSettings: (member: TeamDockMember) => void
  onRemoveRequest: (member: TeamDockMember) => void
}

export function TeamAgentDock({ members, statusBySessionId, onLocate, onOpenSettings, onRemoveRequest }: TeamAgentDockProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [menu, setMenu] = useState<{ member: TeamDockMember; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) return undefined
    const closeOnClick = (event: MouseEvent): void => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
      setMenu(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', closeOnClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeOnClick); document.removeEventListener('keydown', closeOnEscape) }
  }, [menu])

  const anyRunning = useMemo(() => members.some((member) => statusBySessionId[member.session_id]?.running), [members, statusBySessionId])

  const openMenu = (member: TeamDockMember, x: number, y: number): void => {
    setMenu({ member, x, y })
  }

  return (
    <div style={{ ...styles.dock }} data-team-agent-dock>
      {/* 内联 style 无法表达 :hover，这里只放悬停反馈；变量全部来自 ui/src/index.css */}
      <style>{`.team-agent-dock-row:hover{background:var(--bg-2)}.team-agent-dock-row:hover .team-agent-dock-more{opacity:1;background:var(--bg-3);color:var(--text-1)}.team-agent-dock-row .team-agent-dock-more:hover{background:var(--bg-4)}.team-agent-dock-head:hover{background:var(--bg-2)}`}</style>
      <button type="button" className="team-agent-dock-head" style={styles.head} onClick={() => setCollapsed((current) => !current)} title={collapsed ? '展开团队 Agent 列表' : '收起团队 Agent 列表'}>
        <Bot size={13} aria-hidden />
        <span>团队 Agent · {members.length} 人</span>
        <span style={styles.headDots}>
          {members.map((member) => {
            const status = statusBySessionId[member.session_id]
            return <span key={member.id} style={{ ...styles.headDot, ...(status?.running ? styles.headDotBusy : {}) }} title={`${member.name} ${status?.label || '空闲'}`} />
          })}
        </span>
        {anyRunning && <Loader2 size={12} style={styles.spin} aria-hidden />}
        <span style={{ ...styles.chev, ...(collapsed ? styles.chevCollapsed : {}) }}><ChevronDown size={13} /></span>
      </button>
      {!collapsed && (
        <div style={styles.body}>
          <div style={styles.hint}>点击定位该成员消息 · 右键（或悬停 ⋯）管理成员</div>
          {members.map((member, index) => (
            <DockMemberRow
              key={member.id}
              member={member}
              color={AVATAR_COLORS[index % AVATAR_COLORS.length]}
              status={statusBySessionId[member.session_id] || { running: false, waiting: false, label: '空闲' }}
              onLocate={onLocate}
              onMenu={openMenu}
            />
          ))}
        </div>
      )}
      {menu && (
        <div ref={menuRef} style={menuPositionStyles(menu.x, menu.y)} role="menu">
          <button type="button" style={styles.menuItem} onClick={() => { const target = menu.member; setMenu(null); onOpenSettings(target) }}>
            <Settings2 size={13} /> 设置 Agent
          </button>
          {menu.member.role !== 'leader' && (
            <button type="button" style={{ ...styles.menuItem, ...styles.menuItemDanger }} onClick={() => { const target = menu.member; setMenu(null); onRemoveRequest(target) }}>
              <Trash2 size={13} /> 移除成员
            </button>
          )}
          {menu.member.role === 'leader' && <div style={styles.menuNote}>Master 为团队主控，不可移除</div>}
        </div>
      )}
    </div>
  )
}

function DockMemberRow({ member, color, status, onLocate, onMenu }: {
  member: TeamDockMember
  color: string
  status: TeamMemberLiveStatus
  onLocate: (member: TeamDockMember) => void
  onMenu: (member: TeamDockMember, x: number, y: number) => void
}): ReactElement {
  const isMaster = member.role === 'leader'
  const effective = member.modelConfig?.effective
  return (
    <div
      className="team-agent-dock-row"
      style={styles.row}
      onClick={() => onLocate(member)}
      onContextMenu={(event) => { event.preventDefault(); onMenu(member, event.clientX, event.clientY) }}
      title={`定位 ${member.name} 的最新消息`}
    >
      <div style={styles.rowTop}>
        <span style={{ ...styles.avatar, background: color }}>
          {member.name.slice(0, 1)}
          <span style={{ ...styles.presence, ...(status.running ? styles.presenceBusy : {}) }} />
        </span>
        <span style={styles.name}>{member.name}</span>
        <span style={isMaster ? styles.roleMaster : styles.roleMember}>{isMaster ? '主控' : '成员'}</span>
        <span style={{ ...styles.status, ...(status.running ? styles.statusRunning : styles.statusIdle) }}>
          {status.running
            ? <Loader2 size={12} style={styles.spin} aria-hidden />
            : <span style={styles.idleDot} aria-hidden />}
          {status.label}
        </span>
      </div>
      <div style={styles.sub}>
        <span style={styles.modelName}>{effective?.name || '系统默认'}</span>· {effective?.source || '未指定档案'}
      </div>
      <button
        type="button"
        className="team-agent-dock-more"
        style={styles.more}
        onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onMenu(member, rect.left, rect.bottom + 4) }}
        title="成员操作"
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  )
}

function menuPositionStyles(x: number, y: number): CSSProperties {
  const width = 188
  const height = 96
  return {
    ...styles.menu,
    left: Math.max(8, Math.min(x, (typeof window === 'undefined' ? 1200 : window.innerWidth) - width - 8)),
    top: Math.max(8, Math.min(y, (typeof window === 'undefined' ? 800 : window.innerHeight) - height - 8)),
  }
}

const styles: Record<string, CSSProperties> = {
  dock: {
    width: 320,
    maxWidth: '100%',
    marginBottom: 8,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg-0)',
    boxShadow: 'var(--shadow-md)',
    alignSelf: 'flex-end',
    flexShrink: 0,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'var(--bg-1)',
    fontSize: 13.5,
    fontWeight: 700,
    color: 'var(--text-1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  headDots: { display: 'inline-flex', gap: 4, marginLeft: 2 },
  headDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--bg-4)' },
  headDotBusy: { background: 'var(--green)', animation: 'session-running-pulse 1.6s ease-in-out infinite' },
  chev: { marginLeft: 'auto', color: 'var(--text-3)', display: 'flex', transition: 'transform 0.15s' },
  chevCollapsed: { transform: 'rotate(-90deg)' },
  body: { padding: 7, display: 'flex', flexDirection: 'column' },
  hint: { fontSize: 11.5, color: 'var(--text-3)', padding: '0 3px 6px' },
  row: {
    position: 'relative',
    width: '100%',
    cursor: 'pointer',
    padding: '9px 10px',
    borderRadius: 9,
    border: '1px solid var(--border)',
    background: 'var(--bg-1)',
    marginBottom: 6,
    boxSizing: 'border-box',
    transition: 'background 0.15s, border-color 0.15s',
  },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    lineHeight: 1,
  },
  presence: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: '50%',
    border: '2px solid var(--bg-1)',
    background: 'var(--bg-4)',
    boxSizing: 'border-box',
  },
  presenceBusy: { background: 'var(--green)', animation: 'session-running-pulse 1.6s ease-in-out infinite' },
  name: { fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  roleMaster: { fontSize: 11, padding: '1px 6px', borderRadius: 999, fontWeight: 700, flexShrink: 0, background: 'var(--blue-light)', color: 'var(--blue)' },
  roleMember: { fontSize: 11, padding: '1px 6px', borderRadius: 999, fontWeight: 700, flexShrink: 0, background: 'var(--bg-2)', color: 'var(--text-3)' },
  status: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusRunning: { color: 'var(--blue)' },
  statusIdle: { color: 'var(--text-3)', fontWeight: 500 },
  idleDot: { width: 7, height: 7, borderRadius: '50%', background: 'var(--bg-4)', flexShrink: 0 },
  sub: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 34, fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  modelName: { color: 'var(--text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  more: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-3)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
  menu: {
    position: 'fixed',
    zIndex: 900,
    minWidth: 176,
    padding: 5,
    background: 'var(--bg-0)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    boxShadow: 'var(--shadow-lg)',
    animation: 'fadeIn 0.12s ease-out',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    padding: '7px 9px',
    border: 'none',
    background: 'transparent',
    borderRadius: 6,
    fontSize: 13.5,
    color: 'var(--text-1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  menuItemDanger: { color: 'var(--red)' },
  menuNote: { padding: '6px 9px 4px', fontSize: 12, color: 'var(--text-3)', borderTop: '1px solid var(--border-light)', marginTop: 4 },
  spin: { animation: 'spin 1s linear infinite', flexShrink: 0 },
}
