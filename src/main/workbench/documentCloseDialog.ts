import { dialog, type BrowserWindow } from 'electron'
import type { DocumentHostService } from './DocumentHostService'
import { closeDocumentFlow } from './documentCloseFlow'
import { saveDocumentWithDialog } from './documentSaveDialog'
import type { SaveDirectoryContext } from '../../shared/workbench/desktop'
import { executionDesktopService } from './execution/ExecutionDesktopService'
import { externalMcpService } from './external/externalDesktopService'

const pending = new Map<string, Promise<boolean>>()
export function closeDocumentWithDialog(window: BrowserWindow, documents: DocumentHostService, documentId: string, suggestedDirectory?: SaveDirectoryContext): Promise<boolean> {
  const existing = pending.get(documentId)
  if (existing) return existing
  const operation = (async () => {
    const execution = await executionDesktopService(), external = await externalMcpService()
    return closeDocumentFlow({
      read: () => documents.registry.get(documentId).drain(),
      hasWritableTasks: async () => {
        const active = await execution.writableTasksForDocument(documentId)
        return Boolean(active.runIds.length || active.submissionIds.length || external.writableConnectionsForDocument(documentId).length)
      },
      confirmStop: async () => (await dialog.showMessageBox(window, { type: 'question', title: '关闭正在修改的文档',
        message: '此文档还有可写任务或外部授权。停止这些任务后关闭文档？',
        detail: '已经应用的修改会保留。仅隐藏内容区不会停止任务。', buttons: ['停止并关闭', '继续编辑'], defaultId: 1, cancelId: 1 })).response === 0,
      stopWritableTasks: async () => { await execution.stopTasksForDocument(documentId); await external.stopForDocument(documentId) },
      chooseDirty: async snapshot => {
        const name = snapshot.binding.kind === 'file' ? snapshot.binding.path : snapshot.binding.suggestedName
        const result = await dialog.showMessageBox(window, { type: 'question', title: '保存文档更改', message: `关闭前保存“${name}”的更改？`,
          buttons: ['保存并关闭', '放弃未保存更改', '取消'], defaultId: 0, cancelId: 2, noLink: true })
        return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
      },
      save: () => saveDocumentWithDialog(window, documents, documentId, false, suggestedDirectory),
      withBarrier: work => documents.tools.withWriteTaskBarrier([documentId], work),
      close: async (snapshot, discardDirty) => { await documents.operate({ type: 'close', documentId, discardDirty,
        expected: { epoch: snapshot.epoch, revision: snapshot.revision } }) },
    })
  })()
  pending.set(documentId, operation)
  void operation.finally(() => { if (pending.get(documentId) === operation) pending.delete(documentId) }).catch(() => undefined)
  return operation
}
