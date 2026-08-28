/**
 * 移动端设计 token 单一来源(v5 改版)。
 * 颜色/圆角/阴影取值必须与 mobile/src/index.css 的 :root 保持一致,
 * tests/unit/mobile-theme-tokens.test.ts 会校验两侧同步。
 * 新样式优先从这里和 CSS 变量取值,禁止再散落硬编码色值。
 */
export const theme = {
  colors: {
    primary: '#6c5ce7',
    primaryLight: '#a29bfe',
    primaryBg: '#f0edff',
    bg: '#f5f5f7',
    bgCard: '#ffffff',
    bgInput: '#f0f0f5',
    textPrimary: '#1a1a2e',
    textSecondary: '#6b7280',
    textMuted: '#9ca3af',
    border: '#e5e7eb',
    borderLight: '#f0f0f5',
    success: '#10b981',
    successBg: '#e7f8f1',
    warning: '#f59e0b',
    warningBg: '#fdf3e0',
    error: '#ef4444',
    errorBg: '#fdecec',
    info: '#3b82f6',
    infoBg: '#eaf2fe',
  },
  radius: { sm: 8, md: 12, lg: 16, group: 14 },
  shadow: {
    card: '0 1px 3px rgba(26, 26, 46, 0.05), 0 4px 14px rgba(26, 26, 46, 0.04)',
  },
  fontMono: "'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
} as const

/** agent 头像渐变(按 agentId 稳定取色,同名 agent 跨页同色) */
export const AGENT_GRADIENTS = [
  ['#6c5ce7', '#a29bfe'],
  ['#3b82f6', '#7cb0fd'],
  ['#f59e0b', '#fcd34d'],
  ['#10b981', '#6ee7b7'],
  ['#ef4444', '#f87171'],
  ['#6a7480', '#9aa3b2'],
] as const

export function agentGradient(agentId: string): readonly [string, string] {
  let hash = 0
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  }
  return AGENT_GRADIENTS[hash % AGENT_GRADIENTS.length]
}
