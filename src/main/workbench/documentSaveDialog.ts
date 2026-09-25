import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { SaveDirectoryContext } from '../../shared/workbench/desktop'
import type { DocumentHostService } from './DocumentHostService'
import { operateWorkspaceFiles } from './workspaceFilesDesktopService'

/** Shared by explicit Save/Save As and window-wide Save and Close. */
export async function saveDocumentWithDialog(
  window: BrowserWindow,
  documents: DocumentHostService,
  documentId: string,
  saveAs = false,
  suggestedDirectory?: SaveDirectoryContext,
): Promise<DocumentSnapshot | null> {
  const current = await documents.registry.get(documentId).drain()
  if (!saveAs && current.binding.kind === 'file') return documents.saveToPath(documentId)
  const extension = current.model.kind === 'markdown' ? 'md' : 'h5lesson'
  let defaultPath: string
  if (current.binding.kind === 'file') defaultPath = current.binding.path
  else {
    let directory: string
    if (suggestedDirectory) {
      const resolved = await operateWorkspaceFiles({ type: 'resolve', workspaceId: suggestedDirectory.workspaceId, entryId: suggestedDirectory.directoryEntryId })
      if (resolved.kind !== 'directory') throw new Error('当前保存位置不是文件夹，请重新选择目录')
      directory = resolved.resolvedPath
    } else {
      directory = path.join(app.getPath('userData'), 'workbench-v2', 'space')
      await fs.mkdir(directory, { recursive: true })
    }
    defaultPath = path.join(directory, path.basename(current.binding.suggestedName))
  }
  const result = await dialog.showSaveDialog(window, {
    title: saveAs ? '另存文档' : '保存文档',
    defaultPath,
    filters: [{ name: current.model.kind === 'markdown' ? 'Markdown 文档' : '果铃课件', extensions: [extension] }],
    properties: ['showOverwriteConfirmation'],
  })
  if (result.canceled || !result.filePath) return null
  return documents.saveToPath(documentId, result.filePath, true)
}
