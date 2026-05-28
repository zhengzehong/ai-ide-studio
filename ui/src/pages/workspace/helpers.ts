import type React from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { ConfigOptionInfo, ToolCallInfo } from '../../stores/session.store'

export const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' }

export function agentColor(a: AgentData): string { return TYPE_COLORS[a.type] ?? '#6b7280' }
export function agentAvatar(a: AgentData): string { return a.name.charAt(0).toUpperCase() }
export function statusDot(s: string): string { return s === 'running' ? '#2563eb' : s === 'idle' ? '#059669' : '#9ca3af' }
export function statusLabel(s: string): string { return { running: '运行中', idle: '空闲', standby: '待机', sleeping: '休眠' }[s] ?? s }
export function formatTime(iso: string): string { try { return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) } catch { return iso } }
export function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }

const MODE_CN: Record<string, string> = {
  Default: '默认', Auto: '自动', 'Accept Edits': '自动编辑', 'Plan Mode': '计划模式',
  "Don't Ask": '不询问', 'Bypass Permissions': '跳过权限',
  default: '默认', plan: '计划', code: '编码', debug: '调试', ask: '提问', agent: '代理', edit: '编辑', chat: '对话',
}

export function modeCn(name: string | null | undefined): string { return name ? (MODE_CN[name] || name) : '模式' }

export function displayConfigValue(value: string | undefined): string {
  if (!value) return ''
  const labels: Record<string, string> = { default: '默认', low: '低', medium: '中', high: '高', xhigh: '超高', max: 'Max' }
  return labels[value] || value
}

export function sessionTitle(session: { id: string; title?: string | null }): string {
  return session.title?.trim() || `会话 ${session.id.slice(-6)}`
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
  const active = opt.options?.find(o => o.value === opt.currentValue)
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
  const kindLabel = { read: '读取', edit: '编辑', delete: '删除', search: '搜索', execute: '执行', think: '思考', fetch: '拉取', move: '移动' }[tc.kind || ''] || ''
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
  const hasDiff = tc.content?.some(c => c.type === 'diff')
  if (hasDiff) {
    const diffItem = tc.content!.find(c => c.type === 'diff')
    if (diffItem?.path) return `编辑 ${diffItem.path}`
  }
  if ((tc.content?.some(c => c.type === 'text' && c.text) || typeof tc.rawOutput === 'string') && tc.status === 'completed') return '工具调用 完成'
  return `工具调用 #${tc.id.slice(-6)}`
}
