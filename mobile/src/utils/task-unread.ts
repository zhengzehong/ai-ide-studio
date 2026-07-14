// 简化版未读汇报判断:
// 用 localStorage 存 { taskId: lastSeenAt }, 进入列表页时若 task.updated_at > lastSeenAt 则标记未读.
// 详情页暂未实现, 列表页点击卡片时清掉对应 taskId 的未读.
// 只展示"有未读"的红点, 不展示数量(数量本就无精确来源).

const STORAGE_KEY = 'mobile-task-unread-v1'

type UnreadMap = Record<string, string>

function readMap(): UnreadMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as UnreadMap
  } catch {
    return {}
  }
}

function writeMap(map: UnreadMap): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / privacy mode
  }
}

export function isTaskUnread(taskId: string, updatedAt: string | null | undefined): boolean {
  if (!taskId || !updatedAt) return false
  const map = readMap()
  const last = map[taskId]
  if (!last) return true
  return new Date(updatedAt).getTime() > new Date(last).getTime()
}

export function markTaskRead(taskId: string): void {
  if (!taskId) return
  const map = readMap()
  map[taskId] = new Date().toISOString()
  writeMap(map)
}

export function getTaskLastSeen(taskId: string): string | null {
  if (!taskId) return null
  const map = readMap()
  return map[taskId] ?? null
}

export function markAllVisibleRead(taskIds: string[]): void {
  if (!taskIds.length) return
  const now = new Date().toISOString()
  const map = readMap()
  for (const id of taskIds) {
    if (id) map[id] = now
  }
  writeMap(map)
}

