import { app, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  normalizeConnectionInput,
  toConnectionSettings,
  type DesktopConnectionInput,
  type DesktopConnectionStore,
} from './desktop-connection.js'
import { probeDesktopConnection } from './desktop-connection-probe.js'
import type { DesktopRuntimeTarget } from './desktop-target.js'
import { runDesktopDownload, type DesktopDownloadInput } from './desktop-download.js'
import {
  isDesktopApplicationPath,
  isTrustedDesktopIpcSender,
  isWidgetPath,
} from './desktop-ipc-policy.js'

interface DesktopIpcOptions {
  store: DesktopConnectionStore
  target: DesktopRuntimeTarget
  mainWindow: BrowserWindow
  getWidgetWindow: () => BrowserWindow | null
}

export function registerDesktopIpc(options: DesktopIpcOptions): void {
  ipcMain.on('desktop:get-bootstrap', (event) => {
    assertTrustedBootstrapSender(event, options)
    event.returnValue = {
      mode: options.target.mode,
      origin: options.target.origin,
      token: options.target.token,
      widgetEnabled: options.target.widgetEnabled,
    }
  })
  ipcMain.handle('desktop:get-settings', (event) => {
    assertTrustedMainSender(event, options)
    const profile = options.store.load()
    if (!profile) throw new Error('桌面连接配置不存在')
    return toConnectionSettings(profile)
  })
  ipcMain.handle('desktop:test-connection', async (_event, input: DesktopConnectionInput) => {
    try {
      assertTrustedMainSender(_event, options)
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
      assertTrustedMainSender(_event, options)
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
  ipcMain.handle('desktop:download-file', async (event, input: DesktopDownloadInput) => {
    assertTrustedMainSender(event, options)
    if (!input || typeof input.url !== 'string') return { ok: false, error: '下载参数无效' }
    return await runDesktopDownload(options.mainWindow, options.target, input)
  })
}

function assertTrustedBootstrapSender(
  event: IpcMainEvent,
  options: DesktopIpcOptions,
): void {
  const widgetWindow = options.getWidgetWindow()
  const isMain = isTrustedSender(event, options.mainWindow, options.target, isDesktopApplicationPath)
  const isWidget = widgetWindow
    ? isTrustedSender(event, widgetWindow, options.target, isWidgetPath)
    : false
  if (!isMain && !isWidget) throw new Error('不允许从当前页面读取桌面连接')
}

function assertTrustedMainSender(
  event: IpcMainInvokeEvent,
  options: DesktopIpcOptions,
): void {
  if (!isTrustedSender(event, options.mainWindow, options.target, isDesktopApplicationPath)) {
    throw new Error('不允许从当前页面修改桌面连接')
  }
}

function isTrustedSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  window: BrowserWindow,
  target: DesktopRuntimeTarget,
  allowedPath: (pathname: string) => boolean,
): boolean {
  return isTrustedDesktopIpcSender({
    senderId: event.sender.id,
    allowedSenderIds: new Set([window.webContents.id]),
    isMainFrame: event.senderFrame === event.sender.mainFrame,
    frameUrl: event.senderFrame?.url ?? '',
    allowedOrigin: target.origin,
    allowedPath,
  })
}
