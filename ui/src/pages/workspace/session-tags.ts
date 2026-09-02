// 会话 tag 颜色与列表筛选的纯逻辑。颜色取值与哈希算法照抄
// docs/design/workspace-tags-archive-prototype.html（交互规范原型），
// 只使用 ui/src/index.css 的既有 token，不自造颜色。
export type SessionTagColor = readonly [background: string, foreground: string]

export const SESSION_TAG_COLORS: readonly SessionTagColor[] = [
  ['var(--blue-light)', 'var(--blue)'],
  ['var(--green-light)', 'var(--green)'],
  ['var(--purple-light)', 'var(--purple)'],
  ['var(--orange-light)', 'var(--orange)'],
  ['var(--yellow-light)', 'var(--yellow)'],
]

// 标签约束与 src/core/sessions.ts 的 normalizeSessionTags 保持一致。
export const MAX_SESSION_TAGS = 10
export const MAX_SESSION_TAG_LENGTH = 24

export function sessionTagColor(tag: string): SessionTagColor {
  let hash = 0
  for (let index = 0; index < tag.length; index += 1) {
    hash = (hash * 31 + tag.charCodeAt(index)) >>> 0
  }
  return SESSION_TAG_COLORS[hash % SESSION_TAG_COLORS.length] as SessionTagColor
}

export interface SessionTagItem {
  id: string
  archived_at?: string | null
  tags?: string[]
}

export function splitSessionsByArchive<T extends SessionTagItem>(sessions: T[]): {
  active: T[]
  archived: T[]
} {
  const active: T[] = []
  const archived: T[] = []
  for (const session of sessions) {
    if (session.archived_at) archived.push(session)
    else active.push(session)
  }
  return { active, archived }
}

// 当前作用域（含已归档会话）的 tag 并集，排序后供筛选区与标签编辑器使用。
export function collectScopeTags(sessions: SessionTagItem[]): string[] {
  const set = new Set<string>()
  for (const session of sessions) {
    for (const tag of session.tags ?? []) set.add(tag)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

// 多选 OR：未选 tag 时返回原列表；选中时保留命中任一所选 tag 的会话。
export function filterSessionsByTags<T extends SessionTagItem>(sessions: T[], selectedTags: string[]): T[] {
  if (selectedTags.length === 0) return sessions
  return sessions.filter((session) => (session.tags ?? []).some((tag) => selectedTags.includes(tag)))
}

// 提交一个新标签：trim → 截断到长度上限 → 空名/重复/超数量返回原数组。
// 与原型 commitTag 的静默语义一致，超限的显式报错由 core 层负责。
export function appendSessionTag(tags: string[], rawTag: string): string[] {
  const tag = rawTag.trim().slice(0, MAX_SESSION_TAG_LENGTH)
  if (!tag || tags.includes(tag) || tags.length >= MAX_SESSION_TAGS) return tags
  return [...tags, tag]
}
