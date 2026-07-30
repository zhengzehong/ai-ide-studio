export interface DesktopIpcSender {
  senderId: number
  allowedSenderIds: ReadonlySet<number>
  isMainFrame: boolean
  frameUrl: string
  allowedOrigin: string
  allowedPath: (pathname: string) => boolean
}

export function isTrustedDesktopIpcSender(input: DesktopIpcSender): boolean {
  if (!input.allowedSenderIds.has(input.senderId) || !input.isMainFrame) return false
  try {
    const frame = new URL(input.frameUrl)
    return frame.origin === new URL(input.allowedOrigin).origin && input.allowedPath(frame.pathname)
  } catch {
    return false
  }
}

export function isDesktopApplicationPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/workspace') return true
  if (pathname.startsWith('/p/')) return true
  return [
    '/projects',
    '/shares',
    '/templates',
    '/settings',
    '/agents',
    '/skills',
    '/tools',
    '/tasks',
    '/schedule',
    '/events',
    '/knowledge',
    '/agent-memory',
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function isWidgetPath(pathname: string): boolean {
  return pathname === '/widget'
}
