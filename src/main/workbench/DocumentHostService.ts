import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentRegistry } from '../../core/documents/DocumentRegistry'
import type { DocumentSession, DocumentSaveObserver } from '../../core/documents/DocumentSession'
import { createMarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { createCourseV9Driver } from '../../core/drivers/CourseV9Driver'
import type { AsyncNativeTextMeasurePort } from '../../core/tools/prepareNativeTextFrame'
import type { DocumentEvent, DocumentKind, DocumentSnapshot } from '../../shared/workbench/document'
import { documentHostRequestSchema, type DocumentHostRequest, type DocumentHostAPI, type DocumentFileObservation, type ReconcileDocumentFile } from '../../shared/workbench/desktop'
import { createDocumentJournal, readDocumentFileVersion, readDocumentMarkdownResources } from './documentJournal'
import { DocumentToolGateway } from '../../core/tools/DocumentToolGateway'
import { WorkspaceFiles, type WorkspaceFilesDependencies } from './WorkspaceFiles'
import { DocumentFileCoordinator } from './DocumentFileCoordinator'
import { prepareImageResource } from './admittedImageResource'
import { createBlankCourseProject } from '../../core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../shared/defaultTeacherControllerComponent'

function canonicalKey(filename: string): string {
  return process.platform === 'win32' ? filename.toLowerCase() : filename
}

export type DocumentSaveFact = { saveId: string; documentId: string; epoch: string; documentName: string; time: number } & (
  | { status: 'saving'; revision: number }
  | { status: 'saved'; savedRevision: number; currentRevision: number }
  | { status: 'failed'; revision: number; error: string }
)

/** App-owned singleton, independent of renderer lifetime and active surface. */
export class DocumentHostService {
  readonly registry: DocumentRegistry
  readonly tools: DocumentToolGateway
  readonly files: WorkspaceFiles
  readonly fileCoordinator: DocumentFileCoordinator
  private readonly journal
  private readonly drivers
  private readonly subscribed = new Set<string>()
  private eventSink?: (event: DocumentEvent) => void
  private readonly saveListeners = new Set<(fact: DocumentSaveFact) => void>()
  private bootstrapping?: Promise<DocumentSnapshot>

  constructor(directory: string, fileDependencies: Pick<WorkspaceFilesDependencies, 'trashItem' | 'showItemInFolder' | 'fileOperations'> = {}, rendering: { measureNativeTextAsync?: AsyncNativeTextMeasurePort } = {}) {
    this.drivers = [createMarkdownDriver(), createCourseV9Driver(rendering)]
    this.journal = createDocumentJournal({ directory })
    this.registry = new DocumentRegistry({ persistence: this.journal, drivers: this.drivers, createId: randomUUID, bindingKey: binding => canonicalKey(binding.path) })
    this.tools = new DocumentToolGateway(this.registry, this.drivers, randomUUID, { prepareImage: prepareImageResource, ...rendering })
    this.fileCoordinator = new DocumentFileCoordinator(this.registry, this.journal, path.join(directory, 'binding-intents'))
    this.files = new WorkspaceFiles({ ...fileDependencies, aroundMutation: this.fileCoordinator.aroundMutation,
      aroundOperation: perform => this.fileCoordinator.withFileOperation(perform) })
  }

  setEventSink(sink?: (event: DocumentEvent) => void): void { this.eventSink = sink }

  subscribeSaves(listener: (fact: DocumentSaveFact) => void): () => void { this.saveListeners.add(listener); return () => this.saveListeners.delete(listener) }
  private publishSave(fact: DocumentSaveFact): void {
    for (const listener of this.saveListeners) { try { listener(structuredClone(fact)) } catch { /* File saving is independent of timeline/diagnostic consumers. */ } }
  }

  bootstrapCourse(): Promise<DocumentSnapshot> {
    const live = this.registry.list().find(snapshot => snapshot.model.kind === 'course-v9')
    if (live) return Promise.resolve(live)
    if (!this.bootstrapping) {
      const project = createBlankCourseProject()
      const controller = createDefaultTeacherControllerPackage()
      this.bootstrapping = this.registry.create({ kind: 'course-v9', project,
        resources: { assets: {}, components: { [`${controller.manifest.id}@${controller.manifest.version}`]: controller.files } },
      }, `${project.title}.h5lesson`, true).then(session => this.attach(session))
        .finally(() => { this.bootstrapping = undefined })
    }
    return this.bootstrapping
  }

  /** Trusted main consumers use the same sessions; UI envelopes remain human-only. */
  readonly internalAPI: Pick<DocumentHostAPI, 'list' | 'create' | 'recoverable' | 'restore' | 'open' | 'read' | 'dispatch' | 'lookup' | 'save' | 'observeFile' | 'reconcileFile'> & { stopRun(documentId: string, runId: string): Promise<unknown> } = {
    list: async () => this.registry.list(),
    create: async (model, suggestedName) => this.attach(await this.registry.create(model, suggestedName)),
    recoverable: () => this.operate({ type: 'recoverable' }) as Promise<DocumentSnapshot[]>,
    restore: documentId => this.operate({ type: 'restore', documentId }) as Promise<DocumentSnapshot>,
    open: filename => this.open(filename),
    read: documentId => this.registry.get(documentId).drain(),
    dispatch: operation => this.registry.get(operation.documentId).execute(operation),
    lookup: async (documentId, operationId) => this.registry.get(documentId).lookupOperation(operationId),
    save: (documentId, filename) => this.saveToPath(documentId, filename),
    observeFile: documentId => this.observeFile(documentId),
    reconcileFile: input => this.reconcileFile(input),
    stopRun: (documentId, runId) => this.registry.get(documentId).stopRun(runId),
  }

  private attach(session: DocumentSession): DocumentSnapshot {
    if (!this.subscribed.has(session.documentId)) {
      this.subscribed.add(session.documentId)
      session.subscribe(event => {
        if (event.type === 'closed') this.subscribed.delete(event.documentId)
        this.eventSink?.(event)
      })
    }
    return session.read()
  }

  private kind(filename: string): DocumentKind {
    const extension = path.extname(filename).toLowerCase()
    if (extension === '.md' || extension === '.markdown') return 'markdown'
    if (extension === '.h5lesson') return 'course-v9'
    throw new Error('当前仅支持 Markdown 和 V9 h5lesson 文档')
  }

  open(filename: string): Promise<DocumentSnapshot> { return this.fileCoordinator.withFileAccess(() => this.openFile(filename)) }
  private async openFile(filename: string): Promise<DocumentSnapshot> {
    if (!path.isAbsolute(filename)) throw new Error('文档路径必须是绝对路径')
    const canonical = await fs.realpath(filename)
    const kind = this.kind(canonical)
    const version = await readDocumentFileVersion(canonical, kind)
    if (version === null) throw new Error('文档已不存在')
    const session = await this.registry.open({ kind: 'file', path: canonical, version, bindingVersion: 1 }, async () => {
      const driver = this.drivers.find(value => value.kind === kind)!
      const model = await driver.load(new Uint8Array(await fs.readFile(canonical)))
      if (model.kind === 'markdown') model.resources = await readDocumentMarkdownResources(canonical)
      if (await readDocumentFileVersion(canonical, kind) !== version) throw new Error('读取期间文档已改变，请重新打开')
      driver.validate(model)
      return model
    })
    return this.attach(session)
  }

  private async readDisk(filename: string, kind: DocumentKind): Promise<{ version: string | null; model: DocumentSnapshot['model'] | null }> {
    const version = await readDocumentFileVersion(filename, kind)
    if (version === null) return { version, model: null }
    const driver = this.drivers.find(value => value.kind === kind)!
    const model = await driver.load(new Uint8Array(await fs.readFile(filename)))
    if (model.kind === 'markdown') model.resources = await readDocumentMarkdownResources(filename)
    if (await readDocumentFileVersion(filename, kind) !== version) throw new Error('读取期间文件已改变，请重新比较')
    driver.validate(model)
    return { version, model }
  }

  observeFile(documentId: string): Promise<DocumentFileObservation> { return this.fileCoordinator.withFileAccess(() => this.observeDisk(documentId)) }
  private async observeDisk(documentId: string): Promise<DocumentFileObservation> {
    const snapshot = await this.registry.get(documentId).drain()
    if (snapshot.binding.kind !== 'file') throw new Error('未保存文档没有磁盘版本')
    return { bindingVersion: snapshot.binding.bindingVersion, ...await this.readDisk(snapshot.binding.path, snapshot.model.kind) }
  }

  reconcileFile(input: ReconcileDocumentFile): Promise<DocumentSnapshot> {
    return this.fileCoordinator.withFileAccess(() => this.registry.get(input.documentId).reconcileFile(input, async current => {
      if (current.binding.kind !== 'file') throw new Error('文件位置已改变')
      const disk = await this.readDisk(current.binding.path, current.model.kind)
      if (disk.version !== input.version) throw new Error('磁盘文件再次改变，请重新比较')
      if (!disk.model) throw new Error('磁盘文件已删除或移动，请另存当前稿或重新定位')
      if (input.choice === 'disk') {
        if (input.source !== undefined) throw new Error('采纳磁盘版本不能夹带其他正文')
        return { model: disk.model, version: disk.version, matchesDisk: true }
      }
      const model = structuredClone(current.model)
      if (input.source !== undefined) {
        if (model.kind !== 'markdown') throw new Error('课件不能使用 Markdown 合并正文')
        model.source = input.source
        if (disk.model?.kind === 'markdown') model.resources = {
          assets: { ...disk.model.resources.assets, ...model.resources.assets },
          components: { ...disk.model.resources.components, ...model.resources.components },
        }
      }
      return { model, version: disk.version, matchesDisk: false }
    }))
  }

  /** overwriteConfirmed is supplied only after the native dialog, never from renderer arguments. */
  async saveToPath(documentId: string, filename?: string, overwriteConfirmed = false): Promise<DocumentSnapshot> {
    const initial = this.registry.get(documentId).read(), saveId = randomUUID()
    const base = { saveId, documentId, epoch: initial.epoch }
    let observedRevision = initial.revision, terminal = false
    let documentName = initial.binding.kind === 'file' ? path.basename(initial.binding.path) : initial.binding.suggestedName
    const observer: DocumentSaveObserver = progress => {
      documentName = progress.binding.kind === 'file' ? path.basename(progress.binding.path) : progress.binding.suggestedName
      if (progress.status === 'saving') { observedRevision = progress.revision; this.publishSave({ ...base, documentName, time: Date.now(), status: 'saving', revision: progress.revision }) }
      else if (progress.status === 'saved') { terminal = true; this.publishSave({ ...base, documentName, time: Date.now(), status: 'saved', savedRevision: progress.savedRevision, currentRevision: progress.currentRevision }) }
      else { terminal = true; this.publishSave({ ...base, documentName, time: Date.now(), status: 'failed', revision: progress.revision, error: progress.error instanceof Error ? progress.error.message : String(progress.error) }) }
    }
    return this.fileCoordinator.withFileAccess(async () => {
      const saved = await this.saveFile(documentId, filename, overwriteConfirmed, observer)
      if (saved.binding.kind === 'file') await this.files.acknowledgeDocumentSave(saved.binding.path, saved.model.kind, saved.binding.version)
      return saved
    }).catch(error => {
      // Path/ownership preflight may fail before a session captures a save revision.
      if (!terminal) {
        this.registry.get(documentId).reportSaveFailure(error)
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'failed', revision: observedRevision, error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    })
  }
  private async saveFile(documentId: string, filename?: string, overwriteConfirmed = false, observer?: DocumentSaveObserver): Promise<DocumentSnapshot> {
    const current = this.registry.get(documentId).read()
    if (!filename) return this.registry.save(documentId, undefined, observer)
    if (!path.isAbsolute(filename)) throw new Error('保存路径必须是绝对路径')
    const canonical = path.join(await fs.realpath(path.dirname(filename)), path.basename(filename))
    if (this.kind(canonical) !== current.model.kind) throw new Error('另存格式与文档不一致')
    if (current.binding.kind === 'file' && canonicalKey(canonical) === canonicalKey(current.binding.path)) return this.registry.save(documentId, undefined, observer)
    const version = await readDocumentFileVersion(canonical, current.model.kind)
    if (version !== null && !overwriteConfirmed) throw new Error('另存目标已存在，请选择新文件名')
    return this.registry.save(documentId, { kind: 'file', path: canonical, version, bindingVersion: current.binding.kind === 'file' ? current.binding.bindingVersion + 1 : 1 }, observer)
  }

  async operate(raw: unknown): Promise<unknown> {
    const input: DocumentHostRequest = documentHostRequestSchema.parse(raw)
    switch (input.type) {
      case 'list': return this.registry.list()
      case 'bootstrap-course': return this.bootstrapCourse()
      case 'create': return this.attach(await this.registry.create(input.model, input.suggestedName))
      case 'open': return this.open(input.path)
      case 'read': return this.registry.get(input.documentId).drain()
      case 'dispatch': return this.registry.get(input.operation.documentId).execute(input.operation)
      case 'lookup': return this.registry.get(input.documentId).lookupOperation(input.operationId)
      case 'save': return this.saveToPath(input.documentId, input.path)
      case 'save-dialog': throw new Error('保存对话框需要应用窗口')
      case 'close-dialog': throw new Error('关闭对话框需要应用窗口')
      case 'observe-file': return this.observeFile(input.documentId)
      case 'reconcile-file': return this.reconcileFile(input)
      case 'close': return this.fileCoordinator.withFileAccess(async () => {
        await this.registry.close(input.documentId, { discardDirty: input.discardDirty, expected: input.expected })
        await this.journal.discard(input.documentId)
        return
      })
      case 'recoverable': return this.fileCoordinator.withFileAccess(async () => {
        const snapshots: DocumentSnapshot[] = []
        for (const documentId of await this.journal.list()) {
          // A live dirty session is already authoritative. Listing its journal as
          // crash recovery races a view attachment and falsely blocks editing.
          if (this.registry.list().some(snapshot => snapshot.documentId === documentId)) continue
          const state = await this.journal.recover(documentId)
          if (state && state.savedRevision !== state.revision) snapshots.push({ documentId, epoch: state.epoch, revision: state.revision, model: state.model, binding: state.binding, dirty: true, saving: false, recoverable: true, undoDepth: state.past.length, redoDepth: state.future.length })
        }
        return snapshots
      })
      case 'restore': return this.fileCoordinator.withFileAccess(async () => {
        const state = await this.journal.recover(input.documentId)
        if (!state) throw new Error('恢复稿不存在')
        return this.attach(await this.registry.restore(state))
      })
      case 'discard-recovery': return this.fileCoordinator.withFileAccess(async () => {
        if (this.registry.list().some(snapshot => snapshot.documentId === input.documentId)) throw new Error('文档已打开，请从文档关闭入口处理未保存更改')
        await this.journal.discard(input.documentId)
        return
      })
    }
  }
}
