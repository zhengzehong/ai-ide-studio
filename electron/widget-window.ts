import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

let widgetWindow: BrowserWindow | null = null

interface WidgetConfig {
  port: number
  token: string
  electronDir: string
  userDataDir: string
}

const WIDGET_WIDTH = 300
const WIDGET_HEIGHT = 380

function getBoundsPath(userDataDir: string): string {
  return join(userDataDir, 'widget-bounds.json')
}

function loadWidgetBounds(userDataDir: string): { x: number; y: number } | null {
  try {
    const filePath = getBoundsPath(userDataDir)
    if (!existsSync(filePath)) return null
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (typeof data.x === 'number' && typeof data.y === 'number') return data
    return null
  } catch {
    return null
  }
}

function saveWidgetBounds(userDataDir: string, bounds: { x: number; y: number }): void {
  try {
    const dir = userDataDir
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(getBoundsPath(dir), JSON.stringify({ x: bounds.x, y: bounds.y }))
  } catch {
    // ignore save errors
  }
}

export function createWidgetWindow(config: WidgetConfig): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const savedBounds = loadWidgetBounds(config.userDataDir)

  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x: savedBounds?.x ?? workAreaSize.width - WIDGET_WIDTH - 20,
    y: savedBounds?.y ?? workAreaSize.height - WIDGET_HEIGHT - 20,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: join(config.electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  widgetWindow.loadURL(
    `http://127.0.0.1:${config.port}/widget?token=${config.token}`,
  )

  widgetWindow.on('moved', () => {
    if (widgetWindow) {
      const bounds = widgetWindow.getBounds()
      saveWidgetBounds(config.userDataDir, { x: bounds.x, y: bounds.y })
    }
  })

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })

  return widgetWindow
}

export function getWidgetWindow(): BrowserWindow | null {
  return widgetWindow
}

export function toggleWidgetPin(): void {
  if (!widgetWindow) return
  const current = widgetWindow.isAlwaysOnTop()
  widgetWindow.setAlwaysOnTop(!current)
}

export function hideWidget(): void {
  widgetWindow?.hide()
}

export function showWidget(): void {
  widgetWindow?.show()
}
