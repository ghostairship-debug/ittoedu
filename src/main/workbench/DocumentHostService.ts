import { componentContainers } from '../../shared/contracts/component-platform/project'
import { DocumentSaveFailure, type DocumentSaveFact, type DocumentSaveIdentity, type DocumentSourcePublication, type SavedCourseIdentity } from '../../shared/workbench/documentSave'
import type { SaveReceipt } from '../../shared/workbench/toolPorts'
import { documentDigest } from '../../core/documents/documentDigest'
import { sourceFileKind } from '../../shared/workbench/sourceFileKind'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DocumentRegistry } from '../../core/documents/DocumentRegistry'
import type { DocumentSession, DocumentSaveObserver } from '../../core/documents/DocumentSession'
import { createMarkdownDriver } from '../../core/drivers/MarkdownDriver'
import { createTextDriver, TextEncodingError } from '../../core/drivers/TextDriver'
import { createDocumentArchiveDriver, loadDocumentArchive } from './documentArchiveWorker'
import type { WorkProjectMigrationMap } from '../../shared/contracts/component-platform/workProjectMigration'
import { isSourceDocumentModel, type DocumentDispatchOptions, type DocumentDriver, type DocumentEvent, type DocumentKind, type DocumentModel, type DocumentSnapshot, type DocumentOperation, type DocumentOperationResult } from '../../shared/workbench/document'
import { DesktopOperationError } from '../errors'
import { authoringDraftRecoverySchema, documentHostRequestSchema, type AuthoringDraftRecovery, type AuthoringDraftWrite, type AuthoringRecoveryClaim, type DocumentHostRequest, type DocumentHostAPI, type DocumentFileObservation, type DocumentRecoverySummary, type ReconcileDocumentFile } from '../../shared/workbench/desktop'
import { createDocumentJournal, readDocumentFileVersion, type PublishedSourceObservation } from './documentJournal'
import { captureDocumentSaveModel, prepareDocumentSave, readSourceResource } from './documentSourceResources'
import type { HtmlResourceSource } from './htmlImport/types'
import { readHtmlMediaDirectory } from './htmlImport/readHtmlClosure'
import { DocumentToolGateway } from '../../core/tools/DocumentToolGateway'
import { WorkspaceFiles, type WorkspaceFilesDependencies } from './WorkspaceFiles'
import { DocumentFileCoordinator } from './DocumentFileCoordinator'
import { FileArtifactService } from './FileArtifactService'
import { prepareImageResource } from './admittedImageResource'
import { prepareMediaResource } from './admittedMediaResource'
import { createBlankCourseProjectV10 } from '../../core/course/createCourseProjectV10'
import { InMemoryComponentCompilation } from '../../core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from './contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService, type ContentApplyPlanOptions } from './contentApply/applyService'
import { readComponentProjectFileInput, prepareComponentProjectFileSource } from './projectFiles/componentPlatformFileInput'
import { AgentFileService } from './execution/AgentFileService'
import { HostArtifactDeliveryService } from './execution/HostArtifactDeliveryService'
import { verifyContentResourceDiagnostic } from './contentApply/resources/verifyContentResourceDiagnostic'
import { app } from 'electron'
import { diagnosticLog } from '../diagnosticLog'
import { DocumentInputRecovery } from './DocumentInputRecovery'
import type { MediaFileDraftInput } from '../../shared/workbench/mediaFiles'
import { matchesSavedDocument } from './execution/savedDocumentBinding'
import { spatialViewportCaptureSchema, type SpatialViewportCapture, type SpatialViewportRequest } from '../../shared/workbench/spatialViewport'

function canonicalKey(filename: string): string {
  return process.platform === 'win32' ? filename.toLowerCase() : filename
}

async function loadDocumentModel(driver: DocumentDriver, bytes: Uint8Array, identities?: WorkProjectMigrationMap): Promise<{ model: DocumentModel; courseProjectMigrationIds?: WorkProjectMigrationMap }> {
  try {
    if (driver.kind === 'course-v10') {
      return await loadDocumentArchive(bytes, { identities, includeMigrationIds: true })
    }
    return { model: await driver.load(bytes) }
  }
  catch (error) {
    if (error instanceof TextEncodingError) throw new DesktopOperationError('TEXT_ENCODING_UNSUPPORTED', '无法打开文本', '不是 UTF-8 编码的文本文件', '请将文件转换为 UTF-8 编码后再打开。')
    throw error
  }
}

export type { DocumentSaveFact } from '../../shared/workbench/documentSave'

