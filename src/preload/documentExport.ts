import { contextBridge, ipcRenderer } from 'electron'
import type { ComponentCompilationInput, ComponentCompilationResult } from '../core/components/compilation/types'
import type { ExportBuildReply, ExportBuildRequest } from '../shared/workbench/toolPorts'

// This isolated export worker cannot access the workbench desktop API or generic IPC.
contextBridge.exposeInMainWorld('documentExportWorkerAPI', {
  onBuildRequest(handler: (request: ExportBuildRequest) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: ExportBuildRequest) => handler(request)
    ipcRenderer.on('document-export:build-request', listener)
    return () => ipcRenderer.removeListener('document-export:build-request', listener)
  },
  reply(reply: ExportBuildReply): void { ipcRenderer.send('document-export:build-reply', reply) },
  compileComponent(input: ComponentCompilationInput): Promise<ComponentCompilationResult> {
    return ipcRenderer.invoke('document-export:compile', input)
  },
})
