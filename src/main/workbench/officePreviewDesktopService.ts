import path from 'node:path'
import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { docxPreviewRequestSchema, pptxPreviewRequestSchema, type DocxPreviewRequest, type DocxPreviewSnapshot,
  type PptxPreviewRequest, type PptxPreviewSnapshot } from '../../shared/workbench/officePreview'
import { documentHost } from './documentHost'
import { assertAuthorizedWorkspacePath } from './workspaceFilesDesktopService'
import { OfficeFileService } from './office/OfficeFileService'
import { inspectOfficeContentOffThread } from './office/officeContentWorker'
import { WordPreviewService } from './office/WordPreviewService'
import { createWordPreviewConverter, WordLayoutRuntime } from './office/WordLayoutRuntime'

/** Reads and human object edits share authorization, the physical file owner and Office mechanics. */
export async function readPptxPreview(request: PptxPreviewRequest): Promise<PptxPreviewSnapshot> {
  const input = pptxPreviewRequestSchema.parse(request), artifacts = documentHost().artifacts
  const writing = input.type !== 'pptx-preview.open' && input.type !== 'pptx-preview.reload'
  // Reload obtains the latest version of an authorized path. Writes still require
  // the actually issued binding and the physical compare-and-swap boundary.
  const filename = input.type === 'pptx-preview.open' ? input.path
    : writing ? artifacts.resolveBinding(input.binding).path : input.binding.path
  const authorized = await assertAuthorizedWorkspacePath(filename)
  if (path.extname(authorized).toLowerCase() !== '.pptx') throw new Error('此预览入口仅支持 PPTX 文件')
  const office = new OfficeFileService(documentHost())
  if (input.type === 'pptx-preview.edit') {
    if (input.content.format !== 'pptx') throw new Error('演示文稿对象编辑需要 PPTX 内容请求')
    await office.edit(input.binding, { ...input.content, operation: 'edit' }, {
      actor: 'human', expectedVersion: input.binding.fileVersion, historyLabel: '手动编辑演示文稿',
    })
  } else if (input.type === 'pptx-preview.undo' || input.type === 'pptx-preview.redo') {
    await office.moveHistory(input.binding, input.type === 'pptx-preview.undo' ? 'undo' : 'redo', { expectedVersion: input.binding.fileVersion })
  }
  const binding = await artifacts.bind(authorized)
  const bytes = await artifacts.read(binding)
  const snapshot: PptxPreviewSnapshot = { binding, bytes }
  try {
    const inspection = await inspectOfficeContentOffThread(bytes, 'pptx')
    if (inspection.format !== 'pptx') throw new Error('未找到演示文稿对象')
    snapshot.inspection = inspection
    snapshot.history = await office.history(binding)
  } catch (reason) {
    snapshot.editingError = `原件对象编辑暂不可用：${reason instanceof Error ? reason.message : String(reason)}`
  }
  // Inspector/history await worker IO. Do not publish old bytes after another
  // writer has replaced them while we were preparing the projection.
  await artifacts.read(binding)
  return snapshot
}

let wordRuntime: WordLayoutRuntime | undefined
function wordLayoutRuntime(): WordLayoutRuntime {
  return wordRuntime ??= new WordLayoutRuntime({
    directory: path.join(app.getPath('userData'), 'workbench-v2', 'word-layout'),
    extractorPath: path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'office-extractor', 'win-x64', '7z.exe'),
    download: (url, signal) => net.fetch(url, { signal }),
  })
}

/** Word preview is a disposable read projection; it has no original-file writer. */
export async function readDocxPreview(request: DocxPreviewRequest, options: { signal?: AbortSignal; log?(line: string): void } = {}): Promise<DocxPreviewSnapshot> {
  const input = docxPreviewRequestSchema.parse(request), artifacts = documentHost().artifacts
  const filename = input.type === 'docx-preview.open' ? input.path : input.binding.path
  const authorized = await assertAuthorizedWorkspacePath(filename)
  if (path.extname(authorized).toLowerCase() !== '.docx') throw new Error('此分页预览入口仅支持 DOCX 原件')
  const binding = await artifacts.bind(authorized), bytes = await artifacts.read(binding, options.signal)
  options.log?.('正在为 Word 原件排版…')
  const service = new WordPreviewService(path.join(app.getPath('temp'), 'guoling-word-preview'),
    createWordPreviewConverter(wordLayoutRuntime(), { log: options.log }))
  const preview = await service.render(bytes, { signal: options.signal })
  const current = await artifacts.read(binding, options.signal)
  if (createHash('sha256').update(current).digest('hex') !== preview.sourceSha256)
    throw new Error('排版期间 Word 原件已改变，请重新载入最新版本。')
  options.signal?.throwIfAborted()
  return { binding, ...preview }
}
