import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createBackendLaunchOptions, resolveBackendNodeCommand } from './backend-launch.js'
import { DesktopConnectionStore, type DesktopConnectionProfile } from './desktop-connection.js'
import { probeDesktopConnection } from './desktop-connection-probe.js'
import { createDesktopCredentialProtector } from './desktop-credentials.js'
import { registerDesktopIpc } from './desktop-ipc.js'
import { isTrustedDesktopIpcSender, isWidgetPath } from './desktop-ipc-policy.js'
import { restrictWindowNavigation } from './desktop-security.js'
import {
  createDesktopUrl,
  createManagedLocalTarget,
  createRemoteTarget,
  type DesktopRuntimeTarget,
} from './desktop-target.js'
import { showDesktopSetupWindow } from './setup-window.js'
import { createWidgetWindow, toggleWidgetPin, hideWidget, showWidget, getWidgetWindow } from './widget-window.js'

const electronDir = dirname(fileURLToPath(import.meta.url))

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-sandbox')

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let isQuitting = false
let trayRef: Tray | null = null

async function main(): Promise<void> {
  await app.whenReady()
  const resourcesDir = getResourcesPath()
  const userDataDir = app.getPath('userData')
  const store = new DesktopConnectionStore(
    join(userDataDir, 'desktop-connection.json'),
    createDesktopCredentialProtector(),
  )

  try {
    const profile = await resolveConnectionProfile(store)
    const target = await startRuntimeTarget(profile, store, resourcesDir)
    mainWindow = createWindow(target)
    registerDesktopIpc({ store, target, mainWindow, getWidgetWindow })
    setupWidgetIpc(target)
    if (target.widgetEnabled) {
      createWidgetWindow({ target, electronDir, userDataDir })
    }
    attachMainWindowLoadRecovery(mainWindow, target, store)
    void mainWindow.loadURL(createDesktopUrl(target))
    createTray(target.widgetEnabled)
  } catch (error) {
    if (error instanceof Error && error.message === '首次启动设置已取消') {
      app.quit()
      return
    }
    dialog.showErrorBox('AI IDE Studio 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  }
}

async function resolveConnectionProfile(store: DesktopConnectionStore): Promise<DesktopConnectionProfile> {
  const existing = store.load()
  if (existing) return existing
  return store.save(await showSetupWindow())
}

async function startRuntimeTarget(
  initialProfile: DesktopConnectionProfile,
  store: DesktopConnectionStore,
  resourcesDir: string,
): Promise<DesktopRuntimeTarget> {
  let profile = initialProfile
  while (profile.mode === 'remote') {
    try {
      await probeDesktopConnection(profile.remoteOrigin ?? '', profile.token ?? '')
      return createRemoteTarget(profile)
    } catch (error) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '无法连接远程服务器',
        message: error instanceof Error ? error.message : String(error),
        detail: profile.remoteOrigin,
        buttons: ['修改连接', '重试', '退出'],
        defaultId: 1,
        cancelId: 2,
      })
      if (result.response === 1) continue
      if (result.response === 2) throw new Error('首次启动设置已取消')
      profile = store.save(await showSetupWindow())
    }
  }

  const port = await findAvailablePort(Number(process.env.PORT || '18800'))
  const token = randomBytes(24).toString('hex')
  const dataDir = process.env.AI_IDE_PORTABLE === '1'
    ? join(resourcesDir, 'data')
    : join(app.getPath('userData'), 'data')
  backendProcess = startBackend(port, token, dataDir, resourcesDir)
  await waitForHealth(port, token)
  return createManagedLocalTarget(port, token, profile.widgetEnabled)
}

function showSetupWindow() {
  return showDesktopSetupWindow({
    preloadPath: join(electronDir, 'setup-preload.js'),
    validateRemote: async (origin, token) => { await probeDesktopConnection(origin, token) },
  })
}

