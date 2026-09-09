import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nookDesktop', {
  exportNote: (request: { name: string; markdown: string }) => ipcRenderer.invoke('nook:export-note', request),
  revealExport: (id: string) => ipcRenderer.invoke('nook:reveal-export', id),
})
