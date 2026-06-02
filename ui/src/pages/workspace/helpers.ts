import type React from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { ConfigOptionInfo, SessionData, ToolCallInfo } from '../../stores/session.store'

export const TYPE_COLORS: Record<string, string> = {
  dev: '#2563eb',
  test: '#059669',
  ops: '#ea580c',
  security: '#dc2626',
  architect: '#7c3aed',
  pm: '#7c3aed',
}

export function agentColor(a: AgentData): string {
  return TYPE_COLORS[a.type] ?? '#6b7280'
}
export function agentAvatar(a: AgentData): string {
  return a.name.charAt(0).toUpperCase()
}
export function statusDot(s: string): string {
  return s === 'running' ? '#2563eb' : s === 'idle' ? '#059669' : '#9ca3af'
}
export function statusLabel(s: string): string {
  return { running: '运行中', idle: '空闲', standby: '待机', sleeping: '休眠' }[s] ?? s
}
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const MODE_CN: Record<string, string> = {
  Default: '默认',
  Auto: '自动',
  'Accept Edits': '自动编辑',
  'Plan Mode': '计划模式',
  "Don't Ask": '不询问',
  'Bypass Permissions': '跳过权限',
  default: '默认',
  plan: '计划',
  code: '编码',
  debug: '调试',
  ask: '提问',
  agent: '代理',
  edit: '编辑',
  chat: '对话',
}

export function modeCn(name: string | null | undefined): string {
  return name ? MODE_CN[name] || name : '模式'
}

export function displayConfigValue(value: string | undefined): string {
  if (!value) return ''
  const labels: Record<string, string> = {
    default: '默认',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: 'Max',
  }
  return labels[value] || value
}

export function sessionTitle(session: { id: string; title?: string | null }): string {
  return session.title?.trim() || `会话 ${session.id.slice(-6)}`
}

export function filterSessionsByProject<T extends { project_id?: string | null }>(sessions: T[], projectId?: string | null): T[] {
  if (!projectId) return []
  return sessions.filter((session) => session.project_id === projectId)
}

export function filterAgentsByProject<T extends { project_id?: string | null }>(agents: T[], projectId?: string | null): T[] {
  if (!projectId) return []
  return agents.filter((agent) => agent.project_id === projectId)
}

export function selectChatAgent({
  agents,
  sessions,
  currentSessionId,
  selectedAgentId,
}: {
  agents: AgentData[]
  sessions: SessionData[]
  currentSessionId: string | null
  selectedAgentId: string | null
}): AgentData | undefined {
  const currentSession = currentSessionId ? sessions.find((session) => session.id === currentSessionId) : undefined
  if (currentSession) return agents.find((agent) => agent.id === currentSession.agent_id)
  return agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]
}

export function chatContentKey(sessionId: string | null): string {
  return `chat-content:${sessionId ?? 'none'}`
}

export const sessionMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '7px 9px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-1)',
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
}

export function configOptionLabel(value: string, name: string): string {
  return displayConfigValue(value) || name
}

export function configLabel(opt: ConfigOptionInfo): string {
  if (opt.category === 'thought_level') return configOptionLabel(String(opt.currentValue || ''), opt.name || '思考强度')
  if (opt.type === 'boolean') return `${opt.name}: ${opt.currentValue ? '开' : '关'}`
  const active = opt.options?.find((o) => o.value === opt.currentValue)
  return active ? configOptionLabel(active.value, active.name) : opt.name
}

export type MenuName = 'command' | 'mode' | 'model' | `config:${string}`
export type MenuAnchor = { name: MenuName; left: number; top: number; minWidth: number }

export function menuStyle(anchor: MenuAnchor | null, width = 260): React.CSSProperties {
  const fallbackTop = window.innerHeight - 440
  const left = Math.min(Math.max(8, anchor?.left ?? 280), window.innerWidth - width - 8)
  return { left, top: Math.max(8, anchor?.top ?? fallbackTop), width, maxWidth: `calc(100vw - 16px)` }
}

