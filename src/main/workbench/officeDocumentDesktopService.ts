import path from 'node:path'
import { documentHost } from './documentHost'
import { assertAuthorizedWorkspacePath } from './workspaceFilesDesktopService'
import { officeDocumentRequestSchema, type OfficeDocumentRequest, type OfficeDocumentSnapshot } from '../../shared/workbench/officeDocument'
import { OfficeFileService } from './office/OfficeFileService'
import type { OfficeFormat } from '../../shared/workbench/officeFiles'
import type { FileArtifactBinding } from '../../shared/workbench/mediaFiles'

/** Thin IPC adapter; existing OfficeFileService owns transformations and all writes/history. */
export async function operateOfficeDocument(request: OfficeDocumentRequest): Promise<OfficeDocumentSnapshot | undefined> {
  const input = officeDocumentRequestSchema.parse(request), host = documentHost()
  const service = new OfficeFileService(host)
  if (input.type === 'office-document.close') {
    // Closing only releases the main-owned session. The original may have
    // been moved to trash after the editor opened it.
    await service.closeWorking(input.path, input.discard)
    return
  }
  const filename = input.type === 'office-document.open' ? input.path : host.artifacts.resolveBinding(service.baseBinding(input.binding)).path
  const authorized = await assertAuthorizedWorkspacePath(filename)
  const format = path.extname(authorized).slice(1).toLowerCase() as OfficeFormat
  if (format !== 'docx' && format !== 'xlsx') throw new Error('此编辑入口支持 DOCX、XLSX 原件')
  let diagnostics: OfficeDocumentSnapshot['diagnostics'], committed: FileArtifactBinding | undefined
  let inspection: OfficeDocumentSnapshot['inspection'] | undefined
  if (input.type === 'office-document.edit') {
    if (input.content.format !== format) throw new Error('修改内容格式与当前文件不一致')
    const result = await service.edit(input.binding, { ...input.content, operation: 'edit' }, {
      actor: 'human', expectedVersion: input.binding.fileVersion, historyLabel: format === 'docx' ? '编辑 Word 文稿' : '编辑 Excel 工作簿',
    })
    diagnostics = result.diagnostics; committed = result.binding; inspection = result.inspection
  } else if (input.type === 'office-document.undo' || input.type === 'office-document.redo') {
    const result = await service.moveHistory(input.binding, input.type === 'office-document.undo' ? 'undo' : 'redo', { expectedVersion: input.binding.fileVersion })
    committed = result.binding; inspection = result.inspection
  } else if (input.type === 'office-document.save') {
    committed = await service.saveWorking(input.binding)
  }
  const binding = committed ?? await service.bindWorking(authorized, input.type === 'office-document.open' && input.draft)
  const bytes = await service.readWorking(binding)
  inspection ??= (await service.inspect(binding, format)).inspection
  const history = await service.history(binding)
  await service.readWorking(binding)
  return { binding, bytes, inspection, history, draftDirty: service.isDraftDirty(binding.path), ...(diagnostics ? { diagnostics } : {}) }
}
