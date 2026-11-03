import path from 'node:path'
import { documentHost } from './documentHost'
import { assertAuthorizedWorkspacePath } from './workspaceFilesDesktopService'
import { officeDocumentRequestSchema, type OfficeDocumentRequest, type OfficeDocumentSnapshot } from '../../shared/workbench/officeDocument'
import { OfficeFileService } from './office/OfficeFileService'
import type { OfficeFormat } from '../../shared/workbench/officeFiles'
import type { FileArtifactBinding } from '../../shared/workbench/mediaFiles'

/** Thin IPC adapter; existing OfficeFileService owns transformations and all writes/history. */
export async function operateOfficeDocument(request: OfficeDocumentRequest): Promise<OfficeDocumentSnapshot> {
  const input = officeDocumentRequestSchema.parse(request), host = documentHost()
  const filename = input.type === 'office-document.open' ? input.path : host.artifacts.resolveBinding(input.binding).path
  const authorized = await assertAuthorizedWorkspacePath(filename)
  const format = path.extname(authorized).slice(1).toLowerCase() as OfficeFormat
  if (format !== 'docx' && format !== 'xlsx') throw new Error('此编辑入口支持 DOCX、XLSX 原件')
  const service = new OfficeFileService(host)
  let diagnostics: OfficeDocumentSnapshot['diagnostics'], committed: FileArtifactBinding | undefined
  if (input.type === 'office-document.edit') {
    if (input.content.format !== format) throw new Error('修改内容格式与当前文件不一致')
    const result = await service.edit(input.binding, { ...input.content, operation: 'edit' }, {
      actor: 'human', expectedVersion: input.binding.fileVersion, historyLabel: format === 'docx' ? '编辑 Word 文稿' : '编辑 Excel 工作簿',
    })
    diagnostics = result.diagnostics; committed = result.binding
  } else if (input.type === 'office-document.undo' || input.type === 'office-document.redo') {
    committed = (await service.moveHistory(input.binding, input.type === 'office-document.undo' ? 'undo' : 'redo', { expectedVersion: input.binding.fileVersion })).binding
  }
  const binding = committed ?? await host.artifacts.bind(authorized)
  const bytes = await host.artifacts.read(binding)
  const { inspection } = await service.inspect(binding, format), history = await service.history(binding)
  await host.artifacts.read(binding)
  return { binding, bytes, inspection, history, ...(diagnostics ? { diagnostics } : {}) }
}
