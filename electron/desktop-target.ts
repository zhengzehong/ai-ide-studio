import type { DesktopConnectionProfile } from './desktop-connection.js'

export interface DesktopRuntimeTarget {
  mode: 'managed-local' | 'remote'
  origin: string
  token: string
  ownsBackend: boolean
  widgetEnabled: boolean
}

export function createManagedLocalTarget(
  port: number,
  token: string,
  widgetEnabled: boolean,
): DesktopRuntimeTarget {
  return {
    mode: 'managed-local',
    origin: `http://127.0.0.1:${port}`,
    token,
    ownsBackend: true,
    widgetEnabled,
  }
}

export function createRemoteTarget(profile: DesktopConnectionProfile): DesktopRuntimeTarget {
  if (profile.mode !== 'remote' || !profile.remoteOrigin || !profile.token) {
    throw new Error('远程桌面连接配置不完整')
  }
  return {
    mode: 'remote',
    origin: profile.remoteOrigin,
    token: profile.token,
    ownsBackend: false,
    widgetEnabled: profile.widgetEnabled,
  }
}

export function createDesktopUrl(target: DesktopRuntimeTarget, path = '/'): string {
  return new URL(path, `${target.origin}/`).toString()
}

export function isAllowedDesktopNavigation(url: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== new URL(allowedOrigin).origin) return false
    return !parsed.pathname.startsWith('/api/')
      && !parsed.pathname.startsWith('/preview/')
      && !parsed.pathname.startsWith('/avatars/')
  } catch {
    return false
  }
}
