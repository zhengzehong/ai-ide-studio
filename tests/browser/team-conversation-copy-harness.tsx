/* 团队会话线「复制」冒烟 harness：真实组件（TeamConversationList）+ 假 wsClient，
 * 复刻服务端数据（列表行带 activity_state、copy RPC 返回新线占位），供
 * team-conversation-copy-smoke.mjs 用浏览器断言全链路：
 * ① 右键空闲线 → 复制菜单 → 确认弹窗（语义披露文案）→ copy RPC → 新线出现并选中
 * ② running 线复制菜单置灰 ③ copy RPC 失败 → 错误条透出原因。
 * 运行：node tests/browser/team-conversation-copy-smoke.mjs
 */
import { useCallback, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import '../../ui/src/index.css'
import { TeamConversationList } from '../../ui/src/components/team/TeamConversationList'
import { wsClient } from '../../ui/src/services/ws-client'
import type { TeamData } from '../../ui/src/stores/team.store'

const team = { id: 't1', project_id: 'p1', name: '冒烟团队', description: null, status: 'active', created_at: '', updated_at: '', archived_at: null } as unknown as TeamData

interface FakeConversation {
  id: string
  team_id: string
  master_session_id: string
  title: string
  status: string
  last_message_at: string | null
  updated_at?: string
  activity_state?: 'running' | 'idle'
  grid_session_ids?: string[]
  unread?: boolean
}

let lines: FakeConversation[] = [
  { id: 'tc-1', team_id: 't1', master_session_id: 'm1', title: '首线', status: 'active', last_message_at: '2030-01-01T00:00:00.000Z', activity_state: 'idle', grid_session_ids: ['m1', 's2'], unread: false },
  { id: 'tc-2', team_id: 't1', master_session_id: 'm2', title: '执行中的线', status: 'active', last_message_at: '2030-01-01T00:00:00.000Z', activity_state: 'running', grid_session_ids: ['m2'], unread: true },
]
let copyShouldFail = false

const log: string[] = []
const rpcCalls: string[] = []

function record(entry: string): void {
  log.push(entry)
  const element = document.getElementById('events')
  if (element) element.textContent = log.join('|')
}
function recordRpc(entry: string): void {
  rpcCalls.push(entry)
  const element = document.getElementById('rpc')
  if (element) element.textContent = rpcCalls.join('|')
}

wsClient.request = async (msg: Record<string, unknown>): Promise<unknown> => {
  const type = String(msg.type)
  switch (type) {
    case 'team.conversation.list':
      return [...lines]
    case 'team.conversation.copy': {
      recordRpc(`copy:${String(msg.conversationId)}`)
      if (copyShouldFail) throw new Error('团队会话正在运行或有排队消息，空闲后再复制')
      const conversation: FakeConversation = {
        id: 'tc-new', team_id: 't1', master_session_id: 'm-new', title: '首线（副本）', status: 'active',
        last_message_at: null, activity_state: 'idle', grid_session_ids: ['m-new'], unread: false,
      }
      lines = [conversation, ...lines]
      return { conversation }
    }
    case 'team.conversation.create':
      recordRpc(`create:${String(msg.teamId)}`)
      return {}
    default:
      recordRpc(type)
      return {}
  }
}
// 事件注册表：组件真实订阅 team:update，按钮可模拟服务端推送（回滚序列）。
const listeners = new Map<string, Set<(msg: unknown) => void>>()
wsClient.on = (type: string, handler: (msg: unknown) => void) => {
  const set = listeners.get(type) ?? new Set()
  set.add(handler)
  listeners.set(type, set)
  return () => { set.delete(handler) }
}
wsClient.subscribe = () => undefined
wsClient.unsubscribe = () => undefined

function emitServerEvent(type: string, msg: unknown): void {
  for (const handler of [...(listeners.get(type) ?? [])]) handler(msg)
}

/** 模拟服务端后台复制失败回滚：先发 deleted 变更（触发 300ms 防抖刷新），再发失败事件——
 * 复现原缺陷时序（失败错误条随后被刷新的 setError(null) 擦除）。 */
function emitRollbackSequence(): void {
  lines = lines.filter((line) => line.id !== 'tc-new')
  emitServerEvent('team:update', { teamId: 't1', data: { conversationId: 'tc-new', status: 'deleted' } })
  emitServerEvent('team:update', {
    teamId: 't1', sessionIds: ['m-new'],
    data: { conversationId: 'tc-new', reason: 'conversation.copy_failed', message: '模拟 fork 失败' },
  })
  record('rollback-emitted')
}

function Harness(): ReactElement {
  const [, setEpoch] = useState(0)
  const onSelect = useCallback((conversation: FakeConversation | null): void => { record(`select:${conversation?.id ?? 'null'}`) }, [])
  const onMasterSession = useCallback((sessionId: string | null): void => { record(`master:${sessionId ?? 'null'}`) }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 760 }}>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button id="btn-fail" onClick={() => { copyShouldFail = !copyShouldFail; record(`fail=${copyShouldFail}`) }}>模拟复制失败</button>
        <button id="btn-rollback" onClick={emitRollbackSequence}>模拟后台回滚</button>
        <div id="events" />
        <div id="rpc" />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <TeamConversationList
          team={team}
          activeId={null}
          onSelect={onSelect as never}
          onMasterSession={onMasterSession}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
