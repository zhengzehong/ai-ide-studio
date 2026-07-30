import { shell, type BrowserWindow } from 'electron'

export function restrictWindowNavigation(window: BrowserWindow, allowedOrigin: string): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedDesktopNavigation(url, allowedOrigin)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDesktopNavigation(url, allowedOrigin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

export function isAllowedDesktopNavigation(url: string, allowedOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(allowedOrigin).origin
  } catch {
    return false
  }
}
