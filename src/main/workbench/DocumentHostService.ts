import { DocumentSaveFailure, type DocumentSaveFact, type DocumentSaveIdentity, type SavedCourseIdentity } from '../../shared/workbench/documentSave'
import type { SaveReceipt } from '../../shared/workbench/toolPorts'
import { documentDigest } from '../../core/documents/documentDigest'
import { sourceFileKind } from '../../shared/workbench/sourceFileKind'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentRegistry } from '../../core/documents/DocumentRegistry'
import type { DocumentSession, DocumentSaveObserver } from '../../core/documents/DocumentSession'
import { createMarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { createTextDriver, TextEncodingError } from '../../core/drivers/TextDriver'
import { createCourseV10Driver } from '../../core/drivers/CourseV10Driver'
import { checkComponentExpectations, ComponentOperationConflict } from '../../core/drivers/courseV10Operations'
import { isSourceDocumentModel, type DocumentDriver, type DocumentEvent, type DocumentKind, type DocumentModel, type DocumentSnapshot, type DocumentOperation, type DocumentOperationResult } from '../../shared/workbench/document'
import { DesktopOperationError } from '../errors'
import { authoringDraftRecoverySchema, documentHostRequestSchema, type AuthoringDraftRecovery, type DocumentHostRequest, type DocumentHostAPI, type DocumentFileObservation, type ReconcileDocumentFile } from '../../shared/workbench/desktop'
import { createDocumentJournal, readDocumentFileVersion, readDocumentMarkdownResources } from './documentJournal'
import { DocumentToolGateway } from '../../core/tools/DocumentToolGateway'
import { WorkspaceFiles, type WorkspaceFilesDependencies } from './WorkspaceFiles'
import { DocumentFileCoordinator } from './DocumentFileCoordinator'
import { FileArtifactService } from './FileArtifactService'
import { prepareImageResource } from './admittedImageResource'
import { createBlankCourseProjectV10 } from '../../core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from './contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from './contentApply/applyService'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from './projectFiles/componentPlatformFileInput'
import { AgentFileService } from './execution/AgentFileService'
import { HostArtifactDeliveryService } from './execution/HostArtifactDeliveryService'
import { verifyContentResourceDiagnostic } from './contentApply/resources/verifyContentResourceDiagnostic'
import { discardFlowDocumentRecovery, type FlowRecoveryDocumentIdentity } from '../flowDocumentRecovery'

function canonicalKey(filename: string): string {
  return process.platform === 'win32' ? filename.toLowerCase() : filename
}

async function loadDocumentModel(driver: DocumentDriver, bytes: Uint8Array): Promise<DocumentModel> {
  try { return await driver.load(bytes) }
  catch (error) {
    if (error instanceof TextEncodingError) throw new DesktopOperationError('TEXT_ENCODING_UNSUPPORTED', '无法打开文本', '不是 UTF-8 编码的文本文件', '请将文件转换为 UTF-8 编码后再打开。')
    throw error
  }
}

export type { DocumentSaveFact } from '../../shared/workbench/documentSave'

/** App-owned singleton, independent of renderer lifetime and active surface. */
export class DocumentHostService {
  readonly registry: DocumentRegistry
  readonly tools: DocumentToolGateway
  readonly files: WorkspaceFiles
  readonly fileCoordinator: DocumentFileCoordinator
  readonly artifacts: FileArtifactService
  readonly agentFiles: AgentFileService
  readonly artifactDeliveries: HostArtifactDeliveryService
  /** Main consumers share compilation output; each runtime still owns its own load lease. */
  readonly compilation: Pick<InMemoryComponentCompilation, 'compile'>
  private readonly journal
  private readonly drivers
  private readonly subscribed = new Set<string>()
  private eventSink?: (event: DocumentEvent) => void
  private readonly eventListeners = new Set<(event: DocumentEvent) => void>()
  private readonly saveListeners = new Set<(fact: DocumentSaveFact) => unknown>()
  private readonly saveObservations = new Set<Promise<void>>()
  private readonly closeListeners = new Set<(documentId: string) => void>()
  private bootstrapping?: Promise<DocumentSnapshot>
  private readonly authoringDraftDirectory: string
  private authoringDraftTail: Promise<unknown> = Promise.resolve()
  private readonly authoringDraftClaims = new Map<string, { epoch: string; records: Set<string> }>()
  private readonly discardFlowDrafts: (target: FlowRecoveryDocumentIdentity) => Promise<void>

  constructor(directory: string, fileDependencies: Pick<WorkspaceFilesDependencies, 'trashItem' | 'showItemInFolder' | 'fileOperations'> = {},
    options: { artifactDeliveryDirectory?: string; discardFlowRecovery?: (target: FlowRecoveryDocumentIdentity) => Promise<void> } = {}) {
    this.authoringDraftDirectory = path.join(directory, 'authoring-drafts')
    this.discardFlowDrafts = options.discardFlowRecovery ?? discardFlowDocumentRecovery
    this.drivers = [createMarkdownDriver(), createTextDriver(), createCourseV10Driver()]
    this.journal = createDocumentJournal({ directory })
    this.registry = new DocumentRegistry({ persistence: this.journal, drivers: this.drivers, createId: randomUUID, bindingKey: binding => canonicalKey(binding.path) })
    this.compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    this.tools = new DocumentToolGateway(this.registry, this.drivers, randomUUID, { prepareImage: prepareImageResource,
      componentContent: {
        verifyDiagnostic: (snapshot, diagnostic) => verifyContentResourceDiagnostic({ project: snapshot.model.project,
          resources: snapshot.model.resources, diagnostic }),
        source: (from, fileAccess, sourceHtml?: string) => readComponentProjectFileInput({ from, fileAccess, sourceHtml,
          currentHtml: async (filename: string) => {
            const opened = this.registry.list().find(snapshot => snapshot.binding.kind === 'file'
              && canonicalKey(snapshot.binding.path) === canonicalKey(filename))
            if (!opened) return undefined
            const current = await this.registry.get(opened.documentId).drain()
            return current.model.kind === 'text' ? current.model.source : undefined
          },
        }),
        prepareSource: prepareComponentProjectFileSource,
        apply: input => new ContentApplyService({
          session: { project: () => input.baseline.model.project,
            resources: () => input.baseline.model.resources,
            dispatch: async command => {
              input.assertActive()
              const current = await this.registry.get(input.baseline.documentId).drain()
              input.assertActive()
              return this.dispatch({ documentId: current.documentId, epoch: input.baseline.epoch, baseRevision: current.revision,
                operationId: input.operationId, requestDigest: input.requestDigest, actor: input.actor, runId: input.runId, runLeaseId: input.runLeaseId,
                mutation: { type: 'command', command: { ...command, expected: [...new Map([...command.expected, ...(input.readExpectations ?? [])]
                  .map(expected => [JSON.stringify(expected.path), expected])).values()] } } })
            } },
          measure: async request => (await import('./contentApply/measurement/ElectronHtmlDesignMeasurement.js')).measureHtmlAtDesignViewport(request),
          compilation: this.compilation,
        }).apply(input.request),
      },
    })
    this.fileCoordinator = new DocumentFileCoordinator(this.registry, this.journal, path.join(directory, 'binding-intents'))
    this.files = new WorkspaceFiles({ ...fileDependencies, aroundMutation: this.fileCoordinator.aroundMutation,
      creationReceiptDirectory: path.join(directory, 'creation-receipts'),
      aroundOperation: perform => this.fileCoordinator.withFileOperation(perform),
      captureCopyContent: async (source, kind) => {
        const captured = []
        for (const observed of this.registry.list()) {
          if (observed.binding.kind !== 'file') continue
          const relative = path.relative(source, observed.binding.path)
          if (kind === 'file' ? canonicalKey(source) !== canonicalKey(observed.binding.path)
            : relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
          const snapshot = await this.registry.get(observed.documentId).drain()
          if (snapshot.binding.kind !== 'file' || canonicalKey(snapshot.binding.path) !== canonicalKey(observed.binding.path)) throw new Error('复制期间当前稿文件位置已变化')
          const driver = this.drivers.find(driver => driver.kind === snapshot.model.kind)
          if (!driver) throw new Error('当前稿格式没有可用的保存编码器')
          captured.push({ sourcePath: snapshot.binding.path, relativePath: kind === 'file' ? '' : relative,
            bytes: await driver.serialize(snapshot.model), ...(snapshot.model.kind === 'markdown'
              ? { markdown: { source: snapshot.model.source, resources: snapshot.model.resources } } : {}) })
        }
        return captured
      } })
    this.artifacts = new FileArtifactService(this)
    this.agentFiles = new AgentFileService(this)
    this.artifactDeliveries = new HostArtifactDeliveryService({
      journalDirectory: options.artifactDeliveryDirectory ?? path.join(directory, 'artifact-deliveries'),
      withFileOperation: work => this.fileCoordinator.withFileOperation(work),
      assertTarget: filename => this.assertFileAvailable(filename),
    })
  }

  setEventSink(sink?: (event: DocumentEvent) => void): void { this.eventSink = sink }

  /** Main consumers can observe every formal session change without replacing the renderer event sink. */
  subscribeEvents(listener: (event: DocumentEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeSaves(listener: (fact: DocumentSaveFact) => unknown): () => void { this.saveListeners.add(listener); return () => this.saveListeners.delete(listener) }
  /** A document session closed (its tab or window); what belonged to it can be cleared (M15 element AI cards). */
  subscribeClosed(listener: (documentId: string) => void): () => void { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener) }
  /** Continuation awaits returned save-consumer ACKs; display observers return immediately. */
  async settleSaveObservations(): Promise<void> {
    await Promise.all([...this.saveObservations])
  }
  private publishSave(fact: DocumentSaveFact): void {
    for (const listener of this.saveListeners) {
      try {
        const observation = listener(structuredClone(fact))
        if (observation instanceof Promise) {
          const pending = observation.then(() => undefined, () => undefined)
          this.saveObservations.add(pending)
          void pending.finally(() => this.saveObservations.delete(pending))
        }
      } catch { /* File saving is independent of timeline/diagnostic consumers. */ }
    }
  }

  bootstrapCourse(): Promise<DocumentSnapshot> {
    const live = this.registry.list().find(snapshot => snapshot.model.kind === 'course-v10')
    if (live) return Promise.resolve(live)
    if (!this.bootstrapping) {
      const project = createBlankCourseProjectV10()
      this.bootstrapping = this.registry.create({ kind: 'course-v10', project,
        resources: { assets: {}, components: {} },
      }, `${project.title}.h5lesson`, true).then(session => this.attach(session))
        .finally(() => { this.bootstrapping = undefined })
    }
    return this.bootstrapping
  }

  private authoringDraftPath(snapshot: DocumentSnapshot): string {
    if (snapshot.model.kind !== 'course-v10') throw new Error('高级课件草稿需要当前 Project V10')
    // The filename is an auxiliary storage key, never a target supplied by an author or model.
    return path.join(this.authoringDraftDirectory, documentDigest({ projectId: snapshot.model.project.id,
      file: snapshot.binding.kind === 'file' ? canonicalKey(snapshot.binding.path) : null }) + '.json')
  }
  private async readDraftFile(snapshot: DocumentSnapshot): Promise<AuthoringDraftRecovery | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.authoringDraftPath(snapshot), 'utf8'))
      return authoringDraftRecoverySchema.parse(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  async readAuthoringDrafts(documentId: string): Promise<AuthoringDraftRecovery | null> {
    await this.authoringDraftTail
    const snapshot = await this.registry.get(documentId).drain(), drafts = await this.readDraftFile(snapshot)
    if (drafts) this.authoringDraftClaims.set(documentId, { epoch: snapshot.epoch,
      records: new Set([...drafts.advanced.filter(record => snapshot.model.kind === 'course-v10' && record.projectId === snapshot.model.project.id),
        ...drafts.properties.filter(record => { try { return Array.isArray(JSON.parse(record.bindingKey)) } catch { return false } })]
        .map(record => this.authoringRecordKey(record))) })
    return drafts
  }
  private authoringRecordKey(record: AuthoringDraftRecovery['advanced'][number] | AuthoringDraftRecovery['properties'][number]): string {
    return 'bindingKey' in record ? JSON.stringify([record.bindingKey, record.kind, record.label])
      : JSON.stringify([record.documentId, record.epoch, record.kind, record.key])
  }
  private unclaimedAuthoringDrafts(snapshot: DocumentSnapshot, drafts: AuthoringDraftRecovery): AuthoringDraftRecovery {
    const claim = this.authoringDraftClaims.get(snapshot.documentId)
    const claimed = (record: AuthoringDraftRecovery['advanced'][number] | AuthoringDraftRecovery['properties'][number]) =>
      claim?.epoch === snapshot.epoch && claim.records.has(this.authoringRecordKey(record))
    return {
      advanced: drafts.advanced.filter(record => !claimed(record) && !(record.documentId === snapshot.documentId && record.epoch === snapshot.epoch)),
      properties: drafts.properties.filter(record => {
        if (claimed(record)) return false
        try { const binding: unknown = JSON.parse(record.bindingKey)
          return !(Array.isArray(binding) && binding[0] === snapshot.documentId && binding[1] === snapshot.epoch)
        } catch { return true }
      }),
    }
  }
  private async writeDraftFile(snapshot: DocumentSnapshot, drafts: AuthoringDraftRecovery, requireLive = true): Promise<void> {
    const filename = this.authoringDraftPath(snapshot), temporary = `${filename}.${randomUUID()}.tmp`
    await fs.mkdir(this.authoringDraftDirectory, { recursive: true })
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(drafts), 'utf8'); await handle.sync() } finally { await handle.close() }
      if (requireLive && this.registry.get(snapshot.documentId).read().epoch !== snapshot.epoch) throw new Error('草稿所属会话已改变，原恢复记录未覆盖')
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  writeAuthoringDrafts(documentId: string, input: AuthoringDraftRecovery): Promise<void> {
    const drafts = authoringDraftRecoverySchema.parse(input)
    const epoch = this.registry.get(documentId).read().epoch
    const write = this.authoringDraftTail.then(async () => {
      const snapshot = await this.registry.get(documentId).drain()
      const model = snapshot.model
      if (snapshot.epoch !== epoch || model.kind !== 'course-v10'
        || drafts.advanced.some(record => record.projectId !== model.project.id || record.documentId !== documentId || record.epoch !== epoch))
        throw new Error('原始草稿不属于当前课件，未覆盖恢复记录')
      for (const record of drafts.properties) {
        const binding: unknown = JSON.parse(record.bindingKey)
        if (!Array.isArray(binding) || binding[0] !== documentId || binding[1] !== epoch) throw new Error('属性草稿不属于当前课件会话，未覆盖恢复记录')
      }
      const previous = await this.readDraftFile(snapshot)
      const retained = previous ? this.unclaimedAuthoringDrafts(snapshot, previous) : { advanced: [], properties: [] }
      await this.writeDraftFile(snapshot, { advanced: [...retained.advanced, ...drafts.advanced], properties: [...retained.properties, ...drafts.properties] })
    })
    this.authoringDraftTail = write.catch(() => undefined)
    return write
  }
  clearAuthoringDrafts(documentId: string): Promise<void> {
    const epoch = this.registry.get(documentId).read().epoch
    const clear = this.authoringDraftTail.then(async () => {
      const snapshot = await this.registry.get(documentId).drain()
      if (snapshot.epoch !== epoch) throw new Error('草稿所属会话已改变，未清除恢复记录')
      await this.removeOwnedAuthoringDrafts(snapshot)
    })
    this.authoringDraftTail = clear.catch(() => undefined)
    return clear
  }
  private async removeOwnedAuthoringDrafts(snapshot: DocumentSnapshot): Promise<void> {
    const previous = await this.readDraftFile(snapshot)
    if (!previous) return
    const retained = this.unclaimedAuthoringDrafts(snapshot, previous)
    if (retained.advanced.length || retained.properties.length) await this.writeDraftFile(snapshot, retained, false)
    else await fs.rm(this.authoringDraftPath(snapshot), { force: true })
  }

  /** Trusted main consumers use the same sessions; UI envelopes remain human-only. */
  readonly internalAPI: Pick<DocumentHostAPI, 'list' | 'create' | 'recoverable' | 'restore' | 'open' | 'read' | 'dispatch' | 'lookup' | 'save' | 'observeFile' | 'reconcileFile' | 'readAuthoringDrafts' | 'writeAuthoringDrafts' | 'clearAuthoringDrafts'> & { stopRun(documentId: string, runId: string): Promise<unknown> } = {
    list: async () => this.registry.list(),
    create: async (model, suggestedName) => this.attach(await this.registry.create(model, suggestedName)),
    recoverable: () => this.operate({ type: 'recoverable' }) as Promise<DocumentSnapshot[]>,
    restore: documentId => this.operate({ type: 'restore', documentId }) as Promise<DocumentSnapshot>,
    open: filename => this.open(filename),
    read: documentId => this.registry.get(documentId).drain(),
    dispatch: operation => this.dispatch(operation),
    lookup: async (documentId, operationId) => this.registry.get(documentId).lookupOperation(operationId),
    save: (documentId, filename) => this.saveToPath(documentId, filename),
    observeFile: documentId => this.observeFile(documentId),
    reconcileFile: input => this.reconcileFile(input),
    readAuthoringDrafts: documentId => this.readAuthoringDrafts(documentId),
    writeAuthoringDrafts: (documentId, drafts) => this.writeAuthoringDrafts(documentId, drafts),
    clearAuthoringDrafts: documentId => this.clearAuthoringDrafts(documentId),
    stopRun: (documentId, runId) => this.registry.get(documentId).stopRun(runId),
  }

  private attach(session: DocumentSession): DocumentSnapshot {
    if (!this.subscribed.has(session.documentId)) {
      this.subscribed.add(session.documentId)
      session.subscribe(event => {
        if (event.type === 'closed') {
          this.subscribed.delete(event.documentId)
          for (const listener of this.closeListeners) { try { listener(event.documentId) } catch { /* Closing never waits for its listeners. */ } }
        }
        for (const listener of this.eventListeners) { try { listener(event) } catch { /* Observation cannot veto a formal edit. */ } }
        this.eventSink?.(event)
      })
    }
    return session.read()
  }

  get recoveryIssues(): readonly string[] { return [...this.fileCoordinator.recoveryIssues, ...this.journal.recoveryIssues] }

  /** Replan only known local reads; Session still performs the final CAS and durable commit. */
  private async dispatch(input: DocumentOperation): Promise<DocumentOperationResult> {
    const session = this.registry.get(input.documentId)
    if (input.mutation.type !== 'command' || input.mutation.command.type !== 'component-platform.apply') return session.execute(input)
    const requestDigest = input.requestDigest ?? documentDigest(input)
    const known = session.lookupRequest({ ...input, requestDigest })
    if (known) return known
    const snapshot = await session.drain()
    if (snapshot.epoch !== input.epoch || snapshot.model.kind !== 'course-v10' || input.baseRevision > snapshot.revision) return session.execute(input)
    try { checkComponentExpectations(snapshot.model.project, input.mutation.command) }
    catch (error) {
      if (!(error instanceof ComponentOperationConflict)) throw error
      return { status: 'conflict', documentId: input.documentId, operationId: input.operationId, code: error.code, message: error.message, applied: false }
    }
    return session.execute({ ...input, requestDigest, baseRevision: snapshot.revision })
  }
  async assertFileAvailable(filename: string): Promise<void> { this.fileCoordinator.assertResolved([filename]); await this.journal.assertAvailable([filename]) }

  private kind(filename: string): DocumentKind { return sourceFileKind(filename) }

  open(filename: string): Promise<DocumentSnapshot> { return this.fileCoordinator.withFileAccess(() => this.openFile(filename)) }
  private async openFile(filename: string): Promise<DocumentSnapshot> {
    if (!path.isAbsolute(filename)) throw new Error('文档路径必须是绝对路径')
    const canonical = await fs.realpath(filename)
    // Opening healthy existing bytes does not authorize disk mutations through an unknown old binding.
    this.fileCoordinator.assertResolved([canonical], [], true)
    await this.journal.assertAvailable([canonical], [], true)
    const kind = this.kind(canonical)
    const version = await readDocumentFileVersion(canonical, kind)
    if (version === null) throw new Error('文档已不存在')
    const session = await this.registry.open({ kind: 'file', path: canonical, version, bindingVersion: 1 }, async () => {
      const driver = this.drivers.find(value => value.kind === kind)!
      const model = await loadDocumentModel(driver, new Uint8Array(await fs.readFile(canonical)))
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
    const model = await loadDocumentModel(driver, new Uint8Array(await fs.readFile(filename)))
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

  reconcileFile(input: ReconcileDocumentFile, assertActive?: () => void): Promise<DocumentSnapshot> {
    return this.fileCoordinator.withFileAccess(() => this.registry.get(input.documentId).reconcileFile(input, async current => {
      assertActive?.()
      if (current.binding.kind !== 'file') throw new Error('文件位置已改变')
      const disk = await this.readDisk(current.binding.path, current.model.kind)
      assertActive?.()
      if (disk.version !== input.version) throw new Error('磁盘文件再次改变，请重新比较')
      if (!disk.model) throw new Error('磁盘文件已删除或移动，请另存当前稿或重新定位')
      if (input.choice === 'disk') {
        if (input.source !== undefined) throw new Error('采纳磁盘版本不能夹带其他正文')
        return { model: disk.model, version: disk.version, matchesDisk: true }
      }
      const model = structuredClone(current.model)
      if (input.source !== undefined) {
        if (!isSourceDocumentModel(model)) throw new Error('H5 演示不能使用 Markdown 合并正文')
        model.source = input.source
        if (model.kind === 'markdown' && disk.model?.kind === 'markdown') model.resources = {
          assets: { ...disk.model.resources.assets, ...model.resources.assets },
          components: { ...disk.model.resources.components, ...model.resources.components },
        }
      }
      return { model, version: disk.version, matchesDisk: false }
    }))
  }

  /** Query a correlated persisted intent and its actual file identity; never perform a second save. */
  async lookupSave(documentId: string, identity: DocumentSaveIdentity): Promise<SaveReceipt | null> {
    const proof = await this.journal.lookupSave(documentId, identity)
    if (!proof) return null
    let current = this.registry.list().find(value => value.documentId === documentId)
    if (current && (documentDigest(current.binding) === documentDigest(proof.sourceBinding)
      || documentDigest(current.binding) === documentDigest(proof.binding))) {
      await this.registry.withFileBindings([documentId], [proof.binding], async leases => {
        const lease = leases.get(documentId)!
        current = await lease.acknowledgeSave(proof)
      })
    }
    const revision = current?.revision ?? (await this.journal.inspect(documentId))?.revision
    if (revision === undefined) return null
    return { status: 'saved', documentId, epoch: proof.epoch, path: proof.binding.path,
      savedRevision: proof.savedRevision, currentRevision: revision, fileVersion: proof.binding.version,
      dirty: revision !== proof.savedRevision, warnings: revision === proof.savedRevision ? [] : ['原操作已保存；之后的修改未由该操作保存'] }
  }

  /** overwriteConfirmed is supplied only after the native dialog, never from renderer arguments. */
  async saveWithFact(documentId: string, filename?: string, saveIdentity?: DocumentSaveIdentity): Promise<{ snapshot: DocumentSnapshot; savedRevision: number }> {
    let savedRevision: number | undefined
    const snapshot = await this.saveToPath(documentId, filename, false, progress => {
      if (progress.status === 'saved') savedRevision = progress.savedRevision
    }, saveIdentity)
    if (savedRevision === undefined) throw new Error('保存已完成但缺少保存版本回执')
    return { snapshot, savedRevision }
  }

  async saveToPath(documentId: string, filename?: string, overwriteConfirmed = false, onProgress?: DocumentSaveObserver, saveIdentity?: DocumentSaveIdentity): Promise<DocumentSnapshot> {
    const initial = this.registry.get(documentId).read(), saveId = randomUUID()
    const base = { saveId, documentId, epoch: initial.epoch }
    let observedRevision = initial.revision, terminal = false, enteredSession = false
    let savingProjectId: string | undefined
    let documentName = initial.binding.kind === 'file' ? path.basename(initial.binding.path) : initial.binding.suggestedName
    const observer: DocumentSaveObserver = progress => {
      onProgress?.(progress)
      documentName = progress.binding.kind === 'file' ? path.basename(progress.binding.path) : progress.binding.suggestedName
      if (progress.status === 'saving') {
        enteredSession = true; observedRevision = progress.revision
        // The observer runs synchronously inside the session's captured-save turn.
        const captured = this.registry.get(documentId).read()
        savingProjectId = captured.model.kind === 'course-v10' ? captured.model.project.id : undefined
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'saving', revision: progress.revision })
      } else if (progress.status === 'saved') {
        terminal = true
        const savedBinding: SavedCourseIdentity | undefined = savingProjectId && progress.binding.kind === 'file'
          ? { kind: 'course-v10', path: progress.binding.path, projectId: savingProjectId, epoch: initial.epoch,
            savedRevision: progress.savedRevision, fileVersion: progress.binding.version } : undefined
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'saved', savedRevision: progress.savedRevision,
          currentRevision: progress.currentRevision, ...(savedBinding ? { savedBinding } : {}) })
      }
      else { terminal = true; this.publishSave({ ...base, documentName, time: Date.now(), status: 'failed', revision: progress.revision, error: progress.error instanceof Error ? progress.error.message : String(progress.error) }) }
    }
    return this.fileCoordinator.withFileAccess(async () => {
      const saved = await this.saveFile(documentId, filename, overwriteConfirmed, observer, saveIdentity)
      if (saved.binding.kind === 'file') await this.files.acknowledgeDocumentSave(saved.binding.path, saved.model.kind, saved.binding.version)
      if (initial.model.kind === 'course-v10' && saved.model.kind === 'course-v10'
        && this.authoringDraftPath(initial) !== this.authoringDraftPath(saved)) {
        const move = this.authoringDraftTail.then(async () => {
          const drafts = await this.readDraftFile(initial)
          if (!drafts) return
          // A concurrent current-binding collector may already have saved newer visible inputs.
          if (!await this.readDraftFile(saved)) await this.writeDraftFile(saved, drafts)
          await fs.rm(this.authoringDraftPath(initial), { force: true })
        })
        this.authoringDraftTail = move.catch(() => undefined)
        await move
      }
      return saved
    }).catch(error => {
      error = error instanceof DocumentSaveFailure ? error : new DocumentSaveFailure(enteredSession ? 'unknown' : 'not-published', error)
      // Path/ownership preflight may fail before a session captures a save revision.
      if (!terminal) {
        this.registry.get(documentId).reportSaveFailure(error)
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'failed', revision: observedRevision, error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    })
  }
  private async saveFile(documentId: string, filename?: string, overwriteConfirmed = false, observer?: DocumentSaveObserver, saveIdentity?: DocumentSaveIdentity): Promise<DocumentSnapshot> {
    const current = this.registry.get(documentId).read()
    const paths = [...(filename ? [filename] : []), ...(current.binding.kind === 'file' ? [current.binding.path] : [])]
    this.fileCoordinator.assertResolved(paths, [documentId])
    await this.journal.assertAvailable(paths, [documentId])
    if (!filename) return this.registry.save(documentId, undefined, observer, saveIdentity)
    if (!path.isAbsolute(filename)) throw new Error('保存路径必须是绝对路径')
    const canonical = path.join(await fs.realpath(path.dirname(filename)), path.basename(filename))
    if (this.kind(canonical) !== current.model.kind) throw new Error('另存格式与文档不一致')
    if (current.binding.kind === 'file' && canonicalKey(canonical) === canonicalKey(current.binding.path)) return this.registry.save(documentId, undefined, observer, saveIdentity)
    const version = await readDocumentFileVersion(canonical, current.model.kind)
    if (version !== null && !overwriteConfirmed) throw new Error('另存目标已存在，请选择新文件名')
    return this.registry.save(documentId, { kind: 'file', path: canonical, version, bindingVersion: current.binding.kind === 'file' ? current.binding.bindingVersion + 1 : 1 }, observer, saveIdentity)
  }

  async operate(raw: unknown): Promise<unknown> {
    const input: DocumentHostRequest = documentHostRequestSchema.parse(raw)
    switch (input.type) {
      case 'list': return this.registry.list()
      case 'bootstrap-course': return this.bootstrapCourse()
      case 'create': return this.attach(await this.registry.create(input.model, input.suggestedName))
      case 'open': return this.open(input.path)
      case 'read': return this.registry.get(input.documentId).drain()
      case 'read-authoring-drafts': return this.readAuthoringDrafts(input.documentId)
      case 'write-authoring-drafts': return this.writeAuthoringDrafts(input.documentId, input.drafts)
      case 'clear-authoring-drafts': return this.clearAuthoringDrafts(input.documentId)
      case 'dispatch': return this.dispatch(input.operation)
      case 'lookup': return this.registry.get(input.documentId).lookupOperation(input.operationId)
      case 'save': return this.saveToPath(input.documentId, input.path)
      case 'save-dialog': throw new Error('保存对话框需要应用窗口')
      case 'close-dialog': throw new Error('关闭对话框需要应用窗口')
      case 'observe-file': return this.observeFile(input.documentId)
      case 'reconcile-file': return this.reconcileFile(input)
      case 'close': return this.fileCoordinator.withFileAccess(async () => {
        this.fileCoordinator.assertResolved([], [input.documentId])
        const snapshot = await this.registry.get(input.documentId).drain()
        await this.registry.close(input.documentId, { discardDirty: input.discardDirty, expected: input.expected })
        if (input.discardDirty && snapshot.model.kind === 'course-v10') {
          const clear = this.authoringDraftTail.then(() => this.removeOwnedAuthoringDrafts(snapshot))
          this.authoringDraftTail = clear.catch(() => undefined)
          await clear
          await this.discardFlowDrafts({ projectId: snapshot.model.project.id,
            projectPath: snapshot.binding.kind === 'file' ? snapshot.binding.path : null, epoch: snapshot.epoch })
        }
        await this.journal.discard(input.documentId)
        this.authoringDraftClaims.delete(input.documentId)
        return
      })
      case 'recoverable': return this.fileCoordinator.withFileAccess(async () => {
        const snapshots: DocumentSnapshot[] = []
        for (const documentId of await this.journal.list()) {
          // A live dirty session is already authoritative. Listing its journal as
          // crash recovery races a view attachment and falsely blocks editing.
          if (this.registry.list().some(snapshot => snapshot.documentId === documentId)) continue
          const state = await this.journal.recover(documentId)
          let bindingUnresolved = false
          try { this.fileCoordinator.assertResolved([], [documentId]) } catch { bindingUnresolved = true }
          if (state && (state.savedRevision !== state.revision || bindingUnresolved)) snapshots.push({ documentId, epoch: state.epoch, revision: state.revision, model: state.model, binding: state.binding, dirty: true, saving: false, recoverable: true, undoDepth: state.past.length, redoDepth: state.future.length })
        }
        return snapshots
      })
      case 'restore': return this.fileCoordinator.withFileAccess(async () => {
        if (input.mode !== 'unbound') this.fileCoordinator.assertResolved([], [input.documentId])
        const state = await this.journal.recover(input.documentId)
        if (!state) throw new Error('恢复稿不存在')
        if (input.mode === 'unbound') {
          if (this.registry.list().some(snapshot => snapshot.documentId === input.documentId))
            throw new Error('该恢复稿已经打开，请从文档另存为；未改变当前绑定')
          // This explicit recovery choice changes only the binding. Content, undo/redo,
          // operation receipts and stop barriers remain owned by the same document.
          state.binding = { kind: 'untitled', suggestedName: state.binding.kind === 'file'
            ? path.basename(state.binding.path) : state.binding.suggestedName }
          state.savedRevision = null
        }
        return this.attach(await this.registry.restore(state))
      })
      case 'discard-recovery': return this.fileCoordinator.withFileAccess(async () => {
        this.fileCoordinator.assertResolved([], [input.documentId])
        if (this.registry.list().some(snapshot => snapshot.documentId === input.documentId)) throw new Error('文档已打开，请从文档关闭入口处理未保存更改')
        await this.journal.discard(input.documentId)
        return
      })
    }
  }
}