type HtmlDiskObservation = { path: string; version: string; model: DocumentModel; dependencies: ReadonlyMap<string, string>; sources: HtmlResourceSource[];
  directories?: ReadonlyMap<string, readonly string[] | null>; physical?: ReadonlyMap<string, string> }

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
  readonly compilation: Pick<InMemoryComponentCompilation, 'compile' | 'clear'>
  private readonly journal
  private readonly drivers
  private readonly subscribed = new Set<string>()
  private eventSink?: (event: DocumentEvent) => void
  private readonly eventListeners = new Set<(event: DocumentEvent) => void>()
  private readonly saveListeners = new Set<(fact: DocumentSaveFact) => unknown>()
  private readonly saveObservations = new Set<Promise<void>>()
  private readonly closeListeners = new Set<(documentId: string) => void>()
  private documentInputPreparer?: (documentId: string) => Promise<void>
  private spatialViewportPreparer?: (input: SpatialViewportRequest) => Promise<SpatialViewportCapture>
  private mediaCopyPreparer?: (source: string, kind: 'file' | 'directory') => Promise<readonly MediaFileDraftInput[]>
  private bootstrapping?: Promise<DocumentSnapshot>
  private readonly inputs: DocumentInputRecovery
  /** A projection of the last disk read, owned by the same session and never persisted. */
  private readonly htmlDiskObservations = new WeakMap<DocumentSession, HtmlDiskObservation>()
  /** A published candidate is reusable only after its own Session accepts the save. */
  private readonly pendingSourceSaveObservations = new WeakMap<DocumentSession, PublishedSourceObservation & { epoch: string }>()

  constructor(directory: string, fileDependencies: Pick<WorkspaceFilesDependencies, 'trashItem' | 'showItemInFolder' | 'fileOperations'> = {},
    options: { artifactDeliveryDirectory?: string; legacyFlowRecoveryDirectory?: string } = {}) {
    this.inputs = new DocumentInputRecovery(path.join(directory, 'authoring-drafts'), options.legacyFlowRecoveryDirectory
      ?? (typeof app?.getPath === 'function' ? path.join(app.getPath('userData'), 'flow-document-recovery', 'v1') : undefined))
    this.drivers = [createMarkdownDriver(), createTextDriver(), createDocumentArchiveDriver()]
    this.journal = createDocumentJournal({ directory, isLive: documentId => this.registry?.has(documentId) ?? false,
      currentSource: filename => this.currentSource(filename),
      observeSourcePublication: documentId => {
        if (!this.registry.has(documentId)) return
        const session = this.registry.get(documentId), epoch = session.readIdentity().epoch
        return observation => {
          if (this.registry.has(documentId) && this.registry.get(documentId) === session)
            this.pendingSourceSaveObservations.set(session, { ...observation, epoch })
        }
      },
      onBindingRecovered: state => this.refreshInputBinding(state) })
    this.registry = new DocumentRegistry({ persistence: this.journal, drivers: this.drivers, createId: randomUUID, bindingKey: binding => canonicalKey(binding.path),
      onClosed: () => { if (this.registry.size === 0) this.compilation.clear() } })
    this.compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    this.tools = new DocumentToolGateway(this.registry, this.drivers, randomUUID, { prepareImage: prepareImageResource, prepareMedia: prepareMediaResource,
      prepareInput: documentId => this.prepareDocumentInput(documentId),
      prepareSpatialViewport: (documentId: string, surfaceId: string) => this.prepareSpatialViewport(documentId, surfaceId),
      componentContent: {
        verifyDiagnostic: (snapshot, diagnostic) => verifyContentResourceDiagnostic({ project: snapshot.model.project,
          resources: snapshot.model.resources, diagnostic }),
        source: (from, fileAccess, sourceHtml?: string) => readComponentProjectFileInput({ from, fileAccess, sourceHtml,
          currentSource: async (filename: string) => {
            const snapshot = await this.readOpenedSource(filename)
            return snapshot && isSourceDocumentModel(snapshot.model) ? snapshot.model.source : undefined
          },
        }),
        prepareSource: prepareComponentProjectFileSource,
        plan: (input, options?: ContentApplyPlanOptions) => new ContentApplyService({
          session: { project: () => input.baseline.model.project, resources: () => input.baseline.model.resources,
            async dispatch() { throw new Error('工程内容规划不能提交正式状态') } },
          measure: async request => (await import('./contentApply/measurement/ElectronHtmlDesignMeasurement.js')).measureHtmlAtDesignViewport(request),
          compilation: this.compilation,
        }).plan(input.request, undefined, options),
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
    this.fileCoordinator.subscribeRelocations(action => this.inputs.relocate(action))
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
          await this.prepareDocumentInput(observed.documentId)
          const snapshot = await this.registry.get(observed.documentId).drain()
          if (snapshot.binding.kind !== 'file' || canonicalKey(snapshot.binding.path) !== canonicalKey(observed.binding.path)) throw new Error('复制期间当前稿文件位置已变化')
          const driver = this.drivers.find(driver => driver.kind === snapshot.model.kind)
          if (!driver) throw new Error('当前稿格式没有可用的保存编码器')
          const copyModel = await captureDocumentSaveModel(snapshot.model, snapshot.binding, { currentSource: filename => this.currentSource(filename) })
          captured.push({ sourcePath: snapshot.binding.path, relativePath: kind === 'file' ? '' : relative,
            bytes: await driver.serialize(copyModel), ...(snapshot.model.kind === 'markdown'
              ? { markdown: { source: snapshot.model.source, resources: copyModel.resources } } : {}) })
        }
        const media = await this.mediaCopyPreparer?.(source, kind) ?? []
        if (media.length) captured.push(...await this.artifacts.captureCopyContent(source, kind, media))
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

  /** Binding metadata helps locate raw input; its maintenance cannot undo a
   * completed save or make an already usable recovered document unavailable. */
  private async refreshInputBinding(owner: Parameters<DocumentInputRecovery['refresh']>[0]): Promise<void> {
    try { await this.inputs.refresh(owner) }
    catch (error) {
      void diagnosticLog.append({ source: 'main', message: '输入恢复记录的位置更新未完成，原始输入继续保留。',
        stack: error instanceof Error ? error.stack : undefined,
        details: { documentId: owner.documentId, operation: 'input-binding-refresh' } }).catch(() => undefined)
    }
  }

  bootstrapCourse(): Promise<DocumentSnapshot> {
    const live = this.registry.list().find(snapshot => snapshot.model.kind === 'course-v10')
    if (live) return Promise.resolve(live)
    if (!this.bootstrapping) {
      const project = createBlankCourseProjectV10()
      this.bootstrapping = this.registry.create({ kind: 'course-v10', project,
        resources: { assets: {}, components: {} },
      }, `${project.title}.glx`, true).then(session => this.attach(session))
        .finally(() => { this.bootstrapping = undefined })
    }
    return this.bootstrapping
  }

  async readAuthoringDrafts(documentId: string): Promise<AuthoringDraftRecovery | null> {
    return this.inputs.read(await this.registry.get(documentId).drain())
  }
  async writeAuthoringDrafts(documentId: string, drafts: AuthoringDraftWrite, expectedEpoch?: string): Promise<void> {
    const epoch = expectedEpoch ?? this.registry.get(documentId).read().epoch
    const snapshot = await this.registry.get(documentId).drain()
    if (snapshot.epoch !== epoch) throw new Error('输入所属文档已关闭或重开，原恢复记录未覆盖')
    const model = snapshot.model
    if ((drafts.advanced ?? []).some(record => record.documentId !== documentId || record.epoch !== epoch
      || (model.kind === 'course-v10' ? record.projectId !== model.project.id
        : (model.kind !== 'text' && model.kind !== 'markdown') || record.kind !== 'source' || record.projectId !== documentId))
      || [...(drafts.sourceConflicts ?? []), ...(drafts.sourceConflict ? [drafts.sourceConflict] : [])].some(record => model.kind === 'course-v10' || record.documentId !== documentId || record.epoch !== epoch)
      || (drafts.flow ?? []).some(record => model.kind !== 'course-v10' || record.projectId !== model.project.id || record.documentId && record.documentId !== documentId || record.documentEpoch !== epoch))
      throw new Error('原始输入不属于当前文档，原恢复记录未覆盖')
    for (const record of drafts.properties ?? []) {
      const binding: unknown = JSON.parse(record.bindingKey)
      if (!Array.isArray(binding) || binding[0] !== documentId || binding[1] !== epoch) throw new Error('属性草稿不属于当前课件会话，未覆盖恢复记录')
    }
    await this.inputs.write(snapshot, drafts, () => {
      if (this.registry.get(documentId).read().epoch !== epoch) throw new Error('输入所属文档已关闭或重开，原记录已保留')
    })
  }
  async claimAuthoringDrafts(documentId: string, epoch: string, records: AuthoringRecoveryClaim[]): Promise<void> {
    const snapshot = await this.registry.get(documentId).drain()
    if (snapshot.epoch !== epoch) throw new Error('输入所属文档已关闭或重开，未认领恢复记录')
    await this.inputs.claim(snapshot, records, () => {
      if (this.registry.get(documentId).read().epoch !== epoch) throw new Error('输入所属文档已关闭或重开，原记录已保留')
    })
  }
  async clearAuthoringDrafts(documentId: string): Promise<void> {
    await this.inputs.clear(await this.registry.get(documentId).drain())
  }

  /** Trusted main consumers use the same sessions; UI envelopes remain human-only. */
  readonly internalAPI: Pick<DocumentHostAPI, 'list' | 'create' | 'recoverable' | 'recoverySummaries' | 'restore' | 'open' | 'read' | 'dispatch' | 'lookup' | 'save' | 'observeFile' | 'reconcileFile' | 'readAuthoringDrafts' | 'writeAuthoringDrafts' | 'clearAuthoringDrafts' | 'claimAuthoringDrafts'> & { stopRun(documentId: string, runId: string): Promise<unknown> } = {
    list: async () => this.registry.list(),
    create: async (model, suggestedName) => this.attach(await this.registry.create(model, suggestedName)),
    recoverable: () => this.operate({ type: 'recoverable' }) as Promise<DocumentSnapshot[]>,
    recoverySummaries: () => this.operate({ type: 'recovery-summaries' }) as Promise<DocumentRecoverySummary[]>,
    restore: documentId => this.operate({ type: 'restore', documentId }) as Promise<DocumentSnapshot>,
    open: filename => this.open(filename),
    read: documentId => this.registry.get(documentId).drain(),
    dispatch: (operation, options) => this.dispatch(operation, options),
    lookup: async (documentId, operationId) => this.registry.get(documentId).lookupOperation(operationId),
    save: (documentId, filename) => this.saveToPath(documentId, filename),
    observeFile: (documentId, knownVersion) => this.observeFile(documentId, knownVersion),
    reconcileFile: input => this.reconcileFile(input),
    readAuthoringDrafts: documentId => this.readAuthoringDrafts(documentId),
    writeAuthoringDrafts: (documentId, drafts, epoch) => this.writeAuthoringDrafts(documentId, drafts, epoch),
    claimAuthoringDrafts: (documentId, epoch, records) => this.claimAuthoringDrafts(documentId, epoch, records),
    clearAuthoringDrafts: documentId => this.clearAuthoringDrafts(documentId),
    stopRun: (documentId, runId) => this.registry.get(documentId).stopRun(runId),
  }

  private attach(session: DocumentSession): DocumentSnapshot {
    if (!this.subscribed.has(session.documentId)) {
      this.subscribed.add(session.documentId)
      session.subscribe(event => {
        if (event.type === 'changed' || event.type === 'state') {
          const head = event.head
          const owner = head ? { documentId: head.documentId, epoch: head.epoch, binding: head.binding,
            model: head.kind === 'course-v10' ? { kind: head.kind, project: { id: head.projectId! } } : { kind: head.kind } }
            : event.type === 'changed' ? event.snapshot : undefined
          if (owner) void this.refreshInputBinding(owner)
        }
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

  /** GUI composition connects the existing renderer input owner; headless hosts have no renderer drafts. */
  setDocumentInputPreparer(prepare?: (documentId: string) => Promise<void>): void { this.documentInputPreparer = prepare }

  prepareDocumentInput(documentId: string): Promise<void> { return this.documentInputPreparer?.(documentId) ?? Promise.resolve() }

  setSpatialViewportPreparer(prepare?: (input: SpatialViewportRequest) => Promise<SpatialViewportCapture>): void { this.spatialViewportPreparer = prepare }

  async prepareSpatialViewport(documentId: string, surfaceId: string): Promise<SpatialViewportCapture> {
    await this.prepareDocumentInput(documentId)
    const before = this.registry.get(documentId).read()
    if (before.model.kind !== 'course-v10' || !componentContainers(before.model.project).some(surface => surface.id === surfaceId && surface.kind === 'spatial'))
      throw new Error('原空间表面已不存在，请重新观察。')
    if (!this.spatialViewportPreparer) throw new Error('当前空间视口尚未运行，请打开原空间视口后重试。')
    const capture = spatialViewportCaptureSchema.parse(await this.spatialViewportPreparer({ documentId, epoch: before.epoch, surfaceId }))
    const after = this.registry.get(documentId).read()
    if (capture.documentId !== documentId || capture.epoch !== before.epoch || after.epoch !== before.epoch || capture.surfaceId !== surfaceId
      || after.model.kind !== 'course-v10' || !componentContainers(after.model.project).some(surface => surface.id === surfaceId && surface.kind === 'spatial'))
      throw new Error('原空间视口的文档身份或表面已变化，请重新观察。')
    return capture
  }

  setMediaCopyPreparer(prepare?: (source: string, kind: 'file' | 'directory') => Promise<readonly MediaFileDraftInput[]>): void {
    this.mediaCopyPreparer = prepare
  }

  /** The original input owner confirms its draft before Main captures an already-open source. */
  async readOpenedSource(filename: string): Promise<DocumentSnapshot | undefined> {
    const snapshot = await this.readOpenedTaskInput(filename)
    return snapshot && isSourceDocumentModel(snapshot.model) ? snapshot : undefined
  }

  /** Authorization precedes this lookup; the current document remains usable when its disk path is absent. */
  async readOpenedTaskInput(filename: string): Promise<DocumentSnapshot | undefined> {
    const observed = this.registry.listIdentities().find(snapshot => snapshot.binding.kind === 'file'
      && canonicalKey(snapshot.binding.path) === canonicalKey(filename))
    if (!observed) return undefined
    await this.prepareDocumentInput(observed.documentId)
    const snapshot = await this.registry.get(observed.documentId).drain()
    if (snapshot.epoch !== observed.epoch || snapshot.binding.kind !== 'file'
      || canonicalKey(snapshot.binding.path) !== canonicalKey(filename)) throw new Error('读取期间打开源文件的绑定已改变，请重新观察')
    return snapshot
  }

  private async currentSource(filename: string): Promise<string | undefined> {
    const snapshot = await this.readOpenedSource(filename)
    return snapshot && isSourceDocumentModel(snapshot.model) ? snapshot.model.source : undefined
  }

  /** Replan only known local reads; Session still performs the final CAS and durable commit. */
  private async dispatch(input: DocumentOperation, options?: DocumentDispatchOptions): Promise<DocumentOperationResult> {
    const session = this.registry.get(input.documentId)
    if (input.mutation.type !== 'command' || input.mutation.command.type !== 'component-platform.apply') return session.execute(input, options)
    return session.execute(input, { sourceChangeHints: options?.sourceChangeHints, rebaseComponentExpectations: true })
  }
  async assertFileAvailable(filename: string): Promise<void> { this.fileCoordinator.assertResolved([filename]); await this.journal.assertAvailable([filename]) }

  private kind(filename: string): DocumentKind { return sourceFileKind(filename) }

  open(filename: string): Promise<DocumentSnapshot> { return this.fileCoordinator.withFileAccess(() => this.openFile(filename)) }
  private async captureDiskModel(model: DocumentModel, binding: Extract<DocumentSnapshot['binding'], { kind: 'file' }>): Promise<{ model: DocumentModel; observation?: HtmlDiskObservation }> {
    if (!isSourceDocumentModel(model) || binding.version === null)
      return { model: await captureDocumentSaveModel(model, binding) }
    const directories = new Map<string, readonly string[] | null>()
    let sources: HtmlResourceSource[] = []
    const captured = await prepareDocumentSave(model, binding, { onDependencyDirectory: (relative, files) => {
      directories.set(relative, files ? [...files.keys()].sort() : null)
    },
      onHtmlResourceSources: value => { sources = value } })
    return { model: captured.model, observation: this.sourceDiskObservation(captured.model, binding, captured.sourcePublication, sources, directories.size > 0, directories) }
  }
  private sourceDiskObservation(model: DocumentModel, binding: DocumentSnapshot['binding'], publication: DocumentSourcePublication | undefined,
    sources: HtmlResourceSource[], directoryDependency: boolean, directories?: ReadonlyMap<string, readonly string[] | null>): HtmlDiskObservation | undefined {
    if (!isSourceDocumentModel(model) || binding.kind !== 'file' || binding.version === null
      || (directoryDependency && !directories) || publication?.componentDirectories.length) return
    const dependencies = new Map((publication?.references ?? []).map(reference => [reference, 'missing']))
    for (const file of publication?.files ?? []) dependencies.set(file.path, file.version)
    return { path: binding.path, version: binding.version, model, dependencies, sources, directories }
  }
  private async unchangedHtmlDependencies(observation: HtmlDiskObservation): Promise<boolean> {
    const root = path.dirname(observation.path)
    for (const [relative, expected] of observation.dependencies) {
      let actual: string
      try { actual = (await readSourceResource(root, relative)).version }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; actual = 'missing' }
      if (actual !== expected) return false
    }
    for (const [relative, expected] of observation.directories ?? []) {
      let actual: string[] | null
      try { actual = [...(await readHtmlMediaDirectory(root, root, relative)).keys()].sort() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; actual = null }
      if (actual === null || expected === null) { if (actual !== expected) return false }
      else if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) return false
    }
    return true
  }
  private async diskPhysicalFacts(observation: HtmlDiskObservation): Promise<ReadonlyMap<string, string>> {
    const filenames = [observation.path, ...[...observation.dependencies.keys(), ...(observation.directories?.keys() ?? [])]
      .map(relative => path.resolve(path.dirname(observation.path), relative))]
    const facts = new Map<string, string>()
    for (const filename of filenames) {
      try {
        const real = await fs.realpath(filename), stat = await fs.stat(filename, { bigint: true })
        facts.set(filename, `${real}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; facts.set(filename, 'missing') }
    }
    return facts
  }
  private sameDiskFacts(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
    return left.size === right.size && [...left].every(([filename, value]) => right.get(filename) === value)
  }
  /** Establish the metadata baseline around one strong observation. Afterwards
   * unchanged polling checks file identity/metadata, not every source byte. */
  private async unchangedDiskObservation(observation: HtmlDiskObservation, strong: boolean): Promise<boolean> {
    const before = await this.diskPhysicalFacts(observation)
    if (!strong && observation.physical) return this.sameDiskFacts(observation.physical, before)
    if (await readDocumentFileVersion(observation.path, observation.model.kind) !== observation.version
      || !await this.unchangedHtmlDependencies(observation)) return false
    const after = await this.diskPhysicalFacts(observation)
    if (!this.sameDiskFacts(before, after)) return false
    observation.physical = after
    return true
  }
  /** Reuse the disk preparation already completed by this same Session. A new
   * source or a changed/missing/reappearing dependency gets a fresh analysis. */
  async readCapturedHtmlPreviewSources(documentId: string, source: string, rootRealPath: string): Promise<{
    sources: HtmlResourceSource[]; dependencies: ReadonlyMap<string, string>
  } | undefined> {
    const session = this.registry.get(documentId), previous = this.htmlDiskObservations.get(session)
    if (!previous || previous.model.kind !== 'text' || previous.model.source !== source
      || canonicalKey(path.dirname(previous.path)) !== canonicalKey(rootRealPath)
      || !await this.unchangedDiskObservation(previous, false)) return
    return { sources: previous.sources.map(value => ({ ...value })), dependencies: new Map(previous.dependencies) }
  }
  private async openFile(filename: string): Promise<DocumentSnapshot> {
    if (!path.isAbsolute(filename)) throw new Error('文档路径必须是绝对路径')
    const canonical = await fs.realpath(filename)
    // Opening healthy existing bytes does not authorize disk mutations through an unknown old binding.
    this.fileCoordinator.assertResolved([canonical], [], true)
    await this.journal.assertAvailable([canonical], [], true)
    const kind = this.kind(canonical)
    const version = await readDocumentFileVersion(canonical, kind)
    if (version === null) throw new Error('文档已不存在')
    let observation: HtmlDiskObservation | undefined
    const session = await this.registry.open({ kind: 'file', path: canonical, version, bindingVersion: 1 }, async () => {
      const driver = this.drivers.find(value => value.kind === kind)!
      const loaded = await loadDocumentModel(driver, new Uint8Array(await fs.readFile(canonical)))
      const { model } = loaded
      const captured = await this.captureDiskModel(model, { kind: 'file', path: canonical, version, bindingVersion: 1 })
      model.resources = captured.model.resources
      if (await readDocumentFileVersion(canonical, kind) !== version) throw new Error('读取期间文档已改变，请重新打开')
      // Session.create validates once; the archive worker already checked this
      // owned GLX model, including its resources and professional data.
      observation = captured.observation
      return loaded
    })
    if (observation) this.htmlDiskObservations.set(session, observation)
    return this.attach(session)
  }

  private async readDisk(filename: string, kind: DocumentKind, identities?: WorkProjectMigrationMap, observed?: (value: HtmlDiskObservation | undefined) => void): Promise<{ version: string | null; model: DocumentSnapshot['model'] | null; courseProjectMigrationIds?: WorkProjectMigrationMap }> {
    const version = await readDocumentFileVersion(filename, kind)
    if (version === null) return { version, model: null }
    const driver = this.drivers.find(value => value.kind === kind)!
    const loaded = await loadDocumentModel(driver, new Uint8Array(await fs.readFile(filename)), identities)
    const { model } = loaded
    const captured = await this.captureDiskModel(model, { kind: 'file', path: filename, version, bindingVersion: 1 })
    model.resources = captured.model.resources
    if (await readDocumentFileVersion(filename, kind) !== version) throw new Error('读取期间文件已改变，请重新比较')
    if (kind !== 'course-v10') driver.validate(model)
    observed?.(captured.observation)
    return { version, ...loaded }
  }

  observeFile(documentId: string, knownVersion?: string | null): Promise<DocumentFileObservation> { return this.fileCoordinator.withFileAccess(() => this.observeDisk(documentId, knownVersion)) }
  private async observeDisk(documentId: string, knownVersion?: string | null): Promise<DocumentFileObservation> {
    const session = this.registry.get(documentId), snapshot = await session.drainIdentity()
    if (snapshot.binding.kind !== 'file') throw new Error('未保存文档没有磁盘版本')
    const baseSource = session.readSavedSource()
    const previous = this.htmlDiskObservations.get(session)
    if (previous && previous.path === snapshot.binding.path
      && await this.unchangedDiskObservation(previous, knownVersion === undefined))
      return { bindingVersion: snapshot.binding.bindingVersion, ...(baseSource === undefined ? {} : { baseSource }),
        version: previous.version, model: knownVersion === previous.version && previous.version === snapshot.binding.version ? null : structuredClone(previous.model) }
    const { version, model } = await this.readDisk(snapshot.binding.path, snapshot.kind, session.readCourseProjectMigrationIds(), observation => {
      if (observation) this.htmlDiskObservations.set(session, observation)
      else this.htmlDiskObservations.delete(session)
    })
    return { bindingVersion: snapshot.binding.bindingVersion, ...(baseSource === undefined ? {} : { baseSource }), version, model }
  }

  reconcileFile(input: ReconcileDocumentFile, assertActive?: () => void): Promise<DocumentSnapshot> {
    return this.fileCoordinator.withFileAccess(() => this.registry.get(input.documentId).reconcileFile(input, async current => {
      assertActive?.()
      if (current.binding.kind !== 'file') throw new Error('文件位置已改变')
      const disk = await this.readDisk(current.binding.path, current.model.kind, this.registry.get(input.documentId).readCourseProjectMigrationIds())
      assertActive?.()
      if (disk.version !== input.version) throw new Error('磁盘文件再次改变，请重新比较')
      if (!disk.model) throw new Error('磁盘文件已删除或移动，请另存当前稿或重新定位')
      if (input.choice === 'disk') {
        if (input.source !== undefined) throw new Error('采纳磁盘版本不能夹带其他正文')
        return { model: disk.model, diskModel: disk.model, version: disk.version, matchesDisk: true, courseProjectMigrationIds: disk.courseProjectMigrationIds }
      }
      const model = structuredClone(current.model)
      if (input.source !== undefined) {
        if (!isSourceDocumentModel(model)) throw new Error('果铃工程不能使用 Markdown 合并正文')
        model.source = input.source
        if (model.kind === 'markdown' && disk.model?.kind === 'markdown') {
          const base = this.registry.get(input.documentId).readSavedModel()?.resources
          const merge = <T>(local: Record<string, T>, remote: Record<string, T>, before: Record<string, T> = {}) => Object.fromEntries(
            [...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap(key => {
              const localChanged = !isDeepStrictEqual(local[key], before[key]), remoteChanged = !isDeepStrictEqual(remote[key], before[key])
              if (localChanged && remoteChanged && !isDeepStrictEqual(local[key], remote[key])) throw new Error(`素材 ${key} 在当前稿和磁盘稿均有改变，请保留原稿后处理素材冲突`)
              const value = localChanged ? local[key] : remote[key]
              return value === undefined ? [] : [[key, value]]
            }))
          model.resources = { assets: merge(model.resources.assets, disk.model.resources.assets, base?.assets),
            components: merge(model.resources.components, disk.model.resources.components, base?.components) }
        }
      }
      return { model, diskModel: disk.model, version: disk.version, matchesDisk: false, courseProjectMigrationIds: disk.courseProjectMigrationIds }
    }))
  }

  /** Relate a persisted source to an already-authorized live session; this grants no document access. */
  async matchesSavedDocument(sourceDocumentId: string, currentDocumentId: string): Promise<boolean> {
    const source = await this.journal.inspect(sourceDocumentId)
    if (!source || source.binding.kind !== 'file' || source.model.kind !== 'course-v10' || source.savedRevision === null) return false
    const current = this.registry.list().find(snapshot => snapshot.documentId === currentDocumentId)
    if (!current) return false
    return matchesSavedDocument({ kind: 'course-v10', path: source.binding.path, projectId: source.model.project.id,
      epoch: source.epoch, savedRevision: source.savedRevision, fileVersion: source.binding.version }, current)
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
    // Closing/discarding the authoring document does not invalidate the original
    // disk publication. A retained proof can be queried without reopening it.
    const revision = current?.revision ?? (await this.journal.inspect(documentId))?.revision ?? proof.savedRevision
    return { status: 'saved', documentId, epoch: proof.epoch, path: proof.binding.path,
      savedRevision: proof.savedRevision, currentRevision: revision, fileVersion: proof.binding.version,
      dirty: revision !== proof.savedRevision, warnings: [...(proof.warnings ?? []), ...(revision === proof.savedRevision ? [] : ['原操作已保存；之后的修改未由该操作保存'])] }
  }

  /** overwriteConfirmed is supplied only after the native dialog, never from renderer arguments. */
  async saveWithFact(documentId: string, filename?: string, saveIdentity?: DocumentSaveIdentity): Promise<{ snapshot: DocumentSnapshot; savedRevision: number; warnings: string[] }> {
    let savedRevision: number | undefined
    let warnings: string[] = []
    const snapshot = await this.saveToPath(documentId, filename, false, progress => {
      if (progress.status === 'saved') { savedRevision = progress.savedRevision; warnings = progress.warnings }
    }, saveIdentity)
    if (savedRevision === undefined) throw new Error('保存已完成但缺少保存版本回执')
    return { snapshot, savedRevision, warnings }
  }

  async saveToPath(documentId: string, filename?: string, overwriteConfirmed = false, onProgress?: DocumentSaveObserver, saveIdentity?: DocumentSaveIdentity): Promise<DocumentSnapshot> {
    const session = this.registry.get(documentId), initial = session.readIdentity(), saveId = randomUUID()
    const identity = saveIdentity ?? { runId: saveId, operationId: saveId, requestDigest: documentDigest({ documentId, saveId, filename }) }
    const base = { saveId, documentId, epoch: initial.epoch }
    let observedRevision = initial.revision, terminal = false, enteredSession = false
    let savingProjectId: string | undefined
    let documentName = initial.binding.kind === 'file' ? path.basename(initial.binding.path) : initial.binding.suggestedName
    const observer: DocumentSaveObserver = progress => {
      onProgress?.(progress)
      documentName = progress.binding.kind === 'file' ? path.basename(progress.binding.path) : progress.binding.suggestedName
      if (progress.status === 'saving') {
        enteredSession = true; observedRevision = progress.revision
        // Course receipts need the captured project identity; source save facts
        // use only the lightweight revision/binding facts already supplied here.
        if (initial.kind === 'course-v10') {
          // The observer runs synchronously inside the session's captured-save turn.
          const captured = this.registry.get(documentId).read()
          savingProjectId = captured.model.kind === 'course-v10' ? captured.model.project.id : undefined
        }
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'saving', revision: progress.revision })
      } else if (progress.status === 'saved') {
        terminal = true
        const prepared = this.pendingSourceSaveObservations.get(session)
        this.pendingSourceSaveObservations.delete(session)
        if (prepared && prepared.epoch === initial.epoch && prepared.revision === progress.savedRevision
          && progress.binding.kind === 'file' && prepared.binding.path === progress.binding.path
          && prepared.binding.bindingVersion === progress.binding.bindingVersion && prepared.binding.version === progress.binding.version
          && this.registry.has(documentId) && this.registry.get(documentId) === session) {
          const observation = this.sourceDiskObservation(prepared.model, prepared.binding, prepared.publication, prepared.sources, prepared.directoryDependency)
          if (observation) this.htmlDiskObservations.set(session, observation)
          else this.htmlDiskObservations.delete(session)
        }
        const savedBinding: SavedCourseIdentity | undefined = savingProjectId && progress.binding.kind === 'file'
          ? { kind: 'course-v10', path: progress.binding.path, projectId: savingProjectId, epoch: initial.epoch,
            savedRevision: progress.savedRevision, fileVersion: progress.binding.version } : undefined
        this.publishSave({ ...base, documentName, time: Date.now(), status: 'saved', savedRevision: progress.savedRevision,
          currentRevision: progress.currentRevision, warnings: progress.warnings, ...(savedBinding ? { savedBinding } : {}) })
      }
      else { terminal = true; this.publishSave({ ...base, documentName, time: Date.now(), status: 'failed', revision: progress.revision, error: progress.error instanceof Error ? progress.error.message : String(progress.error) }) }
    }
    return this.fileCoordinator.withFileAccess(async () => {
      let saved: DocumentSnapshot
      try { saved = await this.saveFile(documentId, filename, overwriteConfirmed, observer, identity) }
      catch (error) {
        // The original Session/Registry save has exited before acquiring its file
        // lease. Query the same publication; never reissue an uncertain disk save.
        if (!enteredSession || !(error instanceof DocumentSaveFailure) || error.publication !== 'unknown') throw error
        try {
          const receipt = await this.lookupSave(documentId, identity)
          if (!receipt || receipt.savedRevision === undefined || !this.registry.has(documentId) || this.registry.get(documentId) !== session) throw error
          saved = await session.drain()
          if (saved.binding.kind !== 'file' || saved.binding.path !== receipt.path || saved.binding.version !== receipt.fileVersion) throw error
          observer({ status: 'saved', savedRevision: receipt.savedRevision, currentRevision: saved.revision,
            binding: saved.binding, warnings: [...(receipt.warnings ?? [])] })
        } catch { throw error }
      }
      if (saved.binding.kind === 'file') await this.files.acknowledgeDocumentSave(saved.binding.path, saved.model.kind, saved.binding.version)
      await this.refreshInputBinding(saved)
      return saved
    }).catch(error => {
      this.pendingSourceSaveObservations.delete(session)
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
    const current = this.registry.get(documentId).readIdentity()
    const paths = [...(filename ? [filename] : []), ...(current.binding.kind === 'file' ? [current.binding.path] : [])]
    this.fileCoordinator.assertResolved(paths, [documentId])
    await this.journal.assertAvailable(paths, [documentId])
    if (!filename) return this.registry.save(documentId, undefined, observer, saveIdentity)
    if (!path.isAbsolute(filename)) throw new Error('保存路径必须是绝对路径')
    const canonical = path.join(await fs.realpath(path.dirname(filename)), path.basename(filename))
    if (this.kind(canonical) !== current.kind) throw new Error('另存格式与文档不一致')
    if (current.binding.kind === 'file' && canonicalKey(canonical) === canonicalKey(current.binding.path)) return this.registry.save(documentId, undefined, observer, saveIdentity)
    const version = await readDocumentFileVersion(canonical, current.kind)
    if (version !== null && !overwriteConfirmed) throw new Error('另存目标已存在，请选择新文件名')
    return this.registry.save(documentId, { kind: 'file', path: canonical, version, bindingVersion: current.binding.kind === 'file' ? current.binding.bindingVersion + 1 : 1 }, observer, saveIdentity)
  }

  async renameDocument(input: Extract<DocumentHostRequest, { type: 'rename' }>): Promise<DocumentSnapshot> {
    const failure = (message: string) => new DesktopOperationError('DOCUMENT_RENAME_FAILED', '重命名未完成', message, '原稿保留；请核对名称或刷新后重试。')
    const original = await this.internalAPI.read(input.documentId)
    if (original.epoch !== input.epoch) throw failure('文档已关闭或重开，请重新重命名')
    const oldName = original.binding.kind === 'file' ? path.basename(original.binding.path) : original.binding.suggestedName
    if (path.extname(input.name).toLowerCase() !== path.extname(oldName).toLowerCase()) throw failure('重命名请保留原文件扩展名')
    if (original.binding.kind === 'untitled') return this.fileCoordinator.withFileAccess(() => this.registry.get(input.documentId).withFileLease(async lease => {
      const current = lease.read()
      if (current.epoch !== input.epoch || current.binding.kind !== 'untitled') throw failure('文档绑定已改变，请重新重命名')
      return lease.rebind({ kind: 'untitled', suggestedName: input.name })
    }))
    const sourcePath = original.binding.path
    // Register an internal handle only; this does not grant the renderer a new workspace root.
    const root = await this.files.registerRoot(path.dirname(sourcePath))
    let cursor: string | undefined, entryId: string | undefined
    do {
      const page = await this.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId, cursor })
      const found = page.entries.find(entry => entry.status === 'accessible' && entry.name === oldName)
      if (found?.status === 'accessible') entryId = found.entryId
      cursor = page.nextCursor
    } while (!entryId && cursor)
    if (!entryId) throw failure('原文件已移动，请刷新后重新命名')
    const result = await this.files.rename({ workspaceId: root.workspaceId, operationId: randomUUID(), sourceEntryId: entryId, name: input.name }, () => {
      // Already in FileService's exclusive queue. Read synchronously to avoid a nested shared lock.
      const current = this.registry.get(input.documentId).read()
      if (current.epoch !== input.epoch || current.binding.kind !== 'file' || canonicalKey(current.binding.path) !== canonicalKey(sourcePath))
        throw failure('文档绑定已改变，请重新重命名')
    })
    const failedItem = result.items.find(item => item.status !== 'success')
    if (failedItem) throw failure(failedItem.error?.message ?? '文件未能重命名，原稿保留')
    return this.internalAPI.read(input.documentId)
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
      case 'write-authoring-drafts': return this.writeAuthoringDrafts(input.documentId, input.drafts, input.epoch)
      case 'claim-authoring-drafts': return this.claimAuthoringDrafts(input.documentId, input.epoch, input.records)
      case 'clear-authoring-drafts': return this.clearAuthoringDrafts(input.documentId)
      case 'dispatch': return this.dispatch(input.operation, { sourceChangeHints: input.sourceChangeHints })
      case 'lookup': return this.registry.get(input.documentId).lookupOperation(input.operationId)
      case 'save': return this.saveToPath(input.documentId, input.path)
      case 'save-dialog': throw new Error('保存对话框需要应用窗口')
      case 'close-dialog': throw new Error('关闭对话框需要应用窗口')
      case 'observe-file': return this.observeFile(input.documentId, input.knownVersion)
      case 'reconcile-file': return this.reconcileFile(input)
      case 'close': return this.fileCoordinator.withFileAccess(async () => {
        this.fileCoordinator.assertResolved([], [input.documentId])
        const snapshot = await this.registry.get(input.documentId).drain()
        await this.refreshInputBinding(snapshot)
        await this.registry.close(input.documentId, { discardDirty: input.discardDirty, expected: input.expected ?? { epoch: snapshot.epoch, revision: snapshot.revision } })
        // Raw inputs survive normal close and formal discard until individually adopted or explicitly resolved.
        await this.journal.discard(input.documentId)
        return
      })
      case 'recovery-summaries': return this.fileCoordinator.withFileAccess(async () => {
        const summaries: DocumentRecoverySummary[] = []
        const inputs = (await this.inputs.list()).filter(envelope => envelope.records.length)
        const name = (binding: DocumentRecoverySummary['binding'], title?: string) => binding.kind === 'file'
          ? path.basename(binding.path) : title || binding.suggestedName
        for (const entry of await this.journal.listBindings()) {
          if (this.registry.has(entry.documentId)) continue
          if (entry.unavailable) {
            if (entry.binding.kind === 'file') summaries.push({ documentId: entry.documentId, epoch: entry.epoch,
              revision: entry.revision, binding: entry.binding, kind: entry.kind, name: name(entry.binding, entry.title),
              dirty: false, recoverable: false,
              recoveryUnavailable: '这份恢复记录损坏，未读取其中内容。可保留损坏记录后尝试打开已保存稿。' })
            continue
          }
          let unresolved = false
          try { this.fileCoordinator.assertResolved([], [entry.documentId]) } catch { unresolved = true }
          if (entry.savedRevision === entry.revision && !unresolved && !inputs.some(envelope => envelope.documentId === entry.documentId)) continue
          summaries.push({ documentId: entry.documentId, epoch: entry.epoch, revision: entry.revision,
            binding: entry.binding, kind: entry.kind, name: name(entry.binding, entry.title), dirty: true, recoverable: true })
        }
        for (const envelope of inputs) {
          if (this.registry.has(envelope.documentId) || summaries.some(item => item.documentId === envelope.documentId)) continue
          summaries.push({ documentId: envelope.documentId, epoch: envelope.epoch, revision: 0, binding: envelope.binding,
            kind: envelope.kind as DocumentKind, name: name(envelope.binding), dirty: false, recoverable: false, rawInputOnly: true })
        }
        return summaries
      })
      case 'recoverable': return this.fileCoordinator.withFileAccess(async () => {
        const snapshots: DocumentSnapshot[] = []
        for (const entry of await this.journal.listBindings()) {
          if (!entry.unavailable || entry.binding.kind !== 'file' || this.registry.has(entry.documentId)) continue
          try {
            const disk = await this.readDisk(entry.binding.path, entry.kind)
            if (!disk.model) continue
            snapshots.push({ documentId: entry.documentId, epoch: entry.epoch, revision: entry.revision, model: disk.model,
              binding: entry.binding, dirty: false, saving: false, recoverable: false, undoDepth: 0, redoDepth: 0,
              recoveryUnavailable: '这份恢复记录损坏，未读取其中内容。已保存原文件可用；可保留损坏记录后打开已保存稿。' })
          } catch { /* The existing recoveryIssues remains available if the saved file is unreadable too. */ }
        }
        for (const documentId of await this.journal.list()) {
          // A live dirty session is already authoritative. Listing its journal as
          // crash recovery races a view attachment and falsely blocks editing.
          if (this.registry.has(documentId)) continue
          const state = await this.journal.recover(documentId)
          let bindingUnresolved = false
          try { this.fileCoordinator.assertResolved([], [documentId]) } catch { bindingUnresolved = true }
          const drafts = state && await this.inputs.read(state)
          if (state && (state.savedRevision !== state.revision || bindingUnresolved || drafts && (drafts.advanced.length || drafts.properties.length || drafts.sourceConflict || drafts.flow?.length))) snapshots.push({ documentId, epoch: state.epoch, revision: state.revision, model: state.model, binding: state.binding, dirty: true, saving: false, recoverable: true, undoDepth: state.past.length, redoDepth: state.future.length })
        }
        for (const envelope of await this.inputs.list()) {
          if (!envelope.records.length || this.registry.has(envelope.documentId) || snapshots.some(item => item.documentId === envelope.documentId)) continue
          let model: DocumentModel = this.inputs.material(envelope), binding = envelope.binding, fromDisk = false
          try {
            if (envelope.binding.kind === 'file') {
              const disk = await this.readDisk(envelope.binding.path, envelope.kind as DocumentKind)
              if (disk.model) { model = disk.model; fromDisk = true }
            }
          } catch { /* A missing disk baseline is presented as independent original text. */ }
          if (!fromDisk) binding = { kind: 'untitled', suggestedName: '原始输入材料.txt' }
          snapshots.push({ documentId: envelope.documentId, epoch: envelope.epoch, revision: 0, model,
            binding, dirty: false, saving: false, recoverable: false, rawInputOnly: true, undoDepth: 0, redoDepth: 0 })
        }
        return snapshots
      })
      case 'rename': return this.renameDocument(input)
      case 'restore': return this.fileCoordinator.withFileAccess(async () => {
        if (input.mode === 'saved') {
          const entry = (await this.journal.listBindings()).find(entry => entry.documentId === input.documentId && entry.unavailable)
          if (!entry || entry.binding.kind !== 'file') throw new Error('没有可处理的损坏恢复记录')
          if (this.registry.has(input.documentId)) throw new Error('文档已打开，请保留当前稿后处理')
          this.fileCoordinator.assertResolved([entry.binding.path], [input.documentId], true)
          const disk = await this.readDisk(entry.binding.path, entry.kind)
          if (!disk.model) throw new Error('已保存原文件无法读取，损坏恢复记录仍保留')
          await this.journal.preserveUnavailable(input.documentId)
          return this.openFile(entry.binding.path)
        }
        if (input.mode !== 'unbound') this.fileCoordinator.assertResolved([], [input.documentId])
        const state = await this.journal.recover(input.documentId)
        if (!state) {
          const raw = (await this.inputs.list()).find(envelope => envelope.documentId === input.documentId && envelope.records.length)
          if (raw?.binding.kind === 'file' && input.mode !== 'unbound') {
            try { return await this.openFile(raw.binding.path) } catch { /* Original text remains openable when the file is missing. */ }
          }
          if (raw) return this.attach(await this.registry.create(this.inputs.material(raw), '原始输入材料.txt'))
          throw new Error('正式恢复稿不存在；保留的原始输入可在原文件打开后认领')
        }
        if (input.mode === 'unbound') {
          if (this.registry.has(input.documentId))
            throw new Error('该恢复稿已经打开，请从文档另存为；未改变当前绑定')
          // This explicit recovery choice changes only the binding. Content, undo/redo,
          // operation receipts and stop barriers remain owned by the same document.
          state.binding = { kind: 'untitled', suggestedName: state.binding.kind === 'file'
            ? path.basename(state.binding.path) : state.binding.suggestedName }
          state.savedRevision = null
        }
        const restored = this.attach(await this.registry.restore(state))
        await this.refreshInputBinding(restored)
        return restored
      })
      case 'discard-recovery': return this.fileCoordinator.withFileAccess(async () => {
        this.fileCoordinator.assertResolved([], [input.documentId])
        if (this.registry.has(input.documentId)) throw new Error('文档已打开，请从文档关闭入口处理未保存更改')
        await this.journal.discard(input.documentId)
        await this.inputs.discard(input.documentId)
        return
      })
    }
  }
}
