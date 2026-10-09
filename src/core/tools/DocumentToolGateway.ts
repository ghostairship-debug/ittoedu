import { isNativeProjectFilename, nativeProjectStem } from '../../shared/nativeProjectFile'
import { mapAcknowledgedComponentRange, mapAcknowledgedRange, type ComponentTextSplice, type SourceSplice } from './ToolReadCoverage'
import { HostToolCoordinator, isHostToolName, type HostToolServices } from './HostToolServices'
import { workbenchServiceRegistration } from './WorkbenchServiceTools'
import { materialToolRegistration } from './MaterialTools'
import { hostArtifactSaveRegistration, hostArtifactSaveSchema } from './HostArtifactTools'
import { htmlActionToolRegistration } from './HtmlActionTools'
import { pptxImportRegistration } from './CourseImportTools'
import { officeToolRegistration } from './ToolCatalog'
import type { HostImageInput, PrepareImageResourcePort } from './imageResource'
import type { PrepareMediaResourcePort } from './mediaResource'
import type { AssetSource } from '../../shared/contracts/media-v1/types'
import type { ImageAssetResource } from './imageAssetMetadata'
import { z } from 'zod'
import { isSourceDocumentModel, type DocumentCommand, type DocumentDriver, type DocumentSnapshot, type DocumentModel } from '../../shared/workbench/document'
import type { ModelToolCall, PreparedToolImage, ToolDefinition, ToolGateway, ToolResult, ToolRunGrant, ToolTarget, ToolAdvisory } from '../../shared/workbench/tools'
import type { LocalToolRunIntent, LocalToolRunPreview } from '../../shared/workbench/toolPorts'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import { batchInputSchemaFor, canonicalToolRegistration, describeToolFamily, describeTools, familyOfTool, gatewayToolRegistration, mutationCallSchema, mutationNamesIn, selectRunToolNames, toolCatalog, toolEffectTargets, toolFamilies, toolRegistration, visibleRunToolNames, type BatchMutationCall, type RunToolScope, type ToolFamily } from './ToolCatalog'
import { childTargets, containsTarget, courseInstanceContext, courseInstanceTextTarget, mapMarkdownRange, readTarget, targetFootprint, replaceCourseInstanceText, readCourseInstanceText, sliceCourseInstanceText, isCourseInstanceRange, readEditableTargetContent, recoverEditableTargetAfterReplacement, prepareHtmlAuthorFieldEdit, mapHtmlAuthorFieldTarget, planTextSelectionReplacement } from './ToolTargets'
import { courseInstancePropertyEdits, courseInstanceConversionEdits } from './courseInstanceEdits'
import { courseSettingsEdits, surfaceSettingsEdits } from '../course/courseSemanticEdits'
import { courseConfigureInputSchema } from './toolSchemas'
import { duplicateSurfaceEdits } from '../course/courseSurfaceStructure'
import { RECIPE_CATALOG, planCourseRecipeEdits } from '../course/courseRecipeEdits'
import { inspectCourseRemixSlots, planCourseStyleRemixEdits, planCourseProductivityEdits } from '../course/courseProductivityEdits'
import { prepareCourseElementEdits, prepareCourseTeacherControllerEdits } from '../course/courseElementInsertion'
import { courseGeometryEdits } from '../course/courseGeometryEdits'
import { courseObjectRemovalEdits, courseObjectOrder, courseObjectOrderEdits, courseObjectMoveEdits, courseGlobalPlacementEdits, prepareCourseObjectPaste } from '../course/courseObjectEdits'
import { flowPlacementEdits, flowBodyLayoutEdits, flowReadingOrderEdits } from '../course/courseFlowEdits'
import { componentDataPropertyPaths, componentTableDataEdits, componentChartDataEdits } from '../course/componentDataEdits'
import { componentInputRuleEdits } from '../../components/input/authoring'
import { executeCourseLogicAuthoringCommand, replaceCourseNetworkDeclaration } from '../course/courseLogicAuthoringCommands'
import { courseAudioSettingsEdits, courseSoundEdits, courseSoundImportEdits } from '../course/courseMediaEdits'
import { interactionBehavior, interactionRules, componentRuleEdits, componentClickInteractionEdits, componentRevealSequenceEdits, duplicateComponentRule } from '../../shared/componentInteractionData'
import { coursePresentationEdits } from './coursePresentationEdits'
import { captureComponentOperation, componentValueAt, presentationComponentEdits, componentFieldIdentityPaths, equalComponentValue } from '../drivers/courseV10Operations'
import { imageDataSchema } from '../../components/image/data'
import type { ComponentEdit, ComponentExpectation, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, resolveComponentPresentation, containerChildIds, owningContainer, type ComponentContainer, type ComponentTarget } from '../../shared/contracts/component-platform/project'
import { prepareComponentImageApplication, prepareComponentMediaApplication } from './componentImageApplication'
import { extractComponentLibraryApplication, prepareComponentLibraryApplication } from './componentLibraryApplication'
import { planCourseComponentPackageReplacement } from '../components/library/replacement'
import { documentTextLength, plainDocumentText } from '../../shared/document/content'
import { projectFileRegistration } from './ProjectFileTools'
import { skillReadInputSchema } from './SkillTools'
import { ComponentProjectFileCoordinator, componentProjectSettings, componentProjectFileSchemas, componentProjectFiles, componentProjectSurfaceId, componentFileContentSource, canonicalComponentFileEdits, type ComponentProjectSnapshot, type ComponentProjectFileInput, type ComponentProjectFile, type ComponentProjectFileScope } from '../projectFiles/componentPlatform'
import type { ContentApplyRequest, ContentApplyResult, ContentApplySource, ContentApplyIntent, ContentApplyDiagnostic } from '../contentApply/planning/types'
import { readHtmlAuthoringRecords } from '../../shared/html/htmlAuthoringRecords'
import { planAggregateMarkdownTextEdit } from '../../shared/document/aggregateTextEdit'
import type { SpatialViewportCapture } from '../../shared/workbench/spatialViewport'
import { courseInteractionRuleReference, type CourseAuthoringReference, type CourseAuthoringReferences } from '../course/courseAuthoringReferences'

interface Run {
  grant: ToolRunGrant
  toolScopes: RunToolScope[]
  loadedFamilies: Set<ToolFamily>
  courseAuthoring?: boolean
  currentCourseDocumentId?: string
  currentHtmlDocumentId?: string
  currentDocumentId?: string
  contentTarget?: string
  contentReads: Map<string, { epoch: string; expected: Map<string, ComponentExpectation>; pending?: ComponentExpectation[] }>
  advertised?: { definitions: ToolDefinition[]; names: Set<string>; allowed: Set<string>; batchSchema?: z.ZodType;
    availableFamilies: { family: ToolFamily; description: string; count: number }[] }
  epochs: Map<string, string>
  documentLeases: Map<string, string>
  sources: Map<string, string>
  rangeFootprints: Map<string, string>
  componentSubtrees: Map<string, ReadonlySet<string>>
  stopped: boolean
  history: Map<string, { undoDepth: number; redoDepth: number }>
  /** Receipt lookup survives detaching a document; these ids carry no authority. */
  detachedDocuments?: Set<string>
  watches: Map<string, () => void>
}
interface Handle {
  runId: string
  documentId: string
  epoch: string
  revision: number
  target: ToolTarget
  footprint: string
  expectedFootprint: string
  conflicted: boolean
  source?: string
  writable: boolean
  readOnly?: boolean
}
interface Cursor { runId: string; documentId: string; epoch: string; revision: number; target: string; method: string; digest: string; offset: number }
class ToolError extends Error { constructor(readonly code: string, message: string, readonly data?: unknown) { super(message) } }
/** Current Session facts are distinct from a historical save/export receipt. */
export function documentSnapshotFacts(snapshot: DocumentSnapshot) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, dirty: snapshot.dirty,
    kind: snapshot.model.kind, ...(snapshot.binding.kind === 'file' ? { path: snapshot.binding.path } : { suggestedName: snapshot.binding.suggestedName }) }
}
function sourceField(target: ToolTarget): boolean { return target.kind === 'text-selection' ? target.fragments.every(fragment => sourceField(fragment.target)) : target.kind === 'markdown-range' || target.kind === 'html-author-field' && Boolean(target.source) }
function componentRange(target: ToolTarget): boolean { return isCourseInstanceRange(target) || target.kind === 'text-selection' && target.fragments.some(fragment => isCourseInstanceRange(fragment.target)) }
function mapSourceTarget(before: string, after: string, target: ToolTarget): ToolTarget {
  if (target.kind === 'text-selection') return { ...target, fragments: target.fragments.map(fragment => ({ ...fragment, target: mapSourceTarget(before, after, fragment.target) as typeof fragment.target })) }
  return target.kind === 'markdown-range' ? mapMarkdownRange(before, after, target)
    : target.kind === 'html-author-field' ? mapHtmlAuthorFieldTarget(before, after, target) : target
}
function mapAcknowledgedSourceTarget(target: ToolTarget, edits: readonly SourceSplice[], before?: string, after?: string): ToolTarget {
  if (target.kind === 'text-selection') return { ...target, fragments: target.fragments.map(fragment => ({ ...fragment, target: mapAcknowledgedSourceTarget(fragment.target, edits, before, after) as typeof fragment.target })) }
  if (target.kind === 'html-author-field' && target.source && before !== undefined && after !== undefined
    && readHtmlAuthoringRecords(after)[target.authorKey]) return mapHtmlAuthorFieldTarget(before, after, target, true)
  return target.kind === 'markdown-range' ? mapAcknowledgedRange(target, edits)
    : target.kind === 'html-author-field' && target.source ? { ...target, source: mapAcknowledgedRange(target.source, edits) } : target
}
function mapAcknowledgedComponentTarget(target: ToolTarget, edits: readonly ComponentTextSplice[], model: DocumentModel): ToolTarget {
  if (target.kind === 'text-selection') return { ...target, fragments: target.fragments.map(fragment => ({ ...fragment,
    target: mapAcknowledgedComponentTarget(fragment.target, edits, model) as typeof fragment.target })) }
  // An observed whole object stays a whole object. Only an already-scoped text
  // field can follow the table owner's text/content representation change.
  if (target.kind !== 'course-instance' || !target.dataPath) return target
  const field = courseInstanceTextTarget(model, target)
  if (!isCourseInstanceRange(field)) return field
  const semanticEdits = edits.map(edit => ({ ...edit, dataPath: courseInstanceTextTarget(model,
    { kind: 'course-instance', ...edit }).dataPath! }))
  return mapAcknowledgedComponentRange(field, semanticEdits)
}

/** A conservative upper bound on kinds reachable under the frozen grant. Gateway still checks every concrete target. */
function writableKinds(model: DocumentModel, writable: readonly ToolTarget[]): ToolTarget['kind'][] {
  const kinds = new Set<ToolTarget['kind']>()
  for (const target of writable) {
    kinds.add(target.kind)
    if (target.kind === 'text-selection') for (const fragment of target.fragments) kinds.add(fragment.target.kind)
    if (target.kind === 'document') {
      if (isSourceDocumentModel(model)) { kinds.add('markdown-range'); kinds.add('html-author-field') }
      else if (model.kind === 'course-v10') kinds.add('course-instance')
    }
    if (model.kind === 'course-v10' && target.kind === 'course-surface') kinds.add('course-instance')
  }
  return [...kinds]
}

export interface DocumentToolGatewayOptions { prepareImage?: PrepareImageResourcePort; prepareMedia?: PrepareMediaResourcePort; services?: HostToolServices;
  prepareSpatialViewport?(documentId: string, surfaceId: string): Promise<SpatialViewportCapture>
  prepareInput?(documentId: string): Promise<void>
  componentContent?: {
    verifyDiagnostic?(snapshot: ComponentProjectSnapshot, diagnostic: Pick<ContentApplyDiagnostic, 'code' | 'instanceId' | 'reference'>): Promise<{
      state: 'resolved' | 'unresolved' | 'unknown'; code: string; instanceId?: string; reference?: string; assetId?: string; reason: string }>
    apply(input: { baseline: ComponentProjectSnapshot; request: ContentApplyRequest; operationId: string; requestDigest: string; runId: string; runLeaseId: string; actor: ToolRunGrant['actor']; readExpectations?: ComponentExpectation[]; assertActive(): void }): Promise<ContentApplyResult>
    source(from: string, fileAccess: ToolRunGrant['fileAccess'], sourceHtml?: string): Promise<ComponentProjectFileInput>
    prepareSource?(input: ComponentProjectFileInput, file: ComponentProjectFile, intent: ContentApplyIntent,
      resources?: { readImage(source: string): Promise<HostImageInput | null> }): Promise<ContentApplySource>
  }
}

/** Pure host service. It never consults focus/selection and returns success only after durable Session ACK. */
export class DocumentToolGateway implements ToolGateway {
  private readonly images = new Map<string, { runId: string; documentId: string; epoch: string; asset: ImageAssetResource; source?: AssetSource }>()
  private readonly runs = new Map<string, Run>()
  private readonly startingRuns = new Set<string>()
  private readonly operationLeases = new Map<string, { runId: string; leases: ReadonlyMap<string, string> }>()
  private readonly writeTaskBarriers = new Map<string, number>()
  private readonly writeTaskGenerations = new Map<string, number>()
  private hostServicesConfigured = false
  private readonly handles = new Map<string, Handle>()
  private readonly cursors = new Map<string, Cursor>()
  private readonly pending = new Map<string, { digest: string; result: Promise<ToolResult> }>()
  private readonly callDigests = new Map<string, { runId: string; digest: string; retain: boolean }>()
  private readonly catalogListeners = new Set<(runId: string) => void>()
  /** One live call keeps its observed identities through effects, approval preflight and commit. */
  private readonly mutationCaptures = new WeakMap<object, { runId: string; digest: string; handles: Promise<Handle[]> }>()

  private readonly hostTools: HostToolCoordinator
  private readonly componentProjectFiles: ComponentProjectFileCoordinator

  async currentDocumentFacts(runId: string) {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    return Promise.all(run.grant.documents.map(async document => {
      const snapshot = await this.registry.get(document.documentId).drain()
      if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
      this.authorizeDocument(run, snapshot)
      return { ...documentSnapshotFacts(snapshot), target: this.capture(runId, snapshot, { kind: 'document' }, this.canWrite(run, snapshot, { kind: 'document' })) }
    }))
  }

  constructor(private readonly registry: DocumentRegistry, private readonly drivers: readonly DocumentDriver[], private readonly createId: () => string, private readonly options: DocumentToolGatewayOptions = {}) {
    this.hostServicesConfigured = options.services !== undefined
    this.hostTools = new HostToolCoordinator(options.services ?? {}, registry, {
      resolveImage: async (runId, id) => {
        const run = this.run(runId), handle = this.handle(runId, id)
        const snapshot = await this.registry.get(handle.documentId).drain()
        if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
        this.authorizeDocument(run, snapshot)
        if (handle.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '图片目标会话已失效')
        if (!handle.writable) throw new ToolError('not-authorized', '图片目标不在本次任务的可写范围')
        const target = handle.target
        try { readTarget(snapshot.model, target) }
        catch { throw new ToolError('target-conflict', '图片目标身份已不存在或改变') }
        if (!this.canWrite(run, snapshot, target)) throw new ToolError('not-authorized', '图片目标不在本次任务的可写范围')
        return { snapshot, target }
      },
      active: (runId, documentId, epoch) => { const run = this.run(runId); if (run.stopped) throw new ToolError('run-stopped', '任务已停止'); const current = this.registry.get(documentId).read(); this.authorizeDocument(run, current); if (current.epoch !== epoch) throw new ToolError('stale-epoch', '文档会话已改变') },
      ownsDocument: (runId, documentId) => this.run(runId).grant.documents.some(document => document.documentId === documentId),
      documentIds: runId => this.run(runId).grant.documents.map(document => document.documentId),
      ownsReceiptDocument: (runId, documentId) => {
        const run = this.run(runId)
        return run.grant.documents.some(document => document.documentId === documentId) || run.detachedDocuments?.has(documentId) === true
      },
      provideImage: (runId, documentId, source) => this.provideImage(runId, documentId, source),
      readImage: (runId, documentId, resource) => this.readImageResource(runId, documentId, resource),
      readRunImage: async (runId, resource) => {
        const image = this.images.get(resource)
        return image ? this.readImageResource(runId, image.documentId, resource) : null
      },
    })
    this.componentProjectFiles = new ComponentProjectFileCoordinator({
      document: (runId, selector, access) => this.componentProjectDocument(runId, selector, access),
      scope: (runId, selector, snapshot) => this.componentProjectScope(runId, selector, snapshot),
      apply: (runId, operationId, requestDigest, baseline, request) => this.applyComponentContentOperation(runId, operationId, requestDigest, baseline, request),
      settings: async (runId, snapshot, settings) => {
        const prepared = await this.prepareSettingsBackground(runId, settings.background)
        return [...prepared.resources, ...courseSettingsEdits(snapshot.model.project, { ...settings, background: prepared.background })]
      },
      source: async (runId, from, snapshot, sourceHtml) => {
        const run = this.run(runId), port = this.options.componentContent
        if (run.stopped || !port) throw new ToolError('service-unavailable', '内容源服务不可用')
        if (this.images.has(from) || this.hostTools.isImageSource(from)) {
          const file = await this.readImageResource(runId, snapshot.documentId, from)
          return { filename: file.filename, bytes: file.bytes }
        }
        const result = await port.source(from, run.grant.fileAccess, sourceHtml)
        if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
        return result
      },
      prepareSource: this.options.componentContent?.prepareSource ? (input, file, intent, runId) => this.options.componentContent!.prepareSource!(input, file, intent,
        { readImage: source => this.hostTools.readImageReference(runId, source) }) : undefined,
      spatialViewport: async (runId, snapshot, surfaceId) => {
        const run = this.run(runId)
        if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
        if (!this.options.prepareSpatialViewport) throw new ToolError('service-unavailable', '当前宿主没有空间视口')
        const captured = await this.options.prepareSpatialViewport(snapshot.documentId, surfaceId)
        if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
        if (captured.documentId !== snapshot.documentId || captured.epoch !== snapshot.epoch || captured.surfaceId !== surfaceId)
          throw new ToolError('stale-epoch', '空间视口不属于当前文档页面')
        return captured.pose
      },
    })
  }

  /** Desktop imports share the content service and Session writer with project.apply. */
  applyComponentContent(runId: string, callId: string, baseline: ComponentProjectSnapshot, request: ContentApplyRequest): Promise<ContentApplyResult> {
    const input = 'source' in request && request.source.kind === 'html' && request.source.siblingFiles
      ? { ...request, source: { ...request.source, siblingFiles: [...request.source.siblingFiles] } } : request
    return this.applyComponentContentOperation(runId, this.operationIdentity(runId, callId),
      documentDigest({ documentId: baseline.documentId, epoch: baseline.epoch, revision: baseline.revision, request: input }), baseline, request)
  }

