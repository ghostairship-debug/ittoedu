import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { documentRelativePathSchema } from '../shared/document/resources'
import { documentRefKey, type DocumentFilePort, type DocumentFileRef, type DocumentFileVersion, type DocumentSaveRequest, type DocumentSaveResult } from '../shared/document/ports'
import type { DocumentHostAPI } from '../shared/workbench/desktop'
import type { DocumentOperation, DocumentSnapshot } from '../shared/workbench/document'
import { markdownRefPath, markdownSnapshotDocument, markdownSnapshotVersion } from '../shared/workbench/markdownFileAdapter'
import { parseDocumentMarkdown } from '../shared/document/markdown'
import { resolveFileDocumentImage } from '../shared/document/fileImageReference'

const hash = (data: string) => createHash('sha256').update(data).digest('hex')
const same = (a: DocumentFileVersion | null, b: DocumentFileVersion | null) => JSON.stringify(a) === JSON.stringify(b)
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
export type MarkdownDocumentHost = Pick<DocumentHostAPI, 'open' | 'read' | 'dispatch' | 'save' | 'list' | 'create' | 'recoverable' | 'restore' | 'observeFile' | 'reconcileFile'>
export interface LessonDocumentFilesOptions {
  recoveryDirectory: string
  validateTarget: (ref: DocumentFileRef) => Promise<void>
  documents: MarkdownDocumentHost
}
/** File resource facade. Content, resources, recovery and History have one main Session writer. */
export function createLessonDocumentFiles(options: LessonDocumentFilesOptions) {
  const documents = options.documents
  const queues = new Map<string, Promise<unknown>>()
  const key = (ref: DocumentFileRef) => hash(documentRefKey(ref))
  const pathKey = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
  function serial<T>(ref: DocumentFileRef, action: () => Promise<T>): Promise<T> {
    const id = key(ref), next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action)
    queues.set(id, next)
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id) }).catch(() => {})
    return next
  }
  async function snapshot(ref: DocumentFileRef, create = false): Promise<DocumentSnapshot> {
    await options.validateTarget(ref)
    if (ref.kind === 'lesson') documentRelativePathSchema.parse(ref.relativePath)
    const filename = path.resolve(markdownRefPath(ref))
    if (ref.kind === 'lesson') {
      const root = await fs.realpath(ref.lessonDirectory)
      let ancestor = filename
      for (;;) {
        try {
          const relative = path.relative(root, await fs.realpath(ancestor))
          if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件引用越出课例目录')
          break
        } catch (error) { if (!absent(error)) throw error; ancestor = path.dirname(ancestor) }
      }
    }
    const matches = (value: DocumentSnapshot) => value.binding.kind === 'file' && pathKey(value.binding.path) === pathKey(filename)
    const live = (await documents.list()).find(matches)
    if (live) {
      const current = await documents.read(live.documentId)
      if (current.binding.kind === 'file' && !current.dirty) {
        const observed = await documents.observeFile(current.documentId)
        if (observed.version !== current.binding.version) {
          if (!observed.model) throw Object.assign(new Error('磁盘文件已删除'), { code: 'ENOENT' })
          return documents.reconcileFile({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
            bindingVersion: observed.bindingVersion, version: observed.version, choice: 'disk' })
        }
      }
      return current
    }
    const recovery = (await documents.recoverable()).find(matches)
    if (recovery) return documents.restore(recovery.documentId)
    try { return await documents.open(filename) }
    catch (error) {
      if (!create || !absent(error)) throw error
      return documents.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, path.basename(filename))
    }
  }
  async function commit(current: DocumentSnapshot, source: string, operationId: string, attachments: DocumentSaveRequest['attachments'] = []) {
    if (current.model.kind !== 'markdown') throw new Error('目标不是 Markdown 文档')
    const resources = structuredClone(current.model.resources)
    for (const attachment of attachments) {
      documentRelativePathSchema.parse(attachment.relativePath)
      const existing = resources.assets[attachment.relativePath]
      if (existing && !Buffer.from(existing).equals(Buffer.from(attachment.bytes))) throw new Error('附件路径已用于其他内容，请使用新文件名')
      resources.assets[attachment.relativePath] = new Uint8Array(attachment.bytes)
    }
    const operation: DocumentOperation = { documentId: current.documentId, epoch: current.epoch, operationId, baseRevision: current.revision,
      actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source, resources } } }
    const result = await documents.dispatch(operation)
    if ('message' in result) throw new Error(result.message)
    return documents.read(current.documentId)
  }
  async function save(request: DocumentSaveRequest): Promise<DocumentSaveResult> {
    let recoverable = false
    try {
      const current = await snapshot(request.ref, request.expectedVersion === null)
      if (request.expectedVersion === null && current.binding.kind === 'file') return { status: 'conflict', operationId: request.operationId, disk: markdownSnapshotDocument(request.ref, current) }
      if (request.expectedVersion && !same(request.expectedVersion, markdownSnapshotVersion(current))) return { status: 'conflict', operationId: request.operationId, disk: markdownSnapshotDocument(request.ref, current) }
      const committed = await commit(current, request.source, request.operationId, request.attachments)
      recoverable = true
      const saved = await documents.save(committed.documentId, committed.binding.kind === 'untitled' ? path.resolve(markdownRefPath(request.ref)) : undefined)
      return { status: 'saved', operationId: request.operationId, version: markdownSnapshotVersion(saved) }
    } catch (error) { return { status: 'failed', operationId: request.operationId, message: (error as Error).message, recovery: recoverable ? 'saved' : 'failed' } }
  }
  const port: DocumentFilePort = {
    openDocument: async ref => {
      const document = markdownSnapshotDocument(ref, await snapshot(ref))
      document.diagnostics = parseDocumentMarkdown(document.source, { target: 'file', createId: () => randomUUID(),
        resolveImage: href => resolveFileDocumentImage(path.basename(markdownRefPath(ref)), href) }).diagnostics
      return document
    },
    saveDocument: request => serial(request.ref, () => save(request)),
    watchDocument(ref, listener) {
      let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, last = ''
      const refresh = async () => {
        try {
          const disk = await port.openDocument(ref), version = JSON.stringify(disk.version)
          if (!disposed && version !== last) { last = version; listener({ type: 'changed', disk }) }
        } catch (error) { if (!disposed && absent(error)) listener({ type: 'deleted' }) }
        finally { if (!disposed) timer = setTimeout(() => void refresh(), 1000) }
      }
      void refresh()
      return () => { disposed = true; clearTimeout(timer) }
    },
  }
  const api = { ...port,
    async readResource(ref: DocumentFileRef, relativePath: string) {
      documentRelativePathSchema.parse(relativePath)
      let current: DocumentSnapshot | null = null
      try { current = await snapshot(ref) } catch (error) { if (!absent(error)) throw error }
      let bytes = current?.model.resources.assets[relativePath]
      if (!bytes && current) for (const [directory, files] of Object.entries(current.model.resources.components)) if (relativePath.startsWith(`${directory}/`)) bytes = files[relativePath.slice(directory.length + 1)]
      if (!bytes) {
        // Clipboard may read a user-selected local resource before its destination document exists.
        // This is read-only; imported bytes still enter content through the canonical command.
        await options.validateTarget(ref)
        const root = await fs.realpath(ref.kind === 'lesson' ? ref.lessonDirectory : path.dirname(ref.path))
        const filename = await fs.realpath(path.resolve(root, relativePath)), localPath = path.relative(root, filename)
        if (localPath === '..' || localPath.startsWith(`..${path.sep}`) || path.isAbsolute(localPath)) throw new Error('素材引用越出文档目录')
        bytes = new Uint8Array(await fs.readFile(filename))
      }
      const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.zip': 'application/zip', '.woff2': 'font/woff2' }
      return { bytes: new Uint8Array(bytes), mime: types[path.extname(relativePath).toLowerCase()] ?? 'application/octet-stream', filename: path.basename(relativePath) }
    },
    async readRecovery(ref: DocumentFileRef): Promise<{ source: string; expectedVersion: DocumentFileVersion | null; baseSource?: string; attachments?: DocumentSaveRequest['attachments'] } | null> {
      let current: DocumentSnapshot
      try { current = await snapshot(ref) } catch (error) { if (absent(error)) return null; throw error }
      if (!current.dirty || current.model.kind !== 'markdown') return null
      return { source: current.model.source, expectedVersion: markdownSnapshotVersion(current), attachments: Object.entries(current.model.resources.assets).map(([relativePath, bytes]) => ({ relativePath, bytes })) }
    },
    async preserveDraft(ref: DocumentFileRef, source: string, expectedVersion: DocumentFileVersion | null, attachments: DocumentSaveRequest['attachments'] = []) {
      await serial(ref, async () => {
        const current = await snapshot(ref)
        if (expectedVersion && !same(expectedVersion, markdownSnapshotVersion(current))) throw new Error('文档已改变，未覆盖现有恢复稿')
        await commit(current, source, randomUUID(), attachments)
      })
    },
  }
  return api
}
