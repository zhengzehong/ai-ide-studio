export function shouldHandleInteractiveSignal(ipcConnected: boolean): boolean {
  return !ipcConnected
}
