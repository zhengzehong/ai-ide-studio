import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronSetup', {
  submit: (input: unknown) => ipcRenderer.invoke('desktop:first-run-submit', input),
})
