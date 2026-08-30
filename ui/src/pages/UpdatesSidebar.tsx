import { useState } from 'react'
import { Pin, RefreshCw } from 'lucide-react'
import type { WidgetAgentProjectActivityGroup } from '../stores/widget.store'
import type { SessionDockItem } from '../stores/session-dock.store'
import { ICON_MAP } from '../components/agent-square/constants'
import './updates/updates-sidebar.css'

export interface WorkbenchSessionTarget {
  sessionId: string
  projectId: string | null
  title: string
  agentName?: string | null
  agentIcon?: string | null
  projectName?: string | null
  projectColor?: string | null
}

interface UpdatesSidebarProps {
  activityGroups: WidgetAgentProjectActivityGroup[]
  pinnedItems: SessionDockItem[]
  loading: boolean
  error: string | null
  selectedSessionId: string | null
  onRefresh: () => void
  onSelect: (target: WorkbenchSessionTarget) => void
  defaultTab?: SidebarTab
}

type SidebarTab = 'dyn' | 'pin'

interface SidebarRow {
  sessionId: string
  title: string
  running: boolean
  need: boolean
  time: string
  pinned: boolean
  projectId: string | null
  projectName: string
  projectColor: string | null
  agentId: string
  agentName: string
  agentIcon: string | null
}

const PALETTE = ['var(--green)', 'var(--purple)', 'var(--orange)', 'var(--blue)', 'var(--yellow)']

function paletteColor(seed: string | null): string {
  if (!seed) return 'var(--bg-4)'
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 997
  return PALETTE[hash % PALETTE.length]
}

function formatActivityTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${date.getMonth() + 1}/${date.getDate()}`
}

const ATTENTION_TASK_STATES = new Set(['needs_input', 'blocked', 'needs_attention'])

function needsAttention(unread: boolean, taskStatus: string | null): boolean {
  return unread || (!!taskStatus && ATTENTION_TASK_STATES.has(taskStatus))
}

function rowsFromActivity(groups: WidgetAgentProjectActivityGroup[], pinnedSessionIds: Set<string>): SidebarRow[] {
  return groups.flatMap((group) => group.sessions.map((session) => ({
    sessionId: session.sessionId,
    title: session.sessionTitle || session.taskTitle || '未命名会话',
    running: session.running,
    need: !session.running && needsAttention(session.unread, session.taskStatus),
    time: formatActivityTime(session.activityAt || group.activityAt),
    pinned: pinnedSessionIds.has(session.sessionId),
    projectId: group.projectId,
    projectName: group.projectName || '未归属项目',
    projectColor: null,
    agentId: group.agentId,
    agentName: group.agentName,
    agentIcon: group.agentIcon,
  })))
}

function rowsFromDock(items: SessionDockItem[]): SidebarRow[] {
  return items.map((item) => ({
    sessionId: item.sessionId,
    title: item.sessionTitle || '未命名会话',
    running: item.activityState === 'running',
    need: item.unread,
    time: formatActivityTime(item.lastActivityAt || item.addedAt || ''),
    pinned: true,
    projectId: item.projectId,
    projectName: item.projectName || '未归属项目',
    projectColor: item.projectColor,
    agentId: item.agentId,
    agentName: item.agentName,
    agentIcon: item.agentIcon,
  }))
}

export function UpdatesSidebar({
  activityGroups,
  pinnedItems,
  loading,
  error,
  selectedSessionId,
  onRefresh,
  onSelect,
  defaultTab = 'dyn',
}: UpdatesSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>(defaultTab)
  const pinnedSessionIds = new Set(pinnedItems.map((item) => item.sessionId))
  const dynamicRows = rowsFromActivity(activityGroups, pinnedSessionIds)
  const pinnedRows = rowsFromDock(pinnedItems)
  const visibleRows = tab === 'dyn' ? dynamicRows : pinnedRows

  const selectRow = (row: SidebarRow): void => {
    onSelect({
      sessionId: row.sessionId,
      projectId: row.projectId,
      title: row.title,
      agentName: row.agentName,
      agentIcon: row.agentIcon,
      projectName: row.projectName,
      projectColor: row.projectColor,
    })
  }

  return (
    <aside className="wb-sidebar" aria-label="会话导航">
      <div className="wb-seg-row">
        <div className="wb-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'dyn'} className={tab === 'dyn' ? 'is-on' : ''} onClick={() => setTab('dyn')}>
            动态
          </button>
          <button type="button" role="tab" aria-selected={tab === 'pin'} className={tab === 'pin' ? 'is-on' : ''} onClick={() => setTab('pin')}>
            置顶
          </button>
        </div>
        <button type="button" className="wb-refresh" onClick={onRefresh} title="刷新" aria-label="刷新">
          <RefreshCw size={14} className={loading ? 'wb-spin' : undefined} />
        </button>
      </div>
      {error && <button type="button" className="wb-error" onClick={onRefresh}>{error}，点击重试</button>}
      <div className="wb-list">
        {loading && visibleRows.length === 0 && <div className="wb-empty">正在同步...</div>}
        {!loading && visibleRows.length === 0 && (
          tab === 'dyn'
            ? <div className="wb-empty">没有新动态<br /><small>会话有新消息或状态变化时会出现在这里</small></div>
            : <div className="wb-empty">还没有置顶会话<br /><small>在会话里点 📌 置顶后会出现在这里</small></div>
        )}
        {visibleRows.length > 0 && (
          <GroupedRows
            rows={visibleRows}
            selectedSessionId={selectedSessionId}
            onSelect={selectRow}
            showPinMark={tab === 'dyn'}
          />
        )}
      </div>
    </aside>
  )
}

function GroupedRows({
  rows,
  selectedSessionId,
  onSelect,
  showPinMark,
}: {
  rows: SidebarRow[]
  selectedSessionId: string | null
  onSelect: (row: SidebarRow) => void
  showPinMark: boolean
}) {
  const projects = new Map<string, SidebarRow[]>()
  for (const row of rows) {
    const key = row.projectId || row.projectName
    const bucket = projects.get(key)
    if (bucket) bucket.push(row)
    else projects.set(key, [row])
  }
  return (
    <>
      {[...projects.entries()].map(([key, projectRows]) => {
        const head = projectRows[0]
        const band = head.projectColor || paletteColor(head.projectId || head.projectName)
        const agents = new Map<string, SidebarRow[]>()
        for (const row of projectRows) {
          const bucket = agents.get(row.agentId)
          if (bucket) bucket.push(row)
          else agents.set(row.agentId, [row])
        }
        return (
          <section key={key} className="wb-proj">
            <div className="wb-proj-head" style={{ borderLeftColor: band }}>
              <span className="wb-proj-dot" style={{ background: band }} />
              <span className="wb-proj-name">{head.projectName}</span>
              <span className="wb-proj-count">{projectRows.length} 条</span>
            </div>
            {[...agents.entries()].map(([agentId, agentRows]) => {
              const ordered = [...agentRows].sort((left, right) => Number(right.pinned) - Number(left.pinned))
              const avatarColor = paletteColor(agentId || agentRows[0].agentName)
              return (
                <div key={agentId} className="wb-agent">
                  <div className="wb-agent-head">
                    <span className="wb-agent-avatar" style={{ background: avatarColor }}>
                      <AgentIcon icon={agentRows[0].agentIcon} name={agentRows[0].agentName} />
                    </span>
                    <span className="wb-agent-name">{agentRows[0].agentName}</span>
                  </div>
                  {ordered.map((row) => (
                    <SessionRowButton
                      key={row.sessionId}
                      row={row}
                      selected={selectedSessionId === row.sessionId}
                      onSelect={onSelect}
                      showPinMark={showPinMark}
                    />
                  ))}
                </div>
              )
            })}
          </section>
        )
      })}
    </>
  )
}

function SessionRowButton({
  row,
  selected,
  onSelect,
  showPinMark,
}: {
  row: SidebarRow
  selected: boolean
  onSelect: (row: SidebarRow) => void
  showPinMark: boolean
}) {
  const dot = row.running ? 'run' : row.need ? 'need' : 'ok'
  return (
    <button
      type="button"
      className={`wb-session-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(row)}
      title={row.title}
    >
      <span className={`wb-dot ${dot}`} />
      <span className="wb-row-title">{row.title}</span>
      {showPinMark && row.pinned && <Pin size={12} className="wb-pin-mark" aria-label="已置顶" />}
      <span className="wb-row-time">{row.time}</span>
    </button>
  )
}

function AgentIcon({ icon, name }: { icon: string | null; name: string }): React.ReactNode {
  const Icon = icon && icon in ICON_MAP
    ? ICON_MAP[icon as keyof typeof ICON_MAP]
    : null
  return Icon ? <Icon size={16} strokeWidth={2.2} color="var(--bg-0)" /> : name.charAt(0).toUpperCase()
}
