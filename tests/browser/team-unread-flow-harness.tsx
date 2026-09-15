/* 团队会话线「未读/置顶 + 无自动选中」冒烟 harness：
 * 真实组件（TeamConversationList + TeamChatPane）+ 假 wsClient，复刻 Workspace 的选中态持有方式，
 * 供 team-unread-flow-smoke.mjs 用浏览器断言：
 * ① 进团队不选线 → 空态（列表刷新也不自动选）② 点线 → 选中
 * ③ 标未读 → 退出 → 空态 + 该线黄点亮起（本地失效触发列表重拉）
 * ④ 退出后再点该团队 → 仍空态；⑤ 置顶 → 置顶线排到列表最前。
 * 运行：node tests/browser/team-unread-flow-smoke.mjs
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamConversationList } from '../../ui/src/components/team/TeamConversationList'
import { TeamChatPane } from '../../ui/src/components/team/TeamChatPane'
import { wsClient } from '../../ui/src/services/ws-client'

const team = { id: 't1', project_id: 'p1', name: '冒烟团队', description: null, status: 'active', created_at: '', updated_at: '', archived_at: null }

interface Row { id: string; team_id: string; master_session_id: string; title: string; status: string; updated_at: string; last_message_at: string | null; unread: boolean; grid_session_ids: string[] }
let rows: Row[] = [
  { id: 'tc-1', team_id: 't1', master_session_id: 'm1', title: '首线', status: 'active', updated_at: '2030-01-02T00:00:00.000Z', last_message_at: '2030-01-02T00:00:00.000Z', unread: false, grid_session_ids: ['m1'] },
  { id: 'tc-2', team_id: 't1', master_session_id: 'm2', title: '次线', status: 'active', updated_at: '2030-01-01T00:00:00.000Z', last_message_at: '2030-01-01T00:00:00.000Z', unread: false, grid_session_ids: ['m2'] },
]
let docked: string[] = []
const markUnreadCalls: string[] = []
let failUnread = false
const handlers = new Map<string, (message: Record<string, unknown>) => void>()
const logEntries: string[] = []
const rpcCalls: string[] = []
// 选中态与坞/未读调用都由模块变量直写 DOM：坞变化不经过 harness 的 React state，
// 若走 React 渲染，`#state` 会停在旧值上（假失败）。
const ui: { team: string | null; line: string | null; master: string | null } = { team: null, line: null, master: null }

function refreshState(): void {
  const element = document.getElementById('state')
  if (element) element.textContent = `team=${ui.team ?? 'none'} line=${ui.line ?? 'none'} master=${ui.master ?? 'none'} dock=${docked.join(',') || 'none'} marks=${markUnreadCalls.join(',') || 'none'}`
}

function record(entry: string): void {
  logEntries.push(entry)
  const element = document.getElementById('events')
  if (element) element.textContent = logEntries.join('|')
  refreshState()
}

function recordRpc(entry: string): void {
  rpcCalls.push(entry)
  const element = document.getElementById('rpc')
  if (element) element.textContent = rpcCalls.join('|')
}

function dockItem(sessionId: string): Record<string, unknown> {
  const row = rows.find(item => item.master_session_id === sessionId)
  return {
    sessionId, sessionTitle: row?.title ?? null, stage: '', agentId: 'a-master', agentName: 'Leader', agentIcon: 'bot',
    agentAvatarUrl: null, projectId: 'p1', projectName: 'P', projectColor: null, projectIcon: null,
    activityState: 'idle', unread: row?.unread ?? false, lastActivityAt: '2030-01-02T00:00:00.000Z',
    sortOrder: docked.length + 1, addedAt: '2030-01-02T00:00:00.000Z',
  }
}

wsClient.request = async (msg: Record<string, unknown>): Promise<unknown> => {
  recordRpc(String(msg.type))
  switch (msg.type) {
    case 'team.conversation.list': return rows.map(row => ({ ...row }))
    case 'team.conversation.history': return { members: [], removedMembers: [] }
    case 'sessions.recovery': return { sessionId: String(msg.sessionId), latestSequence: 0, events: [] }
    case 'team.conversation.create': {
      const created: Row = { id: `tc-new-${rows.length + 1}`, team_id: 't1', master_session_id: `m-new-${rows.length + 1}`, title: '新团队会话', status: 'active', updated_at: new Date().toISOString(), last_message_at: null, unread: false, grid_session_ids: [] }
      rows = [created, ...rows]
      return { conversation: created }
    }
    case 'team.conversation.archive': {
      rows = rows.map(row => row.id === msg.conversationId ? { ...row, status: 'archived' } : row)
      return { ok: true }
    }
    case 'team.conversation.delete': {
      rows = rows.filter(row => row.id !== msg.conversationId)
      return { ok: true }
    }
    case 'team.conversation.markUnread': {
      // 失败路径开关：模拟服务端拒绝，验证"失败留在线内 + 报错不退出"。
      if (failUnread) throw new Error('模拟标未读失败')
      const conversationId = String(msg.conversationId)
      markUnreadCalls.push(conversationId)
      rows = rows.map(row => row.id === conversationId ? { ...row, unread: true } : row)
      refreshState()
      return []
    }
    case 'team.conversation.markRead': return []
    case 'sessionDock.list': return docked.map(dockItem)
    case 'sessionDock.add': {
      const sessionId = String(msg.sessionId)
      if (!docked.includes(sessionId)) docked = [sessionId, ...docked]
      refreshState()
      return dockItem(sessionId)
    }
    case 'sessionDock.remove': {
      docked = docked.filter(id => id !== String(msg.sessionId))
      refreshState()
      return { removed: true }
    }
    case 'sessions.projectStats': return { generatedAt: new Date().toISOString(), items: [] }
    default: return {}
  }
}
wsClient.on = (event: string, handler: (message: Record<string, unknown>) => void) => {
  handlers.set(event, handler)
  return () => handlers.delete(event)
}
wsClient.subscribe = () => undefined
wsClient.unsubscribe = () => undefined

function Harness(): ReactElement {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<{ id: string; team_id: string; master_session_id: string; title: string; status?: string; last_message_at?: string | null } | null>(null)
  const [masterSessionId, setMasterSessionId] = useState<string | null>(null)

  // 与 Workspace.handleTeamClick 同逻辑：进团队一律空态起步（同团队重复点击直接忽略）。
  const enterTeam = useCallback((): void => {
    if (ui.team === team.id) return
    record('enter-team')
    ui.team = team.id; ui.line = null; ui.master = null
    setSelectedTeamId(team.id)
    setConversation(null)
    setMasterSessionId(null)
    refreshState()
  }, [])
  const onSelect = useCallback((line: { id: string } | null): void => {
    record(`select:${line?.id ?? 'none'}`)
    ui.line = line?.id ?? null
    setConversation(line as never)
    refreshState()
  }, [])
  const onMasterSession = useCallback((sessionId: string | null): void => {
    record(`master:${sessionId ?? 'none'}`)
    ui.master = sessionId
    setMasterSessionId(sessionId)
    refreshState()
  }, [])
  const exitConversation = useCallback((): void => {
    record('exit-line')
    ui.line = null; ui.master = null
    setConversation(null)
    setMasterSessionId(null)
    refreshState()
  }, [])
  useEffect(() => { refreshState() })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 760 }}>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button id="btn-enter-team" onClick={enterTeam}>进入团队</button>
        <button id="btn-team-update" onClick={() => { handlers.get('team:update')?.({ teamId: team.id, data: { conversationId: 'tc-1' } }) }}>模拟列表刷新</button>
        <button id="btn-fail-unread" onClick={() => { failUnread = !failUnread; refreshState() }}>开关：标未读失败</button>
        <div id="events" />
        <div id="state" />
        <div id="rpc" />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {selectedTeamId === null
          ? <div id="lobby">未进团队</div>
          : (
            <>
              <TeamConversationList
                team={team}
                activeId={conversation?.id ?? null}
                onSelect={onSelect}
                onMasterSession={onMasterSession}
              />
              <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                <TeamChatPane
                  team={team}
                  conversation={conversation as never}
                  masterSessionId={masterSessionId}
                  onExitConversation={exitConversation}
                />
              </div>
            </>
          )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
