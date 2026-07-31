export interface WidgetNavigationTarget {
  projectId?: string | null
  sessionId?: string | null
}

export function createWidgetNavigationUrl(
  origin: string,
  target?: WidgetNavigationTarget,
): string | null {
  const path = createWidgetNavigationPath(target)
  return path ? new URL(path, `${origin}/`).toString() : null
}

export function createWidgetNavigationPath(
  target?: WidgetNavigationTarget,
): string | null {
  const sessionId = target?.sessionId?.trim()
  if (!sessionId) return null

  const projectId = target?.projectId?.trim()
  const pathname = projectId
    ? `/p/${encodeURIComponent(projectId)}/workspace`
    : '/workspace'
  const url = new URL(pathname, 'https://desktop.invalid')
  url.searchParams.set('sessionId', sessionId)
  return `${url.pathname}${url.search}`
}
