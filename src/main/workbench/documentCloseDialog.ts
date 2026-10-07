import { randomUUID } from 'node:crypto'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcTypes'
import { saveDirectoryContextSchema } from '../../shared/workbench/desktop'
import type { DocumentHostService } from './DocumentHostService'
import { closeDocumentFlow } from './documentCloseFlow'
import { saveDocumentWithDialog } from './documentSaveDialog'
import type { SaveDirectoryContext } from '../../shared/workbench/desktop'
import { executionDesktopService } from './execution/ExecutionDesktopService'
import { externalMcpService } from './external/externalDesktopService'

const pending = new Map<string, Promise<boolean>>()
export function closeDocumentWithDialog(window: BrowserWindow, documents: DocumentHostService, documentId: string, suggestedDirectory?: SaveDirectoryContext, discardOnly = false): Promise<boolean> {
  const existing = pending.get(documentId)
  if (existing) return existing
  const operation = (async () => {
    const execution = await executionDesktopService(), external = await externalMcpService()
    let closed = false
    const controller = new AbortController()
    try { closed = await closeDocumentFlow({
      discardOnly,
      prepareRenderer: async mode => {
        const result = await requestRendererBeforeClose(window, mode, controller.signal, undefined, [documentId])
        if (result.suggestedDirectory) suggestedDirectory = result.suggestedDirectory
        return result.ready
      },
      read: () => documents.registry.get(documentId).drain(),
      hasWritableTasks: async () => {
        const active = await execution.writableTasksForDocument(documentId)
        return Boolean(active.runIds.length || active.submissionIds.length || external.writableSessionsForDocument(documentId).length)
      },
      confirmStop: async () => (await dialog.showMessageBox(window, { type: 'question', title: '关闭正在修改的文档',
        message: '此文档还有可写任务或外部授权。停止这些任务后关闭文档？',
        detail: '已经应用的修改会保留。仅隐藏内容区不会停止任务。', buttons: ['停止并关闭', '继续编辑'], defaultId: 1, cancelId: 1 })).response === 0,
      stopWritableTasks: async () => { await execution.stopTasksForDocument(documentId); await external.stopForDocument(documentId) },
      chooseDirty: async snapshot => {
        const name = snapshot.binding.kind === 'file' ? snapshot.binding.path : snapshot.binding.suggestedName
        if (discardOnly) {
          const result = await dialog.showMessageBox(window, { type: 'warning', title: '放弃未保存更改',
            message: `放弃“${name}”的未保存更改并关闭？`, detail: '包括尚未确认的输入；磁盘原文件不会删除，已完成的保存不会回退。',
            buttons: ['放弃未保存更改并关闭', '取消'], defaultId: 1, cancelId: 1, noLink: true })
          return result.response === 0 ? 'discard' : 'cancel'
        }
        const result = await dialog.showMessageBox(window, { type: 'question', title: '保存文档更改', message: `关闭前保存“${name}”的更改？`,
          buttons: ['保存并关闭', '放弃未保存更改', '取消'], defaultId: 0, cancelId: 2, noLink: true })
        return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
      },
      save: () => saveDocumentWithDialog(window, documents, documentId, false, suggestedDirectory),
      withBarrier: work => documents.tools.withWriteTaskBarrier([documentId], work),
      close: async (snapshot, discardDirty) => { await documents.operate({ type: 'close', documentId, discardDirty,
        expected: { epoch: snapshot.epoch, revision: snapshot.revision } }) },
    }); return closed }
    finally {
      controller.abort()
      if (!closed && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.requestResumeClose, [documentId])
    }
  })()
  pending.set(documentId, operation)
  void operation.finally(() => { if (pending.get(documentId) === operation) pending.delete(documentId) }).catch(() => undefined)
  return operation
}

export function requestRendererBeforeClose(window: BrowserWindow, mode: 'save' | 'preserve' | 'discard', signal: AbortSignal, onWaiting?: () => void, documentIds?: readonly string[]): Promise<{ ready: boolean; suggestedDirectory?: SaveDirectoryContext }> {
  const requestId = randomUUID()
  const resultChannel = mode === 'discard' ? IPC_CHANNELS.discardAndCloseResult : mode === 'save' ? IPC_CHANNELS.saveAndCloseResult : IPC_CHANNELS.preserveAndCloseResult
  const requestChannel = mode === 'discard' ? IPC_CHANNELS.requestDiscardAndClose : mode === 'save' ? IPC_CHANNELS.requestSaveAndClose : IPC_CHANNELS.requestPreserveAndClose
  return new Promise((resolve) => {
    let settled = false
    // This is an offered recovery choice, not a timeout or automatic discard.
    const waiting = setTimeout(() => { if (!settled) onWaiting?.() }, 3_000)
    const finish = (ready: boolean, suggestedDirectory?: SaveDirectoryContext) => {
      if (settled) return
      settled = true
      clearTimeout(waiting)
      signal.removeEventListener('abort', onClosed)
      ipcMain.removeListener(resultChannel, onResult)
      window.removeListener('closed', onClosed)
      resolve({ ready, ...(suggestedDirectory ? { suggestedDirectory } : {}) })
    }
    const onResult = (
      event: Electron.IpcMainEvent,
      receivedRequestId: unknown,
      saved: unknown,
      directory: unknown,
    ) => {
      if (event.sender !== window.webContents || receivedRequestId !== requestId) return
      if (directory === undefined) { finish(saved === true); return }
      const parsed = saveDirectoryContextSchema.safeParse(directory)
      if (!parsed.success) { finish(false); return }
      finish(saved === true, parsed.data)
    }
    const onClosed = () => finish(false)
    signal.addEventListener('abort', onClosed, { once: true })
    if (signal.aborted) { finish(false); return }
    ipcMain.on(resultChannel, onResult)
    window.once('closed', onClosed)
    try {
      window.webContents.send(requestChannel, requestId, documentIds)
    } catch (error) {
      console.error('发送关闭前保存请求失败', error)
      finish(false)
    }
  })
}
