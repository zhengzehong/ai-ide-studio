import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronWidget', {
  togglePin: () => ipcRenderer.invoke('widget:toggle-pin'),
  minimize: () => ipcRenderer.invoke('widget:minimize'),
  openMain: (target?: { projectId?: string | null; sessionId?: string | null }) => ipcRenderer.invoke('widget:open-main', target),
})
