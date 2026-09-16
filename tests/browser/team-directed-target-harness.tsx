/* 团队线「定向发送目标胶囊 + 就地档位/权限」冒烟 harness：
 * 真实组件（TeamChatPane → ConversationComposer / ConversationMessageList）+ 假 wsClient/queryClient，
 * 复刻服务端数据（成员 capabilities 走 config.update 恢复事件、定向消息走 sender_role='team-directed'），
 * 供 team-directed-target-smoke.mjs 用浏览器断言全链路：
 * ① 胶囊默认「全体」② @ / 点胶囊选成员 → 变蓝「Dev-GLM ✕」③ 档位开关就地变该成员控制（菜单头/含 Max/写 session.setConfig）
 * ④ 权限开关就地变该成员控制（展示 + 跳转，不就地写）⑤ 发送走 team.member.message + 忙时排队态 + 转录块
 * ⑥ 旧 codex 成员无档位项 → 开关禁用 ⑦ 清除目标回全体。
 * 运行：node tests/browser/team-directed-target-smoke.mjs
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import '../../ui/src/index.css'
import { TeamChatPane } from '../../ui/src/components/team/TeamChatPane'
import { wsClient } from '../../ui/src/services/ws-client'
import { queryClient } from '../../ui/src/services/query-client'

const team = { id: 't1', project_id: 'p1', name: '冒烟团队', description: null, status: 'active', created_at: '', updated_at: '', archived_at: null }
const conversation = { id: 'tc-1', team_id: 't1', master_session_id: 'm1', title: '首线', status: 'active', last_message_at: '2030-01-01T00:00:00.000Z' }

const members = [
  { id: 'tm-master', agent_id: 'a-master', session_id: 'm1', name: 'Master', role: 'leader' },
  { id: 'tm-2', agent_id: 'a-glm', session_id: 's2', name: 'Dev-GLM', role: 'member' },
  { id: 'tm-3', agent_id: 'a-kimi', session_id: 's3', name: 'Dev-Kimi-Legacy', role: 'member' },
]

const log: string[] = []
const rpcCalls: string[] = []
let memberBusy = false
let directedLanded = false

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

// 会话能力（生产走 session.getModels）：就地档位/权限控制唯一能力源。
const capabilitiesBySession: Record<string, Record<string, unknown>> = {
  m1: {
    models: [{ modelId: 'claude-sonnet-5', name: 'claude-sonnet-5' }], currentModelId: 'claude-sonnet-5',
    modes: [{ modeId: 'default', name: '默认' }], currentModeId: 'default', supportsImages: true, configOptions: [], commands: [],
  },
  // Dev-GLM：claude 成员，档位（含 max）与权限模式齐全。
  s2: {
    models: [{ modelId: 'glm-5', name: 'glm-5' }], currentModelId: 'glm-5',
    modes: [{ modeId: 'default', name: '默认' }, { modeId: 'bypassPermissions', name: '跳过权限' }], currentModeId: 'bypassPermissions',
    supportsImages: true, commands: [],
    configOptions: [{ id: 'effort', name: '思考强度', category: 'thought_level', type: 'select', currentValue: 'medium', options: [
      { value: 'default', name: '默认' }, { value: 'low', name: '低' }, { value: 'medium', name: '中' }, { value: 'high', name: '高' }, { value: 'max', name: 'Max' },
    ] }],
  },
  // Dev-Kimi-Legacy：旧 codex 适配器成员——无档位 configOption、无权限模式（权限挂在模型选择上）。
  s3: {
    models: [{ modelId: 'kimi-k2', name: 'kimi-k2' }], currentModelId: 'kimi-k2',
    modes: [], currentModeId: null, supportsImages: true, configOptions: [], commands: [],
  },
}

interface MockMessage { id: string; session_id: string; role: string; content: string; thinking: string | null; tool_calls_json: string | null; decision_json: string | null; timestamp: string; sender_name?: string | null; sender_role?: string | null; status: string }

function message(input: Partial<MockMessage> & { id: string; session_id: string; role: string; content: string; timestamp: string }): MockMessage {
  return { thinking: null, tool_calls_json: null, decision_json: null, status: 'completed', ...input }
}

const sessionMessages: Record<string, MockMessage[]> = {
  m1: [message({ id: 'm1-a1', session_id: 'm1', role: 'agent', content: '团队线已就绪', timestamp: '2030-01-01T00:00:00.000Z', sender_name: 'Master', sender_role: 'leader' })],
  s2: [
    // 服务端已落库的定向消息（用户从团队线直接发给 Dev-GLM）：聚合层应渲染「你 → Dev-GLM」块。
    message({ id: 's2-h1', session_id: 's2', role: 'human', content: '看下这个报错', timestamp: '2030-01-01T00:00:01.000Z', sender_name: '你', sender_role: 'team-directed' }),
    message({ id: 's2-a1', session_id: 's2', role: 'agent', content: '已定位：空指针在解析层', timestamp: '2030-01-01T00:00:05.000Z', sender_name: 'Dev-GLM', sender_role: 'member' }),
  ],
  s3: [],
}

wsClient.request = async (msg: Record<string, unknown>): Promise<unknown> => {
  const type = String(msg.type)
  switch (type) {
    case 'team.conversation.history':
      return { members: members.map((member) => ({ ...member })), removedMembers: [] }
    case 'session.getModels':
      return capabilitiesBySession[String(msg.sessionId)] || { models: [], currentModelId: null, modes: [], currentModeId: null, supportsImages: true, configOptions: [], commands: [] }
    case 'team.member.message': {
      recordRpc(`directed:${String(msg.memberId)}:${String(msg.content)}`)
      const member = members.find((item) => item.id === msg.memberId)
      return { status: memberBusy ? 'queued' : 'accepted', memberId: msg.memberId, memberName: member?.name }
    }
    case 'session.setConfig':
      recordRpc(`setConfig:${String(msg.sessionId)}:${String(msg.configId)}=${String(msg.value)}`)
      return {}
    case 'session.cancel':
      recordRpc(`cancel:${String(msg.sessionId)}`)
      return {}
    case 'sessionDock.list':
      return []
    case 'sessionDock.search':
      return []
    case 'sessions.projectStats':
      return { generatedAt: '2030-01-01T00:00:00.000Z', items: [] }
    default:
      recordRpc(type)
      return {}
  }
}
wsClient.on = () => () => undefined
wsClient.subscribe = () => undefined
wsClient.unsubscribe = () => undefined

queryClient.getSessionRecovery = async (input) => ({ sessionId: input.sessionId, latestSequence: 0, events: [] })
queryClient.listSessionMessages = async (input) => ({ items: ((directedLanded && input.sessionId === 's2' ? sessionMessages.s2 : sessionMessages[input.sessionId] || []) as never), hasMore: false, nextCursor: null })

function Harness(): ReactElement {
  const [epoch, setEpoch] = useState(0)
  // 模拟服务端落库：把「刚发出的定向消息」补进 Dev-GLM 会话历史，验证本地待落账块被真实块替换。
  useEffect(() => {
    queryClient.listSessionMessages = async (input) => {
      const base = sessionMessages[input.sessionId] || []
      const items = directedLanded && input.sessionId === 's2'
        ? [...base, message({ id: 's2-h2', session_id: 's2', role: 'human', content: '刚发的定向消息', timestamp: '2030-01-01T00:01:00.000Z', sender_name: '你', sender_role: 'team-directed' })]
        : base
      return { items: items as never, hasMore: false, nextCursor: null }
    }
  }, [epoch])
  const openToolPermissions = useCallback((agentId: string): void => { record(`open-tools:${agentId}`) }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 760 }}>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button id="btn-busy" onClick={() => { memberBusy = !memberBusy; record(`busy=${memberBusy}`) }}>模拟成员执行中</button>
        <button id="btn-land" onClick={() => { directedLanded = true; setEpoch((value) => value + 1) }}>模拟服务端落库</button>
        <div id="events" />
        <div id="rpc" />
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <TeamChatPane team={team as never} conversation={conversation as never} masterSessionId="m1" onOpenToolPermissions={openToolPermissions} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
