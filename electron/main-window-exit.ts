export interface MainWindowCloseSource {
  on(event: 'closed', listener: () => void): void
}

export interface MainWindowExitActions {
  clearMainWindow(): void
  isQuitting(): boolean
  quitApp(): void
}

export function attachMainWindowExit(
  window: MainWindowCloseSource,
  actions: MainWindowExitActions,
): void {
  window.on('closed', () => {
    actions.clearMainWindow()
    if (!actions.isQuitting()) actions.quitApp()
  })
}

