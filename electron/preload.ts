import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronWidget', {
  togglePin: () => ipcRenderer.invoke('widget:toggle-pin'),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  openMain: () => ipcRenderer.invoke('widget:open-main'),
})
