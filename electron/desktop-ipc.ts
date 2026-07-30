import { app, ipcMain } from 'electron'
import {
  normalizeConnectionInput,
  toConnectionSettings,
  type DesktopConnectionInput,
  type DesktopConnectionStore,
} from './desktop-connection.js'
import { probeDesktopConnection } from './desktop-connection-probe.js'
import type { DesktopRuntimeTarget } from './desktop-target.js'

interface DesktopIpcOptions {
  store: DesktopConnectionStore
  target: DesktopRuntimeTarget
}

export function registerDesktopIpc(options: DesktopIpcOptions): void {
  ipcMain.on('desktop:get-bootstrap', (event) => {
    event.returnValue = {
      mode: options.target.mode,
      origin: options.target.origin,
      token: options.target.token,
      widgetEnabled: options.target.widgetEnabled,
    }
  })
  ipcMain.handle('desktop:get-settings', () => {
    const profile = options.store.load()
    if (!profile) throw new Error('桌面连接配置不存在')
    return toConnectionSettings(profile)
  })
  ipcMain.handle('desktop:test-connection', async (_event, input: DesktopConnectionInput) => {
    try {
      const profile = normalizeConnectionInput(input, options.store.load()?.token)
      if (profile.mode === 'remote') {
        await probeDesktopConnection(profile.remoteOrigin ?? '', profile.token ?? '')
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('desktop:save-settings', async (_event, input: DesktopConnectionInput) => {
    try {
      const profile = normalizeConnectionInput(input, options.store.load()?.token)
      if (profile.mode === 'remote') {
        await probeDesktopConnection(profile.remoteOrigin ?? '', profile.token ?? '')
      }
      options.store.save(input)
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 100)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
