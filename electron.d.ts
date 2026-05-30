declare module 'electron' {
  export interface App {
    commandLine: {
      appendSwitch(name: string): void
    }
    disableHardwareAcceleration(): void
    whenReady(): Promise<void>
    quit(): void
    getPath(name: 'userData'): string
    getAppPath(): string
    on(event: 'window-all-closed' | 'before-quit', listener: () => void): this
  }

  export interface BrowserWindowConstructorOptions {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    webPreferences?: {
      preload?: string
      contextIsolation?: boolean
      nodeIntegration?: boolean
    }
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions)
    loadURL(url: string): Promise<void>
    on(event: 'closed', listener: () => void): this
  }

  export const app: App
  export const dialog: {
    showErrorBox(title: string, content: string): void
  }
}
