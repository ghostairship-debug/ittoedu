import { dialog, type BrowserWindow } from 'electron'
import type { DocumentHostService } from './DocumentHostService'
import type { WorkspaceFilesRequest, WorkspaceOperationResult } from '../../shared/workbench/workspaceFiles'
import { executionDesktopService } from './execution/ExecutionDesktopService'
import { externalMcpService } from './external/externalDesktopService'
import { operateWorkspaceFiles } from './workspaceFilesDesktopService'
import { workspaceTrashFlow } from './workspaceTrashFlow'

const pending = new Map<string, Promise<WorkspaceOperationResult>>()
export function trashWorkspaceWithDialog(window: BrowserWindow, documents: DocumentHostService, input: Extract<WorkspaceFilesRequest, { type: 'trash' }>) {
  const prior = pending.get(input.operationId)
  if (prior) return prior
  const operation = (async () => {
    const execution = await executionDesktopService(), external = await externalMcpService()
    return workspaceTrashFlow(input.operationId, {
      entries: () => Promise.all(input.entryIds.map(entryId => operateWorkspaceFiles({ type: 'resolve', workspaceId: input.workspaceId, entryId }))),
      documents: async () => documents.registry.list(),
      hasWriters: async id => { const tasks = await execution.writableTasksForDocument(id)
        return Boolean(tasks.runIds.length || tasks.submissionIds.length || external.writableConnectionsForDocument(id).length) },
      confirm: async ({ entries, documents: affected, hasWriters }) => (await dialog.showMessageBox(window, {
        type: 'question', title: '移入回收站', message: `将 ${entries.length} 个项目移入系统回收站？`,
        detail: [hasWriters ? '确认后将停止这些文档的写入任务并撤销外部写权限。' : '',
          affected.length ? '已打开文档保留为未命名稿，未保存内容和撤销记录都会保留；之后保存需要选择新位置。' : '可在系统回收站中恢复原文件。'].filter(Boolean).join('\n'),
        buttons: ['移入回收站', '取消'], defaultId: 1, cancelId: 1, noLink: true,
      })).response === 0,
      withBarrier: (ids, work) => documents.tools.withWriteTaskBarrier(ids, work),
      stopWriters: async id => { await execution.stopTasksForDocument(id); await external.stopForDocument(id) },
      trash: () => operateWorkspaceFiles(input),
    })
  })()
  pending.set(input.operationId, operation)
  void operation.finally(() => { if (pending.get(input.operationId) === operation) pending.delete(input.operationId) }).catch(() => undefined)
  return operation
}
