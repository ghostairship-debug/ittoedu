import path from 'node:path'
import { promises as fs } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import type { FileArtifactSaveAsRequest, FileArtifactSaveAsResult } from '../../shared/workbench/fileArtifactSaveAs'
import { documentHost } from './documentHost'
import { assertAuthorizedWorkspacePath } from './workspaceFilesDesktopService'
import { validateWorkspaceEntryName } from './WorkspaceFiles'
import { OfficeFileService } from './office/OfficeFileService'
import { operateOfficeDocument } from './officeDocumentDesktopService'
import { readPptxPreview } from './officePreviewDesktopService'

const pathKey = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)

export async function saveFileArtifactAs(window: BrowserWindow, input: FileArtifactSaveAsRequest): Promise<FileArtifactSaveAsResult | null> {
  const host = documentHost(), artifacts = host.artifacts
  const office = new OfficeFileService(host)
  const source = artifacts.resolveBinding(input.kind === 'office' ? office.baseBinding(input.binding) : input.binding)
  await assertAuthorizedWorkspacePath(source.path)
  const extension = path.extname(source.path).toLowerCase()
  if (!extension || input.kind === 'office' && !['.docx', '.xlsx', '.pptx'].includes(extension)) throw new Error('此文件格式不支持另存。')
  const suggested = path.join(path.dirname(source.path), `${path.basename(source.path, path.extname(source.path))} - 副本${extension}`)
  const result = await dialog.showSaveDialog(window, {
    title: '另存为',
    defaultPath: suggested,
    filters: [{ name: `${extension.slice(1).toUpperCase()} 文件`, extensions: [extension.slice(1)] }],
    properties: ['showOverwriteConfirmation'],
  })
  if (result.canceled || !result.filePath) return null
  const selectedExtension = path.extname(result.filePath).toLowerCase()
  if (selectedExtension && selectedExtension !== extension) throw new Error(`此文件应保存为 ${extension}。`)
  const filename = path.basename(result.filePath) + (selectedExtension ? '' : extension)
  validateWorkspaceEntryName(filename)
  const directory = await assertAuthorizedWorkspacePath(path.dirname(result.filePath)).catch(() => {
    throw new Error('请选择已授权的工作空间内的文件夹。')
  })
  const target = path.join(directory, filename)
  if ([source.path, ...input.openPaths].some(open => pathKey(open) === pathKey(target))) throw new Error('请选择不同的、未打开的目标文件。')
  const exists = selectedExtension && await fs.lstat(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false
    throw error
  })
  const overwrite = exists ? await artifacts.bind(target) : undefined
  if (input.kind === 'office' && overwrite && await artifacts.readOfficeDraft(overwrite))
    throw new Error('目标文件有待恢复的 Office 草稿，请先打开处理或选择新文件名。')
  if (input.kind === 'media') {
    const preview = await artifacts.media.preview(source, input.operations)
    const saved = await artifacts.saveCopy(source, target, preview.content.bytes, overwrite)
    const snapshot = await artifacts.media.open(saved)
    artifacts.media.release(source)
    return { kind: 'media', snapshot }
  }
  const snapshot = await office.saveWorkingAs(input.binding, target, overwrite, async saved => {
    const opened = extension === '.pptx'
      ? await readPptxPreview({ type: 'pptx-preview.open', path: saved.path, draft: true })
      : await operateOfficeDocument({ type: 'office-document.open', path: saved.path, draft: true })
    if (!opened) throw new Error('另存文件已写入，但无法重新打开。')
    return opened
  })
  return { kind: 'office', snapshot }
}
