import type { TaskPage, TaskPageQuery } from '../../../services/query-client'
import type { TaskData } from '../../../stores/task.store'
import type { TaskTimeTab } from './task-helpers'

export interface WorkspaceTaskPageState {
  items: TaskData[]
  total: number
  hasMore: boolean
  nextCursor: string | null
  loading: boolean
  error: string | null
}

export interface WorkspaceTaskPages {
  today: WorkspaceTaskPageState
  history: WorkspaceTaskPageState
}

export function createWorkspaceTaskPageState(): WorkspaceTaskPageState {
  return { items: [], total: 0, hasMore: false, nextCursor: null, loading: false, error: null }
}

export function createWorkspaceTaskPages(): WorkspaceTaskPages {
  return { today: createWorkspaceTaskPageState(), history: createWorkspaceTaskPageState() }
}

export function workspaceTaskPageQuery(
  tab: TaskTimeTab,
  projectId: string,
  hideCompleted: boolean,
  now = new Date(),
): TaskPageQuery {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  return {
    projectId,
    ...(tab === 'today' ? { createdFrom: dayStart } : { createdBefore: dayStart }),
    excludeTerminal: hideCompleted,
    limit: 50,
  }
}

export function replaceWorkspaceTaskPage(
  _current: WorkspaceTaskPageState,
  page: TaskPage,
): WorkspaceTaskPageState {
  return {
    items: uniqueTasks(page.items),
    total: page.total,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    loading: false,
    error: null,
  }
}

export function appendWorkspaceTaskPage(
  current: WorkspaceTaskPageState,
  page: TaskPage,
): WorkspaceTaskPageState {
  return {
    items: uniqueTasks([...current.items, ...page.items]),
    total: page.total,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    loading: false,
    error: null,
  }
}

export function patchWorkspaceTaskPages(
  pages: WorkspaceTaskPages,
  patch: Partial<TaskData> & { id: string; event?: string },
  projectId: string,
  hideCompleted: boolean,
  now = new Date(),
): WorkspaceTaskPages {
  const next: WorkspaceTaskPages = { today: pages.today, history: pages.history }
  let resolved: TaskData | null = null

  for (const tab of ['today', 'history'] as const) {
    const current = next[tab]
    const index = current.items.findIndex((task) => task.id === patch.id)
    if (index < 0) continue
    const existing = current.items[index]
    resolved = { ...existing, ...patch }
    const remove = patch.event === 'deleted'
      || !matchesWorkspacePage(resolved, tab, projectId, hideCompleted, now)
    const items = remove
      ? current.items.filter((task) => task.id !== patch.id)
      : current.items.map((task) => task.id === patch.id ? resolved as TaskData : task)
    next[tab] = {
      ...current,
      items,
      total: remove ? Math.max(0, current.total - 1) : current.total,
      hasMore: remove ? items.length < Math.max(0, current.total - 1) : current.hasMore,
      nextCursor: items.length > 0 && items.length < (remove ? current.total - 1 : current.total)
        ? items.at(-1)?.id ?? null
        : current.nextCursor,
    }
  }

  if (patch.event === 'deleted') return next
  const candidate = resolved ?? completeTaskPatch(patch)
  if (!candidate || next.today.items.some((task) => task.id === candidate.id)
    || next.history.items.some((task) => task.id === candidate.id)) return next

  const tab = taskTimeTab(candidate, now)
  if (!matchesWorkspacePage(candidate, tab, projectId, hideCompleted, now)) return next
  const current = next[tab]
  const items = sortTasks([candidate, ...current.items])
  next[tab] = {
    ...current,
    items,
    total: current.total + 1,
    hasMore: items.length < current.total + 1,
    nextCursor: items.length < current.total + 1 ? items.at(-1)?.id ?? null : null,
  }
  return next
}

export function setWorkspaceTaskPageLoading(
  current: WorkspaceTaskPageState,
  loading: boolean,
): WorkspaceTaskPageState {
  return { ...current, loading, error: loading ? null : current.error }
}

export function setWorkspaceTaskPageError(
  current: WorkspaceTaskPageState,
  error: string,
): WorkspaceTaskPageState {
  return { ...current, loading: false, error }
}

export function shouldStartWorkspaceTaskPageLoad(input: {
  append: boolean
  inFlight: boolean
  hasMore: boolean
  nextCursor: string | null
}): boolean {
  if (input.inFlight) return false
  if (!input.append) return true
  return input.hasMore && Boolean(input.nextCursor)
}

export interface WorkspaceTaskRefreshTransition {
  pending: boolean
  shouldStart: boolean
}

export function requestWorkspaceTaskRefresh(input: {
  inFlight: boolean
  pending: boolean
}): WorkspaceTaskRefreshTransition {
  return input.inFlight
    ? { pending: true, shouldStart: false }
    : { pending: false, shouldStart: true }
}

export function completeWorkspaceTaskPageLoad(input: {
  pending: boolean
}): WorkspaceTaskRefreshTransition {
  return input.pending
    ? { pending: false, shouldStart: true }
    : { pending: false, shouldStart: false }
}

function matchesWorkspacePage(
  task: TaskData,
  tab: TaskTimeTab,
  projectId: string,
  hideCompleted: boolean,
  now: Date,
): boolean {
  if (task.project_id !== projectId) return false
  if (hideCompleted && (task.status === 'completed' || task.status === 'cancelled')) return false
  return taskTimeTab(task, now) === tab
}

function taskTimeTab(task: TaskData, now: Date): TaskTimeTab {
  const createdAt = new Date(task.created_at).getTime()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Number.isFinite(createdAt) && createdAt < dayStart ? 'history' : 'today'
}

function completeTaskPatch(patch: Partial<TaskData> & { id: string }): TaskData | null {
  return typeof patch.title === 'string'
    && typeof patch.status === 'string'
    && typeof patch.created_at === 'string'
    && typeof patch.project_id === 'string'
    ? patch as TaskData
    : null
}

function uniqueTasks(tasks: TaskData[]): TaskData[] {
  const byId = new Map<string, TaskData>()
  for (const task of tasks) if (!byId.has(task.id)) byId.set(task.id, task)
  return [...byId.values()]
}

function sortTasks(tasks: TaskData[]): TaskData[] {
  return [...tasks].sort((left, right) => {
    const byCreatedAt = right.created_at.localeCompare(left.created_at)
    return byCreatedAt !== 0 ? byCreatedAt : right.id.localeCompare(left.id)
  })
}
