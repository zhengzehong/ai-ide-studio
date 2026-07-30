import { shell, type BrowserWindow } from 'electron'
import { isAllowedDesktopNavigation } from './desktop-target.js'

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
