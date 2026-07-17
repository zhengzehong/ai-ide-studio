const LAST_AGENT_KEY_PREFIX = 'mobile:lastAgentByProject:'

export function readLastAgent(projectId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_AGENT_KEY_PREFIX + projectId) ?? null
  } catch {
    return null
  }
}

export function writeLastAgent(projectId: string, agentId: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_AGENT_KEY_PREFIX + projectId, agentId)
  } catch {
    /* ignore */
  }
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return ''
  }
}
