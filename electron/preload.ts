import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronSetup', {
  submit: (input: unknown) => ipcRenderer.invoke('desktop:first-run-submit', input),
})

contextBridge.exposeInMainWorld('electronDesktop', {
  getBootstrap: () => ipcRenderer.sendSync('desktop:get-bootstrap'),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  testConnection: (input: unknown) => ipcRenderer.invoke('desktop:test-connection', input),
  saveSettings: (input: unknown) => ipcRenderer.invoke('desktop:save-settings', input),
})

contextBridge.exposeInMainWorld('electronWidget', {
  togglePin: () => ipcRenderer.invoke('widget:toggle-pin'),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  openMain: (target?: { projectId?: string | null; sessionId?: string | null }) => ipcRenderer.invoke('widget:open-main', target),
})
