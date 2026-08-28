export type SessionViewMode = 'all' | 'pinned'

export const pinnedSessionsPath = '/?view=pinned'

export function resolveSessionViewMode(search: string): SessionViewMode {
  return new URLSearchParams(search).get('view') === 'pinned' ? 'pinned' : 'all'
}

/** 切换视图的导航地址:显式带 view 参数,和"裸路径=恢复上次视图"区分开 */
export function sessionViewPath(mode: SessionViewMode): string {
  return mode === 'pinned' ? pinnedSessionsPath : '/?view=all'
}

/** URL 带 view 参数优先;否则回落到本地保存的上次视图(跨页面往返时保持) */
export function resolveInitialViewMode(search: string, stored: SessionViewMode): SessionViewMode {
  const view = new URLSearchParams(search).get('view')
  return view === 'pinned' || view === 'all' ? view : stored
}
