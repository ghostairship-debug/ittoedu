import { app, dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { AttachmentError, AttachmentService } from './AttachmentService'
import { createSandboxedAttachmentExtractor } from './SandboxedAttachmentExtraction'
import { attachmentsDesktopRequestSchema } from '../../../shared/workbench/attachmentsDesktop'
import type { AttachmentIntakeFile, AttachmentReadProgress } from '../../../shared/workbench/attachmentsDesktop'
import { attachmentOperationError } from './attachmentOperationErrors'
import { DesktopOperationError } from '../../errors'
import { readClipboardFileList } from './clipboardFileList'
import { operateWorkspaceFiles } from '../workspaceFilesDesktopService'

export class AttachmentsDesktopService {
  readonly attachments: AttachmentService
  private readonly grants = new Map<string, { path: string; kind: 'file' | 'workspace'; owner: number }>()
  private readonly extractions = new Map<string, { controller: AbortController; owner: number }>()
  private readonly cancelled = new Set<string>()
  private readonly gestures = new Map<string, Promise<AttachmentIntakeFile[]>>()
  private readonly windows = new Set<number>()
  constructor(directory: string) {
    const dev = process.env.VITE_DEV_SERVER_URL
    this.attachments = new AttachmentService({ directory, resolveAuthorizedPath: async id => {
      const grant = this.grants.get(id)
      if (!grant) throw new AttachmentError('path-not-authorized', '附件文件读取授权已失效')
      return { path: grant.path, kind: grant.kind }
    }, extractor: createSandboxedAttachmentExtractor({ preloadPath: path.resolve(__dirname, '../../../preload/attachmentExtraction.js'),
      ...(dev ? { rendererURL: new URL('attachment-extraction.html', dev.endsWith('/') ? dev : `${dev}/`).href } : { rendererFile: path.resolve(__dirname, '../../../../dist-renderer/attachment-extraction.html') }),
    }) })
  }
  private retainWindow(window: BrowserWindow): void {
    const owner = window.webContents.id
    if (this.windows.has(owner)) return
    this.windows.add(owner)
    window.webContents.once('destroyed', () => {
      this.windows.delete(owner)
      for (const [id, grant] of this.grants) if (grant.owner === owner) this.grants.delete(id)
      for (const key of this.cancelled) if (key.startsWith(`${owner}:`)) this.cancelled.delete(key)
      for (const key of this.gestures.keys()) if (key.startsWith(`${owner}:`)) this.gestures.delete(key)
    })
  }
  private grant(filename: string, window: BrowserWindow, kind: 'file' | 'workspace' = 'file'): AttachmentIntakeFile {
    if (window.webContents.isDestroyed()) throw new AttachmentError('operation-cancelled', '附件窗口已关闭')
    const authorizationId = randomUUID(); this.grants.set(authorizationId, { path: filename, kind, owner: window.webContents.id })
    return { authorizationId, name: path.basename(filename) }
  }
  private async controlled<T>(requestId: string, window: BrowserWindow, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = `${window.webContents.id}:${requestId}`
    if (this.cancelled.delete(key)) throw new AttachmentError('operation-cancelled', '附件处理已取消')
    if (this.extractions.has(key)) throw new AttachmentError('request-running', '附件处理请求已经存在')
    const controller = new AbortController(); this.extractions.set(key, { controller, owner: window.webContents.id })
    const destroyed = () => controller.abort(new AttachmentError('operation-cancelled', '附件窗口已关闭'))
    window.webContents.once('destroyed', destroyed)
    try { const result = await action(controller.signal); controller.signal.throwIfAborted(); return result }
    finally { this.extractions.delete(key); this.cancelled.delete(key); if (!window.webContents.isDestroyed()) window.webContents.removeListener('destroyed', destroyed) }
  }
  async operate(raw: unknown, window: BrowserWindow, onProgress?: (progress: AttachmentReadProgress) => void): Promise<unknown> {
    try { return await this.dispatch(raw, window, onProgress) }
    catch (error) { throw attachmentOperationError(error) }
  }
  private async dispatch(raw: unknown, window: BrowserWindow, onProgress?: (progress: AttachmentReadProgress) => void): Promise<unknown> {
    const input = attachmentsDesktopRequestSchema.parse(raw)
    this.retainWindow(window)
    switch (input.type) {
      case 'select': {
        const result = await dialog.showOpenDialog(window, { title: '添加附件', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与文档', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'pptx', 'md', 'markdown', 'txt', 'csv'] }] })
        return result.canceled ? [] : result.filePaths.map(filename => this.grant(filename, window))
      }
      case 'clipboard-files': {
        if (!window.isFocused()) throw new AttachmentError('clipboard-not-focused', '粘贴窗口未聚焦')
        const key = `${window.webContents.id}:${input.gestureId}`, prior = this.gestures.get(key)
        if (prior) return prior
        const result = readClipboardFileList().then(files => files.map(filename => this.grant(filename, window)))
        this.gestures.set(key, result); return result
      }
      case 'workspace-files': {
        return Promise.all(input.entryIds.map(async entryId => {
          try { const entry = await operateWorkspaceFiles({ type: 'resolve', workspaceId: input.workspaceId, entryId }); return this.grant(entry.resolvedPath, window, 'workspace') }
          catch (error) {
            const failure = attachmentOperationError(error)
            if (!(failure instanceof DesktopOperationError)) console.error('工作空间附件引用失败', error)
            return { name: '工作空间文件', error: failure instanceof DesktopOperationError ? `${failure.message} ${failure.suggestion}` : '文件引用失败，请从资源树重新选择；已有附件保持不变。', workspace: { workspaceId: input.workspaceId, entryId } } satisfies AttachmentIntakeFile
          }
        }))
      }
      case 'release': for (const id of input.authorizationIds) if (this.grants.get(id)?.owner === window.webContents.id) this.grants.delete(id); return
      case 'receive-granted': {
        const grant = this.grants.get(input.authorizationId)
        if (!grant || grant.owner !== window.webContents.id) throw new AttachmentError('path-not-authorized', '附件文件读取授权已失效')
        return this.controlled(input.requestId, window, signal => this.attachments.receivePath({ authorizationId: input.authorizationId }, {
          signal, onProgress: (loaded, total) => onProgress?.({ requestId: input.requestId, loaded, total }),
        }))
      }
      case 'receive': return this.controlled(input.requestId ?? randomUUID(), window, signal => this.attachments.receiveBytes({ name: input.name, bytes: input.bytes, source: { kind: input.source }, ...(input.mediaType ? { declaredMediaType: input.mediaType } : {}) }, { signal }))
      case 'snapshot': return this.attachments.readSnapshot(input.attachmentId)
      case 'representation': return this.attachments.readRepresentation(input.attachmentId, input.representationId)
      case 'cancel': {
        const key = `${window.webContents.id}:${input.requestId}`
        const running = this.extractions.get(key)
        if (running) running.controller.abort(new AttachmentError('operation-cancelled', '附件处理已取消'))
        else this.cancelled.add(key)
        return
      }
      case 'extract': return this.controlled(input.requestId, window, signal => this.attachments.extract(input.attachmentId, { pages: input.pages, images: input.images ?? 'auto', signal,
        onProgress: (loaded, total) => onProgress?.({ requestId: input.requestId, loaded, total, unit: 'pages' }) }))

    }
  }
}
let singleton: AttachmentsDesktopService | undefined
export async function attachmentsDesktopService(): Promise<AttachmentsDesktopService> {
  await app.whenReady()
  return singleton ??= new AttachmentsDesktopService(path.join(app.getPath('userData'), 'workbench-v2', 'attachments'))
}
