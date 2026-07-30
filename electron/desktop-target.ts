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
  const url = new URL(path, `${target.origin}/`)
  url.searchParams.set('token', target.token)
  return url.toString()
}
