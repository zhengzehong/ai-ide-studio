export type SessionViewMode = 'all' | 'pinned'

export const pinnedSessionsPath = '/?view=pinned'

export function resolveSessionViewMode(search: string): SessionViewMode {
  return new URLSearchParams(search).get('view') === 'pinned' ? 'pinned' : 'all'
}

export function sessionViewPath(mode: SessionViewMode): string {
  return mode === 'pinned' ? pinnedSessionsPath : '/'
}
