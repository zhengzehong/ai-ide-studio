export type DesktopConnectionMode = 'managed-local' | 'remote'

export interface DesktopConnectionInput {
  mode: DesktopConnectionMode
  remoteOrigin?: string
  token?: string
  widgetEnabled: boolean
}

export interface DesktopConnectionSettings {
  mode: DesktopConnectionMode
  remoteOrigin: string
  widgetEnabled: boolean
  hasStoredToken: boolean
}

export interface DesktopBootstrap {
  mode: DesktopConnectionMode
  origin: string
  token: string
  widgetEnabled: boolean
}

export interface DesktopOperationResult {
  ok: boolean
  error?: string
}

export interface ElectronDesktopBridge {
  getBootstrap(): DesktopBootstrap
  getSettings(): Promise<DesktopConnectionSettings>
  testConnection(input: DesktopConnectionInput): Promise<DesktopOperationResult>
  saveSettings(input: DesktopConnectionInput): Promise<DesktopOperationResult>
}

export function getElectronDesktopBridge(): ElectronDesktopBridge | null {
  const candidate = (window as unknown as { electronDesktop?: ElectronDesktopBridge }).electronDesktop
  return candidate ?? null
}

export function initializeDesktopRendererConnection(
  bridge: ElectronDesktopBridge | null = getElectronDesktopBridge(),
  location: Location = window.location,
  storage: Storage = localStorage,
  browserHistory: History = history,
): DesktopBootstrap | null {
  if (!bridge) return null
  const bootstrap = bridge.getBootstrap()
  if (bootstrap.token.trim()) storage.setItem('ai-ide-access-token', bootstrap.token.trim())
  const url = new URL(location.href)
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token')
    browserHistory.replaceState(browserHistory.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return bootstrap
}