  private async applyComponentContentOperation(runId: string, operationId: string, requestDigest: string,
    baseline: ComponentProjectSnapshot, request: ContentApplyRequest): Promise<ContentApplyResult> {
    const run = this.run(runId), port = this.options.componentContent
    this.captureOperationLeases(runId, operationId)
    const runLeaseId = this.operationLease(runId, operationId, baseline.documentId)
    if (!port) throw new ToolError('service-unavailable', '组件内容应用服务尚未接入')
    const assertActive = () => {
      if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
      const current = this.registry.get(baseline.documentId).read()
      this.authorizeDocument(run, current)
      if (current.epoch !== baseline.epoch || !this.canWrite(run, current, { kind: 'document' })) throw new ToolError('not-authorized', '工程身份或写权限已变化')
    }
    assertActive()
    const readExpectations = this.contentReadExpectations(runId, this.registry.get(baseline.documentId).read())
    const unwatch = this.registry.get(baseline.documentId).subscribeCommits(({ operation, result, before, after }) => {
      if (operation.runId !== runId || operation.operationId !== operationId || operation.epoch !== baseline.epoch
        || result.status !== 'applied' || operation.mutation.type !== 'command'
        || operation.mutation.command.type !== 'component-platform.apply') return
      this.recordAppliedFootprints(runId, { ...baseline, revision: result.beforeRevision, model: before }, after, result.revision, [], [])
    })
    try {
      return await port.apply({ runId, runLeaseId, operationId, requestDigest, baseline, request, actor: run.grant.actor, readExpectations, assertActive })
    } finally { unwatch() }
  }

  /** Main finishes service wiring once, before any task has started. */
  configureHostServices(services: HostToolServices): void {
    if (this.hostServicesConfigured || this.runs.size || this.startingRuns.size) throw new Error('宿主服务只能在首个任务前配置一次')
    this.hostTools.configure(services)
    this.hostServicesConfigured = true
  }

  /** Main settlement query: old receipts stay immutable; only current author bytes can resolve their diagnostics. */
  async verifyContentDiagnostics(runId: string, documentId: string,
    diagnostics: readonly Pick<ContentApplyDiagnostic, 'code' | 'instanceId' | 'reference'>[]) {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(documentId).drain()
    this.authorizeDocument(run, snapshot)
    if (snapshot.model.kind !== 'course-v10') throw new ToolError('unsupported-document', '当前文档不是可复核的课件')
    const verify = this.options.componentContent?.verifyDiagnostic
    const results = await Promise.all(diagnostics.map(diagnostic => verify
      ? verify(snapshot as ComponentProjectSnapshot, diagnostic)
      : Promise.resolve({ ...diagnostic, state: 'unknown' as const, reason: '当前宿主尚未配置此诊断的实际结果复核' })))
    const current = this.registry.get(documentId).read()
    this.authorizeDocument(run, current)
    return { documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      current: !run.stopped && current.epoch === snapshot.epoch && current.revision === snapshot.revision, results }
  }

  private supports(name: string): boolean {
    return toolRegistration(name)?.supports({ ...this.hostTools.supportContext(),
      componentContent: !!this.options.componentContent }) ?? false
  }
  async describe(names?: readonly string[]) { return describeTools(names).filter(tool => this.supports(tool.name)) }

