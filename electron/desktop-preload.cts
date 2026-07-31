import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('electronDesktop', {
  getBootstrap: () => ipcRenderer.sendSync('desktop:get-bootstrap'),
  onNavigate: (listener: (request: { id: string; path: string }) => void) => {
    const handler = (_event: IpcRendererEvent, request: { id: string; path: string }) => listener(request)
    ipcRenderer.on('desktop:navigate', handler)
    return () => ipcRenderer.removeListener('desktop:navigate', handler)
  },
  acknowledgeNavigation: (id: string) => ipcRenderer.send('desktop:navigation-applied', id),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  testConnection: (input: unknown) => ipcRenderer.invoke('desktop:test-connection', input),
  saveSettings: (input: unknown) => ipcRenderer.invoke('desktop:save-settings', input),
})
