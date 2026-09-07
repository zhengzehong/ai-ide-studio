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

export interface DesktopDownloadResult {
  ok: boolean
  canceled?: boolean
  error?: string
}

export interface DesktopDownloadInput {
  url: string
  filename?: string
}

export interface ElectronDesktopBootstrapBridge {
  getBootstrap(): DesktopBootstrap
}

export interface ElectronDesktopBridge extends ElectronDesktopBootstrapBridge {
  getNodeStatus?(): Promise<DesktopNodeStatus>
  setNodeEnabled?(enabled: boolean): Promise<DesktopNodeStatus>
  unpairNode?(): Promise<DesktopNodeStatus>
  signOrigin?(input: { sessionId: string; messageId: string }): Promise<string | undefined>
  onNavigate?(listener: (request: DesktopNavigationRequest) => void): () => void
  acknowledgeNavigation?(id: string): void
  getSettings(): Promise<DesktopConnectionSettings>
  testConnection(input: DesktopConnectionInput): Promise<DesktopOperationResult>
  saveSettings(input: DesktopConnectionInput): Promise<DesktopOperationResult>
  downloadFile?(input: DesktopDownloadInput): Promise<DesktopDownloadResult>
}

export interface DesktopNodeStatus {
  supported: boolean
  enabled: boolean
  online: boolean
  machineName: string
  deviceId: string | null
  shells: string[]
  error?: string
}

export function getElectronDesktopBridge(): ElectronDesktopBridge | null {
  const candidate = getElectronDesktopBootstrapBridge()
  if (!candidate || !('getSettings' in candidate) || !('testConnection' in candidate) || !('saveSettings' in candidate)) {
    return null
  }
  return candidate as ElectronDesktopBridge
}

export interface DesktopNavigationRequest {
  id: string
  path: string
}

export function subscribeDesktopNavigation(
  bridge: Pick<ElectronDesktopBridge, 'onNavigate' | 'acknowledgeNavigation'> | null,
  navigate: (path: string) => void,
): () => void {
  return bridge?.onNavigate?.((request) => {
    navigate(request.path)
    bridge.acknowledgeNavigation?.(request.id)
  }) ?? (() => undefined)
}

export function getElectronDesktopBootstrapBridge(): ElectronDesktopBootstrapBridge | null {
  const candidate = (window as unknown as { electronDesktop?: ElectronDesktopBootstrapBridge }).electronDesktop
  return candidate ?? null
}

export function initializeDesktopRendererConnection(
  bridge: ElectronDesktopBootstrapBridge | null = getElectronDesktopBootstrapBridge(),
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