function startBackend(port: number, token: string, dataDir: string, resourcesDir: string): ChildProcess {
  const packagedEntry = join(resourcesDir, 'app', 'electron', 'backend-main.js')
  const fallbackEntry = join(app.getAppPath(), 'electron', 'backend-main.js')
  const launch = createBackendLaunchOptions({
    command: resolveBackendNodeCommand({ resourcesDir }),
    entryPath: existsSync(packagedEntry) ? packagedEntry : fallbackEntry,
    port,
    token,
    dataDir,
    resourcesDir,
    baseEnv: process.env,
    appDir: app.getAppPath(),
  })
  const child = spawn(launch.command, launch.args, {
    env: launch.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.on('exit', (code) => {
    if (code !== 0 && !isQuitting) {
      dialog.showErrorBox('AI IDE Studio 后端已退出', `后端进程异常退出，退出码：${code ?? 'unknown'}`)
    }
  })
  return child
}

function createWindow(target: DesktopRuntimeTarget): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: join(electronDir, 'desktop-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  restrictWindowNavigation(window, target.origin)
  window.on('closed', () => { mainWindow = null })
  return window
}

function setupWidgetIpc(target: DesktopRuntimeTarget): void {
  ipcMain.handle('widget:toggle-pin', (event) => {
    assertTrustedWidgetSender(event, target)
    return toggleWidgetPin()
  })
  ipcMain.handle('widget:minimize', (event) => {
    assertTrustedWidgetSender(event, target)
    return hideWidget()
  })
  ipcMain.handle('widget:open-main', (event, destination?: { projectId?: string | null; sessionId?: string | null }) => {
    assertTrustedWidgetSender(event, target)
    if (destination?.sessionId) {
      const url = new URL('/workspace', `${target.origin}/`)
      url.searchParams.set('sessionId', destination.sessionId)
      if (destination.projectId) url.searchParams.set('projectId', destination.projectId)
      void mainWindow?.loadURL(url.toString())
    }
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function assertTrustedWidgetSender(
  event: IpcMainInvokeEvent,
  target: DesktopRuntimeTarget,
): void {
  const widget = getWidgetWindow()
  const trusted = widget && isTrustedDesktopIpcSender({
    senderId: event.sender.id,
    allowedSenderIds: new Set([widget.webContents.id]),
    isMainFrame: event.senderFrame === event.sender.mainFrame,
    frameUrl: event.senderFrame?.url ?? '',
    allowedOrigin: target.origin,
    allowedPath: isWidgetPath,
  })
  if (!trusted) throw new Error('不允许从当前页面操作 Widget')
}

function attachMainWindowLoadRecovery(
  window: BrowserWindow,
  target: DesktopRuntimeTarget,
  store: DesktopConnectionStore,
): void {
  let dialogOpen = false
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || dialogOpen) return
    dialogOpen = true
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: '页面加载失败',
      message: errorDescription,
      buttons: ['重试', '修改连接', '退出'],
      defaultId: 0,
      cancelId: 2,
    }).then(async (result) => {
      if (result.response === 0) await window.loadURL(createDesktopUrl(target))
      if (result.response === 1) {
        store.save(await showSetupWindow())
        app.relaunch()
        app.quit()
      }
      if (result.response === 2) app.quit()
    }).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === '首次启动设置已取消')) {
        dialog.showErrorBox('连接设置失败', error instanceof Error ? error.message : String(error))
      }
    }).finally(() => { dialogOpen = false })
  })
}

function createTray(widgetEnabled: boolean): void {
  const iconPath = join(electronDir, 'icon-16.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  trayRef = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 128)) : icon)
  trayRef.setToolTip('AI IDE Studio')
  const items: MenuItemConstructorOptions[] = [
    { label: '显示主窗口', click: showMainWindow },
  ]
  if (widgetEnabled) items.push({ label: '显示/隐藏 Widget', click: toggleWidgetVisibility })
  items.push({ type: 'separator' }, { label: '退出', click: () => app.quit() })
  trayRef.setContextMenu(Menu.buildFromTemplate(items))
  trayRef.on('click', widgetEnabled ? toggleWidgetVisibility : showMainWindow)
}

function showMainWindow(): void {
  mainWindow?.show()
  mainWindow?.focus()
}

function toggleWidgetVisibility(): void {
  const widget = getWidgetWindow()
  if (widget?.isVisible()) hideWidget()
  else showWidget()
}

async function waitForHealth(port: number, token: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { 'x-ai-ide-token': token },
      })
      if (response.ok) return
    } catch {
      // The backend process may still be binding its port.
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error('后端服务启动超时')
}

async function findAvailablePort(preferred: number): Promise<number> {
  if (await canListen(preferred)) return preferred
  for (let port = preferred + 1; port < preferred + 100; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error('找不到可用本地端口')
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

function getResourcesPath(): string {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string }
  return processWithResources.resourcesPath ?? app.getAppPath()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  isQuitting = true
  backendProcess?.kill()
})

void main()
