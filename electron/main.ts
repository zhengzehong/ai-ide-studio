import { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createBackendLaunchOptions, resolveBackendNodeCommand } from './backend-launch.js'
import { createWidgetWindow, toggleWidgetPin, hideWidget, showWidget, getWidgetWindow } from './widget-window.js'

const electronDir = dirname(fileURLToPath(import.meta.url))

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-sandbox')

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let isQuitting = false

async function main(): Promise<void> {
  await app.whenReady()

  const resourcesDir = getResourcesPath()
  const port = await findAvailablePort(Number(process.env.PORT || '18800'))
  const token = randomBytes(24).toString('hex')
  const dataDir = process.env.AI_IDE_PORTABLE === '1'
    ? join(resourcesDir, 'data')
    : join(app.getPath('userData'), 'data')

  backendProcess = startBackend(port, token, dataDir, resourcesDir)

  try {
    await waitForHealth(port, token)
    mainWindow = createWindow(port, token)

    const userDataDir = app.getPath('userData')
    createWidgetWindow({ port, token, electronDir, userDataDir })
    setupWidgetIpc()
    createTray(port, token)
  } catch (err) {
    dialog.showErrorBox('AI IDE Studio 启动失败', err instanceof Error ? err.message : String(err))
    app.quit()
  }
}

function startBackend(port: number, token: string, dataDir: string, resourcesDir: string): ChildProcess {
  const entry = join(resourcesDir, 'app', 'electron', 'backend-main.js')
  const fallbackEntry = join(app.getAppPath(), 'electron', 'backend-main.js')
  const entryPath = existsSync(entry) ? entry : fallbackEntry
  const launch = createBackendLaunchOptions({
    command: resolveBackendNodeCommand({ resourcesDir }),
    entryPath,
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

function createWindow(port: number, token: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: join(electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  void win.loadURL(`http://127.0.0.1:${port}/?token=${token}`)
  win.on('closed', () => { mainWindow = null })
  return win
}

async function waitForHealth(port: number, token: string): Promise<void> {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health?token=${token}`)
      if (res.ok) return
    } catch {
      // wait and retry
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
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
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

function setupWidgetIpc(): void {
  ipcMain.handle('widget:toggle-pin', () => toggleWidgetPin())
  ipcMain.handle('widget:minimize', () => hideWidget())
  ipcMain.handle('widget:open-main', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function createTray(_port: number, _token: string): void {
  const iconPath = join(electronDir, 'icon-16.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  const tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(16 * 16 * 4, 128)) : icon)

  tray.setToolTip('AI IDE Studio')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        },
      },
      {
        label: '显示/隐藏部件',
        click: () => {
          const widget = getWidgetWindow()
          if (widget?.isVisible()) hideWidget()
          else showWidget()
        },
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )

  tray.on('click', () => {
    const widget = getWidgetWindow()
    if (widget?.isVisible()) hideWidget()
    else showWidget()
  })
}

void main()