  /** Built-in model catalog is fixed from the frozen document kinds and grants, never from current focus. */
  async describeRun(runId: string): Promise<readonly ToolDefinition[]> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    // Per-round recomputation drains every granted document; cached advertised stays valid until
    // the frozen grant shape changes (attachRunDocument / loadToolFamilies invalidate it below).
    if (run.advertised) return structuredClone(run.advertised.definitions)
    const scopes: RunToolScope[] = []
    for (const doc of run.grant.documents) {
      const snapshot = await this.registry.get(doc.documentId).drain()
      this.authorizeDocument(run, snapshot)
      scopes.push(this.runScope(snapshot.model, doc.writable))
    }
    const standaloneImage = run.grant.actor === 'agent' && !!run.grant.fileAccess?.workspaceRoot
      && run.grant.fileAccess.permission !== 'read-only'
    const projectFiles = run.grant.fileAccess?.workspaceRoot && this.hostTools.projectFileServices()
      ? run.grant.fileAccess.permission === 'read-only' ? 'read' as const : 'write' as const : undefined
    const allowed = selectRunToolNames(scopes, { standaloneImage, projectFiles }, {
      ...this.hostTools.supportContext(), componentContent: !!this.options.componentContent,
      courseAuthoring: run.courseAuthoring, workbenchServices: !!run.grant.fileAccess,
      fileAccess: run.grant.fileAccess?.permission === 'read-only' ? 'read' : 'write',
    })
    const names = visibleRunToolNames(allowed, run.loadedFamilies)
    const batchMutationNames = mutationNamesIn(names)
    run.toolScopes = scopes
    run.advertised = {
      definitions: describeTools(names, { batchMutationNames }), names: new Set(names), allowed: new Set(allowed),
      availableFamilies: toolFamilies.map(family => ({ family, description: describeToolFamily(family, allowed),
        count: allowed.filter(name => familyOfTool(name) === family).length })).filter(item => item.count > 0),
      ...(names.includes('batch') ? { batchSchema: batchInputSchemaFor(batchMutationNames) } : {}),
    }
    return structuredClone(run.advertised.definitions)
  }

  private runScope(model: DocumentModel, writable: readonly ToolTarget[]): RunToolScope {
    return { kind: model.kind, writableTargetKinds: writableKinds(model, writable),
      wholeDocumentWritable: writable.some(target => target.kind === 'document') }
  }

  async availableToolFamilies(runId: string): Promise<readonly { family: ToolFamily; description: string; count: number }[]> {
    const run = this.run(runId)
    if (!run.advertised) await this.describeRun(runId)
    return structuredClone(run.advertised!.availableFamilies)
  }

  /** Exact capability discovery shares the authorization owner with execute, never a second load gate. */
  async resolveRunTool(runId: string, name: string): Promise<ToolDefinition | null> {
    const run = this.run(runId)
    if (!run.advertised) await this.describeRun(runId)
    if (!run.advertised!.allowed.has(name)) return null
    const family = familyOfTool(name)
    if (family && !run.advertised!.names.has(name)) await this.loadToolFamilies(runId, [family])
    return structuredClone(run.advertised!.definitions.find(tool => tool.name === name) ?? null)
  }

  async loadToolFamilies(runId: string, families: readonly ToolFamily[]): Promise<readonly { family: ToolFamily; description: string; count: number }[]> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const available = await this.availableToolFamilies(runId)
    let changed = false
    for (const family of families) if (available.some(item => item.family === family) && !run.loadedFamilies.has(family)) {
      run.loadedFamilies.add(family)
      changed = true
    }
    if (changed) this.catalogChanged(runId)
    await this.describeRun(runId)
    return available
  }

  usesProjectFileAuthoring(runId: string): boolean { return !!this.run(runId).courseAuthoring }

  subscribeCatalogChanges(listener: (runId: string) => void): () => void {
    this.catalogListeners.add(listener)
    return () => { this.catalogListeners.delete(listener) }
  }
  private catalogChanged(runId: string): void {
    this.run(runId).advertised = undefined
    for (const listener of this.catalogListeners) try { listener(runId) } catch { /* A disconnected client cannot change authority. */ }
  }

  /** Host-only lifecycle gate. Existing tasks are stopped by the caller before file work. */
  async withWriteTaskBarrier<T>(documentIds: readonly string[], work: () => T | Promise<T>): Promise<T> {
    const ids = [...new Set(documentIds)]
    for (const id of ids) {
      this.writeTaskBarriers.set(id, (this.writeTaskBarriers.get(id) ?? 0) + 1)
      this.writeTaskGenerations.set(id, (this.writeTaskGenerations.get(id) ?? 0) + 1)
    }
    try { return await work() }
    finally {
      for (const id of ids) {
        const count = this.writeTaskBarriers.get(id)! - 1
        if (count) this.writeTaskBarriers.set(id, count)
        else this.writeTaskBarriers.delete(id)
      }
    }
  }

  private assertWriteTasksAllowed(grant: ToolRunGrant, generations?: Map<string, number>): void {
    for (const doc of grant.documents) {
      if (doc.writable.length && (this.writeTaskBarriers.has(doc.documentId) || generations && generations.get(doc.documentId) !== (this.writeTaskGenerations.get(doc.documentId) ?? 0))) {
        throw new ToolError('document-write-tasks-blocked', '文档正在关闭或处理文件变更，请完成后重新发起编辑任务')
      }
    }
  }

  async beginRun(input: ToolRunGrant): Promise<void> {
    if (!input.runId || this.runs.has(input.runId) || this.startingRuns.has(input.runId)) throw new Error('任务编号已存在或无效')
    this.startingRuns.add(input.runId)
    try {
      const grant = structuredClone(input)
      this.assertWriteTasksAllowed(grant)
      const generations = new Map(grant.documents.map(doc => [doc.documentId, this.writeTaskGenerations.get(doc.documentId) ?? 0]))
      const epochs = new Map<string, string>()
      const sources = new Map<string, string>()
      const rangeFootprints = new Map<string, string>()
      const componentSubtrees = new Map<string, ReadonlySet<string>>()
      const toolScopes: RunToolScope[] = []
      const courses: string[] = [], writableCourses: string[] = []
      for (const doc of grant.documents) {
        if (epochs.has(doc.documentId)) throw new Error('授权文档不能重复')
        const snapshot = await this.registry.get(doc.documentId).drain()
        if (snapshot.model.kind === 'course-v10') {
          courses.push(doc.documentId)
          if (doc.writable.some(target => target.kind === 'document')) writableCourses.push(doc.documentId)
        }
        for (const target of doc.writable) {
          readTarget(snapshot.model, target)
          const key = documentDigest({ documentId: doc.documentId, target })
          if (componentRange(target)) rangeFootprints.set(key, targetFootprint(snapshot.model, target))
          if (target.kind === 'course-instance' && !target.dataPath && snapshot.model.kind === 'course-v10') {
            const project = snapshot.model.project, ids = new Set<string>()
            const collect = (id: string) => { if (ids.has(id)) return; ids.add(id); project.instances[id]?.childIds?.forEach(collect) }
            collect(target.instanceId); componentSubtrees.set(key, ids)
          }
        }
        epochs.set(doc.documentId, snapshot.epoch)
        toolScopes.push(this.runScope(snapshot.model, doc.writable))
        if (isSourceDocumentModel(snapshot.model)) sources.set(doc.documentId, snapshot.model.source)
      }
      if (this.runs.has(grant.runId)) throw new Error('任务编号已存在')
      await this.hostTools.beginRun(grant)
      this.assertWriteTasksAllowed(grant, generations)
      const run: Run = { grant, toolScopes, loadedFamilies: new Set(), epochs, sources, rangeFootprints, componentSubtrees,
        currentDocumentId: grant.documents.length === 1 ? grant.documents[0]!.documentId : undefined,
        currentCourseDocumentId: courses.length === 1 ? courses[0] : writableCourses.length === 1 ? writableCourses[0] : undefined,
        documentLeases: new Map(grant.documents.map(doc => [doc.documentId, grant.runId])),
        stopped: false, history: new Map(), watches: new Map(), contentReads: new Map() }
      if (grant.contentOutput) {
        const binding = grant.contentOutput
        const snapshot = await this.registry.get(binding.documentId).drain()
        this.authorizeDocument(run, snapshot)
        if (!this.canWrite(run, snapshot, binding.target)) throw new ToolError('not-authorized', '默认文字目标不属于本次已授权范围')
        readEditableTargetContent(snapshot.model, binding.target)
        run.contentTarget = this.capture(grant.runId, snapshot, binding.target, true)
      }
      this.runs.set(grant.runId, run)
      for (const doc of grant.documents) this.watchDocument(grant.runId, doc.documentId)
    } finally { this.startingRuns.delete(input.runId) }
  }

  /** Main-only: a file tool has opened a supported document during this live run. */
  async attachRunDocument(runId: string, documentId: string, writable: boolean, currentCourse?: 'select' | 'initialize'): Promise<boolean> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const generation = this.writeTaskGenerations.get(documentId) ?? 0
    const snapshot = await this.registry.get(documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const targets = writable ? [{ kind: 'document' as const }] : []
    this.assertWriteTasksAllowed({ ...run.grant, documents: [{ documentId, writable: targets }] }, new Map([[documentId, generation]]))
    const selectDocument = () => {
      if (currentCourse === 'select' || currentCourse === 'initialize' && !run.currentDocumentId) run.currentDocumentId = documentId
      if (currentCourse === 'select' && isSourceDocumentModel(snapshot.model) && snapshot.binding.kind === 'file' && /\.html?$/i.test(snapshot.binding.path))
        run.currentHtmlDocumentId = documentId
    }
    if (run.epochs.has(documentId)) {
      this.authorizeDocument(run, snapshot)
      selectDocument()
      if (snapshot.model.kind === 'course-v10' && (currentCourse === 'select' || currentCourse === 'initialize' && !run.currentCourseDocumentId))
        run.currentCourseDocumentId = documentId
      return !!run.grant.documents.find(item => item.documentId === documentId)?.writable.some(item => item.kind === 'document')
    }
    run.grant = { ...run.grant, documents: [...run.grant.documents, { documentId, writable: targets }],
      ...(writable && snapshot.binding.kind === 'file' && run.grant.fileAccess ? { fileAccess: {
        ...run.grant.fileAccess, boundPaths: { ...run.grant.fileAccess.boundPaths, [documentId]: snapshot.binding.path },
      } } : {}) }
    run.epochs.set(documentId, snapshot.epoch)
    selectDocument()
    run.documentLeases.set(documentId, run.detachedDocuments?.has(documentId) ? `${runId}:document:${this.createId()}` : runId)
    if (snapshot.model.kind === 'course-v10' && (currentCourse === 'select' || currentCourse === 'initialize' && !run.currentCourseDocumentId))
      run.currentCourseDocumentId = documentId
    run.toolScopes.push(this.runScope(snapshot.model, targets))
    if (isSourceDocumentModel(snapshot.model)) run.sources.set(documentId, snapshot.model.source)
    this.watchDocument(runId, documentId)
    run.advertised = undefined
    return writable
  }

  /** A successful file/open producer supplies facts; all consumers continue the same captured target here. */
  async completeOpenedDocument(runId: string, opened: { documentId: string; writable: boolean },
    options: { selection?: 'select' | 'initialize' | 'preserve'; sourcePreviewChars?: number } = {}) {
    const writable = await this.attachRunDocument(runId, opened.documentId, opened.writable,
      options.selection === 'preserve' ? undefined : options.selection ?? 'select')
    await this.options.prepareInput?.(opened.documentId)
    const run = this.run(runId), snapshot = await this.registry.get(opened.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.authorizeDocument(run, snapshot)
    const target = this.capture(runId, snapshot, { kind: 'document' }, writable)
    const preview = isSourceDocumentModel(snapshot.model)
      ? this.previewSnapshot(runId, snapshot, { kind: 'document' }, options.sourcePreviewChars ?? 4000) : null
    const source = preview ? { content: preview.text, truncated: preview.truncated,
      ...(preview.nextCursor ? { nextCursor: preview.nextCursor } : {}),
      ...(writable ? { writableTarget: this.capture(runId, snapshot,
        { kind: 'markdown-range', from: 0, to: preview.total }, true) } : {}) } : undefined
    return { documentId: snapshot.documentId, kind: snapshot.model.kind, revision: snapshot.revision, target, writable,
      ...(source ? { source } : {}) }
  }

  /** Recovery registers receipt-query identity only. It cannot renew old target authority. */
  recoverRun(input: ToolRunGrant): void {
    if (!input.runId) throw new Error('任务编号无效')
    const ids = input.documents.map(document => document.documentId)
    if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error('恢复文档身份重复或无效')
    const existing = this.runs.get(input.runId)
    if (existing) {
      // An Engine can restart while its DocumentHost still owns the stopped run's receipts.
      // Keep that owner and its receipt metadata; recovery must not restart its authority.
      const knownIds = new Set([...existing.grant.documents.map(document => document.documentId), ...(existing.detachedDocuments ?? [])])
      if (!existing.stopped || existing.grant.actor !== input.actor || ids.some(id => !knownIds.has(id)))
        throw new Error('恢复身份与现有任务不一致，或任务仍在运行')
      return
    }
    const grant: ToolRunGrant = { runId: input.runId, actor: input.actor, documents: ids.map(documentId => ({ documentId, writable: [] })) }
    this.runs.set(input.runId, { grant, toolScopes: [], loadedFamilies: new Set(), epochs: new Map(), sources: new Map(),
      rangeFootprints: new Map(), componentSubtrees: new Map(), documentLeases: new Map(), stopped: true, history: new Map(), watches: new Map(), contentReads: new Map() })
  }

  /** Host-only: never expose arbitrary addresses as model tool input. */
  async issueTarget(runId: string, documentId: string, target: ToolTarget, options?: { readOnly?: boolean }): Promise<string> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(documentId).drain()
    this.authorizeDocument(run, snapshot)
    const writable = !options?.readOnly && this.canWrite(run, snapshot, target)
    return this.capture(runId, snapshot, target, writable, options?.readOnly)
  }

  /** Host-only: issue a separate editable handle for an already selected target only when the frozen grant contains it. */
  async issueWritableTargetWithinGrant(runId: string, documentId: string, target: ToolTarget, selectionHandleId?: string): Promise<string | null> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(documentId).drain()
    this.authorizeDocument(run, snapshot)
    if (selectionHandleId) {
      const selected = this.handle(runId, selectionHandleId)
      if (selected.documentId !== documentId || JSON.stringify(selected.target) !== JSON.stringify(target)) throw new ToolError('invalid-target', '选区句柄与目标不一致')
      if (selected.epoch !== snapshot.epoch || selected.revision !== snapshot.revision) throw new ToolError('target-conflict', '签发期间选区内容已改变')
    }
    readTarget(snapshot.model, target)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (!this.canWrite(run, snapshot, target)) return null
    return this.capture(runId, snapshot, target, true)
  }

  /** Main-only task-frozen file scope; absent for external MCP grants. */
  runFileAccess(runId: string): ToolRunGrant['fileAccess'] {
    return this.run(runId).grant.fileAccess && structuredClone(this.run(runId).grant.fileAccess)
  }

  /** Host-only compound-tool check of one frozen document handle. */
  async resolveWholeDocumentHandle(runId: string, handleId: string, access: 'read' | 'write'): Promise<{
    documentId: string; epoch: string; revision: number; bindingVersion: number | null
  }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = this.handle(runId, handleId)
    await this.options.prepareInput?.(handle.documentId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const target = this.resolve(handle, snapshot, access === 'write', true)
    if (target.kind !== 'document') throw new ToolError('invalid-target', '复合工具需要整份文档句柄')
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      bindingVersion: snapshot.binding.kind === 'file' ? snapshot.binding.bindingVersion : null }
  }

  /** Host-only source map for provisional projections; never a model capability or a commit receipt. */
  async resolveEditTarget(runId: string, handleId: string): Promise<{ documentId: string; epoch: string; revision: number; target: ToolTarget; model: DocumentModel }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = this.handle(runId, handleId)
    await this.options.prepareInput?.(handle.documentId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const target = this.resolve(handle, snapshot, true)
    return structuredClone({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, target, model: snapshot.model })
  }

  /** Host-only first observation of a frozen handle: the same content `read` returns, without receipts. A capped
   *  preview carries the `read` cursor for the rest, so the model continues where the snapshot ended. */
  async previewTarget(runId: string, handleId: string, maxChars: number): Promise<{ kind: ToolTarget['kind']; text: string; total: number; truncated: boolean; nextCursor?: string }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = this.handle(runId, handleId)
    await this.options.prepareInput?.(handle.documentId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    const target = this.resolve(handle, snapshot, false)
    return this.previewSnapshot(runId, snapshot, target, maxChars)
  }

  private previewSnapshot(runId: string, snapshot: DocumentSnapshot, target: ToolTarget, maxChars: number) {
    const current = readTarget(snapshot.model, target)
    this.recordContentRead(runId, snapshot, target)
    const content = typeof current === 'string' ? current : JSON.stringify(current)
    if (content.length <= maxChars) return { kind: target.kind, text: content, total: content.length, truncated: false }
    const nextCursor = `c${this.createId()}`
    this.cursors.set(nextCursor, { ...this.readIdentity(runId, snapshot, target), method: 'read', digest: documentDigest(content), offset: maxChars })
    return { kind: target.kind, text: content.slice(0, maxChars), total: content.length, truncated: true, nextCursor }
  }

  /** Diagnostic/settlement identity only. Does not validate or widen the writable grant. */
  async effectTargets(runId: string, call: ModelToolCall): Promise<Array<{ documentId: string; target: ToolTarget; epoch?: string }> | undefined> {
    if (call.name === 'task.delivery') {
      try {
        const input = call.input as { target?: string }
        const target = await this.currentDeliveryDocument(runId, input.target)
        return [{ documentId: target.documentId, epoch: target.epoch, target: { kind: 'document' } }]
      } catch { return undefined }
    }
    if (call.name === 'batch' || canonicalToolRegistration(call.name)) {
      try {
        const mutations = call.name === 'batch'
          ? (toolCatalog.find(tool => tool.name === 'batch')!.inputSchema.parse(call.input) as { operations: BatchMutationCall[] }).operations
          : [mutationCallSchema.parse(call)]
        const handles = await this.captureMutationHandles(runId, mutations, call.input)
        return [...handles, ...this.additionalMutationHandles(runId, mutations)].map(handle => ({ documentId: handle.documentId, epoch: handle.epoch, target: structuredClone(handle.target) }))
      } catch { return undefined }
    }
    return toolEffectTargets(call, {
      resolveHandle: id => {
        try {
          const handle = this.handle(runId, id)
          return { documentId: handle.documentId, epoch: handle.epoch, target: structuredClone(handle.target) }
        } catch { return undefined }
      },
      resolveProject: async (selector, path) => {
        const current = await this.componentProjectDocument(runId, selector, 'read')
        if (!path) return { documentId: current.documentId, epoch: current.epoch, target: { kind: 'document' } }
        const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, path, false, selector)
        return { documentId: snapshot.documentId, epoch: snapshot.epoch, target: file.binding?.kind === 'project-settings'
          ? { kind: 'document' } : this.componentAssetPlacement(snapshot, file).target }
      },
    })
  }

  /** Host-only: documents named by any of these strings when they are handles issued to this run. */
  async effectWriteScopes(runId: string, call: ModelToolCall,
    capturedTargets?: readonly { documentId: string; target: ToolTarget }[]): Promise<Array<{ documentId: string; epoch: string; paths: string[][] }> | undefined> {
    // These are intended authored fields, not CAS dependencies or all fields read by a planner.
    const instanceRoot = (target: Extract<ToolTarget, { kind: 'course-instance' }>) => target.stateId
      ? ['@surface', target.surfaceId, '@state', target.stateId, 'overrides', target.instanceId]
      : ['instances', target.instanceId]
    try {
      if (call.name === 'project.apply') {
        if (capturedTargets) return undefined // A historical target alone does not preserve the observed virtual-file binding.
        const input = call.input as { project?: string; path: string; intent?: string; content?: string; from?: string }
        if (input.from || input.intent && !['content', 'style'].includes(input.intent)) return undefined
        const current = await this.componentProjectDocument(runId, input.project, 'read')
        const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, input.path, true, input.project)
        let paths: string[][] | undefined
        const binding = file.binding
        if (binding?.kind === 'project-settings') {
          const value = componentProjectSettings(snapshot, input.content!)
          paths = Object.keys(value).map(field => [field])
        } else if (binding?.kind === 'theme') paths = [['theme']]
        else if (binding?.kind === 'asset') paths = [['assets', binding.assetId]]
        else if (binding?.kind === 'instance-source') paths = [['instances', binding.instanceId, 'implementationOverride', file.sourceFile?.path ?? '@entry']]
        else if (binding?.kind === 'definition-source') paths = [['definitions', binding.definitionId, 'implementation', file.sourceFile?.path ?? '@entry']]
        else if (binding?.kind === 'definition') paths = ['role', 'title', 'dataSchema', 'professionalBuiltinKey', 'version'].map(field => ['definitions', binding.definitionId, field])
        else if (file.target?.kind === 'instance' && (file.kind === 'data' || file.kind === 'style')) {
          const instance = snapshot.model.project.instances[file.target.instanceId], value = JSON.parse(input.content!)
          const fields = file.kind === 'data' ? componentDataPropertyPaths(instance.data, value,
            componentDefinitionBuiltinKey(snapshot.model.project.definitions[instance.definitionId])) : Object.keys(value).map(key => [key])
          const root = file.editingContext ? ['@surface', file.editingContext.surfaceId, '@state', file.editingContext.stateId, 'overrides', instance.id] : ['instances', instance.id]
          paths = fields.map(path => [...root, file.kind, ...path])
        }
        return paths?.length ? [{ documentId: snapshot.documentId, epoch: snapshot.epoch, paths }] : undefined
      }
      if (call.name !== 'batch' && !canonicalToolRegistration(call.name)) return undefined
      const mutations = call.name === 'batch'
        ? (toolCatalog.find(tool => tool.name === 'batch')!.inputSchema.parse(call.input) as { operations: BatchMutationCall[] }).operations
        : [mutationCallSchema.parse(call)]
      const handles = capturedTargets ? await Promise.all(capturedTargets.map(async captured => {
        const run = this.run(runId), snapshot = await this.registry.get(captured.documentId).drain()
        this.authorizeDocument(run, snapshot)
        if (run.stopped || snapshot.model.kind !== 'course-v10' || captured.target.kind !== 'course-instance'
          || captured.target.from !== undefined || captured.target.to !== undefined
          || !this.canWrite(run, snapshot, captured.target)) throw new Error('旧字段身份不能绑定到当前授权')
        readTarget(snapshot.model, captured.target)
        return { documentId: snapshot.documentId, epoch: snapshot.epoch, target: captured.target }
      })) : await this.captureMutationHandles(runId, mutations, call.input)
      if (handles.length !== mutations.length) return undefined
      const scopes: Array<{ documentId: string; epoch: string; paths: string[][] }> = []
      for (let index = 0; index < mutations.length; index++) {
        const mutation = mutations[index], handle = handles[index], target = handle.target
        let paths: string[][] | undefined
        if (mutation.name === 'object.update' && target.kind === 'course-instance') {
          const root = instanceRoot(target)
          const snapshot = await this.registry.get(handle.documentId).drain()
          const { project, instance } = courseInstanceContext(snapshot.model, target)
          paths = Object.entries(mutation.input.properties).flatMap(([key, value]) => {
            if (key === 'data') return componentDataPropertyPaths(instance.data, value as import('../../shared/contracts/component-platform').JsonValue,
              componentDefinitionBuiltinKey(project.definitions[instance.definitionId])).map(path => [...root, 'data', ...path])
            if (key === 'style') return Object.keys(value as object).map(field => [...root, 'style', field])
            if (key === 'frame') return Object.keys(value as object).map(field => [...root, 'frame',
              ...(field === 'x' ? ['transform', '4'] : field === 'y' ? ['transform', '5'] : [field])])
            if (key === 'rotation') return ['0', '1', '2', '3'].map(index => [...root, 'frame', 'transform', index])
            if (key === 'opacity') return [[...root, 'style', 'opacity']]
            const field = key === 'label' ? 'name' : key === 'implementation' ? 'implementationOverride' : key
            const owner = ['data', 'style', 'visible', 'playbackInitialVisibility'].includes(field) ? root : ['instances', target.instanceId]
            return [[...owner, field]]
          })
        } else if (mutation.name === 'course.configure' && target.kind === 'document') {
          paths = Object.keys(mutation.input.settings).map(field => [field])
        } else if (mutation.name === 'text.replace') {
          const snapshot = await this.registry.get(handle.documentId).drain()
          const fields = target.kind === 'text-selection' ? target.fragments.map(fragment => fragment.target) : [target]
          paths = fields.flatMap(field => {
            if (field.kind === 'course-instance') {
              field = courseInstanceTextTarget(snapshot.model, field)
              return [[...instanceRoot(field), field.fieldScope ?? 'data', ...field.dataPath ?? [],
                ...(field.from !== undefined && field.to !== undefined ? ['@range', String(field.from), String(field.to)] : [])]]
            }
            if (field.kind === 'markdown-range') return [['source', '@range', String(field.from), String(field.to)]]
            if (field.kind === 'html-author-field') return [['source', '@author', field.authorKey, field.field]]
            return []
          })
        }
        if (!paths?.length) return undefined
        scopes.push({ documentId: handle.documentId, epoch: handle.epoch, paths })
      }
      return scopes
    } catch { return undefined }
  }

  /** Host-only: documents named by any of these strings when they are handles issued to this run. */
  documentsOfHandles(runId: string, values: readonly string[]): string[] {
    const found = new Set<string>()
    for (const value of values) {
      try { found.add(this.handle(runId, value).documentId) } catch { /* Not a handle of this run. */ }
    }
    return [...found]
  }

  /** Host-only admitted bytes port. The model receives only the resulting run/document-bound resource handle. */
  async provideImage(runId: string, documentId: string, input: HostImageInput): Promise<string> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(documentId).drain()
    this.authorizeDocument(run, snapshot)
    if (snapshot.model.kind !== 'course-v10') throw new Error('图片资源需要课件文档')
    const prepareImage = this.options.prepareImage
    if (!prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const asset = structuredClone(await prepareImage({ bytes: Uint8Array.from(input.bytes), filename: input.filename, mimeType: input.mimeType }, this.createId))
    const current = this.registry.get(documentId).read()
    this.authorizeDocument(run, current)
    if (current.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '原图片文档已关闭或重开')
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = `r${this.createId()}`
    if (this.images.has(handle)) throw new Error('资源句柄编号重复')
    this.images.set(handle, { runId, documentId, epoch: snapshot.epoch, asset })
    return handle
  }

  /** Host-only recovery check. A read from an old revision cannot satisfy observation of the current document. */
  async resolveObservationTarget(runId: string, handleId: string): Promise<{ documentId: string; revision: number; target: ToolTarget }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = this.handle(runId, handleId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    if (handle.revision !== snapshot.revision) throw new ToolError('target-conflict', '读取句柄不是当前文档版本')
    const target = this.resolve(handle, snapshot, false, false)
    return { documentId: snapshot.documentId, revision: snapshot.revision, target }
  }


  /** Host-only observation bytes, scoped to the run that captured them. */
  readObservationResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    return this.hostTools.readObservationResource({ runId, resourceId })
  }

  /** Resource ownership and pixel preparation are shared; model and MCP only encode the result. */
  prepareResultImages(runId: string, result: ToolResult): Promise<readonly PreparedToolImage[]> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    return this.hostTools.prepareResultImages(runId, result)
  }
  /** Main has verified same-task ancestry; granting read access does not revive job write authority. */
  authorizeContinuationReads(runId: string, sourceRunIds: readonly string[]): void {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    this.hostTools.authorizeContinuationReads(runId, sourceRunIds)
  }

  /** Host-only continuation bridge. Engine proves the source run is an ancestor in the same
   * conversation; Coordinator checks the durable job and issues a fresh current-run handle. */
  reissueImageForContinuation(currentRunId: string, sourceDocumentId: string, destinationDocumentId: string,
    sourceRunId: string, jobId: string, resourceId: string): Promise<string> {
    return this.hostTools.reissueImageForContinuation(currentRunId, sourceDocumentId, destinationDocumentId, sourceRunId, jobId, resourceId)
  }

  /** Host-only reference bridge for the image service; source bytes are copied and never overwritten. */
  async readImageResource(runId: string, documentId: string, resourceId: string): Promise<HostImageInput> {
    const run = this.run(runId), snapshot = await this.registry.get(documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.authorizeDocument(run, snapshot)
    const resource = this.images.get(resourceId)
    if (!resource) {
      const generated = await this.hostTools.readImageSource(runId, resourceId)
      if (generated) return generated
    }
    if (!resource && snapshot.model.kind === 'course-v10' && this.handles.has(resourceId)) {
      const handle = this.handle(runId, resourceId)
      if (handle.documentId !== documentId || handle.epoch !== snapshot.epoch) throw new ToolError('invalid-resource', '参考图不属于当前任务/文档')
      const target = this.resolve(handle, snapshot, false, false)
      let assetId: string
      if (target.kind === 'course-asset') assetId = target.assetId
      else if (target.kind === 'course-instance' && target.dataPath === undefined && target.from === undefined && target.to === undefined && target.fieldScope !== 'flowLayout') {
        const { project, instance } = courseInstanceContext(snapshot.model, target)
        const definition = project.definitions[instance.definitionId]
        if (definition?.implementation.kind !== 'builtin' || definition.implementation.key !== 'guoling.image') throw new ToolError('invalid-resource', '参考对象不是专业图片')
        assetId = imageDataSchema.parse(instance.data).assetId
      } else throw new ToolError('invalid-resource', '参考图需要整张专业图片或图片素材句柄')
      const asset = snapshot.model.project.assets[assetId], bytes = snapshot.model.resources.assets[assetId]
      const mimeType = asset?.mimeType
      if (!mimeType?.startsWith('image/') || !bytes) throw new ToolError('invalid-resource', '原图片资源字节不可用')
      return { bytes: Uint8Array.from(bytes), mimeType, filename: asset.filename ?? asset.path.split('/').at(-1)! }
    }
    if (!resource || resource.runId !== runId || resource.documentId !== documentId || resource.epoch !== snapshot.epoch) throw new ToolError('invalid-resource', '参考图不属于当前任务/文档')
    return { bytes: Uint8Array.from(resource.asset.bytes), mimeType: resource.asset.meta.mimeType, filename: resource.asset.meta.path.split('/').at(-1) ?? 'reference-image' }
  }

  /** Main lifecycle query from the actual grant, including dynamically opened documents. */
  writableRunIdsForDocument(documentId: string): string[] {
    return [...this.runs].filter(([, run]) => !run.stopped
      && run.grant.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(([id]) => id)
  }

  async stop(runId: string): Promise<void> {
    const run = this.run(runId)
    run.stopped = true
    for (const unwatch of run.watches.values()) unwatch()
    run.watches.clear()
    for (const [id, resource] of this.images) if (resource.runId === runId) this.images.delete(id)
    for (const [id, cursor] of this.cursors) if (cursor.runId === runId) this.cursors.delete(id)
    this.componentProjectFiles.stopRun(runId)
    // Already queued canonical commits finish; later requests cannot cross the barrier.
    const liveIds = new Set(this.registry.list().map(document => document.documentId))
    try {
      await Promise.all([this.hostTools.stop(runId), ...run.grant.documents.filter(doc => liveIds.has(doc.documentId)).map(doc => this.registry.get(doc.documentId).stopRun(run.documentLeases.get(doc.documentId) ?? runId))])
    } finally {
      for (const [id, handle] of this.handles) if (handle.runId === runId) this.handles.delete(id)
      for (const [id, entry] of this.operationLeases) if (entry.runId === runId) this.operationLeases.delete(id)
      for (const [id, entry] of this.callDigests) if (entry.runId === runId && !entry.retain) this.callDigests.delete(id)
      // Only receipt-query identity survives; author bodies, grants and projections are runtime state.
      run.grant = { runId, actor: run.grant.actor, documents: run.grant.documents.map(doc => ({ documentId: doc.documentId, writable: [] })) }
      run.sources.clear(); run.contentReads.clear(); run.rangeFootprints.clear(); run.componentSubtrees.clear()
      run.epochs.clear(); run.documentLeases.clear(); run.history.clear(); run.loadedFamilies.clear()
      run.toolScopes = []; run.advertised = undefined; run.contentTarget = undefined
      run.currentCourseDocumentId = undefined; run.currentHtmlDocumentId = undefined
      run.currentDocumentId = undefined
    }
  }

  /** Actual retained structures; receipt identity is counted separately from live author state. */
  runtimeCounts(runId?: string) {
    const belongs = (entry: { runId: string }) => runId === undefined || entry.runId === runId
    const runs = [...this.runs.entries()].filter(([id]) => runId === undefined || id === runId).map(([, run]) => run)
    return { activeRuns: runs.filter(run => !run.stopped).length, receiptRuns: runs.filter(run => run.stopped).length,
      handles: [...this.handles.values()].filter(belongs).length, images: [...this.images.values()].filter(belongs).length,
      cursors: [...this.cursors.values()].filter(belongs).length, operationLeases: [...this.operationLeases.values()].filter(belongs).length,
      readDigests: [...this.callDigests.values()].filter(entry => belongs(entry) && !entry.retain).length,
      receiptDigests: [...this.callDigests.values()].filter(entry => belongs(entry) && entry.retain).length,
      sourceCharacters: runs.reduce((count, run) => count + [...run.sources.values()].reduce((sum, source) => sum + source.length, 0), 0),
      contentReadValues: runs.reduce((count, run) => count + [...run.contentReads.values()].reduce((sum, basis) => sum + basis.expected.size, 0), 0),
      host: this.hostTools.runtimeCounts(runId) }
  }

  /** Detaching one tab revokes only that document; the resident task retains its other targets. */
  async stopRunDocument(runId: string, documentId: string): Promise<void> {
    const run = this.run(runId)
    if (!run.epochs.has(documentId)) return
    const lease = run.documentLeases.get(documentId) ?? runId
    run.watches.get(documentId)?.(); run.watches.delete(documentId)
    ;(run.detachedDocuments ??= new Set()).add(documentId)
    run.grant = { ...run.grant, documents: run.grant.documents.filter(document => document.documentId !== documentId) }
    run.epochs.delete(documentId)
    run.sources.delete(documentId)
    run.history.delete(documentId)
    run.contentReads.delete(documentId)
    if (run.contentTarget && this.handles.get(run.contentTarget)?.documentId === documentId) run.contentTarget = undefined
    if (run.currentHtmlDocumentId === documentId) run.currentHtmlDocumentId = undefined
    if (run.currentCourseDocumentId === documentId) run.currentCourseDocumentId = undefined
    if (run.currentDocumentId === documentId) run.currentDocumentId = undefined
    for (const [id, handle] of this.handles) if (handle.runId === runId && handle.documentId === documentId) this.handles.delete(id)
    for (const [id, cursor] of this.cursors) if (cursor.runId === runId && cursor.documentId === documentId) this.cursors.delete(id)
    for (const [id, resource] of this.images) if (resource.runId === runId && resource.documentId === documentId) this.images.delete(id)
    this.catalogChanged(runId)
    if (this.registry.list().some(document => document.documentId === documentId)) await this.registry.get(documentId).stopRun(lease)
  }

  private run(runId: string): Run {
    const run = this.runs.get(runId)
    if (!run) throw new ToolError('unknown-run', '任务授权不存在')
    return run
  }
  private watchDocument(runId: string, documentId: string): void {
    // Tracks changing undo/redo depth only for run summary; no invalidation.
    // Per AGENTS.md, undo must not revoke this task's write permission (CAS/revision
    // and handle footprints already protect against cross-task overwrites).
    const run = this.run(runId), session = this.registry.get(documentId), current = session.read()
    run.history.set(documentId, { undoDepth: current.undoDepth, redoDepth: current.redoDepth })
    const unwatch = session.subscribe(event => {
      if (event.type !== 'changed') return
      const next = event.snapshot
      run.history.set(documentId, { undoDepth: next.undoDepth, redoDepth: next.redoDepth })
      // Recompute the catalog when the formal targets addressed by this run change.
      run.advertised = undefined
    })
    const unwatchCommits = session.subscribeCommits(({ operation, result }) => {
      if (operation.runId !== runId || result.status !== 'applied' || operation.mutation.type !== 'command'
        || operation.mutation.command.type !== 'component-platform.apply') return
      this.componentProjectFiles.acknowledge(runId, documentId, operation.epoch, result.revision, operation.mutation.command)
    })
    run.watches.set(documentId, () => { unwatch(); unwatchCommits() })
  }
  private authorizeDocument(run: Run, snapshot: DocumentSnapshot): void {
    if (!run.epochs.has(snapshot.documentId)) throw new ToolError('not-authorized', '任务没有此文档的读取权限')
    if (run.epochs.get(snapshot.documentId) !== snapshot.epoch) throw new ToolError('stale-epoch', '文档会话已改变，请重新冻结任务')
  }
  private canWrite(run: Run, snapshot: DocumentSnapshot, target: ToolTarget): boolean {
    return run.grant.documents.find(doc => doc.documentId === snapshot.documentId)!.writable.some(allowed => {
      try {
        const key = documentDigest({ documentId: snapshot.documentId, target: allowed })
        const frozen = run.rangeFootprints.get(key)
        if (frozen && frozen !== targetFootprint(snapshot.model, allowed)) return false
        if (allowed.kind === 'course-instance' && target.kind === 'course-instance' && allowed.instanceId !== target.instanceId
          && !run.componentSubtrees.get(key)?.has(target.instanceId)) return false
        const mapped = sourceField(allowed) && isSourceDocumentModel(snapshot.model)
          ? mapSourceTarget(run.sources.get(snapshot.documentId)!, snapshot.model.source, allowed) : allowed
        return containsTarget(mapped, target, snapshot.model)
      } catch { return false }
    })
  }
  private capture(runId: string, snapshot: DocumentSnapshot, target: ToolTarget, writable: boolean, readOnly?: boolean): string {
    const value = this.createId()
    // Encode every UUID byte; opaque references need not carry its verbose display format.
    const token = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
      ? btoa(String.fromCharCode(...value.replace(/-/g, '').match(/../g)!.map(byte => parseInt(byte, 16))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : value
    const id = `t${token}`
    if (this.handles.has(id)) throw new Error('句柄编号重复')
    this.handles.set(id, this.capturedHandle(runId, snapshot, target, writable, readOnly))
    return id
  }
  private capturedHandle(runId: string, snapshot: DocumentSnapshot, target: ToolTarget, writable: boolean, readOnly?: boolean): Handle {
    readTarget(snapshot.model, target)
    const footprint = targetFootprint(snapshot.model, target)
    return { runId, documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      target: structuredClone(target), footprint, expectedFootprint: footprint, conflicted: false, writable, readOnly,
      ...(sourceField(target) && isSourceDocumentModel(snapshot.model) ? { source: snapshot.model.source } : {}) }
  }
  /** A declared reference field consumes already observed host identities, never a model-authored map. */
  private authoringReferences(runId: string, snapshot: DocumentSnapshot): CourseAuthoringReferences {
    const references = new Map<string, CourseAuthoringReference>()
    for (const [id, handle] of this.handles) {
      if (handle.runId !== runId || handle.documentId !== snapshot.documentId || handle.epoch !== snapshot.epoch) continue
      try {
        const target = this.resolve(handle, snapshot, false)
        if (target.kind === 'course-instance') references.set(id, { kind: 'instance', instanceId: target.instanceId })
        else if (target.kind === 'course-surface') references.set(id, target.stateId
          ? { kind: 'presentation-state', surfaceId: target.surfaceId, stateId: target.stateId } : { kind: 'surface', surfaceId: target.surfaceId })
      } catch { /* Unavailable observations cannot supply a current platform reference. */ }
    }
    return references
  }
  private captureMutationHandles(runId: string, mutations: BatchMutationCall[], input: unknown): Promise<Handle[]> {
    const digest = documentDigest(mutations)
    const cacheKey = input && typeof input === 'object' ? input : undefined
    const captured = cacheKey && this.mutationCaptures.get(cacheKey)
    if (captured && captured.runId === runId && captured.digest === digest) return captured.handles
    const handles = Promise.all(mutations.map(async mutation => {
      if (mutation.name === 'object.layout') return this.handle(runId, mutation.input.targets[0])
      if (mutation.name === 'text.replace') {
        const target = mutation.input.target ?? this.run(runId).contentTarget
        if (!target) throw new ToolError('invalid-target', '当前任务没有默认文字目标；请使用已观察的可写目标')
        return this.handle(runId, target)
      }
      if ('target' in mutation.input) {
        try { return this.handle(runId, mutation.input.target) }
        catch (error) { if (mutation.name !== 'media.insert') throw error }
      }
      const project = 'project' in mutation.input ? mutation.input.project : undefined
      const path = 'target' in mutation.input ? mutation.input.target : mutation.input.path
      const current = await this.componentProjectDocument(runId, project, 'read')
      let captured: ReturnType<ComponentProjectFileCoordinator['captureFile']>
      try { captured = this.componentProjectFiles.captureFile(runId, current, path, true, project) }
      catch (error) { throw new ToolError('invalid-target', error instanceof Error ? error.message : String(error)) }
      const { snapshot, file } = captured
      if (mutation.name !== 'media.insert' && file.target?.kind !== 'instance') throw new ToolError('invalid-target', '属性修改需要已观察的对象文件路径')
      if (mutation.name === 'media.insert' && (file.target?.kind !== 'container' || file.target.container.kind !== 'surface'))
        throw new ToolError('invalid-target', '插入媒体需要已观察的页面文件路径')
      const target = this.componentAssetPlacement(snapshot, file).target
      return this.capturedHandle(runId, snapshot, target, this.canWrite(this.run(runId), current, target))
    }))
    if (cacheKey) this.mutationCaptures.set(cacheKey, { runId, digest, handles })
    return handles
  }
  private additionalMutationHandles(runId: string, mutations: readonly BatchMutationCall[]): Handle[] {
    return mutations.flatMap(mutation => mutation.name === 'object.layout' ? mutation.input.targets.slice(1).map(target => this.handle(runId, target)) : [])
  }
  private handle(runId: string, id: string): Handle {
    const handle = this.handles.get(id)
    if (!handle || handle.runId !== runId) throw new ToolError('invalid-target', '目标句柄不存在或不属于此任务')
    return handle
  }
  private handleFootprint(handle: Handle, model: DocumentModel): string {
    const target = sourceField(handle.target) && isSourceDocumentModel(model)
      ? mapSourceTarget(handle.source!, model.source, handle.target) : handle.target
    return targetFootprint(model, target)
  }
  private recordAppliedFootprints(runId: string, snapshot: DocumentSnapshot, model: DocumentModel,
    revision: number, edits: readonly SourceSplice[], componentSplices: readonly ComponentTextSplice[] = [],
    acknowledgedTargets: ReadonlyMap<string, ToolTarget> = new Map()): void {
    const run = this.run(runId)
    const committed = { ...snapshot, model, revision }
    const basis = run.contentReads.get(snapshot.documentId)
    if (basis?.epoch === snapshot.epoch && snapshot.model.kind === 'course-v10' && model.kind === 'course-v10') {
      for (const [key, expected] of basis.expected) {
        const before = componentValueAt(snapshot.model.project, expected.path)
        if (before.exists === expected.exists && equalComponentValue(before.value, expected.value))
          basis.expected.set(key, { path: expected.path, ...structuredClone(componentValueAt(model.project, expected.path)) })
      }
    }
    for (const handle of this.handles.values()) {
      if (handle.runId !== runId || handle.documentId !== snapshot.documentId || handle.epoch !== snapshot.epoch
        || handle.revision > snapshot.revision) continue
      try {
        const currentTarget = sourceField(handle.target) && isSourceDocumentModel(snapshot.model)
          ? mapSourceTarget(handle.source!, snapshot.model.source, handle.target) : handle.target
        let nextTarget = acknowledgedTargets.get(documentDigest(currentTarget)) ?? (sourceField(currentTarget) && isSourceDocumentModel(model) && isSourceDocumentModel(snapshot.model)
          ? mapAcknowledgedSourceTarget(currentTarget, edits, snapshot.model.source, model.source)
          : mapAcknowledgedComponentTarget(currentTarget, componentSplices, model))
        // A task commit explains a target change only when the target still matched
        // the result of this task's previous acknowledged commit beforehand.
        if (handle.conflicted || this.handleFootprint(handle, snapshot.model) !== handle.expectedFootprint) {
          handle.conflicted = true
          continue
        }
        handle.target = nextTarget
        if (sourceField(nextTarget) && isSourceDocumentModel(model)) handle.source = model.source
        // This exact task's durable ACK advances its observed logical target. External
        // overlaps still fail the pre-commit footprint check above; models do not re-sign handles.
        handle.footprint = handle.expectedFootprint = targetFootprint(model, nextTarget)
        handle.revision = revision
      } catch { handle.conflicted = true }
    }
    if (isSourceDocumentModel(snapshot.model) && isSourceDocumentModel(model)) {
      const source = run.sources.get(snapshot.documentId)
      if (source !== undefined) {
        const doc = run.grant.documents.find(value => value.documentId === snapshot.documentId)
        const beforeSource = snapshot.model.source
        if (doc) {
          const nextWritable: ToolTarget[] = []
          for (const target of doc.writable) {
            if (!sourceField(target)) { nextWritable.push(target); continue }
            try {
              const currentTarget = mapSourceTarget(source, beforeSource, target)
              nextWritable.push(acknowledgedTargets.get(documentDigest(currentTarget)) ?? mapAcknowledgedSourceTarget(currentTarget, edits, beforeSource, model.source))
            }
            catch { /* An ambiguous external overlap does not become new write authority. */ }
          }
          doc.writable = nextWritable
        }
        run.sources.set(snapshot.documentId, model.source)
      }
    }
    if (snapshot.model.kind === 'course-v10' && model.kind === 'course-v10') {
      const doc = run.grant.documents.find(value => value.documentId === snapshot.documentId)
      if (doc) doc.writable = doc.writable.flatMap(target => {
        if (!componentRange(target) && !(target.kind === 'course-instance' && target.dataPath)) return [target]
        const key = documentDigest({ documentId: snapshot.documentId, target }), expected = run.rangeFootprints.get(key)
        try {
          if (expected && targetFootprint(snapshot.model, target) !== expected) return []
          const next = acknowledgedTargets.get(documentDigest(target)) ?? mapAcknowledgedComponentTarget(target, componentSplices, model)
          run.rangeFootprints.delete(key)
          if (expected || componentRange(target)) run.rangeFootprints.set(documentDigest({ documentId: snapshot.documentId, target: next }), targetFootprint(model, next))
          return [next]
        } catch { return [] }
      })
    }
  }
  private refreshReadHandle(handle: Handle, snapshot: DocumentSnapshot, target: ToolTarget): string {
    const run = this.run(handle.runId)
    const unchanged = !handle.conflicted && targetFootprint(snapshot.model, target) === handle.expectedFootprint
    // A stable object can be inspected after an external edit; the new read does not renew write authority.
    return this.capture(handle.runId, snapshot, target,
      unchanged && handle.writable && this.canWrite(run, snapshot, target), handle.readOnly || !unchanged)
  }
  private resolve(handle: Handle, snapshot: DocumentSnapshot, write: boolean, verifyFootprint = write): ToolTarget {
    const run = this.run(handle.runId)
    this.authorizeDocument(run, snapshot)
    if (handle.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    if (write && !handle.writable) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
    if (handle.conflicted && (write || verifyFootprint)) throw new ToolError('target-conflict', '目标内容已由其他操作改变；旧句柄不可续写，请核对新内容后重新发起任务。')
    let target = handle.target
    try {
      if (sourceField(target) && isSourceDocumentModel(snapshot.model)) target = mapSourceTarget(handle.source!, snapshot.model.source, target)
      if (verifyFootprint
        && targetFootprint(snapshot.model, target) !== handle.footprint) {
        throw new Error(targetFootprint(snapshot.model, target) === handle.expectedFootprint && handle.expectedFootprint !== handle.footprint
          ? '本任务已修改目标内容；旧句柄不可续写。请 read 或 inspect 原句柄并使用返回的 data.target；同轮多项编辑请用 batch。'
          : '目标内容已由其他操作改变；旧句柄不可续写，请核对新内容后重新发起任务。')
      }
      readTarget(snapshot.model, target)
      if (write && !this.canWrite(run, snapshot, target)) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
    } catch (error) { throw new ToolError('target-conflict', error instanceof Error ? error.message : '目标已改变') }
    return target
  }

  /** Stable host event correlation; not exposed to model arguments. */
  operationIdentity(runId: string, callId: string): string {
    if (!callId) throw new ToolError('invalid-call-id', '工具调用缺少宿主编号')
    return `tool:${documentDigest({ runId, callId })}`
  }
  private captureOperationLeases(runId: string, operationId: string): void {
    const run = this.run(runId)
    if (!run.stopped && !this.operationLeases.has(operationId)) this.operationLeases.set(operationId, { runId, leases: new Map(run.documentLeases) })
  }
  private operationLease(runId: string, operationId: string, documentId: string): string {
    const run = this.run(runId)
    const lease = this.operationLeases.get(operationId)?.leases.get(documentId)
      ?? (!run.detachedDocuments?.has(documentId) ? run.documentLeases.get(documentId) : undefined)
    if (!lease || lease !== this.run(runId).documentLeases.get(documentId))
      throw new ToolError('run-stopped', '此操作原来的文档授权已停止，请在重新打开后发起新操作')
    return lease
  }
  /** Main approval binds exact paths to this existing operation identity. */
  authorizeOperationPaths(runId: string, callId: string, paths: readonly string[]): void {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.hostTools.authorizeOperationPaths(runId, this.operationIdentity(runId, callId), paths)
  }
  preflightArtifactSave(runId: string, input: unknown) {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    return this.hostTools.preflightArtifactSave(runId, hostArtifactSaveSchema.parse(input))
  }
  /** Main prepares and approves an exact local command; these methods are not model tools. */
  async prepareLocalRun(runId: string, callId: string, intent: LocalToolRunIntent): Promise<LocalToolRunPreview> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    return this.hostTools.prepareLocalRun(runId, this.operationIdentity(runId, callId), intent)
  }
  async authorizeLocalRun(runId: string, callId: string, intent: LocalToolRunIntent): Promise<void> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    await this.hostTools.authorizeLocalRun(runId, this.operationIdentity(runId, callId), intent)
  }
  /** Main-only continuation/web receipts; never exposed as model arguments or a tool. */
  async bindMaterialSources(runId: string, sourceIds: readonly string[]): Promise<void> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    await this.hostTools.bindMaterialSources(runId, sourceIds)
  }

  private identifyCall(runId: string, callId: string, input: ModelToolCall) {
    const operationId = this.operationIdentity(runId, callId)
    const call = structuredClone(input), digest = documentDigest(call), key = operationId
    return { call, digest, key, operationId }
  }

  /** Read-only durable receipt lookup, including after stop or a new epoch. Never plans or queues a mutation. */
  async lookup(runId: string, callId: string, input: ModelToolCall): Promise<ToolResult | null> {
    try {
      const { digest, key, operationId } = this.identifyCall(runId, callId, input)
      const previousDigest = this.callDigests.get(key)?.digest
      if (previousDigest && previousDigest !== digest) throw new ToolError('operation-payload-mismatch', '同一调用编号不能提交不同内容')
      if (input.name === 'mcp.invoke') {
        const prior = await this.hostTools.lookupMcp(runId, operationId)
        if (prior) return { kind: 'read', data: prior }
      }
      if (input.name === 'file.save' || input.name === 'document.export' || input.name === 'project.save') {
        const imported = await this.hostTools.lookup(runId, operationId, digest, input.name === 'project.save' ? 'file.save' : input.name)
        if (imported) return imported
      }
      return this.findReceipt(runId, operationId, digest) ?? await this.hostTools.lookup(runId, operationId, digest, input.name)
    } catch (error) { return this.error(error) }
  }

  /** Main proves task lineage; the original committed call and current exact content prove the renewed range. */
  async recoverBoundContentOutput(priorRunId: string, callId: string, call: ModelToolCall,
    binding: NonNullable<ToolRunGrant['contentOutput']>, currentDocumentId = binding.documentId,
    capturedTarget?: { documentId: string; target: ToolTarget }): Promise<ToolRunGrant['contentOutput'] | null> {
    if (call.name !== 'text.replace') return null
    const parsed = canonicalToolRegistration('text.replace')!.inputSchema.safeParse(call.input)
    if (!parsed.success || !('content' in parsed.data)) return null
    const input = parsed.data as { target?: string; content: string; format?: 'text' | 'html' }
    if (input.target) {
      const captured = this.handles.get(input.target)
      const original = captured && captured.runId === priorRunId ? captured : capturedTarget
      if (!original || original.documentId !== binding.documentId) return null
      const fieldIdentity = (target: ToolTarget) => target.kind === 'markdown-range' ? { kind: target.kind, from: target.from }
        : target.kind === 'html-author-field' ? { kind: target.kind, authorKey: target.authorKey, field: target.field }
        : target.kind === 'course-instance' ? { ...target, to: undefined } : target
      if (!equalComponentValue(fieldIdentity(original.target), fieldIdentity(binding.target))) return null
    }
    const receipt = await this.lookup(priorRunId, callId, call)
    if (receipt?.kind !== 'document-operation' || !['applied', 'unchanged'].includes(receipt.result.status)) return null
    try {
      const current = await this.registry.get(currentDocumentId).drain()
      const target = recoverEditableTargetAfterReplacement(current.model, binding.target, input.content, input.format)
      return target ? { kind: 'replace-text', documentId: currentDocumentId, target } : null
    } catch { return null }
  }

  private findReceipt(runId: string, operationId: string, requestDigest: string): ToolResult | null {
    const run = this.run(runId)
    for (const documentId of new Set([...run.grant.documents.map(document => document.documentId), ...(run.detachedDocuments ?? [])])) {
      // Closing another granted document cannot hide this operation's durable receipt.
      let session: ReturnType<DocumentRegistry['get']>
      try { session = this.registry.get(documentId) } catch { continue }
      const result = session.lookupRequest({ documentId, operationId, actor: run.grant.actor, runId, requestDigest })
      if (result) return { kind: 'document-operation', result, affected: [] }
    }
    return null
  }

  execute(runId: string, callId: string, input: ModelToolCall): Promise<ToolResult> {
    return this.executeCall(runId, callId, input)
  }

  /** Delivery addresses the current document, not the content version captured for an edit. */
  async currentDeliveryDocument(runId: string, target?: string): Promise<{ documentId: string; epoch: string; revision: number }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = target !== undefined ? this.handle(runId, target) : undefined
    if (handle && handle.target.kind !== 'document') throw new ToolError('invalid-target', '保存或导出需要整份文档句柄')
    if (handle && (!handle.writable || handle.readOnly)) throw new ToolError('not-authorized', '目标没有整份保存或导出授权')
    const writable = run.grant.documents.filter(document => document.writable.some(value => value.kind === 'document'))
    const documentId = handle?.documentId ?? run.currentDocumentId ?? (writable.length === 1 ? writable[0]!.documentId : undefined)
    if (!documentId) throw new ToolError('target-required', '本次任务有多个文档，请明确要保存或导出的文档目标')
    const hasWholeGrant = () => run.grant.documents.some(document => document.documentId === documentId && document.writable.some(value => value.kind === 'document'))
    if (!hasWholeGrant()) throw new ToolError('not-authorized', '当前文档没有整份保存或导出授权')
    if (handle && run.epochs.get(documentId) !== handle.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    await this.options.prepareInput?.(documentId)
    const snapshot = await this.registry.get(documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.authorizeDocument(run, snapshot)
    if (handle && handle.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    if (!hasWholeGrant()) throw new ToolError('not-authorized', '当前文档没有整份保存或导出授权')
    // Own or human edits change content footprints, but the save/export intent is current content.
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision }
  }

  /** Host journal child, deliberately absent from the public model catalog. */
  completeTaskDelivery(runId: string, callId: string, delivery: unknown, signal?: AbortSignal): Promise<ToolResult> {
    return this.executeCall(runId, callId, { name: 'task.delivery', input: delivery }, async (operationId, requestDigest, call) => {
      const known = await this.hostTools.lookup(runId, operationId, requestDigest, 'task.delivery')
      if (known) return known
      if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
      signal?.throwIfAborted()
      let captured: ReturnType<DocumentToolGateway['currentDeliveryDocument']> | undefined
      return this.hostTools.completeTaskDelivery({ runId, operationId, requestDigest, signal,
        current: target => captured ??= this.currentDeliveryDocument(runId, target) }, call.input)
    })
  }

  /** Final content from a host-bound request. The software chooses the matching representation. */
  async applyBoundContent(runId: string, callId: string, targetHandle: string, content: string): Promise<ToolResult> {
    return this.execute(runId, callId, await this.boundContentCall(runId, targetHandle, content))
  }
  async boundContentCall(runId: string, targetHandle: string, content: string): Promise<ModelToolCall> {
    const resolved = await this.resolveEditTarget(runId, targetHandle)
    const view = readEditableTargetContent(resolved.model, resolved.target)
    return { name: 'text.replace', input: { target: targetHandle, content, ...(view.format === 'html' ? { format: 'html' } : {}) } }
  }

  /** Pure authorization and dependency check before showing an approval card. Final planning and CAS still run after approval. */
  async preflightBatch(runId: string, input: unknown): Promise<ToolResult | null> {
    try {
      const run = this.run(runId)
      if (!run.advertised) await this.describeRun(runId)
      if (!run.advertised!.allowed.has('batch')) throw new ToolError('not-authorized', '当前任务没有批量修改权限')
      const schema = batchInputSchemaFor(mutationNamesIn([...run.advertised!.allowed]))
      const mutations = (schema.parse(input) as { operations: BatchMutationCall[] }).operations
      const handles = [...await this.captureMutationHandles(runId, mutations, input), ...this.additionalMutationHandles(runId, mutations)]
      if (handles.some(handle => handle.documentId !== handles[0].documentId))
        throw new ToolError('cross-document-batch', '批量原子操作只能属于同一文档')
      const snapshot = await this.registry.get(handles[0].documentId).drain()
      for (const handle of handles) this.resolve(handle, snapshot, true)
      return null
    } catch (error) { return this.error(error) }
  }

  /** Asset tools plan from the same observed paths as project.apply. */
  private async prepareSettingsBackground(runId: string, input: z.output<typeof courseConfigureInputSchema>['settings']['background']) {
    const resources: ComponentEdit[] = []
    if (!input?.source) return { background: input, resources }
    const { source, ...background } = input
    const image = await this.hostTools.readMediaSource(runId, source)
    if (!image.mimeType.startsWith('image/')) throw new ToolError('invalid-content', '背景需要图片来源')
    const prepare = this.options.prepareMedia ?? this.options.prepareImage
    if (!prepare) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const admitted = await prepare(image, this.createId), provenance = this.images.get(source)?.source
    resources.push({ type: 'asset.add', asset: { ...admitted.meta, ...(provenance ? { source: provenance } : {}) }, bytes: Uint8Array.from(admitted.bytes) })
    return { background: { ...background, mode: background.mode ?? 'own' as const, assetId: admitted.meta.id }, resources }
  }

  /** Asset tools plan from the same observed paths as project.apply. */
  private componentAssetPlacement(snapshot: ComponentProjectSnapshot, file: ComponentProjectFile): { container: ComponentContainer; index: number; target: ToolTarget } {
    const project = file.observedState ? resolveComponentPresentation(snapshot.model.project, file.observedState.surfaceId, file.observedState.stateId) : snapshot.model.project, target = file.target
    if (!target) throw new ToolError('invalid-target', '请选择工程中的页面或对象路径')
    if (target.kind === 'container') {
      let owner = target.container
      while (owner.kind === 'instance') {
        const next = owningContainer(project, owner.instanceId)
        if (!next) throw new ToolError('invalid-target', '对象归属已不存在')
        owner = next
      }
      const surfaceId = owner.kind === 'surface' ? owner.surfaceId : file.observedState?.surfaceId ?? project.surfaces[0]?.id
      if (!surfaceId) throw new ToolError('invalid-target', '工程没有可用页面')
      return { container: target.container, index: containerChildIds(project, target.container).length,
        target: { kind: 'course-surface', surfaceId, ...(file.observedState ? { stateId: file.observedState.stateId } : {}) } }
    }
    const instance = project.instances[target.instanceId], container = owningContainer(project, target.instanceId)
    if (!instance || !container) throw new ToolError('invalid-target', '捕获的对象已不存在')
    let owner = container
    while (owner.kind === 'instance') {
      const next = owningContainer(project, owner.instanceId)
      if (!next) throw new ToolError('invalid-target', '对象归属已不存在')
      owner = next
    }
    const surfaceId = owner.kind === 'surface' ? owner.surfaceId : file.observedState?.surfaceId ?? project.surfaces[0]?.id
    if (!surfaceId) throw new ToolError('invalid-target', '工程没有可用页面')
    return { container, index: containerChildIds(project, container).indexOf(instance.id) + 1,
      target: { kind: 'course-instance', surfaceId, instanceId: instance.id, ...(file.observedState ? { stateId: file.observedState.stateId } : {}) } }
  }

  private async commitComponentAsset(runId: string, operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot,
    command: ComponentOperationBatch, affected: string[]): Promise<ToolResult> {
    const run = this.run(runId), session = this.registry.get(baseline.documentId)
    const current = await session.drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    this.authorizeDocument(run, current)
    if (current.epoch !== baseline.epoch || current.model.kind !== 'course-v10' || !this.canWrite(run, current, { kind: 'document' }))
      throw new ToolError('not-authorized', '原工程身份或写权限已变化')
    const driver = this.drivers.find(value => value.kind === 'course-v10')
    if (!driver) throw new Error('V10 Driver 未注册')
    const next = await driver.apply(current.model, command)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    const result = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
      baseRevision: baseline.revision, actor: run.grant.actor, runId, runLeaseId: this.operationLease(runId, operationId, baseline.documentId), requestDigest, mutation: { type: 'command', command } })
    if (result.status === 'applied') this.recordAppliedFootprints(runId, current, next, result.revision, [], [])
    return { kind: 'document-operation', result, affected }
  }

  /** Downloads retain source metadata; a destination path identifies author content, never a caller-made asset identity. */
  private async fetchOpenImage(runId: string, operationId: string, requestDigest: string, input: { image: string; project?: string; path?: string }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, input.path ? 'write' : 'read')
    if (!input.path) {
      if (!this.run(runId).grant.documents.some(doc => doc.documentId === current.documentId && doc.writable.length > 0))
        throw new ToolError('not-authorized', '本次任务对该课件没有可写范围')
      const fetched = await this.hostTools.openImageFile(runId, input.image)
      if (fetched.status !== 'ready') return { kind: 'read', data: fetched }
      const resource = await this.provideImage(runId, current.documentId, fetched.file)
      this.images.get(resource)!.source = structuredClone(fetched.source)
      return { kind: 'read', data: { status: 'ready', resource, htmlSource: `cw-result:${encodeURIComponent(resource)}`, mimeType: fetched.file.mimeType, width: fetched.width, height: fetched.height,
        byteLength: fetched.file.bytes.byteLength, source: fetched.source } }
    }
    const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, input.path, false, input.project)
    const placement = this.componentAssetPlacement(snapshot, file)
    if (file.observedState && placement.target.kind === 'course-surface') throw new ToolError('state-placement-unsupported', '展示状态页面不支持此文件资产插入；请使用具体对象的状态目标。')
    const instance = placement.target.kind === 'course-instance' ? snapshot.model.project.instances[placement.target.instanceId] : undefined
    const definition = instance && snapshot.model.project.definitions[instance.definitionId]
    const mode = componentDefinitionBuiltinKey(definition) === 'guoling.image' ? 'replace' : 'insert'
    const fetched = await this.hostTools.openImageFile(runId, input.image)
    if (fetched.status !== 'ready') return { kind: 'read', data: fetched }
    if (!this.options.prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const prepared = await prepareComponentImageApplication({ snapshot, target: placement.target, image: fetched.file, mode,
      source: fetched.source, container: placement.container, index: placement.index }, { prepareImage: this.options.prepareImage, createId: this.createId })
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, prepared.command, [input.path])
  }

  /** Insert the same complete API 5 graph offered by the component panel as one undoable command. */
  private async applyImageResourceFile(runId: string, operationId: string, requestDigest: string,
    input: { project?: string; path: string; from: string; intent?: ContentApplyIntent }): Promise<ToolResult> {
    if (input.intent === 'style') throw new ToolError('invalid-input', '图片资源不能用于样式修改')
    const current = await this.componentProjectDocument(runId, input.project, 'write')
    const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, input.path, false, input.project)
    const placement = this.componentAssetPlacement(snapshot, file)
    if (file.observedState && placement.target.kind === 'course-surface') throw new ToolError('state-placement-unsupported', '展示状态页面不支持此文件资产插入；请使用具体对象的状态目标。')
    const image = await this.readImageResource(runId, snapshot.documentId, input.from)
    const source = this.images.get(input.from)?.source
    if (!this.options.prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const intent = input.intent ?? 'content'
    const instance = file.target?.kind === 'instance' ? snapshot.model.project.instances[file.target.instanceId] : undefined
    const definition = instance && snapshot.model.project.definitions[instance.definitionId]
    const isImage = componentDefinitionBuiltinKey(definition) === 'guoling.image'
    if (file.observedState && intent === 'redo' && !isImage) throw new ToolError('state-placement-unsupported', '展示状态图片操作不能删除基础对象；请使用状态内的具体图片对象进行替换。')
    if (intent === 'content' && !isImage) throw new ToolError('invalid-target', '图片内容替换需要专业图片对象；向页面添加图片请使用 insert')
    const removeIds = intent !== 'redo' || isImage ? [] : file.target?.kind === 'instance' ? [file.target.instanceId]
      : file.target?.kind === 'container' ? [...containerChildIds(snapshot.model.project, file.target.container)] : []
    const prepared = await prepareComponentImageApplication({ snapshot, target: placement.target, image,
      mode: isImage && intent !== 'insert' ? 'replace' : 'insert', source, container: placement.container,
      index: removeIds.length ? file.target?.kind === 'instance' ? placement.index - 1 : 0 : placement.index },
      { prepareImage: this.options.prepareImage, createId: this.createId })
    const command = removeIds.length ? captureComponentOperation(snapshot.model.project, [
      ...removeIds.map(instanceId => ({ type: 'instance.remove' as const, instanceId })), ...prepared.command.edits,
    ]) : prepared.command
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, command, [input.path])
  }

  private async useLibraryComponent(runId: string, operationId: string, requestDigest: string,
    input: { packageId: string; version?: string; project?: string; path: string }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, 'write')
    const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, input.path, false, input.project)
    if (file.observedState) throw new ToolError('state-placement-unsupported', '组件库图结构插入属于基础内容；请明确选择基础页面或对象目标。')
    const placement = this.componentAssetPlacement(snapshot, file)
    const component = await this.hostTools.libraryComponent(runId, input.packageId, input.version)
    if (component.status !== 'ready') return { kind: 'read', data: component }
    const planned = prepareComponentLibraryApplication(snapshot.model.project, component.entry, {
      container: placement.container, index: placement.index, createId: kind => `${kind}_${this.createId()}` })
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, planned.command, [input.path])
  }

  /** Save the actual selected author graph and its resource closure into the existing managed catalog. */
  private librarySelection(runId: string, current: ComponentProjectSnapshot, path?: string, selector?: string): string[] {
    if (path) {
      const { file } = this.componentProjectFiles.captureFile(runId, current, path, false, selector)
      if (file.observedState) throw new ToolError('state-placement-unsupported', '组件库图结构操作属于基础内容；请明确选择基础对象目标。')
      if (file.target?.kind !== 'instance') throw new ToolError('invalid-target', '请指定工程对象文件路径')
      return [file.target.instanceId]
    }
    const selected = this.run(runId).grant.documents.find(doc => doc.documentId === current.documentId)?.selection ?? []
    const ids = [...new Set(selected.flatMap(target => target.kind === 'course-instance' ? [target.instanceId] : []))]
    if (!ids.length) throw new ToolError('selection-required', '本次任务没有绑定对象选区，请先选择对象或指定对象路径')
    if (ids.some(id => !current.model.project.instances[id])) throw new ToolError('target-conflict', '任务绑定的部分对象已不存在')
    return ids
  }

  private async updateLibraryComponent(runId: string, operationId: string, requestDigest: string,
    input: { packageId: string; version?: string; project?: string; path?: string }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, 'write')
    const roots = this.librarySelection(runId, current, input.path, input.project)
    const definitions = [...new Set(roots.map(id => current.model.project.instances[id]!.definitionId))]
    if (definitions.length !== 1) throw new ToolError('target-ambiguous', '选中对象使用不同组件定义，请指定要更新的对象路径')
    const component = await this.hostTools.libraryComponent(runId, input.packageId, input.version)
    if (component.status !== 'ready') return { kind: 'read', data: component }
    const command = captureComponentOperation(current.model.project,
      planCourseComponentPackageReplacement(current.model.project, definitions[0]!, component.entry))
    return this.commitComponentAsset(runId, operationId, requestDigest, current, command, input.path ? [input.path] : [])
  }

  private async saveLibraryComponent(runId: string, operationId: string, input: { project?: string; path?: string; title?: string; description?: string;
    subject?: string[]; schoolStage?: string[]; tags?: string[] }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, 'read')
    const roots = this.librarySelection(runId, current, input.path, input.project)
    const { project, resources } = current.model, instance = project.instances[roots[0]!]
    if (!instance) throw new ToolError('not-found', '捕获的对象已不存在')
    const extracted = extractComponentLibraryApplication(project, resources, { rootIds: roots,
      title: input.title || (roots.length > 1 ? '组合组件' : instance.name || project.definitions[instance.definitionId]?.title || '组件') })
    const course = current.binding.kind === 'file' ? current.binding.path.replace(/\\/g, '/').split('/').at(-1)! : current.binding.suggestedName
    const result = await this.hostTools.saveLibraryComponent(runId, operationId, { entry: extracted.entry, sourceCourse: course,
      ...(input.description ? { description: input.description } : {}), ...(input.subject ? { subject: [...new Set(input.subject)] } : {}),
      ...(input.schoolStage ? { schoolStage: [...new Set(input.schoolStage)] } : {}), ...(input.tags ? { tags: [...new Set(input.tags)] } : {}) })
    return result.kind === 'read' && extracted.diagnostics.length ? { ...result, data: { result: result.data, diagnostics: extracted.diagnostics } } : result
  }

  /** Host-only: authorized image bytes for the run's next model request. */
  async readOpenImagePreview(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
    return this.hostTools.readImagePreview(runId, resourceId)
  }
  readMcpResource(runId: string, resourceId: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
    return this.hostTools.readMcpResource(runId, resourceId)
  }

  /** Host-verified bytes for a workspace file delivery; never serialized into a model receipt. */
  readStandaloneImage(runId: string, jobId: string, resourceId: string) {
    return this.hostTools.readStandaloneImage(runId, jobId, resourceId)
  }
  readComputeArtifact(runId: string, jobId: string, name: string) {
    return this.hostTools.readComputeArtifact(runId, jobId, name)
  }

  private async executeCall(runId: string, callId: string, input: ModelToolCall,
    perform?: (operationId: string, requestDigest: string, call: ModelToolCall) => Promise<ToolResult>): Promise<ToolResult> {
    try {
      const { call, digest, key, operationId } = this.identifyCall(runId, callId, input)
      this.captureOperationLeases(runId, operationId)
      const previousDigest = this.callDigests.get(key)?.digest
      if (previousDigest && previousDigest !== digest) return Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      if (!this.run(runId).stopped) this.callDigests.set(key, { runId, digest, retain: toolRegistration(input.name)?.effect !== null })
      const pending = this.pending.get(key)
      if (pending) return pending.digest === digest ? pending.result : Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      const result = (perform ? perform(operationId, digest, call) : this.invoke(runId, operationId, digest, call, input)).catch(error => this.error(error))
      this.pending.set(key, { digest, result })
      void result.finally(() => {
        this.pending.delete(key)
        if (input.input && typeof input.input === 'object') this.mutationCaptures.delete(input.input)
      })
      return result
    } catch (error) { return Promise.resolve(this.error(error)) }
  }
  private error(error: unknown): ToolResult {
    return { kind: 'error', code: error instanceof z.ZodError ? 'invalid-input' : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'invalid-operation', message: error instanceof Error ? error.message : '工具操作失败',
      ...(error instanceof ToolError && error.data !== undefined ? { data: error.data } : {}) }
  }

  private async componentProjectDocument(runId: string, selector: string | undefined, access: 'read' | 'write'): Promise<ComponentProjectSnapshot> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshots = await Promise.all(run.grant.documents.map(document => this.registry.get(document.documentId).drain()))
    const courses = snapshots.filter((snapshot): snapshot is ComponentProjectSnapshot => snapshot.model.kind === 'course-v10')
    const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
    const wanted = selector === undefined ? undefined : normalize(selector)
    let found = wanted === undefined ? run.currentCourseDocumentId
      ? courses.filter(snapshot => snapshot.documentId === run.currentCourseDocumentId) : courses : this.handles.has(selector!)
      ? courses.filter(snapshot => snapshot.documentId === this.handle(runId, selector!).documentId)
      : courses.filter(snapshot => {
        const filename = normalize(snapshot.binding.kind === 'file' ? snapshot.binding.path : snapshot.binding.suggestedName)
        const base = filename.split('/').at(-1)!
        return filename === wanted || filename.endsWith(`/${wanted}`) || base === wanted || nativeProjectStem(base) === wanted
      })
    const openProject = this.hostTools.projectFileServices()?.openProject
    if (!found.length && selector !== undefined && isNativeProjectFilename(selector) && openProject) {
      const opened = await openProject({ runId, path: selector, fileAccess: run.grant.fileAccess })
      await this.completeOpenedDocument(runId, opened, { selection: 'preserve' })
      const snapshot = await this.registry.get(opened.documentId).drain()
      if (snapshot.model.kind === 'course-v10') found = [snapshot as ComponentProjectSnapshot]
    }
    if (found.length !== 1) throw new ToolError(found.length ? 'project-ambiguous' : 'project-not-found', found.length ? '本任务有多个课件，请指定project文件名' : '本任务没有可用的Project V10工程')
    await this.options.prepareInput?.(found[0]!.documentId)
    const prepared = await this.registry.get(found[0]!.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (prepared.model.kind !== 'course-v10') throw new ToolError('invalid-target', '课件文档已改变')
    const snapshot = prepared as ComponentProjectSnapshot
    this.authorizeDocument(run, snapshot)
    if (access === 'write' && !this.canWrite(run, snapshot, { kind: 'document' })) throw new ToolError('not-authorized', '本次任务没有整份课件的写权限')
    return snapshot
  }

  private componentProjectScope(runId: string, selector: string | undefined, snapshot: ComponentProjectSnapshot): ComponentProjectFileScope {
    if (!selector || !this.handles.has(selector)) return { kind: 'document' }
    const target = this.resolve(this.handle(runId, selector), snapshot, false)
    const state = (target.kind === 'course-instance' || target.kind === 'course-surface') && target.stateId
      ? { state: { surfaceId: target.surfaceId, stateId: target.stateId } } : {}
    return target.kind === 'course-instance' ? { kind: 'instance', instanceId: target.instanceId, ...state }
      : target.kind === 'course-surface' ? { kind: 'surface', surfaceId: target.surfaceId, ...state } : { kind: 'document' }
  }

  /** Image bytes for assets/: this task's image result, a standalone image job result, or a workspace file. */
  private async invoke(runId: string, operationId: string, requestDigest: string, call: ModelToolCall, originalCall = call): Promise<ToolResult> {
    const run = this.run(runId)
    // Durable replay precedes target validation: a successful call has already changed that target.
    const receipt = this.findReceipt(runId, operationId, requestDigest)
    if (receipt) return receipt
    if (call.name === 'course.importPptx' || call.name === 'asset.save' || call.name === 'asset.import' || call.name === 'asset.delete' || call.name === 'artifact.save' || call.name.startsWith('office.')) {
      const imported = await this.hostTools.lookup(runId, operationId, requestDigest, call.name)
      if (imported) return imported
    }
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (!run.advertised) await this.describeRun(runId)
    const advertised = run.advertised!
    if (!advertised.allowed.has(call.name)) throw new ToolError('not-authorized', '此工具不在当前任务的授权或已配置能力中')
    if (call.name === 'batch') batchInputSchemaFor(mutationNamesIn([...advertised.allowed])).parse(call.input)
    const family = familyOfTool(call.name)
    if (family && !advertised.names.has(call.name)) {
      run.loadedFamilies.add(family)
      this.catalogChanged(runId)
    }
    const definition = toolCatalog.find(tool => tool.name === call.name)
    if (!definition) throw new ToolError('unsupported-tool', '此工具尚未接入正式 Gateway')
    if (call.name === 'course.importPptx') return pptxImportRegistration.handler({ import: async input => {
      const result = await this.hostTools.importPptx(runId, operationId, requestDigest, input)
      if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') return result
      const data = result.data as Record<string, unknown>
      if (data.status !== 'saved' || typeof data.documentId !== 'string' || run.stopped) return result
      try {
        const opened = await this.completeOpenedDocument(runId, { documentId: data.documentId, writable: true })
        return { ...result, data: { ...data, ...opened } }
      } catch { return { ...result, data: { ...data, openError: '课件已保存，任务未取得新目标；可按返回路径重新打开' } } }
    } }, call.input)
    const htmlAction = htmlActionToolRegistration(call.name)
    if (htmlAction) return htmlAction.handler({ execute: async (name, input) => {
      const snapshots = await Promise.all(run.grant.documents.map(document => this.registry.get(document.documentId).drain()))
      const candidates = snapshots.filter(snapshot => isSourceDocumentModel(snapshot.model) && snapshot.binding.kind === 'file' && /\.html?$/i.test(snapshot.binding.path))
      const snapshot = candidates.find(value => value.documentId === run.currentHtmlDocumentId)
        ?? candidates.find(value => value.documentId === run.grant.contentOutput?.documentId) ?? (candidates.length === 1 ? candidates[0] : undefined)
      if (!snapshot) throw new ToolError('html-target-required', '请先通过 file.open 明确本任务要观察的 HTML 文件')
      this.authorizeDocument(run, snapshot)
      return this.hostTools.executeHtmlAction(runId, snapshot, { name, input, operationId })
    } }, call.input)
    const office = officeToolRegistration(call.name)
    if (office) return office.handler({ runId, operationId, host: this.hostTools }, call.input)
    const material = materialToolRegistration(call.name)
    if (material) return material.handler({ runId, operationId, host: this.hostTools }, call.input)
    if (call.name === 'artifact.save') return hostArtifactSaveRegistration.handler({ runId, operationId, requestDigest, host: this.hostTools }, call.input)
    const projectTool = projectFileRegistration(call.name)
    if (projectTool) return projectTool.handler({ projectFiles: async (name, input) => {
      if (name === 'project.save') {
        // Save through the existing delivery owner with the same permission, receipt and recovery.
        if (!this.supports(name)) throw new ToolError('service-unavailable', '文档保存服务尚未就绪')
        const { project } = input as { project?: string }
        const snapshot = await this.componentProjectDocument(runId, project, 'write')
        const target = this.capture(runId, snapshot, { kind: 'document' }, true)
        return this.hostTools.deliverDocument({ runId, operationId, requestDigest,
          resolveHandle: handle => this.currentDeliveryDocument(runId, handle) }, 'file.save', { target })
      }
      if (name === 'project.apply') {
        const parsed = componentProjectFileSchemas[name].parse(input)
        const current = await this.componentProjectDocument(runId, parsed.project, 'write')
        this.contentReadExpectations(runId, current)
        if ('from' in parsed && (this.images.has(parsed.from) || this.hostTools.isImageSource(parsed.from))) {
          const { file } = this.componentProjectFiles.captureFile(runId, current, parsed.path, false, parsed.project)
          // File-bound assets retain their identity through the existing file owner.
          // Only object/page targets use professional-image insertion or replacement.
          if (file.kind !== 'asset') return this.applyImageResourceFile(runId, operationId, requestDigest, parsed)
        }
      }
      const result = await this.componentProjectFiles.execute(runId, operationId, requestDigest, name, input)
      if (name === 'project.read' && result.kind === 'read') {
        const parsed = componentProjectFileSchemas['project.read'].parse(input)
        const current = await this.componentProjectDocument(runId, parsed.project, 'read')
        const observed = this.componentProjectFiles.captureFile(runId, current, parsed.path, true, parsed.project)
        if (observed.file.target?.kind === 'instance' && ['data', 'html'].includes(observed.file.kind))
          this.recordContentRead(runId, observed.snapshot, this.componentAssetPlacement(observed.snapshot, observed.file).target)
      }
      return result
    } }, call.input)
    const service = workbenchServiceRegistration(call.name)
    if (service) return service.handler({
      runId, operationId, host: this.hostTools,
      fetchImage: input => this.fetchOpenImage(runId, operationId, requestDigest, input),
      useAsset: input => this.useLibraryComponent(runId, operationId, requestDigest, input),
      saveAsset: input => this.saveLibraryComponent(runId, operationId, input),
      importAsset: input => this.hostTools.changeLibrary(runId, operationId, { kind: 'import', ...input }),
      deleteAsset: input => this.hostTools.changeLibrary(runId, operationId, { kind: 'delete', ...input }),
      updateAsset: input => this.updateLibraryComponent(runId, operationId, requestDigest, input),
    }, call.input)
    const gateway = gatewayToolRegistration(call.name)
    if (gateway) return gateway.handler({
      readTarget: (name, input) => this.read(runId, name, input),
      readRecipes: async () => ({ kind: 'read', data: { recipes: RECIPE_CATALOG } }),
      inspectRemix: async input => {
        const handle = this.handle(runId, input.target)
        await this.options.prepareInput?.(handle.documentId)
        const snapshot = await this.registry.get(handle.documentId).drain(), target = this.resolve(handle, snapshot, false)
        if (snapshot.model.kind !== 'course-v10' || target.kind !== 'course-surface') throw new ToolError('invalid-target', '参考改写需要已观察页面')
        const preview = inspectCourseRemixSlots(snapshot.model.project, target.surfaceId)
        return { kind: 'read', data: { target: this.refreshReadHandle(handle, snapshot, target), label: preview.sourceLabel,
          slots: preview.slots.map(slot => ({ id: slot.id, label: slot.label, original: slot.original, capacity: slot.capacity,
            ...('issue' in slot && typeof slot.issue === 'string' && slot.issue ? { issue: slot.issue } : {}) })), issues: preview.issues } }
      },
      readSkill: async input => {
        const result = await this.hostTools.readSkill(runId, input)
        const parsed = skillReadInputSchema.safeParse(input)
        if (result.kind === 'read' && parsed.success && parsed.data.path === 'SKILL.md') {
          if (parsed.data.skill === 'orchestrate-courseware' || parsed.data.skill === 'edit-content') {
            run.loadedFamilies.add('content')
            run.courseAuthoring = parsed.data.skill === 'orchestrate-courseware'
            this.catalogChanged(runId)
          } else if (parsed.data.skill === 'build-courseware-project') {
            run.courseAuthoring = false
            this.catalogChanged(runId)
          }
        }
        return result
      },
      listSkills: input => this.hostTools.listSkills(runId, input),
      observe: input => this.hostTools.observePage({ runId, operationId,
      resolveFileTarget: async (selector, path) => {
        const snapshot = await this.componentProjectDocument(runId, selector, 'read')
        const project = snapshot.model.project
        let locationId = componentProjectSurfaceId(project, path)
        if (!locationId) {
          const target = componentProjectFiles(project, snapshot.model.resources).find(file => file.path === path)?.target
          if (!target) return null
          let owner = target.kind === 'container' ? target.container : owningContainer(project, target.instanceId)
          while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
          locationId = owner?.kind === 'surface' ? owner.surfaceId : owner?.kind === 'global' ? project.surfaces[0]?.id : undefined
        }
        if (!locationId) return null
        return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
          projectId: project.id, locationId, stateId: null }
      },
      resolveTarget: async handle => {
        const observed = await this.resolveObservationTarget(runId, handle)
        const snapshot = await this.registry.get(observed.documentId).drain()
        if (snapshot.revision !== observed.revision) return null
        if (snapshot.model.kind === 'course-v10') {
          const project = snapshot.model.project, target = observed.target
          const locationId = target.kind === 'document' ? project.surfaces[0]?.id
            : target.kind === 'course-surface' || target.kind === 'course-instance' ? target.surfaceId : undefined
          const surface = project.surfaces.find(value => value.id === locationId)
          if (!surface) return null
          const stateId = target.kind === 'course-instance' ? target.stateId ?? null : null
          if (stateId && !surface.presentation?.states.some(state => state.id === stateId)) return null
          return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
            projectId: project.id, locationId: surface.id, stateId }
        }
        return null
      } }, input),
      deliverDocument: (name, input) => this.hostTools.deliverDocument({ runId, operationId, requestDigest,
        resolveHandle: handle => this.currentDeliveryDocument(runId, handle) }, name, input),
      batch: mutations => this.dispatchCanonicalMutations(runId, operationId, requestDigest, mutations, originalCall.input),
    }, call.input)
    if (isHostToolName(call.name)) return this.hostTools.invoke(runId, operationId, requestDigest, call.name, call.input)
    return this.dispatchCanonicalMutations(runId, operationId, requestDigest, [mutationCallSchema.parse(call)], originalCall.input)
  }

  /** Each registered handler admits its parsed mutation; the batch shares one Session receipt. */
  private async dispatchCanonicalMutations(runId: string, operationId: string, requestDigest: string,
    mutations: BatchMutationCall[], captureInput: unknown): Promise<ToolResult> {
    let resolve!: (result: ToolResult) => void
    let reject!: (error: unknown) => void
    const committed = new Promise<ToolResult>((done, failed) => { resolve = done; reject = failed })
    const admitted: BatchMutationCall[] = []
    const dispatched = Promise.all(mutations.map(mutation => canonicalToolRegistration(mutation.name)!.handler({
      mutate: next => { admitted.push(mutationCallSchema.parse(next)); return committed },
    }, mutation.input)))
    void this.applyCanonicalMutations(runId, operationId, requestDigest, admitted, captureInput).then(resolve, reject)
    return (await dispatched)[0]
  }

  /** Original canonical planner and single Session writer for both direct and batch calls. */
  private async applyCanonicalMutations(runId: string, operationId: string, requestDigest: string,
    mutations: BatchMutationCall[], captureInput: unknown): Promise<ToolResult> {
    const run = this.run(runId)
    const observedHandles = await this.captureMutationHandles(runId, mutations, captureInput)
    if (observedHandles.some(handle => handle.documentId !== observedHandles[0].documentId)) throw new ToolError('cross-document-batch', '批量原子操作只能属于同一文档')
    const session = this.registry.get(observedHandles[0].documentId)
    const snapshot = await session.drain()
    const readExpectations = this.contentReadExpectations(runId, snapshot)
    const references = mutations.some(mutation => ['interaction.update', 'course.logic', 'object.author', 'object.place'].includes(mutation.name))
      ? this.authoringReferences(runId, snapshot) : undefined
    const observedTargets = observedHandles.map(handle => this.resolve(handle, snapshot, true))
    const handles: Handle[] = [], targets: ToolTarget[] = [], expanded: BatchMutationCall[] = []
    const groups: { start: number; count: number; target: ToolTarget; handle: Handle; sourceIndexes: number[] }[] = []
    for (const [index, mutation] of mutations.entries()) {
      const target = observedTargets[index], handle = observedHandles[index], start = targets.length
      if (target.kind !== 'text-selection' || snapshot.model.kind === 'markdown' && target.fragments.every(fragment => fragment.target.kind === 'markdown-range')) {
        handles.push(handle); targets.push(target); expanded.push(mutation)
      }
      else {
        if (mutation.name !== 'text.replace') throw new ToolError('invalid-target', '连续文字选区仅支持正文替换')
        try {
          const format = mutation.input.format ?? (readEditableTargetContent(snapshot.model, target).format === 'html' ? 'html' : 'text')
          for (const fragment of planTextSelectionReplacement(snapshot.model, target, mutation.input.content, format)) {
            handles.push(this.capturedHandle(runId, snapshot, fragment.target, handle.writable)); targets.push(fragment.target)
            expanded.push({ name: 'text.replace', input: { ...mutation.input, content: fragment.content, format: fragment.format } })
          }
        } catch (error) { throw new ToolError('invalid-content', error instanceof Error ? error.message : String(error),
          { rejectedContent: mutation.input.content, currentContent: readEditableTargetContent(snapshot.model, target) }) }
      }
      groups.push({ start, count: targets.length - start, target, handle, sourceIndexes: [] })
    }
    mutations = expanded
    const driver = this.drivers.find(value => value.kind === snapshot.model.kind)
    if (!driver) throw new Error('文档 Driver 未注册')
    let model = snapshot.model
    const finalTargets: ToolTarget[] = []
    const sourceSplices: SourceSplice[] = []
    const componentEdits: ComponentEdit[] = []
    const componentReadPaths = new Map<string, string[]>()
    const componentSplices: ComponentTextSplice[] = []
    const advisories: ToolAdvisory[] = []
    for (let i = 0; i < mutations.length; i += 1) {
      const mutation = mutations[i]
      let target = targets[i]
      if (sourceField(target) && isSourceDocumentModel(model) && isSourceDocumentModel(snapshot.model)) target = mapAcknowledgedSourceTarget(target, sourceSplices, snapshot.model.source, model.source)
      if (model.kind === 'markdown' && target.kind === 'text-selection' && mutation.name === 'text.replace') {
        const beforeSource = model.source
        const prepared = planAggregateMarkdownTextEdit({ source: beforeSource,
          fragments: target.fragments.map(fragment => {
            if (fragment.target.kind !== 'markdown-range') throw new ToolError('invalid-target', '正文选区载体已改变')
            return { from: fragment.target.from, to: fragment.target.to, separatorBefore: fragment.separatorBefore }
          }), replacement: mutation.input.content })
        const splices = [...prepared.edits].reverse().map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length }))
        model = await driver.apply(model, { type: 'markdown.replace', source: prepared.afterSource })
        groups.find(group => group.start === i)!.sourceIndexes = splices.map((_, index) => sourceSplices.length + index)
        sourceSplices.push(...splices)
        for (let j = 0; j < finalTargets.length; j++) if (sourceField(finalTargets[j]))
          finalTargets[j] = mapAcknowledgedSourceTarget(finalTargets[j], splices, beforeSource, prepared.afterSource)
        finalTargets.push({ kind: 'text-selection', fragments: prepared.selectedRanges.map((range, index, ranges) => {
          const gap = index ? prepared.afterSource.slice(ranges[index - 1].to, range.from) : ''
          const separatorBefore = /\r?\n[\s]*\r?\n/.test(gap) ? '\n\n' : /[\r\n]/.test(gap) ? '\n' : undefined
          return { target: { kind: 'markdown-range', ...range }, ...(separatorBefore ? { separatorBefore } : {}) }
        }) })
        continue
      }
      if (model.kind === 'course-v10') {
        if (mutation.name === 'object.layout') {
          const selected = mutation.input.targets.map(id => {
            const handle = this.handle(runId, id)
            if (handle.documentId !== snapshot.documentId) throw new ToolError('cross-document-batch', '对齐对象需要属于同一文档')
            return this.resolve(handle, snapshot, true)
          })
          if (target.kind !== 'course-instance') throw new ToolError('invalid-target', '对齐需要整对象')
          const { surfaceId, stateId } = target
          if (selected.some(value => value.kind !== 'course-instance' || value.dataPath || value.from !== undefined || value.fieldScope
            || value.surfaceId !== surfaceId || (value.stateId ?? null) !== (stateId ?? null)))
            throw new ToolError('invalid-target', '对齐需要同页同展示状态的整对象')
          const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
          const edits = presentationComponentEdits(model.project, target.surfaceId, target.stateId ?? null,
            courseGeometryEdits(project, selected.map(value => (value as Extract<ToolTarget, { kind: 'course-instance' }>).instanceId), mutation.input.intent))
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command); componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'object.insert' || mutation.name === 'teacher.ensure') {
          if (target.kind !== 'course-surface' && (target.kind !== 'course-instance' || target.dataPath || target.from !== undefined))
            throw new ToolError('invalid-target', '专业插入需要已观察页面或容器')
          if (mutation.name === 'teacher.ensure' && target.kind !== 'course-surface') throw new ToolError('invalid-target', '教师控制台需要已观察页面')
          const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
          if (target.kind === 'course-instance' && !project.instances[target.instanceId]?.childIds) throw new ToolError('invalid-target', '所选对象不是容器')
          if (target.kind === 'course-instance' && componentIsLocked(project, target.instanceId)) throw new ToolError('locked-target', '容器已锁定，请先解锁')
          const container: ComponentContainer = target.kind === 'course-instance' ? { kind: 'instance', instanceId: target.instanceId } : { kind: 'surface', surfaceId: target.surfaceId }
          const prepared = mutation.name === 'teacher.ensure' ? prepareCourseTeacherControllerEdits(project, target.surfaceId)
            : prepareCourseElementEdits(project, target.surfaceId, null, mutation.input.kind, { ...mutation.input, container })
          for (const edit of prepared.edits) if (edit.type === 'instance.insert') {
            const owner: ToolTarget = edit.container.kind === 'global' ? { kind: 'document' } : edit.container.kind === 'surface'
              ? { kind: 'course-surface', surfaceId: edit.container.surfaceId, stateId: target.stateId }
              : { kind: 'course-instance', surfaceId: target.surfaceId, instanceId: edit.container.instanceId, stateId: target.stateId }
            if (!this.canWrite(run, snapshot, owner)) throw new ToolError('not-authorized', '插入容器不属于本次授权范围')
          }
          const edits = presentationComponentEdits(model.project, target.surfaceId, target.stateId ?? null, prepared.edits)
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command); componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push({ kind: 'course-instance', surfaceId: target.surfaceId, instanceId: prepared.instanceIds[0]!, stateId: target.stateId })
          continue
        }
        if (mutation.name === 'surface.recipe' || mutation.name === 'surface.remix' || mutation.name === 'course.productivity') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '此操作需要已观察页面')
          if ((mutation.name !== 'course.productivity' || mutation.input.request.scope !== 'page') && !this.canWrite(run, snapshot, { kind: 'document' }))
            throw new ToolError('not-authorized', '此操作涉及整课或全局内容，需要整课授权')
          let edits: ComponentEdit[], nextTarget: ToolTarget = target
          if (mutation.name === 'surface.recipe') {
            const result = planCourseRecipeEdits(model.project, { ...mutation.input, surfaceId: target.surfaceId }, { createId: this.createId })
            if (!result.ok) throw new ToolError('invalid-content', result.reason)
            edits = result.edits; nextTarget = { kind: 'course-surface', surfaceId: result.createdLocationId }
          } else if (mutation.name === 'surface.remix') {
            const result = planCourseStyleRemixEdits(model.project, target.surfaceId, mutation.input.replacements, this.createId)
            edits = result.edits; nextTarget = { kind: 'course-surface', surfaceId: result.createdSurfaceId }
          } else {
            const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
            const result = planCourseProductivityEdits(project, target.surfaceId, mutation.input.request)
            edits = result.edits
            advisories.push(...result.unsupported.map(message => ({ step: i + 1, code: 'authoring-preserved' as const, message })))
            edits = presentationComponentEdits(model.project, target.surfaceId, target.stateId ?? null, edits)
          }
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command); componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(nextTarget)
          continue
        }
        if (mutation.name === 'course.logic' || mutation.name === 'course.media' || mutation.name === 'interaction.update') {
          let edits: ComponentEdit[]
          if (mutation.name === 'interaction.update') {
            if (target.kind !== 'document' && target.kind !== 'course-surface' && target.kind !== 'course-instance') throw new ToolError('invalid-target', '互动需要页面、全局或整对象目标')
            if (target.kind === 'course-instance' && (target.dataPath || target.from !== undefined)) throw new ToolError('invalid-target', '互动需要整对象目标')
            const surfaceId = target.kind === 'document' ? null : target.surfaceId, stateId = target.kind === 'document' ? null : target.stateId ?? null
            const project = resolveComponentPresentation(model.project, surfaceId, stateId), change = mutation.input.change
            if (change.kind === 'click') {
              if (target.kind !== 'course-instance') throw new ToolError('invalid-target', '点击快捷规则需要对象目标')
              edits = componentClickInteractionEdits({ project, surfaceId, activeStateId: stateId, instanceId: target.instanceId }, change.action, change.value, references)
            } else {
              if (target.kind === 'course-instance') throw new ToolError('invalid-target', '规则编辑需要页面或整课目标；对象目标只支持点击快捷规则')
              const owner: ComponentTarget = surfaceId ? { kind: 'surface', surfaceId } : { kind: 'project' }
              const rules = structuredClone(interactionRules(interactionBehavior(project, owner)))
              if (change.kind === 'add' || change.kind === 'reveal' || change.kind === 'update') {
                const rule = { ...change.rule, id: change.kind === 'update' ? courseInteractionRuleReference(change.ruleId, owner, references) : this.createId(),
                  actions: change.rule.actions.map(step => ({ ...step, id: step.id ?? this.createId() })) }
                if (change.kind === 'reveal') edits = componentRevealSequenceEdits(project, owner, rule, rules, references)
                else {
                  if (change.kind === 'update') {
                    const index = rules.findIndex(item => item.id === rule.id)
                    if (index < 0) throw new ToolError('invalid-target', '规则已不存在')
                    rules[index] = rule
                  } else rules.push(rule)
                  edits = componentRuleEdits(project, owner, rules, references)
                }
              } else {
                const ruleId = 'ruleId' in change ? courseInteractionRuleReference(change.ruleId, owner, references) : ''
                const index = rules.findIndex(rule => rule.id === ruleId)
                if (index < 0) throw new ToolError('invalid-target', '规则已不存在')
                if (change.kind === 'duplicate') rules.splice(index + 1, 0, duplicateComponentRule(rules[index]))
                else rules.splice(index, 1)
                edits = componentRuleEdits(project, owner, rules, references)
              }
            }
            edits = presentationComponentEdits(model.project, surfaceId, stateId, edits)
          } else {
            if (target.kind !== 'document') throw new ToolError('invalid-target', '课程逻辑与声音设置需要整课目标')
            if (mutation.name === 'course.logic') {
              const change = mutation.input.change, context = { projectId: model.project.id, baseRevision: model.project.revision }
              const result = change.kind === 'network' ? replaceCourseNetworkDeclaration(model.project, context, change.network)
                : change.kind === 'navigation-guard.add' || change.kind === 'navigation-guard.update'
                  ? executeCourseLogicAuthoringCommand(model.project, { ...change, ...context,
                    guard: { ...change.guard, id: change.kind === 'navigation-guard.add' ? this.createId() : change.guardId } }, references)
                  : executeCourseLogicAuthoringCommand(model.project, { ...change, ...context }, references)
              if (!result.ok && result.code !== 'no-change') throw new ToolError(result.code, result.reason)
              edits = result.ok ? result.edits : []
            } else {
              const change = mutation.input.change
              edits = change.kind === 'audio' ? courseAudioSettingsEdits(model.project, change.settings)
                : change.kind === 'sound' ? courseSoundEdits(model.project, change.soundId, change.settings)
                : courseSoundImportEdits(model.project, change.assets.map(id => {
                  const asset = model.kind === 'course-v10' ? model.project.assets[id] : undefined
                  if (!asset) throw new ToolError('invalid-target', '音频素材已不存在')
                  return { id, kind: asset.mimeType?.startsWith('audio/') ? 'audio' : undefined, filename: asset.path }
                }))
            }
          }
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command); componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'course.configure' || mutation.name === 'surface.configure') {
          if (mutation.name === 'course.configure' ? target.kind !== 'document' : target.kind !== 'course-surface')
            throw new ToolError('invalid-target', '请使用相应的整课或页面目标')
          if (target.kind === 'course-surface' && target.stateId)
            throw new ToolError('invalid-target', '页面设置需要母版页面目标；当前句柄固定在命名状态')
          if (mutation.name === 'surface.configure' && target.kind === 'course-surface' && mutation.input.settings.resize) {
            const resize = mutation.input.settings.resize
            for (const surfaceId of resize.surfaceIds ?? [target.surfaceId]) if (!this.canWrite(run, snapshot, { kind: 'course-surface', surfaceId }))
              throw new ToolError('not-authorized', '尺寸修改包含未授权页面')
            if (resize.includeGlobal && !this.canWrite(run, snapshot, { kind: 'document' }))
              throw new ToolError('not-authorized', '共享层尺寸适配需要整课授权')
          }
          const prepared = await this.prepareSettingsBackground(runId, mutation.input.settings.background)
          const settings = { ...mutation.input.settings, background: prepared.background }, resources = prepared.resources
          const edits = [...resources, ...(mutation.name === 'course.configure' ? courseSettingsEdits(model.project, settings)
            : surfaceSettingsEdits(model.project, (target as Extract<ToolTarget, { kind: 'course-surface' }>).surfaceId, settings))]
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command)
          componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'surface.duplicate') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '复制页面需要已观察页面目标')
          if (!this.canWrite(run, snapshot, { kind: 'document' })) throw new ToolError('not-authorized', '复制页面需要整课授权')
          const copy = duplicateSurfaceEdits(model.project, target.surfaceId, this.createId), command = captureComponentOperation(model.project, copy.edits)
          model = await driver.apply(model, command); componentEdits.push(...copy.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push({ kind: 'course-surface', surfaceId: copy.surfaceId })
          continue
        }
        if (mutation.name === 'presentation.update') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '命名状态需要已授权演示页面目标')
          if (target.stateId !== undefined) throw new ToolError('invalid-target', '管理命名状态需要整页句柄；请从文档列出页面后操作')
          const edits = coursePresentationEdits(model.project, target, mutation.input, this.createId)
          const command = captureComponentOperation(model.project, edits)
          model = await driver.apply(model, command)
          componentEdits.push(...edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'media.insert') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '插入媒体需要已授权页面目标')
          const prepareMedia = this.options.prepareMedia ?? this.options.prepareImage
          if (!prepareMedia) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置媒体读取能力')
          const reference = 'source' in mutation.input ? mutation.input.source : mutation.input.resource
          const media = await this.hostTools.readMediaSource(runId, reference)
          const source = this.images.get(reference)?.source
          const prepared = await prepareComponentMediaApplication({ snapshot: { ...snapshot, model }, target, media,
            mode: 'insert', fit: mutation.input.fit, frame: mutation.input.frame, source }, { prepareMedia, createId: this.createId })
          model = await driver.apply(model, prepared.command)
          componentEdits.push(...prepared.command.edits)
          for (const expected of prepared.command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(prepared.target)
          continue
        }
        if (target.kind !== 'course-instance') throw new ToolError('invalid-target', '此修改需要已授权的组件对象或文字字段')
        if (mutation.name === 'media.apply') {
          const prepareMedia = this.options.prepareMedia ?? this.options.prepareImage
          if (!prepareMedia) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置媒体读取能力')
          const reference = 'source' in mutation.input ? mutation.input.source : 'resource' in mutation.input ? mutation.input.resource : mutation.input.asset
          const media = 'asset' in mutation.input ? await this.readImageResource(runId, snapshot.documentId, reference)
            : await this.hostTools.readMediaSource(runId, reference)
          const source = this.images.get(reference)?.source
          const prepared = await prepareComponentMediaApplication({ snapshot: { ...snapshot, model }, target, media,
            mode: 'replace', fit: mutation.input.fit, source }, { prepareMedia, createId: this.createId })
          model = await driver.apply(model, prepared.command)
          componentEdits.push(...prepared.command.edits)
          for (const expected of prepared.command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'text.replace') target = courseInstanceTextTarget(model, mapAcknowledgedComponentTarget(target, componentSplices, model) as typeof target)
        const textBefore = mutation.name === 'text.replace' ? readCourseInstanceText(model, target) : null
        const splice = mutation.name === 'text.replace' && textBefore !== null && target.dataPath ? {
          surfaceId: target.surfaceId, instanceId: target.instanceId, stateId: target.stateId, fieldScope: target.fieldScope, dataPath: target.dataPath,
          from: target.from ?? 0, to: target.to ?? (typeof textBefore === 'string' ? Array.from(textBefore).length : documentTextLength(textBefore)),
          inserted: Array.from(mutation.input.content).length } : null
        const textFormat = mutation.name === 'text.replace'
          ? mutation.input.format ?? (readEditableTargetContent(model, target).format === 'html' ? 'html' : 'text') : undefined
        let edits: ComponentEdit[] | null
        let mapPresentation = true
        if (mutation.name === 'text.replace') {
          try { edits = [replaceCourseInstanceText(model, target, mutation.input.content, textFormat)] }
          catch (error) { throw new ToolError('invalid-content', error instanceof Error ? error.message : String(error),
            { documentId: snapshot.documentId, revision: snapshot.revision, currentContent: readEditableTargetContent(model, target),
              rejectedContent: mutation.input.content, supportedRepresentation: 'component-html-source' }) }
        } else if (mutation.name === 'object.author') {
          if (target.dataPath || target.from !== undefined) throw new ToolError('invalid-target', '专业内容编辑需要整对象目标')
          const { project } = courseInstanceContext(model, target), change = mutation.input.change
          if (componentIsLocked(project, target.instanceId)) throw new ToolError('locked-target', '对象已锁定，请先解锁')
          edits = change.kind === 'table' ? componentTableDataEdits(project, target, change.edit)
            : change.kind === 'chart' ? componentChartDataEdits(project, target, change.edit.type === 'data' ? { ...change.edit, type: 'table-data' } : change.edit)
              : componentInputRuleEdits({ project, surfaceId: target.surfaceId, instanceId: target.instanceId }, change.request, references)
        } else if (mutation.name === 'object.structure' || mutation.name === 'object.place') {
          if (target.dataPath || target.from !== undefined) throw new ToolError('invalid-target', '结构与载体修改需要整对象目标')
          const { project } = courseInstanceContext(model, target), instanceId = target.instanceId, surfaceId = target.surfaceId, stateId = target.stateId
          const requireContainer = (container: ComponentContainer) => {
            const required: ToolTarget = container.kind === 'global' ? { kind: 'document' }
              : container.kind === 'surface' ? { kind: 'course-surface', surfaceId: container.surfaceId }
                : { kind: 'course-instance', surfaceId, instanceId: container.instanceId, stateId }
            if (!this.canWrite(run, snapshot, required)) throw new ToolError('not-authorized', '目标容器不属于当前写入范围')
            return container
          }
          const resolveContainer = (id: string): ComponentContainer => {
            const destination = this.handle(runId, id)
            if (destination.documentId !== snapshot.documentId) throw new ToolError('cross-document-batch', '结构操作需要同一课件内的目标')
            const value = this.resolve(destination, snapshot, true)
            if (value.kind === 'course-surface') return requireContainer({ kind: 'surface', surfaceId: value.surfaceId })
            if (value.kind === 'course-instance' && !value.dataPath && project.instances[value.instanceId]?.childIds)
              return requireContainer({ kind: 'instance', instanceId: value.instanceId })
            throw new ToolError('invalid-target', '目标不是已观察的页面或容器')
          }
          const topOwner = (container: ComponentContainer): ComponentContainer => container.kind === 'instance'
            ? topOwner(owningContainer(project, container.instanceId)!) : container
          if (mutation.name === 'object.structure') {
            const input = mutation.input, owner = owningContainer(project, instanceId)
            if (!owner) throw new ToolError('invalid-target', '对象归属已不存在')
            if (input.action === 'remove') edits = courseObjectRemovalEdits(project, [instanceId])
            else if (input.action === 'reorder') {
              const root = topOwner(owner)
              if (root.kind === 'surface' && project.surfaces.find(surface => surface.id === root.surfaceId)?.kind === 'flow')
                edits = flowReadingOrderEdits(project, instanceId, input.direction === 'front' ? 'last' : input.direction === 'back' ? 'first' : input.direction === 'forward' ? 'down' : 'up')
              else {
                const order = courseObjectOrder(project, instanceId, input.direction!)
                edits = order ? courseObjectOrderEdits(project, order) : []
              }
            } else {
              const container = input.destination ? resolveContainer(input.destination) : requireContainer(owner)
              if (input.action === 'move' && JSON.stringify(topOwner(container)) !== JSON.stringify(topOwner(owner)))
                throw new ToolError('invalid-target', '移动仅调整当前页面或全局平面内的父子归属；跨页面请使用复制')
              const index = input.index ?? containerChildIds(project, container).filter(id => input.action !== 'move' || id !== instanceId).length
              const reparent = JSON.stringify(owner) !== JSON.stringify(container)
              mapPresentation = input.action === 'move' && !reparent
              edits = input.action === 'move' ? courseObjectMoveEdits(reparent ? model.project : project, instanceId, container, index)
                : prepareCourseObjectPaste({ documentId: snapshot.documentId, project: model.project, resources: model.resources, roots: [instanceId] }, {
                  capturedTarget: { documentId: snapshot.documentId, project: model.project, resources: model.resources, surfaceId: target.surfaceId },
                  container, index, identity: 'copy', keepOwner: !input.destination, offset: { x: 20, y: 20 } }).edits
            }
          } else {
            const input = mutation.input.placement
            if (input.kind === 'global') {
              if (input.plane) requireContainer({ kind: 'global', plane: input.plane })
              edits = courseGlobalPlacementEdits(project, instanceId, input, references)
            } else {
              if (project.surfaces.find(surface => surface.id === surfaceId)?.kind !== 'flow') throw new ToolError('invalid-target', '此排版操作需要讲义对象')
              let parentId: string | null | undefined
              if (input.kind === 'flow-body' && input.parent !== undefined) {
                const container = input.parent ? resolveContainer(input.parent) : requireContainer({ kind: 'surface', surfaceId: target.surfaceId })
                if (container.kind === 'global') throw new ToolError('invalid-target', '正文不能移入全局层')
                const parentOwner = topOwner(container)
                if (parentOwner.kind !== 'surface' || parentOwner.surfaceId !== surfaceId) throw new ToolError('invalid-target', '正文容器需要位于当前讲义页面')
                parentId = container.kind === 'instance' ? container.instanceId : null
              }
              edits = input.kind === 'flow-overlay'
                ? flowPlacementEdits(project, instanceId, { kind: 'overlay', surfaceId: target.surfaceId, placement: input.placement, frame: input.frame, index: input.index }, references)
                : [...flowPlacementEdits(project, instanceId, { kind: 'document', surfaceId: target.surfaceId,
                  ...(parentId !== undefined ? { parentId } : {}), index: input.index }), ...(input.layout ? flowBodyLayoutEdits(project, instanceId, input.layout) : [])]
            }
          }
        } else if (mutation.name === 'object.update') {
          edits = courseInstancePropertyEdits(model, target, mutation.input.properties)
          const implementation = mutation.input.properties.implementation
          if (implementation === null || implementation?.kind === 'builtin')
            edits.push({ type: 'implementation.set', instanceId: target.instanceId, implementation })
          else if (implementation?.kind === 'source') {
            const sourceInstanceId = target.instanceId
            const observed = componentProjectFiles(model.project, model.resources).find(file => file.kind === 'source'
              && file.target?.kind === 'instance' && file.target.instanceId === sourceInstanceId
              && (!file.implementation?.workspace || file.sourceFile?.path === file.implementation.workspace.entry))
            const file: ComponentProjectFile = { ...observed, path: observed?.path ?? `source.${implementation.language === 'typescript' ? 'ts' : 'js'}`,
              kind: 'source', target: { kind: 'instance', instanceId: target.instanceId }, binding: { kind: 'instance-source', instanceId: target.instanceId },
              implementation: { ...(observed?.implementation ?? { kind: 'source', source: '', language: 'javascript' }),
                ...(implementation.language ? { language: implementation.language } : {}) } }
            let source: ContentApplySource, input: ComponentProjectFileInput | undefined
            if ('from' in implementation) {
              const port = this.options.componentContent
              if (!port?.prepareSource) throw new ToolError('service-unavailable', '当前宿主未配置组件源文件读取')
              input = await port.source(implementation.from, run.grant.fileAccess)
              source = await port.prepareSource(input, file, 'content')
            } else source = componentFileContentSource(file, implementation.source)
            edits.push(...input?.resourceEdits ?? [], ...canonicalComponentFileEdits({ ...snapshot, model }, file, undefined, source, input))
          }
        } else edits = mutation.name === 'object.convert' ? courseInstanceConversionEdits(model, target, mutation.input) : null
        if (!edits) throw new ToolError('unsupported-operation', '此 V10 对象工具尚不支持当前修改')
        if (mutation.name === 'text.replace' && textFormat !== 'html' && textBefore !== null) {
          const selected = target.from !== undefined && target.to !== undefined
            ? sliceCourseInstanceText(textBefore, target.from, target.to) : textBefore
          if ((typeof selected === 'string' ? selected : plainDocumentText(selected)) === mutation.input.content) {
            finalTargets.push(target)
            continue
          }
        }
        const mapped = mapPresentation ? presentationComponentEdits(model.project, target.surfaceId, target.stateId ?? null, edits) : edits
        for (const expected of captureComponentOperation(model.project, edits).expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
        model = await driver.apply(model, captureComponentOperation(model.project, mapped))
        componentEdits.push(...mapped)
        if (mutation.name === 'text.replace') target = courseInstanceTextTarget(model, target)
        if (splice) {
          const textAfter = readCourseInstanceText(model, target)!
          splice.inserted = (typeof textAfter === 'string' ? Array.from(textAfter).length : documentTextLength(textAfter))
            - (typeof textBefore === 'string' ? Array.from(textBefore).length : documentTextLength(textBefore!)) + splice.to - splice.from
          for (let previous = 0; previous < finalTargets.length; previous++) {
            const previousTarget = finalTargets[previous]
            if (isCourseInstanceRange(previousTarget)) finalTargets[previous] = mapAcknowledgedComponentRange(previousTarget, [splice])
          }
          componentSplices.push(splice)
        }
        if (mutation.name === 'text.replace' && target.from !== undefined && target.to !== undefined)
          target = { ...target, to: target.from + splice!.inserted }
        finalTargets.push(target)
        continue
      }
      if (isSourceDocumentModel(model) && mutation.name === 'text.replace' && target.kind === 'html-author-field') {
        if (mutation.input.format === 'html') throw new ToolError('invalid-content', 'HTML 作者字段接受正文，不接受 HTML 标记')
        const beforeSource = model.source
        const { source, splices } = prepareHtmlAuthorFieldEdit(model, target, mutation.input.content)
        model = await driver.apply(model, { type: 'markdown.replace', source })
        sourceSplices.push(...splices)
        for (let j = 0; j < finalTargets.length; j++) {
          const previous = finalTargets[j]
          if (sourceField(previous)) finalTargets[j] = mapAcknowledgedSourceTarget(previous, splices, beforeSource, source)
        }
        finalTargets.push(recoverEditableTargetAfterReplacement(model, target, mutation.input.content) ?? target)
        continue
      }
      if (!isSourceDocumentModel(model) || mutation.name !== 'text.replace' || target.kind !== 'markdown-range')
        throw new ToolError('unsupported-operation', '此文档工具不支持当前修改')
      model = await driver.apply(model, { type: 'markdown.splice', from: target.from, to: target.to, text: mutation.input.content })
      const splice = { from: target.from, to: target.to, inserted: mutation.input.content.length }
      sourceSplices.push(splice)
      for (let j = 0; j < finalTargets.length; j += 1) {
        const previous = finalTargets[j]
        if (sourceField(previous)) finalTargets[j] = mapAcknowledgedSourceTarget(previous, [splice])
      }
      target = { ...target, to: target.from + mutation.input.content.length }
      finalTargets.push(target)
    }
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    let command: DocumentCommand
    if (model.kind === 'course-v10') {
      if (snapshot.model.kind !== 'course-v10') throw new Error('文档格式在操作中改变')
      const project = snapshot.model.project
      command = captureComponentOperation(project, componentEdits)
      command.expected = [...new Map([...command.expected, ...[...componentReadPaths.values()].map(path => ({ path, ...componentValueAt(project, path) })), ...readExpectations]
        .map(expected => [JSON.stringify(expected.path), expected])).values()]
    } else if (isSourceDocumentModel(model)) command = { type: 'markdown.replace', source: model.source, resources: model.resources }
    else throw new ToolError('unsupported-document', '当前文档格式不受支持')
    const acknowledgedTargets = new Map<string, ToolTarget>()
    const aggregateMappings: NonNullable<import('../../shared/workbench/document').DocumentTextChanges['aggregateMappings']> = []
    for (const group of groups) if (group.target.kind === 'text-selection') {
      let next: Extract<ToolTarget, { kind: 'text-selection' }>
      const final = finalTargets[group.start]
      if (final?.kind === 'text-selection') next = final
      else {
        const fragments = group.target.fragments.map((fragment, index) => ({ ...fragment, target: finalTargets[group.start + index] as typeof fragment.target }))
        const nonempty = fragments.filter(fragment => fragment.target.from !== fragment.target.to)
        next = { kind: 'text-selection', fragments: (nonempty.length ? nonempty : fragments.slice(0, 1)).map((fragment, index) => index ? fragment : { target: fragment.target }) }
      }
      acknowledgedTargets.set(documentDigest(group.target), next)
      aggregateMappings.push({ before: group.target, after: next, sourceIndexes: group.sourceIndexes })
    }
    const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId, baseRevision: snapshot.revision,
      actor: run.grant.actor, runId, runLeaseId: this.operationLease(runId, operationId, snapshot.documentId), requestDigest,
      ...(sourceSplices.length || aggregateMappings.length ? { textChanges: { source: sourceSplices, flow: [], ...(aggregateMappings.length ? { aggregateMappings } : {}) } } : {}),
      mutation: { type: 'command', command } })
    if (result.status === 'applied') this.recordAppliedFootprints(runId, snapshot, model, result.revision, sourceSplices, componentSplices, acknowledgedTargets)
    const affected: string[] = []
    if (result.status === 'applied' || result.status === 'unchanged') {
      // Capture the exact acknowledged model, never a later intervening edit.
      const committed = { ...snapshot, model, revision: result.revision }
      for (const group of groups) {
        const i = group.start
        // Deleted/moved intermediate targets are still affected. Do not turn their durable ACK into a failure.
        try {
          const target = acknowledgedTargets.get(documentDigest(group.target)) ?? finalTargets[i]
          const refreshed = this.capture(runId, committed, target, group.handle.writable)
          affected.push(refreshed)
          if (run.contentTarget && group.handle === this.handles.get(run.contentTarget)) run.contentTarget = refreshed
        }
        catch {
          const input = mutations[i].input
          const original = 'path' in input ? input.path : 'targets' in input ? input.targets[0] : input.target ?? run.contentTarget
          if (original) affected.push(original)
        }
      }
      for (const handle of this.additionalMutationHandles(runId, mutations)) {
        try { affected.push(this.capture(runId, committed, handle.target, handle.writable)) } catch { /* Earlier operations may have removed an acknowledged target. */ }
      }
    }
    return { kind: 'document-operation', result, affected, ...(advisories.length ? { advisories } : {}) }
  }

  private readIdentity(runId: string, snapshot: DocumentSnapshot, target: ToolTarget) {
    return { runId, documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, target: documentDigest(target) }
  }

  /** Content observations bind only the semantic fields actually supplied, never sibling frames. */
  private recordContentRead(runId: string, snapshot: DocumentSnapshot, target: ToolTarget): void {
    if (target.kind === 'text-selection') { for (const fragment of target.fragments) this.recordContentRead(runId, snapshot, fragment.target); return }
    if (snapshot.model.kind !== 'course-v10' || target.kind !== 'course-instance' || target.fieldScope === 'flowLayout') return
    const project = snapshot.model.project, instance = project.instances[target.instanceId]
    if (!instance) return
    const paths: string[][] = [['instances', instance.id, 'definitionId']]
    let dataPath = ['instances', instance.id, 'data']
    if (target.stateId) {
      const surface = project.surfaces.find(value => value.id === target.surfaceId)
      const index = surface?.presentation?.states.findIndex(value => value.id === target.stateId) ?? -1
      if (index < 0) return
      const statePath = ['@surface', target.surfaceId, 'presentation', 'states', String(index)]
      paths.push([...statePath, 'id'])
      const overridePath = [...statePath, 'overrides', instance.id, 'data']
      if (componentValueAt(project, overridePath).exists) dataPath = overridePath
      else paths.push(overridePath)
    }
    dataPath = [...dataPath, ...(target.dataPath ?? [])]
    paths.push(dataPath, ...componentFieldIdentityPaths(project, dataPath))
    const run = this.run(runId)
    let basis = run.contentReads.get(snapshot.documentId)
    if (!basis || basis.epoch !== snapshot.epoch) {
      basis = { epoch: snapshot.epoch, expected: new Map() }
      run.contentReads.set(snapshot.documentId, basis)
    }
    for (const path of paths) basis.expected.set(JSON.stringify(path), { path, ...structuredClone(componentValueAt(project, path)) })
  }

  private contentReadExpectations(runId: string, snapshot: DocumentSnapshot): ComponentExpectation[] {
    const basis = this.run(runId).contentReads.get(snapshot.documentId)
    if (!basis || snapshot.model.kind !== 'course-v10') return []
    if (basis.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '读取依据所属文档已关闭或重开')
    const changed: ComponentExpectation[] = []
    for (const expected of basis.expected.values()) {
      const current = componentValueAt(snapshot.model.project, expected.path)
      if (current.exists !== expected.exists || !equalComponentValue(current.value, expected.value))
        changed.push({ path: expected.path, ...structuredClone(current) })
    }
    if (changed.length) {
      basis.pending = changed
      throw new ToolError('read-basis-changed', '本次生成直接读取的内容已改变，旧结果未提交。请根据当前事实重新判断并继续本任务。',
        { documentId: snapshot.documentId, revision: snapshot.revision, current: changed })
    }
    return structuredClone([...basis.expected.values()])
  }

  /** Main calls only when the changed-facts reply enters a new model request, never to replay a command. */
  acknowledgeContentFacts(runId: string, facts: readonly { documentId: string; current: readonly ComponentExpectation[] }[]): void {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    for (const fact of facts) {
      const basis = run.contentReads.get(fact.documentId)
      if (!basis?.pending || !equalComponentValue(basis.pending, fact.current)) continue
      for (const expected of basis.pending ?? []) basis.expected.set(JSON.stringify(expected.path), expected)
      delete basis.pending
    }
  }

  private async read(runId: string, method: string, input: { target: string; state?: string | null; cursor?: string; limit?: number }): Promise<ToolResult> {
    let handle = this.handle(runId, input.target)
    await this.options.prepareInput?.(handle.documentId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    let target = this.resolve(handle, snapshot, false)
    if (input.state !== undefined) {
      if (snapshot.model.kind !== 'course-v10' || target.kind !== 'course-surface' && target.kind !== 'course-instance')
        throw new ToolError('invalid-target', '展示状态需要页面或对象目标')
      const surfaceId = target.surfaceId
      const surface = snapshot.model.project.surfaces.find(value => value.id === surfaceId)
      const exact = surface?.presentation?.states.find(value => value.id === input.state)
      const matches = exact ? [exact] : surface?.presentation?.states.filter(value => value.title === input.state) ?? []
      if (input.state !== null && matches.length !== 1) throw new ToolError('invalid-target', '展示状态不存在或同名，请从页面内容中选择')
      const original = this.handle(runId, this.refreshReadHandle(handle, snapshot, target))
      target = { ...target, stateId: input.state === null ? null : matches[0]!.id }
      handle = this.capturedHandle(runId, snapshot, target, original.writable && this.canWrite(this.run(runId), snapshot, target), original.readOnly)
    }
    const current = readTarget(snapshot.model, target)
    if (method === 'read') this.recordContentRead(runId, snapshot, target)
    if (method === 'inspect') {
      const refreshed = this.refreshReadHandle(handle, snapshot, target)
      const refreshedHandle = this.handle(runId, refreshed)
      const advertised = this.run(runId).advertised
      const candidates = advertised?.definitions ?? toolCatalog.filter(tool => this.supports(tool.name))
      const writable = refreshedHandle.writable
      return { kind: 'read', data: { target: refreshed, kind: target.kind, writable,
        tools: candidates.filter(tool => (tool.manual.targetKinds as readonly string[]).includes(target.kind) &&
          (tool.manual.group === 'read' || writable && !handle.readOnly)).map(tool => tool.name) } }
    }
    const content = method === 'listChildren' ? childTargets(snapshot.model, target) : typeof current === 'string' ? current : JSON.stringify(current)
    const digest = documentDigest(content)
    let offset = 0
    if (input.cursor) {
      const cursor = this.cursors.get(input.cursor)
      const identity = this.readIdentity(runId, snapshot, target)
      if (!cursor || cursor.runId !== identity.runId || cursor.documentId !== identity.documentId || cursor.epoch !== identity.epoch
        || cursor.revision !== identity.revision || cursor.target !== identity.target || cursor.method !== method || cursor.digest !== digest) throw new ToolError('stale-cursor', '分页内容已改变，请从首页重新读取')
      offset = cursor.offset
    }
    const refreshed = this.refreshReadHandle(handle, snapshot, target)
    const refreshedHandle = this.handle(runId, refreshed)
    // Large page requests are served in chunks, not rejected after a paid model round.
    const limit = method === 'listChildren' ? Math.min(input.limit ?? 100, 1000) : Math.min((input.limit ?? 120) * 100, 64_000)
    const end = Math.min(offset + limit, content.length)
    let data: unknown
    if (typeof content === 'string') data = { target: refreshed, text: content.slice(offset, end), offset, total: content.length, truncated: end < content.length,
      ...(method === 'read' && !offset && snapshot.model.kind === 'course-v10' && ['document', 'course-surface', 'course-instance'].includes(target.kind)
        ? { authoring: { project: refreshed, ...this.componentProjectFiles.listScope(runId, snapshot as ComponentProjectSnapshot,
          this.componentProjectScope(runId, refreshed, snapshot as ComponentProjectSnapshot)) } } : {}) }
    else data = content.slice(offset, end).map(child => {
      const writable = !refreshedHandle.readOnly && (refreshedHandle.writable && containsTarget(target, child.target, snapshot.model)
        || this.canWrite(this.run(runId), snapshot, child.target))
      return { target: this.capture(runId, snapshot, child.target, writable, refreshedHandle.readOnly), label: child.label, kind: child.target.kind }
    })
    if (end < content.length) {
      const nextCursor = `c${this.createId()}`
      this.cursors.set(nextCursor, { ...this.readIdentity(runId, snapshot, target), method, digest, offset: end })
      return { kind: 'read', data, nextCursor }
    }
    return { kind: 'read', data }
  }
}
