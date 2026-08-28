export type SessionViewMode = 'all' | 'pinned'

export const pinnedSessionsPath = '/?view=pinned'

export function resolveSessionViewMode(search: string): SessionViewMode {
  return new URLSearchParams(search).get('view') === 'pinned' ? 'pinned' : 'all'
}

export function sessionViewPath(mode: SessionViewMode): string {
  return mode === 'pinned' ? pinnedSessionsPath : '/'
}

/** URL 带 view 参数优先;否则回落到本地保存的上次视图(跨页面往返时保持) */
export function resolveInitialViewMode(search: string, stored: SessionViewMode): SessionViewMode {
  const view = new URLSearchParams(search).get('view')
  return view === 'pinned' || view === 'all' ? view : stored
}
