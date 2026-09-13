/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Bot, ChevronDown, Loader2, MoreHorizontal, Settings2, Square, Trash2 } from 'lucide-react'
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
  /** 成员 Agent 当前真实生效的原始 system_prompt（后端下发，含 Master spawn 时配置的值），空则 null。 */
  agentSystemPrompt: string | null
  /** Agent 定义 config_json 的原始 model_profile_id（后端下发），空则 null；供 Master 弹窗预填。 */
  agentModelProfileId: string | null
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

/** 收起状态记忆：默认收起；用户显式展开过（'0'）则保持展开，切会话不丢。 */
const COLLAPSE_STORAGE_KEY = 'team-agent-dock-collapsed'

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return true
  try { return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) !== '0' } catch { return true }
}

interface TeamAgentDockProps {
  members: TeamDockMember[]
  statusBySessionId: Record<string, TeamMemberLiveStatus>
  /** 覆盖初始收起态（仅测试用）；默认读 localStorage 记忆，无记录时收起。 */
  initialCollapsed?: boolean
  onLocate: (member: TeamDockMember) => void
  onOpenSettings: (member: TeamDockMember) => void
  onRemoveRequest: (member: TeamDockMember) => void
  /** 中断成员当前回合（session.cancel，与主输入框停止同语义）；leader 行不渲染停止按钮。返回值忽略（如 CommandReceipt）。 */
  onCancelMember?: (member: TeamDockMember) => Promise<unknown> | void
}

export function TeamAgentDock({ members, statusBySessionId, initialCollapsed, onLocate, onOpenSettings, onRemoveRequest, onCancelMember }: TeamAgentDockProps): ReactElement {
  const [collapsed, setCollapsed] = useState(() => initialCollapsed ?? readInitialCollapsed())
  const [menu, setMenu] = useState<{ member: TeamDockMember; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 中断瞬态反馈：点击后禁用防连点（Promise 结算前），失败短暂显示失败态后自动复位。
  const [cancelPendingId, setCancelPendingId] = useState<string | null>(null)
  const [cancelFailedId, setCancelFailedId] = useState<string | null>(null)

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current
      try { window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0') } catch { /* 隐私模式等存储失败时仅本次会话内生效 */ }
      return next
    })
  }

  useEffect(() => {
    if (!cancelFailedId) return undefined
    const timer = window.setTimeout(() => setCancelFailedId(null), 1600)
    return () => window.clearTimeout(timer)
  }, [cancelFailedId])

  const cancelMember = (member: TeamDockMember): void => {
    if (!onCancelMember || cancelPendingId) return
    setCancelFailedId(null)
    setCancelPendingId(member.session_id)
    Promise.resolve(onCancelMember(member)).then(() => {
      setCancelPendingId(null)
    }).catch(() => {
      // 取消失败：按钮短暂反色提示（title 同步），1.6s 后复位可重试。
      setCancelPendingId(null)
      setCancelFailedId(member.session_id)
    })
  }

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
      {/* 内联 style 无法表达 :hover，这里只放悬停反馈；变量全部来自 ui/src/index.css。
          行内按钮的默认隐藏（⋯）也必须放这里：内联 opacity 会压过 :hover 规则。
          停止按钮不隐藏：仅运行中成员行渲染（见 DockMemberRow），常驻显示。 */}
      <style>{`.team-agent-dock-row:hover{background:var(--bg-2)}.team-agent-dock-more{opacity:0}.team-agent-dock-row:hover .team-agent-dock-more{opacity:1;background:var(--bg-3);color:var(--text-1)}.team-agent-dock-row .team-agent-dock-more:hover{background:var(--bg-4)}.team-agent-dock-stop.is-busy,.team-agent-dock-stop.is-failed{opacity:1}.team-agent-dock-stop.is-failed{background:var(--red);color:var(--bg-0)}.team-agent-dock-stop:hover{border-color:var(--red)}.team-agent-dock-head:hover{background:var(--bg-2)}`}</style>
      <button type="button" className="team-agent-dock-head" style={styles.head} onClick={toggleCollapsed} title={collapsed ? '展开团队 Agent 列表' : '收起团队 Agent 列表'}>
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
              onCancel={member.role !== 'leader' && onCancelMember ? () => cancelMember(member) : undefined}
              cancelling={cancelPendingId === member.session_id}
              cancelFailed={cancelFailedId === member.session_id}
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

function DockMemberRow({ member, color, status, onLocate, onMenu, onCancel, cancelling, cancelFailed }: {
  member: TeamDockMember
  color: string
  status: TeamMemberLiveStatus
  onLocate: (member: TeamDockMember) => void
  onMenu: (member: TeamDockMember, x: number, y: number) => void
  /** 仅 running 的非 leader 成员行由父级传入；空闲/leader 行不渲染停止按钮。 */
  onCancel?: () => void
  cancelling: boolean
  cancelFailed: boolean
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
      {onCancel && status.running && (
        <button
          type="button"
          className={`team-agent-dock-stop conversation-stop${cancelling ? ' is-busy' : ''}${cancelFailed ? ' is-failed' : ''}`}
          style={styles.stop}
          disabled={cancelling}
          onClick={(event) => { event.stopPropagation(); onCancel() }}
          title={cancelFailed ? '取消失败，请重试' : '停止该成员当前回合'}
          aria-label={`停止 ${member.name}`}
        >
          {cancelling ? <Loader2 size={11} style={styles.spin} aria-hidden /> : <Square size={10} fill="currentColor" aria-hidden />}
        </button>
      )}
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

// dock 固定锚在输入框本体上方（图片条/错误行在输入框框体外，不再推动 dock）：
// offset = 输入框静止高度 120px（textarea rows=2 ≈70 + toolbar 48 + 边框 2）
//        + shell 底部外边距 16px（.conversation-composer-shell margin 0 20px 16px）
//        + 原间距 8px —— 无附件时与「shell 顶沿上方 8px」的旧位置重合。
const COMPOSER_ANCHOR_BOTTOM = 144

const styles: Record<string, CSSProperties> = {
  // 悬浮层：脱离文档流，锚在输入框本体上方右侧（容器为 TeamChatPane 里 position:relative 的 Composer 包裹层）。
  // 根元素尺寸即视觉尺寸（收起=细条，展开=面板），不产生额外挡点击的透明区域。
  dock: {
    position: 'absolute',
    right: 20,
    bottom: COMPOSER_ANCHOR_BOTTOM,
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column',
    width: 320,
    maxWidth: 'calc(100vw - 40px)',
    maxHeight: '50vh',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg-0)',
    boxShadow: 'var(--shadow-lg)',
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
  body: { padding: 7, display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
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
  sub: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 34, paddingRight: 68, fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
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
  },
  // 成员行停止按钮：视觉同主输入框 conversation-stop（Square + 红描边圆钮），尺寸适配成员行；
  // 仅运行中成员行渲染、常驻显示（无 hover 依赖），styles.sub 预留右侧留白防文字顶到按钮。
  stop: {
    position: 'absolute',
    right: 38,
    bottom: 8,
    width: 24,
    height: 24,
    border: '1.5px solid var(--red)',
    borderRadius: '50%',
    background: 'transparent',
    color: 'var(--red)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
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
