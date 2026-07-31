export interface MainWindowNavigationTarget {
  webContents: {
    getURL(): string
    isLoadingMainFrame(): boolean
    send(channel: string, path: string): void
  }
  loadURL(url: string): Promise<unknown>
}

export interface MainWindowPresentationTarget {
  on(event: string, listener: () => void): void
  isMaximized(): boolean
  isFullScreen(): boolean
  isMinimized(): boolean
  restore(): void
  maximize(): void
  setFullScreen(value: boolean): void
  show(): void
  focus(): void
}

export interface MainWindowPresentation {
  showAndFocus(): void
}

export async function navigateMainWindow(
  window: MainWindowNavigationTarget,
  origin: string,
  path: string,
  requestRendererNavigation?: (path: string) => Promise<void>,
): Promise<'renderer' | 'reload'> {
  if (isRendererReady(window, origin)) {
    try {
      if (requestRendererNavigation) await requestRendererNavigation(path)
      else window.webContents.send('desktop:navigate', path)
      return 'renderer'
    } catch {
      // Fall through to a full load only when the live renderer does not acknowledge navigation.
    }
  }
  await window.loadURL(new URL(path, `${origin}/`).toString())
  return 'reload'
}

export function createMainWindowPresentation(
  window: MainWindowPresentationTarget,
): MainWindowPresentation {
  let wasMaximized = window.isMaximized()
  let wasFullScreen = window.isFullScreen()
  window.on('maximize', () => { wasMaximized = true })
  window.on('unmaximize', () => { wasMaximized = false })
  window.on('enter-full-screen', () => { wasFullScreen = true })
  window.on('leave-full-screen', () => { wasFullScreen = false })

  return {
    showAndFocus(): void {
      if (window.isMinimized()) window.restore()
      window.show()
      if (wasFullScreen && !window.isFullScreen()) window.setFullScreen(true)
      else if (wasMaximized && !window.isMaximized()) window.maximize()
      window.focus()
    },
  }
}

function isRendererReady(window: MainWindowNavigationTarget, origin: string): boolean {
  if (window.webContents.isLoadingMainFrame()) return false
  try {
    return new URL(window.webContents.getURL()).origin === new URL(origin).origin
  } catch {
    return false
  }
}
