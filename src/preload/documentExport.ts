import { contextBridge, ipcRenderer } from 'electron'
import type { ComponentCompilationInput, ComponentCompilationResult } from '../core/components/compilation/types'
import type { ExportBuildReply, ExportBuildRequest, ExportBuildCancel, ExportBuildProgress } from '../shared/workbench/toolPorts'
import type { CaptureObservationInput } from '../shared/ipcTypes'

// This isolated export worker cannot access the workbench desktop API or generic IPC.
contextBridge.exposeInMainWorld('documentExportWorkerAPI', {
  onBuildRequest(handler: (request: ExportBuildRequest) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: ExportBuildRequest) => handler(request)
    ipcRenderer.on('document-export:build-request', listener)
    return () => ipcRenderer.removeListener('document-export:build-request', listener)
  },
  reply(reply: ExportBuildReply): void { ipcRenderer.send('document-export:build-reply', reply) },
  onBuildCancel(handler: (cancel: ExportBuildCancel) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, cancel: ExportBuildCancel) => handler(cancel)
    ipcRenderer.on('document-export:build-cancel', listener)
    return () => ipcRenderer.removeListener('document-export:build-cancel', listener)
  },
  progress(progress: ExportBuildProgress): void { ipcRenderer.send('document-export:build-progress', progress) },
  compileComponent(input: ComponentCompilationInput): Promise<ComponentCompilationResult> {
    return ipcRenderer.invoke('document-export:compile', input)
  },
  capturePublished(input: { requestId: string; identity: ExportBuildRequest['identity']; capture: Extract<CaptureObservationInput, { kind: 'published' }> }): Promise<{ dataUrl: string; width: number; height: number }> {
    return ipcRenderer.invoke('document-export:capture-published', input)
  },
})