export function toolSummary(tc: ToolCallInfo): string {
  const teamSummary = teamToolSummary(tc)
  if (teamSummary) return teamSummary

  const kindLabel =
    {
      read: '读取',
      edit: '编辑',
      delete: '删除',
      search: '搜索',
      execute: '执行',
      think: '思考',
      fetch: '拉取',
      move: '移动',
    }[tc.kind || ''] || ''
  const loc = tc.locations?.[0]
  if (loc) return `${kindLabel || '访问'} ${loc.path}${loc.line ? `:${loc.line}` : ''}`
  if (tc.rawInput && typeof tc.rawInput === 'object') {
    const inp = tc.rawInput as Record<string, unknown>
    if (inp.command) return `执行 ${String(inp.command).slice(0, 80)}`
    if (inp.path) return `${tc.kind === 'edit' ? '编辑' : '读取'} ${String(inp.path)}`
    if (inp.pattern) return `搜索 ${String(inp.pattern).slice(0, 60)}`
    if (inp.query) return `搜索 ${String(inp.query).slice(0, 60)}`
  }
  if (tc.title) return tc.title
  const hasDiff = tc.content?.some((c) => c.type === 'diff')
  if (hasDiff) {
    const diffItem = tc.content!.find((c) => c.type === 'diff')
    if (diffItem?.path) return `编辑 ${diffItem.path}`
  }
  if (
    (tc.content?.some((c) => c.type === 'text' && c.text) || typeof tc.rawOutput === 'string') &&
    tc.status === 'completed'
  )
    return '工具调用 完成'
  return `工具调用 #${tc.id.slice(-6)}`
}

function teamToolSummary(tc: ToolCallInfo): string | null {
  const name = toolName(tc)
  if (!name?.startsWith('team.')) return null
  const input = recordOrEmpty(tc.rawInput)
  const output = recordOrEmpty(tc.rawOutput)
  const team = recordOrEmpty(output.team)
  const member = recordOrEmpty(output.member)
  const task = recordOrEmpty(output.task)
  const message = recordOrEmpty(output.message)

  if (name === 'team.create') return `创建 Team：${text(team.name) || text(input.name) || '新团队'}`
  if (name === 'team.get') return `查看 Team：${text(team.name) || text(input.teamId) || '当前 Team'}`
  if (name === 'team.update')
    return `更新 Team：${text(input.name) || text(input.status) || text(input.teamId) || '团队信息'}`
  if (name === 'team.member.list') return '查看 Team 成员'
  if (name === 'team.member.spawn')
    return `创建成员：${text(member.name) || text(input.name) || text(input.templateId) || '新成员'}`
  if (name === 'team.member.message')
    return `派发给成员：${short(text(input.content), 36) || text(input.memberId) || '任务消息'}`
  if (name === 'team.mailbox.list') return '查看成员汇报'
  if (name === 'team.mailbox.send')
    return `成员汇报：${short(text(message.content) || text(input.content), 36) || '新消息'}`
  if (name === 'team.task.list') return '查看 Team 任务'
  if (name === 'team.task.create') return `创建 Team 任务：${text(task.title) || text(input.title) || '新任务'}`
  if (name === 'team.task.update')
    return `更新 Team 任务：${text(input.status) || text(task.status) || text(input.taskId) || '任务状态'}`
  if (name === 'team.template.list') return '查看可用成员模板'
  if (name === 'team.template.describe') return `查看成员模板：${text(input.templateId) || '模板详情'}`
  return tc.title || name
}

function toolName(tc: ToolCallInfo): string | null {
  if (tc.title?.startsWith('team.')) return tc.title
  if (tc.rawInput && typeof tc.rawInput === 'object') {
    const input = tc.rawInput as Record<string, unknown>
    if (typeof input.name === 'string' && input.name.startsWith('team.')) return input.name
    if (typeof input.tool === 'string' && input.tool.startsWith('team.')) return input.tool
  }
  return null
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
