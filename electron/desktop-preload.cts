import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronDesktop', {
  getBootstrap: () => ipcRenderer.sendSync('desktop:get-bootstrap'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  testConnection: (input: unknown) => ipcRenderer.invoke('desktop:test-connection', input),
  saveSettings: (input: unknown) => ipcRenderer.invoke('desktop:save-settings', input),
})
