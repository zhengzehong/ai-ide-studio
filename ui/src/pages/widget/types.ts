export interface ElectronWidgetApi {
  getPinState: () => Promise<boolean>
  togglePin: () => Promise<boolean>
  minimize: () => Promise<unknown>
  openMain: (target?: { projectId?: string | null; sessionId?: string | null }) => Promise<WidgetNavigationResult>
}

export interface WidgetNavigationResult {
  ok: boolean
  error?: string
}

export const electronApi = (window as unknown as { electronWidget?: ElectronWidgetApi }).electronWidget
