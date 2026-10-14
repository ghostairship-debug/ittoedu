import type { IpcMain, IpcMainEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipcTypes'

/** GUI promotion owns these two callbacks; request workers retain their own listeners. */
export function installDocumentExportBuildListeners(ipc: Pick<IpcMain, 'on' | 'removeListener'>, callbacks: {
  progress(event: IpcMainEvent, raw: unknown): void
  reply(event: IpcMainEvent, raw: unknown): void
}): () => void {
  ipc.on(IPC_CHANNELS.documentExportBuildProgress, callbacks.progress)
  ipc.on(IPC_CHANNELS.documentExportBuildReply, callbacks.reply)
  return () => {
    ipc.removeListener(IPC_CHANNELS.documentExportBuildProgress, callbacks.progress)
    ipc.removeListener(IPC_CHANNELS.documentExportBuildReply, callbacks.reply)
  }
}
