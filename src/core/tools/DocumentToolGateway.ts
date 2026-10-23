import { componentSurfaces, componentContainers } from '../../shared/contracts/component-platform/project'
import { isNativeProjectFilename, nativeProjectStem } from '../../shared/nativeProjectFile'
import { createProjectDefinitionDiscoveryEntries, type ComponentDiscoveryEntry } from '../../shared/componentDiscovery'
import { mapAcknowledgedComponentRange, mapAcknowledgedRange, type ComponentTextSplice, type SourceSplice } from './ToolReadCoverage'
import { HostToolCoordinator, hostToolRegistration, imageInput, isHostToolName, type HostToolServices } from './HostToolServices'
import { workbenchServiceRegistration, workbenchServiceSchemas } from './WorkbenchServiceTools'
import { materialToolRegistration } from './MaterialTools'
import { hostArtifactSaveRegistration, hostArtifactSaveSchema } from './HostArtifactTools'
import { htmlActionToolRegistration } from './HtmlActionTools'
import { viewActionToolRegistration } from './ViewActionTools'
import { pptxImportRegistration } from './CourseImportTools'
import { officeToolRegistration } from './ToolCatalog'
import type { HostImageInput, PrepareImageResourcePort } from './imageResource'
import type { PrepareMediaResourcePort } from './mediaResource'
import type { AssetSource } from '../../shared/contracts/media-v1/types'
import type { ImageAssetResource } from './imageAssetMetadata'
import { z } from 'zod'
import { publicWriteToolResult } from './publicWriteReceipt'
import { compactToolInputError } from './ToolInputDiagnostic'
import { componentContainerSchema, componentFrameSchema } from '../../shared/contracts/component-platform/schema'
import { isSourceDocumentModel, type DocumentCommand, type DocumentDriver, type DocumentSnapshot, type DocumentModel } from '../../shared/workbench/document'
import type { ModelToolCall, PreparedToolImage, ToolDefinition, ToolGateway, ToolResult, ToolRunGrant, ToolTarget, ToolAdvisory } from '../../shared/workbench/tools'
import type { LocalToolRunIntent, LocalToolRunPreview } from '../../shared/workbench/toolPorts'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import { batchInputSchema, batchInputSchemaFor, canonicalToolRegistration, describeToolFamily, describeTools, familyOfTool, gatewayToolRegistration, mutationCallSchema, mutationNamesIn, selectRunToolNames, toolCatalog, toolEffectTargets, toolFamilies, toolRegistration, visibleRunToolNames, type BatchMutationCall, type InitialToolProfile, type RunToolScope, type ToolFamily } from './ToolCatalog'
import { viewObserveInputSchema } from '../../shared/workbench/viewObservation'
import { childTargets, containsTarget, courseAuthorFieldReadPaths, replaceCourseAuthorField, courseInstanceContext, courseInstanceScopeId, instanceWithinScope, courseInstanceTextTarget, mapMarkdownRange, readTarget, readSemanticTarget, targetFootprint, replaceCourseInstanceText, readCourseInstanceText, sliceCourseInstanceText, isCourseInstanceRange, readEditableTargetContent, recoverEditableTargetAfterReplacement, prepareHtmlAuthorFieldEdit, mapHtmlAuthorFieldTarget, planTextSelectionReplacement, mapExternalCourseTextTarget } from './ToolTargets'
import { courseInstancePropertyEdits, courseInstanceConversionEdits, courseInstanceAppearanceEdits, readCourseInstanceAppearance } from './courseInstanceEdits'
import { formatCourseInstanceText } from './ToolTargets'
import { formatMarkdownSource } from './textFormatting'
import { courseSettingsEdits, surfaceSettingsEdits } from '../course/courseSemanticEdits'
import { courseConfigureInputSchema, objectUpdatePropertiesInputSchema } from './toolSchemas'
import { duplicateSurfaceEdits } from '../course/courseSurfaceStructure'
import { RECIPE_CATALOG, planCourseRecipeEdits } from '../course/courseRecipeEdits'
import { inspectCourseRemixSlots, planCourseStyleRemixEdits, planCourseProductivityEdits } from '../course/courseProductivityEdits'
import { prepareCourseElementEdits, prepareCourseTeacherControllerEdits } from '../course/courseElementInsertion'
import { prepareFlowBodyInsertion } from '../course/courseFlowInsertion'
import { prepareCourseFlowColumns } from '../course/courseFlowLayoutEdits'
import { courseGeometryEdits } from '../course/courseGeometryEdits'
import { courseObjectRemovalEdits, courseObjectOrder, courseObjectOrderEdits, courseObjectMoveEdits, courseGlobalPlacementEdits, createCourseObjectPastePlanningBatch } from '../course/courseObjectEdits'
import { flowPlacementEdits, flowBodyLayoutEdits, flowReadingOrderEdits } from '../course/courseFlowEdits'
import { componentDataEdits, componentDataPropertyPaths, componentTableDataEdits, componentChartDataEdits } from '../course/componentDataEdits'
import { componentInputRuleEdits } from '../../components/input/authoring'
import { componentTextInteractionEdits } from '../course/componentTextInteractionEdits'
import { executeCourseLogicAuthoringCommand, replaceCourseNetworkDeclaration } from '../course/courseLogicAuthoringCommands'
import { courseAudioSettingsEdits, courseSoundEdits, courseSoundImportEdits } from '../course/courseMediaEdits'
import { interactionBehavior, interactionRules, remapComponentInteractionData, componentRuleEdits, componentClickInteractionEdits, componentRevealSequenceEdits, duplicateComponentRule, removeComponentRule } from '../../shared/componentInteractionData'
import { coursePresentationEdits } from './coursePresentationEdits'
import { isSpatialGraphScopedEdit, spatialGraphItem, spatialGraphDependencyPaths } from '../course/courseSpatialEdits'
import { courseTextAdvisories } from './courseTextAdvisories'
import { captureComponentOperation, componentValueAt, presentationComponentEdits, componentFieldIdentityPaths, equalComponentValue } from '../drivers/courseV10Operations'
import { imageDataSchema } from '../../components/image/data'
import type { ComponentEdit, ComponentExpectation, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, resolveComponentPresentation, containerChildIds, owningContainer, type ComponentContainer, type ComponentTarget } from '../../shared/contracts/component-platform/project'
import { prepareComponentImageApplication, prepareComponentMediaApplication } from './componentImageApplication'
import { extractComponentLibraryApplication, prepareComponentLibraryApplication } from './componentLibraryApplication'
import { planCourseComponentPackageReplacement } from '../components/library/replacement'
import { documentTextContentSchema, documentTextLength, plainDocumentText } from '../../shared/document/content'
import { flowInsertionSelection } from './ToolTargets'
import { documentReplacementEdits } from '../../shared/document/textInteraction'
import { projectFileRegistration } from './ProjectFileTools'
import { skillReadInputSchema } from './SkillTools'
import { ComponentProjectFileCoordinator, componentProjectSettings, componentProjectFileSchemas, componentProjectFiles, componentProjectSurfaceId, componentFileContentSource, canonicalComponentFileEdits, type ComponentProjectSnapshot, type ComponentProjectFileInput, type ComponentProjectFile, type ComponentProjectFileScope } from '../projectFiles/componentPlatform'
import type { ContentApplyRequest, ContentApplyResult, ContentApplySource, ContentApplyIntent, ContentApplyDiagnostic, ContentApplyPlan, ContentApplyPlanOptions } from '../contentApply/planning/types'
import { readHtmlAuthoringRecords } from '../../shared/html/htmlAuthoringRecords'
import { planAggregateMarkdownTextEdit } from '../../shared/document/aggregateTextEdit'
import type { SpatialViewportCapture } from '../../shared/workbench/spatialViewport'
import { courseInteractionRuleReference, type CourseAuthoringReference } from '../course/courseAuthoringReferences'
import type { ComponentProjectFileBatchItem } from '../projectFiles/componentPlatform/coordinator'

interface Run {
  grant: ToolRunGrant
  toolScopes: RunToolScope[]
  /** Frozen authorization categories; target continuity may suspend a range, never revoke a grant. */
  authorizedTargets: Map<string, readonly ToolTarget[]>
  historySuspended?: Map<string, { target: ToolTarget; footprint: string; source?: string }[]>
  loadedFamilies: Set<ToolFamily>
  loadedNames: Set<string>
  initialToolProfile?: InitialToolProfile
  courseAuthoring?: boolean
  currentCourseDocumentId?: string
  currentHtmlDocumentId?: string
  currentObservationCarrier?: 'html' | 'course'
  currentDocumentId?: string
  contentTarget?: string
  contentReads: Map<string, { epoch: string; expected: Map<string, ComponentExpectation>; pending?: ComponentExpectation[];
    ranges?:Map<string,{target:Extract<ToolTarget,{kind:'course-instance'}>;footprint:string;conflicted?:boolean;historyConflict?:boolean}>;pendingRanges?:string[] }>
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
  lease: string
  documentId: string
  epoch: string
  revision: number
  target: ToolTarget
  footprint: string
  expectedFootprint: string
  conflicted: boolean
  /** Only an uninterrupted canonical undo/redo sequence can restore this acknowledged target. */
  historyConflict?: boolean
  source?: string
  writable: boolean
  readOnly?: boolean
}
interface Cursor { runId: string; documentId: string; epoch: string; revision: number; target: string; method: string; digest: string; offset: number }
interface ImageApplicationCapture { runId: string; operationId: string; requestDigest: string; snapshot: ComponentProjectSnapshot;
  target: Extract<ToolTarget, { kind: 'course-surface' | 'course-instance' }>; mode: 'insert' | 'replace'; handle: Handle; result?: ToolResult }
class ToolError extends Error { constructor(readonly code: string, message: string, readonly data?: unknown) { super(message) } }
/** Current Session facts are distinct from a historical save/export receipt. */
export function documentSnapshotFacts(snapshot: DocumentSnapshot) {
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, dirty: snapshot.dirty,
    kind: snapshot.model.kind, ...(snapshot.binding.kind === 'file' ? { path: snapshot.binding.path } : { suggestedName: snapshot.binding.suggestedName }) }
}
function sourceField(target: ToolTarget): boolean { return target.kind === 'text-selection' ? target.fragments.every(fragment => sourceField(fragment.target)) : target.kind === 'markdown-range' || target.kind === 'html-author-field' && Boolean(target.source) }
function componentRange(target: ToolTarget): boolean { return target.kind === 'course-instance' && Boolean(target.authorField) || isCourseInstanceRange(target) || target.kind === 'text-selection' && target.fragments.some(fragment => isCourseInstanceRange(fragment.target)) }
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
    plan?(input: { baseline: ComponentProjectSnapshot; request: ContentApplyRequest }, options?: ContentApplyPlanOptions): Promise<ContentApplyPlan>
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
  private readonly imageApplications = new Map<string, ImageApplicationCapture>()
  private readonly runs = new Map<string, Run>()
  private readonly startingRuns = new Set<string>()
  private readonly operationLeases = new Map<string, { runId: string; leases: ReadonlyMap<string, string>; generations: ReadonlyMap<string, number> }>()
  private readonly writeTaskBarriers = new Map<string, number>()
  private readonly writeTaskGenerations = new Map<string, number>()
  private hostServicesConfigured = false
  private readonly handles = new Map<string, Handle>()
  private readonly cursors = new Map<string, Cursor>()
  private readonly pending = new Map<string, { digest: string; result: Promise<ToolResult> }>()
  private readonly callDigests = new Map<string, { runId: string; digest: string; retain: boolean }>()
  private readonly catalogListeners = new Set<(runId: string) => void>()
  /** One live call keeps its observed identities through effects, approval preflight and commit. */
  private readonly mutationCaptures = new WeakMap<object, { runId: string; digest: string; handles: Promise<Handle[]>; references: Map<string, CourseAuthoringReference> }>()

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
      active: (runId, documentId, epoch) => { const run = this.run(runId); if (run.stopped) throw new ToolError('run-stopped', '任务已停止'); const current = this.registry.get(documentId).readIdentity(); this.authorizeDocument(run, current); if (current.epoch !== epoch) throw new ToolError('stale-epoch', '文档会话已改变') },
      ownsDocument: (runId, documentId) => this.run(runId).grant.documents.some(document => document.documentId === documentId),
      documentIds: runId => this.run(runId).grant.documents.map(document => document.documentId),
      projectDiscovery: runId => this.projectDiscovery(runId),
      taskTargetContext: (runId, target, resumeContext) => this.taskTargetContext(runId, target, resumeContext),
      ownsReceiptDocument: (runId, documentId) => {
        const run = this.run(runId)
        return run.grant.documents.some(document => document.documentId === documentId) || run.detachedDocuments?.has(documentId) === true
      },
      provideImage: (runId, documentId, source) => this.provideImage(runId, documentId, source),
      readImage: (runId, documentId, resource) => this.readImageResource(runId, documentId, resource),
      readRunImage: async (runId, resource) => {
        const documentId = this.images.get(resource)?.documentId ?? this.handles.get(resource)?.documentId
        // The existing reader checks the current run, document grant, epoch and whole-image target.
        return documentId ? this.readImageResource(runId, documentId, resource) : null
      },
    })
    this.componentProjectFiles = new ComponentProjectFileCoordinator({
      document: (runId, selector, access) => this.componentProjectDocument(runId, selector, access, true),
      currentTarget: runId => this.run(runId).contentTarget,
      rebaseTarget: (runId, context) => this.rebaseTaskTargetContext(runId, context),
      scope: (runId, selector, snapshot) => this.componentProjectScope(runId, selector, snapshot),
      apply: (runId, operationId, requestDigest, baseline, request) => this.applyComponentContentOperation(runId, operationId, requestDigest, baseline, request),
      applyBatch: (runId, operationId, requestDigest, operations) => this.applyComponentContentBatch(runId, operationId, requestDigest, operations),
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
        const result = await this.readComponentSource(runId, from, sourceHtml)
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

  private async readComponentSource(runId: string, from: string, sourceHtml?: string): Promise<ComponentProjectFileInput> {
    const run = this.run(runId), port = this.options.componentContent
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (!port) throw new ToolError('service-unavailable', '内容源服务不可用')
    const group = await this.hostTools.readArtifactGroup(runId, from)
    const input = group ?? await port.source(from, run.grant.fileAccess, sourceHtml)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    return input
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
    const graphScopes = request.intent === 'canonical' && request.edits.length === 1
      ? run.grant.documents.find(document => document.documentId === baseline.documentId)?.writable.filter(
        (target): target is Extract<ToolTarget, { kind: 'spatial-graph' }> => target.kind === 'spatial-graph'
          && isSpatialGraphScopedEdit(baseline.model.project, target, request.edits[0])) ?? [] : []
    const assertActive = () => {
      if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
      const session = this.registry.get(baseline.documentId), identity = session.readIdentity()
      this.authorizeDocument(run, identity)
      if (identity.epoch !== baseline.epoch) throw new ToolError('not-authorized', '工程身份已变化')
      if (run.grant.documents.find(document => document.documentId === baseline.documentId)?.writable.some(target => target.kind === 'document')) return
      // Scoped grants still need current professional facts to prove their containment.
      const current = session.read()
      if (!this.canWrite(run, current, { kind: 'document' })) {
        const project = current.model.kind === 'course-v10' ? current.model.project : null
        const contentTarget = project ? this.componentContentTarget(current as ComponentProjectSnapshot, request) : undefined
        const contentWritable = contentTarget && this.canWrite(run, current, contentTarget)
        if (!project || !contentWritable && !graphScopes.some(scope => {
          try { spatialGraphItem(project, scope); return this.canWrite(run, current, scope) }
          catch { return false }
        })) throw new ToolError('not-authorized', '工程修改不属于当前冻结的写入范围')
      }
    }
    assertActive()
    const readExpectations = this.contentReadExpectations(runId, this.registry.get(baseline.documentId).read())
    if (request.intent === 'canonical' && request.edits[0]?.type === 'spatial.set') {
      const edit = request.edits[0]
      const project = baseline.model.project, instance = project.instances[edit.surfaceId]
      const proposed = { ...project, instances: { ...project.instances,
        [instance.id]: { ...instance, container: { ...instance.container!, spatial: edit.spatial } } } }
      for (const scope of graphScopes) for (const path of spatialGraphDependencyPaths(proposed, scope))
        readExpectations.push({ path, ...componentValueAt(baseline.model.project, path) })
    }
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

  /** File preparation stays with its owner; all usable plans share one Session command. */
  private async applyComponentContentBatch(runId: string, operationId: string, requestDigest: string,
    operations: ComponentProjectFileBatchItem[]): Promise<ContentApplyResult[]> {
    const run = this.run(runId), port = this.options.componentContent
    if (!port?.plan) throw new ToolError('service-unavailable', '当前宿主没有组件内容规划服务')
    const documentId = operations[0]!.baseline.documentId, session = this.registry.get(documentId)
    const current = await session.drain()
    if (current.model.kind !== 'course-v10') throw new ToolError('unsupported-document', '工程格式已变化')
    const assertActive = () => {
      if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
      const snapshot = session.readIdentity()
      this.authorizeDocument(run, snapshot)
      if (operations.some(item => item.baseline.documentId !== documentId || item.baseline.epoch !== snapshot.epoch))
        throw new ToolError('cross-document-batch', '同批工程内容需要属于同一正式工程和会话')
      if (!run.grant.documents.find(document => document.documentId === documentId)?.writable.some(target => target.kind === 'document'))
        throw new ToolError('not-authorized', '同批工程修改需要整课写入授权')
    }
    assertActive()
    this.captureOperationLeases(runId, operationId)
    const driver = this.drivers.find(value => value.kind === 'course-v10')!
    let model: DocumentModel = current.model
    const edits: ComponentEdit[] = [], expected = new Map<string, ComponentExpectation>()
    const results: ContentApplyResult[] = [], usable: number[] = []
    for (const [index, operation] of operations.entries()) {
      assertActive()
      try {
        const prepared = (edits.length || operation.candidateTarget) && operation.reprepare ? await operation.reprepare({ ...current, model: model as ComponentProjectSnapshot['model'] }) : operation
        const plan = await port.plan(prepared, { deferTextRelationships: true })
        assertActive()
        if (model.kind !== 'course-v10') throw new Error('工程格式已变化')
        // Candidate application may follow earlier edits; the original observed expectations remain below.
        const command = captureComponentOperation(model.project, plan.command.edits, [], { deferTextRelationships: true })
        // File batches retain usable siblings when a local professional-data candidate is invalid.
        model = await driver.apply(model, command)
        for (const item of operation.candidateTarget ? [] : plan.command.expected) if (!expected.has(JSON.stringify(item.path))) expected.set(JSON.stringify(item.path), item)
        edits.push(...command.edits); usable.push(index)
        operation.acknowledge?.(plan.command)
        results.push({ commit: 'not_committed', usability: plan.usability, delivery: 'not_requested', input: operation.request,
          insertedIds: plan.insertedIds, diagnostics: plan.diagnostics })
      } catch (error) {
        assertActive()
        results.push({ commit: 'not_committed', usability: 'unusable', delivery: 'not_requested', input: operation.request, insertedIds: [],
          diagnostics: [{ level: 'error', code: 'content-apply-unresolved', message: error instanceof Error ? error.message : String(error), repairable: true }] })
        // A complete program root and its admitted source form one authoring change.
        // Ordinary file batches still preserve independently usable siblings.
        if (operation.required) return results
      }
    }
    if (!usable.length) return results
    const combined: ComponentEdit[] = [], fileOwners = new Map<string, number>()
    for (const edit of edits) {
      if (edit.type !== 'component.files.set') { combined.push(edit); continue }
      const ownerKey = (ownerId: string) => `${JSON.stringify(edit.sourceScope ?? null)}\u0000${ownerId}`
      const earlier = fileOwners.get(ownerKey(edit.ownerId))
      if (earlier !== undefined) {
        const original = combined[earlier] as Extract<ComponentEdit, { type: 'component.files.set' }>
        // The candidate already checked the sequential bytes. Commit the final owner file set against its first observed bytes.
        combined[earlier] = { ...original, files: edit.files }
        if (edit.forkOwnerId) fileOwners.set(ownerKey(edit.forkOwnerId), earlier)
      } else {
        fileOwners.set(ownerKey(edit.ownerId), combined.length)
        if (edit.forkOwnerId) fileOwners.set(ownerKey(edit.forkOwnerId), combined.length)
        combined.push(edit)
      }
    }
    const command = captureComponentOperation(current.model.project, combined)
    command.expected = [...new Map([...command.expected, ...expected.values(), ...this.contentReadExpectations(runId, current)]
      .map(item => [JSON.stringify(item.path), item])).values()]
    model = await driver.apply(current.model, command)
    assertActive()
    let receipt: Awaited<ReturnType<typeof session.execute>>
    try {
      receipt = await session.execute({ documentId, epoch: current.epoch, baseRevision: current.revision, operationId, requestDigest,
        actor: run.grant.actor, runId, runLeaseId: this.operationLease(runId, operationId, documentId), mutation: { type: 'command', command } })
    } catch (error) {
      // A failed transport cannot disprove a commit, so leave the original operation for settlement.
      for (const index of usable) results[index] = { ...results[index]!, commit: 'unknown',
        usability: ['partial', 'unusable'].includes(results[index]!.usability) ? results[index]!.usability : 'unverified', insertedIds: [],
        diagnostics: [...results[index]!.diagnostics, { level: 'error', code: 'content-dispatch-failed',
          message: error instanceof Error ? error.message : String(error), repairable: true }] }
      return results
    }
    const committed = receipt.status === 'applied' || receipt.status === 'unchanged'
    if (receipt.status === 'applied') this.recordAppliedFootprints(runId, current, model, receipt.revision, [], [])
    for (const index of usable) results[index] = { ...results[index]!, receipt,
      commit: receipt.status === 'applied' ? 'committed' : receipt.status === 'unchanged' ? 'unchanged' : 'not_committed',
      usability: committed ? results[index]!.usability : 'unusable', insertedIds: committed ? results[index]!.insertedIds : [],
      diagnostics: 'code' in receipt ? [...results[index]!.diagnostics, { level: 'error', code: receipt.code, message: receipt.message, repairable: true }]
        : results[index]!.diagnostics }
    return results
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

  setInitialToolProfile(runId: string, profile: InitialToolProfile): void {
    const run = this.run(runId)
    if (run.initialToolProfile === profile) return
    run.initialToolProfile = profile
    this.catalogChanged(runId)
  }

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
      scopes.push(this.runScope(snapshot.model, run.authorizedTargets.get(doc.documentId) ?? []))
    }
    const standaloneImage = run.grant.actor === 'agent' && !!run.grant.fileAccess?.workspaceRoot
      && run.grant.fileAccess.permission !== 'read-only'
    const projectFiles = run.grant.fileAccess?.workspaceRoot && this.hostTools.projectFileServices()
      ? run.grant.fileAccess.permission === 'read-only' ? 'read' as const : 'write' as const : undefined
    const support = {
      ...this.hostTools.supportContext(), componentContent: !!this.options.componentContent,
      courseAuthoring: run.courseAuthoring, workbenchServices: !!run.grant.fileAccess,
      fileAccess: run.grant.fileAccess?.permission === 'read-only' ? 'read' as const : 'write' as const,
    }
    // Readiness and the current document shape select the initial disclosure only.
    // Explicit discovery and execution use the registered, connected catalog; the
    // target/service owners still enforce the frozen grants at actual dispatch.
    const allowed = toolCatalog.filter(tool => tool.supports(support)).map(tool => tool.name)
    const initial = new Set(visibleRunToolNames(selectRunToolNames(scopes, { standaloneImage, projectFiles }, support),
      new Set(), run.initialToolProfile))
    const names = visibleRunToolNames(allowed, run.loadedFamilies, run.initialToolProfile, run.loadedNames)
      .filter(name => initial.has(name) || run.loadedNames.has(name)
        || !!familyOfTool(name) && run.loadedFamilies.has(familyOfTool(name)!))
      .filter(name => name !== 'image.status' || !support.jobs || run.loadedNames.has(name))
    const batchMutationNames = mutationNamesIn(names)
    run.toolScopes = scopes
    const imageRoles = this.hostTools.describeImages(runId)
    const imageRoleDescription = imageRoles && (['generate', 'edit'] as const).map(operation => {
      const role = imageRoles[operation]
      return `${operation === 'generate' ? '生成' : '编辑'}：${role.status === 'configured' ? '已配置' : `不可用（${role.reason}）`}`
    }).join('；')
    run.advertised = {
      definitions: describeTools(names, { batchMutationNames }), names: new Set(names), allowed: new Set(allowed),
      availableFamilies: toolFamilies.map(family => ({ family, description: describeToolFamily(family, allowed, scopes)
        + (family === 'external' && this.hostTools.describeSearch(runId) ? ` 联网搜索配置：${this.hostTools.describeSearch(runId)!.detail}；这说明冻结配置，不是本次真实执行成功。` : '')
        + (family === 'media' && imageRoleDescription ? ` 本任务启动时冻结的图片角色：${imageRoleDescription}。已配置不代表供应商真实执行成功；image.status 仅查作业。` : ''),
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
    if (!run.advertised!.names.has(name)) await this.loadToolFamilies(runId, [], [name])
    return structuredClone(run.advertised!.definitions.find(tool => tool.name === name) ?? null)
  }

  async loadToolFamilies(runId: string, families: readonly ToolFamily[], names: readonly string[] = []): Promise<readonly { family: ToolFamily; description: string; count: number }[]> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const available = await this.availableToolFamilies(runId)
    let changed = false
    // Keep this run's disclosure request when its document has not been created yet.
    // describeRun still intersects it with the connected canonical catalog.
    for (const family of families) if (!run.loadedFamilies.has(family)) {
      run.loadedFamilies.add(family)
      if (available.some(item => item.family === family)) changed = true
    }
    for (const name of names) if (run.advertised!.allowed.has(name) && !run.loadedNames.has(name)) {
      run.loadedNames.add(name)
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
    let preparedRun: Run | undefined, hostAttempted = false
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
          if (target.kind === 'course-instance' && !target.authorField && !target.dataPath && snapshot.model.kind === 'course-v10') {
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
      hostAttempted = true
      await this.hostTools.beginRun(grant)
      const run: Run = { grant, toolScopes, authorizedTargets: new Map(grant.documents.map(doc => [doc.documentId, structuredClone(doc.writable)])), loadedFamilies: new Set(), loadedNames: new Set(), epochs, sources, rangeFootprints, componentSubtrees,
        currentDocumentId: grant.documents.length === 1 ? grant.documents[0]!.documentId : undefined,
        currentCourseDocumentId: courses.length === 1 ? courses[0] : writableCourses.length === 1 ? writableCourses[0] : undefined,
        documentLeases: new Map(grant.documents.map(doc => [doc.documentId, grant.runId])),
        stopped: false, history: new Map(), watches: new Map(), contentReads: new Map() }
      preparedRun = run
      if (grant.contentOutput) {
        const binding = grant.contentOutput
        const snapshot = await this.registry.get(binding.documentId).drain()
        this.authorizeDocument(run, snapshot)
        if (!this.canWrite(run, snapshot, binding.target)) throw new ToolError('not-authorized', '默认文字目标不属于本次已授权范围')
        readTarget(snapshot.model, binding.target)
        run.contentTarget = this.capturePrepared(run, snapshot, binding.target, true)
      }
      this.assertWriteTasksAllowed(grant, generations)
      this.runs.set(grant.runId, run)
      for (const doc of grant.documents) this.watchDocument(grant.runId, doc.documentId)
    } catch (error) {
      if (preparedRun) {
        for (const unwatch of preparedRun.watches.values()) unwatch()
        preparedRun.watches.clear()
        if (this.runs.get(input.runId) === preparedRun) this.runs.delete(input.runId)
      }
      for (const [id, handle] of this.handles) if (handle.runId === input.runId) this.handles.delete(id)
      if (hostAttempted) {
        try { await this.hostTools.stop(input.runId) }
        catch (cleanup) { throw new AggregateError([error, cleanup], '任务初始化失败，宿主清理也未完成', { cause: error }) }
      }
      throw error
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
    run.authorizedTargets.set(documentId, structuredClone(targets))
    run.historySuspended?.delete(documentId)
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
    this.runs.set(input.runId, { grant, toolScopes: [], authorizedTargets: new Map(), loadedFamilies: new Set(), loadedNames: new Set(), epochs: new Map(), sources: new Map(),
      rangeFootprints: new Map(), componentSubtrees: new Map(), documentLeases: new Map(), stopped: true, history: new Map(), watches: new Map(), contentReads: new Map() })
  }

  /** Host-only: never expose arbitrary addresses as model tool input. */
  async issueTarget(runId: string, documentId: string, target: ToolTarget, options?: { readOnly?: boolean; observed?: DocumentSnapshot }): Promise<string> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    // File/source tools already observed this content before attaching the document.
    // Preserve that basis: a later drain must not silently renew stale write intent.
    const snapshot = options?.observed ?? await this.registry.get(documentId).drain()
    if (snapshot.documentId !== documentId) throw new ToolError('invalid-target', '观察文档与目标不一致')
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

  /** Host-only current-draft view. Only an exact renderer ACK renews its original logical write scope. */
  async prepareQuestionDraft(runId: string, handleId: string, acknowledged?: { epoch: string; revision: number }): Promise<{
    documentId: string; epoch: string; revision: number; target: ToolTarget; handle: string; content: string
  }> {
    const run = this.run(runId), handle = this.handle(runId, handleId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    await this.options.prepareInput?.(handle.documentId)
    const session = this.registry.get(handle.documentId), snapshot = await session.drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.authorizeDocument(run, snapshot)
    if (handle.epoch !== snapshot.epoch || handle.lease !== run.documentLeases.get(handle.documentId))
      throw new ToolError('stale-epoch', '确认稿的原授权已失效')
    if (acknowledged && (acknowledged.epoch !== snapshot.epoch || acknowledged.revision !== snapshot.revision))
      throw new ToolError('target-conflict', '确认后作品又有修改，请核对当前稿')
    const currentTarget = (observed: Handle): ToolTarget => {
      const followSource = (value: ToolTarget): ToolTarget => {
        if (value.kind === 'text-selection') return { ...value, fragments: value.fragments.map(fragment => ({ ...fragment,
          target: followSource(fragment.target) as typeof fragment.target })) }
        if (!isSourceDocumentModel(snapshot.model) || observed.source === undefined) return value
        return value.kind === 'markdown-range' ? mapMarkdownRange(observed.source, snapshot.model.source, value, true)
          : value.kind === 'html-author-field' ? mapHtmlAuthorFieldTarget(observed.source, snapshot.model.source, value, true) : value
      }
      let target = followSource(structuredClone(observed.target))
      if (componentRange(target) && snapshot.revision !== observed.revision) {
        for (const change of session.committedChangesSince(observed.revision)) {
          if (!change.before || !change.after) throw new ToolError('target-conflict', '确认稿的文字范围无法定位，请重新选择')
          target = mapExternalCourseTextTarget(change.before, change.after, target, true)
        }
      }
      return target
    }
    const target = currentTarget(handle)
    const current = readTarget(snapshot.model, target)
    let refreshed = handleId
    if (acknowledged) {
      const writable = handle.writable && !handle.readOnly
      if (writable && !this.canWrite(run, snapshot, target)) {
        const document = run.grant.documents.find(document => document.documentId === snapshot.documentId)!
        // The user confirmed this existing captured range, never an arbitrary new address.
        document.writable = [...document.writable, structuredClone(target)]
        if (componentRange(target)) run.rangeFootprints.set(documentDigest({ documentId: snapshot.documentId, target }), targetFootprint(snapshot.model, target))
      }
      if (isSourceDocumentModel(snapshot.model)) run.sources.set(snapshot.documentId, snapshot.model.source)
      refreshed = this.capture(runId, snapshot, target, writable, handle.readOnly)
      const defaultHandle = run.contentTarget ? this.handles.get(run.contentTarget) : undefined
      if (run.contentTarget === handleId || defaultHandle && defaultHandle.documentId === handle.documentId
        && defaultHandle.epoch === handle.epoch && defaultHandle.lease === handle.lease
        && equalComponentValue(currentTarget(defaultHandle), target)) run.contentTarget = refreshed
      run.advertised = undefined
    }
    return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      target, handle: refreshed, content: typeof current === 'string' ? current : JSON.stringify(current) }
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
    const current = readSemanticTarget(snapshot.model, target)
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
        const input = call.input as { project?: string; path: string; intent?: string; content?: string; from?: string; edits?: { old: string; new: string }[]; operations?: unknown[] }
        if (input.operations) return undefined
        if (input.from || input.edits || input.intent && !['content', 'style'].includes(input.intent)) return undefined
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
          const properties = await this.resolvedObjectProperties(runId, snapshot.model, handle.documentId, mutation.input.properties)
          paths = Object.entries(properties).flatMap(([key, value]) => {
            if (key === 'data') return componentDataPropertyPaths(instance.data, value as import('../../shared/contracts/component-platform').JsonValue,
              componentDefinitionBuiltinKey(project.definitions[instance.definitionId])).map(path => [...root, 'data', ...path])
            if (key === 'appearance') return courseInstanceAppearanceEdits(snapshot.model, target, value as Record<string, import('../../shared/contracts/component-platform').JsonValue>)
              .flatMap(edit => edit.type === 'data.set' ? [[...root, 'data', ...edit.path]] : edit.type === 'style.set' ? [[...root, 'style', ...edit.path]] : [])
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
        } else if (mutation.name === 'text.replace' || mutation.name === 'text.format') {
          const snapshot = await this.registry.get(handle.documentId).drain()
          const fields = target.kind === 'text-selection' ? target.fragments.map(fragment => fragment.target) : [target]
          paths = fields.flatMap(field => {
            if (field.kind === 'course-instance') {
              if (field.authorField) {
                const author = field.authorField, region = author.sourceRegion, root = instanceRoot(field)
                if (region) return [[...root, region.kind === 'data' ? 'data' : 'implementationOverride', ...region.path ?? [], '@range', String(region.start), String(region.end)]]
                return [[...root, author.authorKey ? 'authoring' : author.fieldScope ?? 'data', ...(author.authorKey ? ['records', author.authorKey, 'overrides', author.kind === 'text' ? 'text' : 'src'] : author.dataPath ?? [])]]
              }
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
      else if (target.kind === 'course-instance' && target.authorField?.kind === 'image') {
        const { instance } = courseInstanceContext(snapshot.model, target), value = readTarget(snapshot.model, target)
        if (typeof value !== 'string') throw new ToolError('invalid-resource', '所选图片字段没有可读取的图片地址')
        assetId = instance.authoring?.resourceBindings?.[value] ?? value
      }
      else if (target.kind === 'course-instance' && !target.authorField && target.dataPath === undefined && target.from === undefined && target.to === undefined && target.fieldScope !== 'flowLayout') {
        const { project, instance } = courseInstanceContext(snapshot.model, target)
        const definition = project.definitions[instance.definitionId]
        if (componentDefinitionBuiltinKey(definition) !== 'guoling.image') throw new ToolError('invalid-resource', '参考对象不是专业图片')
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
  runIdsForDocument(documentId: string): string[] {
    return [...this.runs].filter(([, run]) => !run.stopped
      && run.grant.documents.some(document => document.documentId === documentId)).map(([id]) => id)
  }

  writableRunIdsForDocument(documentId: string): string[] {
    return [...this.runs].filter(([, run]) => !run.stopped
      && run.grant.documents.some(document => document.documentId === documentId && (run.authorizedTargets.get(documentId)?.length ?? 0) > 0)).map(([id]) => id)
  }

  async stop(runId: string): Promise<void> {
    const run = this.run(runId)
    run.stopped = true
    for (const unwatch of run.watches.values()) unwatch()
    run.watches.clear()
    for (const [id, resource] of this.images) if (resource.runId === runId) this.images.delete(id)
    for (const [id, capture] of this.imageApplications) if (capture.runId === runId) this.imageApplications.delete(id)
    for (const [id, cursor] of this.cursors) if (cursor.runId === runId) this.cursors.delete(id)
    this.componentProjectFiles.stopRun(runId)
    // Already queued canonical commits finish; later requests cannot cross the barrier.
    const liveIds = new Set(this.registry.listIdentities().map(document => document.documentId))
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
    this.writeTaskGenerations.set(documentId, (this.writeTaskGenerations.get(documentId) ?? 0) + 1)
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
    let catalogScope = documentDigest(this.runScope(current.model, run.authorizedTargets.get(documentId) ?? []))
    const refreshCatalog = (snapshot: DocumentSnapshot) => {
      const scope = documentDigest(this.runScope(snapshot.model, run.authorizedTargets.get(documentId) ?? []))
      if (scope !== catalogScope) { catalogScope = scope; this.catalogChanged(runId) }
    }
    const unwatch = session.subscribe(event => {
      if (event.type !== 'changed') return
      const next = event.snapshot
      run.history.set(documentId, { undoDepth: next.undoDepth, redoDepth: next.redoDepth })
      refreshCatalog(next)
    })
    const unwatchCommits = session.subscribeCommits(({ operation, result, before, after }) => {
      if (result.status !== 'applied') return
      if (operation.runId !== runId) {
        const historyChange = operation.mutation.type === 'undo' || operation.mutation.type === 'redo'
        if (!historyChange) run.historySuspended?.delete(documentId)
        const basis=run.contentReads.get(documentId)
        if(basis?.ranges)for(const entry of basis.ranges.values()) {
          if (entry.conflicted) {
            if (historyChange && entry.historyConflict) try {
              if (targetFootprint(after, entry.target) === entry.footprint) { entry.conflicted = false; delete entry.historyConflict }
            } catch { /* The historical target is still absent. */ }
            else if (!historyChange) delete entry.historyConflict
            continue
          }
          try {const mapped=mapExternalCourseTextTarget(before,after,entry.target);if(mapped.kind!=='course-instance' || targetFootprint(after,mapped)!==entry.footprint)throw new Error('读取范围已改变');entry.target=mapped}
          catch {entry.conflicted=true; entry.historyConflict=historyChange}
        }
        // Consume each canonical change separately; comparing r0 directly with r2 can
        // merge disjoint edits into an apparent overlap and abort the other card.
        for (const handle of this.handles.values()) {
          if (handle.runId !== runId || handle.documentId !== documentId || handle.epoch !== operation.epoch) continue
          if (handle.conflicted) {
            if (historyChange && handle.historyConflict) try {
              const target = sourceField(handle.target) && isSourceDocumentModel(after)
                ? mapSourceTarget(handle.source!, after.source, handle.target) : handle.target
              if (targetFootprint(after, target) === handle.expectedFootprint) {
                handle.target = target; handle.revision = result.revision; handle.conflicted = false
                delete handle.historyConflict
                if (isSourceDocumentModel(after) && sourceField(target)) handle.source = after.source
              }
            } catch { /* Undo has not restored the exact acknowledged target yet. */ }
            else if (!historyChange) delete handle.historyConflict
            continue
          }
          try {
            const target = sourceField(handle.target) && isSourceDocumentModel(after)
              ? mapSourceTarget(handle.source!, after.source, handle.target)
              : mapExternalCourseTextTarget(before, after, handle.target)
            if (targetFootprint(after, target) !== handle.expectedFootprint) throw new Error('目标已重叠修改')
            handle.target = target; handle.revision = result.revision
            if (isSourceDocumentModel(after) && sourceField(target)) handle.source = after.source
          } catch { handle.conflicted = true; handle.historyConflict = historyChange }
        }
        const document = run.grant.documents.find(document => document.documentId === documentId)
        if (document) {
          const suspended = run.historySuspended?.get(documentId) ?? [], newlySuspended: typeof suspended = []
          document.writable = document.writable.flatMap(target => {
            try {
              const mapped = isSourceDocumentModel(before) && isSourceDocumentModel(after) && sourceField(target)
                ? mapSourceTarget(before.source, after.source, target) : mapExternalCourseTextTarget(before, after, target)
              if (componentRange(target)) {
                const key = documentDigest({ documentId, target }), expected = run.rangeFootprints.get(key)
                if (expected && expected !== targetFootprint(after, mapped)) throw new Error('范围内容已改变')
                run.rangeFootprints.delete(key)
                if (expected) run.rangeFootprints.set(documentDigest({ documentId, target: mapped }), expected)
              }
              return [mapped]
            } catch {
              if (historyChange) try {
                newlySuspended.push({ target: structuredClone(target), footprint: targetFootprint(before, target),
                  ...(isSourceDocumentModel(before) && sourceField(target) ? { source: before.source } : {}) })
              } catch { /* No readable prior target means no restoration proof. */ }
              return []
            }
          })
          const retained = suspended.filter(entry => {
            if (!historyChange) return false
            try {
              const target = entry.source !== undefined && isSourceDocumentModel(after)
                ? mapSourceTarget(entry.source, after.source, entry.target) : entry.target
              if (targetFootprint(after, target) !== entry.footprint) return true
              document.writable = [...document.writable, target]
              if (componentRange(target)) run.rangeFootprints.set(documentDigest({ documentId, target }), entry.footprint)
              return false
            } catch { return true }
          })
          const remaining = [...retained, ...newlySuspended]
          if (remaining.length) (run.historySuspended ??= new Map()).set(documentId, remaining)
          else run.historySuspended?.delete(documentId)
        }
        if (isSourceDocumentModel(after)) run.sources.set(documentId, after.source)
        refreshCatalog(session.read())
      }
      if (operation.runId === runId && operation.mutation.type === 'command' && operation.mutation.command.type === 'component-platform.apply')
        this.componentProjectFiles.acknowledge(runId, documentId, operation.epoch, result.revision, operation.mutation.command)
    })
    run.watches.set(documentId, () => { unwatch(); unwatchCommits() })
  }
  private authorizeDocument(run: Run, snapshot: Pick<DocumentSnapshot, 'documentId' | 'epoch'>): void {
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
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，不再分配新的读取句柄')
    return this.capturePrepared(run, snapshot, target, writable, readOnly)
  }
  /** beginRun captures its validated target before publishing any callable authority. */
  private capturePrepared(run: Run, snapshot: DocumentSnapshot, target: ToolTarget, writable: boolean, readOnly?: boolean): string {
    const runId = run.grant.runId
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
    return { runId, lease: this.runs.get(runId)?.documentLeases.get(snapshot.documentId) ?? runId, documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      target: structuredClone(target), footprint, expectedFootprint: footprint, conflicted: false, writable, readOnly,
      ...(sourceField(target) && isSourceDocumentModel(snapshot.model) ? { source: snapshot.model.source } : {}) }
  }
  /** A declared reference field consumes already observed host identities, never a model-authored map. */
  private authoringReferences(runId: string, snapshot: DocumentSnapshot): Map<string, CourseAuthoringReference> {
    const references = new Map<string, CourseAuthoringReference>()
    for (const [id, handle] of this.handles) {
      if (handle.runId !== runId || handle.documentId !== snapshot.documentId || handle.epoch !== snapshot.epoch) {
        references.set(id, { kind: 'unavailable' })
        continue
      }
      try {
        const target = this.resolve(handle, snapshot, false)
        if (target.kind === 'course-instance') references.set(id, { kind: 'instance', instanceId: target.instanceId })
        else if (target.kind === 'course-surface') references.set(id, target.stateId
          ? { kind: 'presentation-state', surfaceId: target.surfaceId, stateId: target.stateId } : { kind: 'surface', surfaceId: target.surfaceId })
        else references.set(id, { kind: 'unavailable' })
      } catch { references.set(id, { kind: 'unavailable' }) }
    }
    return references
  }
  private captureMutationHandles(runId: string, mutations: BatchMutationCall[], input: unknown): Promise<Handle[]> {
    const digest = documentDigest(mutations)
    const cacheKey = input && typeof input === 'object' ? input : undefined
    const captured = cacheKey && this.mutationCaptures.get(cacheKey)
    if (captured && captured.runId === runId && captured.digest === digest) return captured.handles
    const references = new Map<string, CourseAuthoringReference>()
    const handles = Promise.all(mutations.map(async mutation => {
      if (mutation.name === 'object.layout') return this.handle(runId, mutation.input.targets[0])
      if (mutation.name === 'text.replace') {
        const target = mutation.input.target ?? this.run(runId).contentTarget
        if (!target) throw new ToolError('invalid-target', '当前任务没有默认文字目标；请使用已观察的可写目标')
        return this.handle(runId, target)
      }
      if ('target' in mutation.input) {
        try { return this.handle(runId, mutation.input.target) }
        catch (error) { if (mutation.name !== 'media.insert' && mutation.name !== 'object.insert') throw error }
      }
      const project = 'project' in mutation.input ? mutation.input.project : undefined
      const path = 'target' in mutation.input ? mutation.input.target : mutation.input.path
      const current = await this.componentProjectDocument(runId, project, 'read')
      let captured: ReturnType<ComponentProjectFileCoordinator['captureFile']>
      try { captured = this.componentProjectFiles.captureFile(runId, current, path, true, project) }
      catch (error) { throw new ToolError('invalid-target', error instanceof Error ? error.message : String(error)) }
      const { snapshot, file } = captured
      if (mutation.name !== 'media.insert' && mutation.name !== 'object.insert' && file.target?.kind !== 'instance') throw new ToolError('invalid-target', '属性修改需要已观察的对象文件路径')
      const fileContainer = file.target?.kind === 'container' && (file.target.container.kind === 'surface' || file.target.container.kind === 'instance')
      const programRoot = mutation.name === 'media.insert' && file.target?.kind === 'instance' && this.isProgramRoot(snapshot.model.project, file.target.instanceId)
      if ((mutation.name === 'media.insert' || mutation.name === 'object.insert') && !fileContainer && !programRoot)
        throw new ToolError('invalid-target', '插入内容需要已观察的容器或程序根文件路径')
      const target = this.componentAssetPlacement(snapshot, file).target
      const readOnly = project && this.handles.has(project) ? this.handle(runId, project).readOnly : false
      return this.capturedHandle(runId, snapshot, target, !readOnly && this.canWrite(this.run(runId), current, target), readOnly || undefined)
    })).then(async handles => {
      for (const [index, mutation] of mutations.entries()) {
        const click = mutation.name === 'object.insert' ? mutation.input.click
          : mutation.name === 'interaction.update' && mutation.input.change.kind === 'click' ? mutation.input.change : undefined
        if (click?.action !== 'location-go' || !click.value || this.handles.has(click.value)) continue
        const current = await this.registry.get(handles[index]!.documentId).drain()
        if (current.model.kind !== 'course-v10') throw new ToolError('invalid-target', '跳转需要课件页面')
        if (componentContainers(current.model.project).some(surface => surface.id === click.value)) continue
        const project = 'project' in mutation.input ? mutation.input.project : undefined
        const captured = this.componentProjectFiles.captureFile(runId, current as ComponentProjectSnapshot, click.value, true, project)
        const destination = captured.file.target
        if (destination?.kind !== 'container' || destination.container.kind !== 'surface')
          throw new ToolError('invalid-target', '跳转需要已观察的页面路径或句柄')
        references.set(click.value, { kind: 'surface', surfaceId: destination.container.surfaceId })
      }
      return handles
    })
    if (cacheKey) this.mutationCaptures.set(cacheKey, { runId, digest, handles, references })
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
  private async resolvedObjectProperties(runId: string, model: DocumentModel, documentId: string,
    properties: z.infer<typeof objectUpdatePropertiesInputSchema>): Promise<z.infer<typeof objectUpdatePropertiesInputSchema>> {
    const { appearanceFrom, ...supplied } = properties
    if (!appearanceFrom) return supplied
    const run = this.run(runId), source = this.handle(runId, appearanceFrom.target)
    const snapshot = await this.registry.get(source.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (source.lease !== run.documentLeases.get(source.documentId)) throw new ToolError('stale-epoch', '外观来源的读取授权已失效')
    const target = this.resolve(source, snapshot, false, true)
    if (target.kind !== 'course-instance' || target.authorField || target.dataPath || target.from !== undefined || target.to !== undefined)
      throw new ToolError('invalid-target', '外观来源需要已观察的整对象只读句柄，不会扩大文字范围')
    const copied = readCourseInstanceAppearance(source.documentId === documentId ? model : snapshot.model, target, appearanceFrom.fields)
    // Explicitly authored values take precedence; omitted fields never become writes.
    const appearance = { ...copied.appearance, ...supplied.appearance }, copiedStyle = { ...copied.style }
    if (Object.hasOwn(supplied.appearance ?? {}, 'shadows')) delete copiedStyle.textShadow
    const style = { ...copiedStyle, ...supplied.style }
    return { ...supplied, ...(Object.keys(appearance).length ? { appearance } : {}), ...(Object.keys(style).length ? { style } : {}) }
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
          : currentTarget.kind === 'course-instance' && currentTarget.authorField ? mapExternalCourseTextTarget(snapshot.model, model, currentTarget)
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
      if(basis?.ranges)for(const entry of basis.ranges.values()) {
        if(entry.conflicted)continue
        try {
          if(targetFootprint(snapshot.model,entry.target)!==entry.footprint)throw new Error('读取范围已改变')
          const mapped=acknowledgedTargets.get(documentDigest(entry.target)) ?? mapExternalCourseTextTarget(snapshot.model,model,entry.target,true)
          if(mapped.kind!=='course-instance')throw new Error('读取范围已改变')
          entry.target=mapped;entry.footprint=targetFootprint(model,mapped)
        } catch {entry.conflicted=true}
      }
      if(doc)for(const target of doc.writable) {
        if(target.kind!=='course-instance' || target.authorField || target.dataPath || target.from!==undefined)continue
        const key=documentDigest({documentId:snapshot.documentId,target}),existing=run.componentSubtrees.get(key)
        if(!existing)continue
        const expanded=new Set(existing)
        for(const id of Object.keys(model.project.instances))if(!snapshot.model.project.instances[id] && containsTarget(target,{...target,instanceId:id},model))expanded.add(id)
        run.componentSubtrees.set(key,expanded)
      }
      if (doc) doc.writable = doc.writable.flatMap(target => {
        if (!componentRange(target) && !(target.kind === 'course-instance' && target.dataPath)) return [target]
        const key = documentDigest({ documentId: snapshot.documentId, target }), expected = run.rangeFootprints.get(key)
        try {
          if (expected && targetFootprint(snapshot.model, target) !== expected) return []
          const next = acknowledgedTargets.get(documentDigest(target)) ?? (target.kind === 'course-instance' && target.authorField ? mapExternalCourseTextTarget(snapshot.model, model, target) : mapAcknowledgedComponentTarget(target, componentSplices, model))
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
    if (!run.stopped && !this.operationLeases.has(operationId)) this.operationLeases.set(operationId, { runId, leases: new Map(run.documentLeases), generations: new Map(this.writeTaskGenerations) })
  }
  /** Main-only admission, before asynchronous path preparation or approval. The identity is already normalized. */
  captureHostOperation(runId: string, operationId: string, input: ModelToolCall): void {
    if (!this.runs.has(runId)) return // Ordinary disk operations need no document run.
    this.captureOperationLeases(runId, operationId)
    const digest = documentDigest(input), previous = this.callDigests.get(operationId)
    if (previous && (previous.runId !== runId || previous.digest !== digest))
      throw new ToolError('operation-payload-mismatch', '同一调用编号不能提交不同内容')
    if (!this.run(runId).stopped) this.callDigests.set(operationId, { runId, digest, retain: true })
  }
  private operationLease(runId: string, operationId: string, documentId: string): string {
    const run = this.run(runId)
    const captured = this.operationLeases.get(operationId)
    if (captured && (captured.generations.get(documentId) ?? 0) !== (this.writeTaskGenerations.get(documentId) ?? 0))
      throw new ToolError('run-stopped', '此操作开始后文档授权已停止，请重新发起操作')
    const lease = captured?.leases.get(documentId)
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
        if (imported) return publicWriteToolResult(input.name, imported)
      }
      const found = this.findReceipt(runId, operationId, digest) ?? await this.hostTools.lookup(runId, operationId, digest, input.name)
      return found && publicWriteToolResult(input.name, found)
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
      return target ? { kind: 'content', documentId: currentDocumentId, target } : null
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

  /** Resolve a historical web location after admitting the original model call identity. */
  executeWebOpen(runId: string, callId: string, input: ModelToolCall, source: { url: string; version?: string }): Promise<ToolResult> {
    return this.executeCall(runId, callId, input, (operationId, requestDigest, call) =>
      this.invoke(runId, operationId, requestDigest, { ...call,
        input: { ...workbenchServiceSchemas['web.open'].parse(call.input), ...source } }, call))
  }

  /** File paths are authorized by Main; opened source uses this same admission, planner, CAS and Session writer. */
  commitOpenedSource(input: { runId: string; operationId: string; call: ModelToolCall; snapshot: DocumentSnapshot;
    target: Extract<ToolTarget, { kind: 'markdown-range' }>; content: string; approvedOutside: boolean;
    assertActive?: () => void }): Promise<ToolResult> {
    return this.executeIdentifiedCall(input.runId, input.operationId, input.call, async (operationId, requestDigest) => {
      const known = this.findReceipt(input.runId, operationId, requestDigest)
      if (known) return known
      input.assertActive?.()
      const run = this.run(input.runId)
      if (run.stopped || run.grant.fileAccess?.permission === 'read-only') throw new ToolError('not-authorized', '任务已停止或为只读')
      await this.attachRunDocument(input.runId, input.snapshot.documentId, !input.approvedOutside)
      const document = run.grant.documents.find(value => value.documentId === input.snapshot.documentId)!
      // A one-operation outside-file approval cannot expand an explicit range restriction.
      if (!this.canWrite(run, input.snapshot, input.target) && !(input.approvedOutside && !(run.authorizedTargets.get(document.documentId)?.length ?? 0)))
        throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
      this.operationLease(input.runId, operationId, input.snapshot.documentId)
      input.assertActive?.()
      const handle = this.capturedHandle(input.runId, input.snapshot, input.target, false)
      return this.applyCanonicalMutations(input.runId, operationId, requestDigest,
        [{ name: 'text.replace', input: { target: 'host-source-operation', content: input.content } }], input.call.input,
        { handle, assertActive: input.assertActive })
    })
  }

  /** Delivery addresses the current document, not the content version captured for an edit. */
  async currentDeliveryDocument(runId: string, target?: string): Promise<{ documentId: string; epoch: string; revision: number }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = target !== undefined ? this.handle(runId, target) : undefined
    if (handle && handle.target.kind !== 'document') throw new ToolError('invalid-target', '保存或导出需要整份文档句柄')
    if (handle?.readOnly) throw new ToolError('not-authorized', '只读引用没有保存或导出授权')
    const writable = run.grant.documents.filter(document => (run.authorizedTargets.get(document.documentId)?.length ?? 0) > 0)
    const documentId = handle?.documentId ?? run.currentDocumentId ?? (writable.length === 1 ? writable[0]!.documentId : undefined)
    if (!documentId) throw new ToolError('target-required', '本次任务有多个文档，请明确要保存或导出的文档目标')
    const hasDeliveryGrant = () => run.grant.fileAccess?.permission !== 'read-only'
      && run.grant.documents.some(document => document.documentId === documentId && (run.authorizedTargets.get(documentId)?.length ?? 0) > 0)
    if (!hasDeliveryGrant()) throw new ToolError('not-authorized', '当前任务没有此文档的保存或导出授权')
    if (handle && run.epochs.get(documentId) !== handle.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    await this.options.prepareInput?.(documentId)
    const snapshot = await this.registry.get(documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    this.authorizeDocument(run, snapshot)
    if (handle && handle.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    if (!hasDeliveryGrant()) throw new ToolError('not-authorized', '当前任务没有此文档的保存或导出授权')
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

  private parseAllowedBatch(run: Run, input: unknown): BatchMutationCall[] {
    const { operations } = batchInputSchema.parse(input)
    for (const operation of operations) if (!run.advertised?.allowed.has(operation.name))
      throw new ToolError('not-authorized', '批量操作包含本任务未获授权的修改')
    return operations
  }

  /** Pure authorization and dependency check before showing an approval card. Final planning and CAS still run after approval. */
  async preflightBatch(runId: string, input: unknown): Promise<ToolResult | null> {
    try {
      const run = this.run(runId)
      if (!run.advertised) await this.describeRun(runId)
      if (!run.advertised!.allowed.has('batch')) throw new ToolError('not-authorized', '当前任务没有批量修改权限')
      const mutations = this.parseAllowedBatch(run, input)
      const handles = [...await this.captureMutationHandles(runId, mutations, input), ...this.additionalMutationHandles(runId, mutations)]
      if (handles.some(handle => handle.documentId !== handles[0].documentId))
        throw new ToolError('cross-document-batch', '批量原子操作只能属于同一文档')
      const snapshot = await this.registry.get(handles[0].documentId).drain()
      for (const handle of handles) this.resolve(handle, snapshot, true)
      return null
    } catch (error) { return this.error(error, { name: 'batch', input }) }
  }

  /** Asset tools plan from the same observed paths as project.apply. */
  private isProgramRoot(project: ComponentProjectSnapshot['model']['project'], instanceId: string): boolean {
    const instance = project.instances[instanceId]
    return project.rootIds.includes(instanceId) && Boolean(instance && !instance.container
      && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.html-program')
  }

  private async prepareSettingsBackground(runId: string, input: z.output<typeof courseConfigureInputSchema>['settings']['background']) {
    const resources: ComponentEdit[] = []
    if (!input?.source) return { background: input, resources }
    const { source, ...background } = input
    const image = await this.hostTools.readMediaSource(runId, source)
    if (!image.mimeType.startsWith('image/')) throw new ToolError('invalid-content', '背景需要图片来源')
    const prepare = this.options.prepareMedia ?? this.options.prepareImage
    if (!prepare) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const admitted = await prepare(image, this.createId), provenance = image.source ?? this.images.get(source)?.source
    resources.push({ type: 'asset.add', asset: { ...admitted.meta, ...(provenance ? { source: provenance } : {}) }, bytes: Uint8Array.from(admitted.bytes) })
    return { background: { ...background, mode: background.mode ?? 'own' as const, assetId: admitted.meta.id }, resources }
  }

  /** Asset tools plan from the same observed paths as project.apply. */
  private componentContentTarget(snapshot: ComponentProjectSnapshot, request: ContentApplyRequest): ToolTarget | undefined {
    if (!('target' in request) || !request.target) return undefined
    const target = request.target, context = 'editingContext' in request ? request.editingContext : undefined
    const state = context ? { stateId: context.stateId } : {}
    const instanceTarget = (instanceId: string): ToolTarget => ({ kind: 'course-instance', instanceId,
      surfaceId: context?.surfaceId ?? courseInstanceScopeId(snapshot.model.project, instanceId)!, ...state })
    const required: ToolTarget = target.kind === 'instance' ? instanceTarget(target.instanceId)
      : target.container.kind === 'global' || target.container.kind === 'project' ? { kind: 'document' }
        : target.container.kind === 'surface' ? { kind: 'course-surface', surfaceId: target.container.surfaceId, ...state }
          : instanceTarget(target.container.instanceId)
    readTarget(snapshot.model, required)
    return required
  }

  private componentAssetPlacement(snapshot: ComponentProjectSnapshot, file: ComponentProjectFile): { container: ComponentContainer; index: number; target: ToolTarget } {
    const project = file.observedState ? resolveComponentPresentation(snapshot.model.project, file.observedState.surfaceId, file.observedState.stateId) : snapshot.model.project, target = file.target
    if (!target) throw new ToolError('invalid-target', '请选择工程中的页面或对象路径')
    if (target.kind === 'container') {
      const container = target.container
      const context: ToolTarget = container.kind === 'global' || container.kind === 'project' ? { kind: 'document' }
        : container.kind === 'surface' ? { kind: 'course-surface', surfaceId: container.surfaceId, ...(file.observedState ? { stateId: file.observedState.stateId } : {}) }
          : { kind: 'course-instance', surfaceId: file.observedState?.surfaceId ?? courseInstanceScopeId(project, container.instanceId)!,
            instanceId: container.instanceId, ...(file.observedState ? { stateId: file.observedState.stateId } : {}) }
      return { container: target.container, index: containerChildIds(project, target.container).length,
        target: context }
    }
    const instance = project.instances[target.instanceId], container = owningContainer(project, target.instanceId)
    if (!instance || !container) throw new ToolError('invalid-target', '捕获的对象已不存在')
    const surfaceId = file.observedState?.surfaceId ?? courseInstanceScopeId(project, instance.id)
    if (!surfaceId) throw new ToolError('invalid-target', '对象没有可用的所属容器或程序根')
    return { container, index: containerChildIds(project, container).indexOf(instance.id) + 1,
      target: { kind: 'course-instance', surfaceId, instanceId: instance.id, ...(file.observedState ? { stateId: file.observedState.stateId } : {}) } }
  }

  private async commitComponentAsset(runId: string, operationId: string, requestDigest: string, baseline: ComponentProjectSnapshot,
    command: ComponentOperationBatch, affected: string[], mergeObserved = false, requiredTarget: ToolTarget = { kind: 'document' }): Promise<ToolResult> {
    const run = this.run(runId), session = this.registry.get(baseline.documentId)
    const current = await session.drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    this.authorizeDocument(run, current)
    if (current.epoch !== baseline.epoch || current.model.kind !== 'course-v10' || !this.canWrite(run, current, requiredTarget))
      throw new ToolError('not-authorized', '原工程身份或写权限已变化')
    const driver = this.drivers.find(value => value.kind === 'course-v10')
    if (!driver) throw new Error('V10 Driver 未注册')
    const next = await driver.apply(current.model, command)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    const result = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
      baseRevision: mergeObserved ? current.revision : baseline.revision, actor: run.grant.actor, runId, runLeaseId: this.operationLease(runId, operationId, baseline.documentId), requestDigest, mutation: { type: 'command', command } })
    if (result.status === 'applied') this.recordAppliedFootprints(runId, current, next, result.revision, [], [])
    return { kind: 'document-operation', result, affected }
  }

  /** Downloads retain source metadata; a destination path identifies author content, never a caller-made asset identity. */
  private async fetchOpenImage(runId: string, operationId: string, requestDigest: string, input: { image: string; project?: string; path?: string }): Promise<ToolResult> {
    if (!input.path) {
      const fetched = await this.hostTools.openImageFile(runId, input.image)
      if (fetched.status !== 'ready') return { kind: 'read', data: fetched }
      const resource = await this.hostTools.registerFetchedImage(runId, fetched.file, fetched.source)
      return { kind: 'read', data: { status: 'ready', resource, htmlSource: `cw-result:${encodeURIComponent(resource)}`, mimeType: fetched.file.mimeType, width: fetched.width, height: fetched.height,
        byteLength: fetched.file.bytes.byteLength, source: fetched.source } }
    }
    const current = await this.componentProjectDocument(runId, input.project, 'write')
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
    const required = placement.target.kind === 'course-instance' && this.isProgramRoot(snapshot.model.project, placement.target.instanceId)
      ? placement.target : undefined
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, prepared.command, [input.path], false, required)
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
    const source = image.source ?? this.images.get(input.from)?.source
    if (!this.options.prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const intent = input.intent ?? 'content'
    const instance = file.target?.kind === 'instance' ? snapshot.model.project.instances[file.target.instanceId] : undefined
    const definition = instance && snapshot.model.project.definitions[instance.definitionId]
    const isImage = componentDefinitionBuiltinKey(definition) === 'guoling.image'
    if (intent === 'redo' && instance && componentDefinitionBuiltinKey(definition) === 'guoling.shape') {
      if (input.project && this.handles.has(input.project)) this.resolve(this.handle(runId, input.project), snapshot, true)
      return this.replaceShapeWithReadyImage(runId, operationId, requestDigest, snapshot, file, placement, image, source, input.path)
    }
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
    const required = placement.target.kind === 'course-instance' && this.isProgramRoot(snapshot.model.project, placement.target.instanceId)
      ? placement.target : undefined
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, command, [input.path], false, required)
  }

  /** Ready-image redo retains a plain carrier's geometry and declared interaction identity. */
  private async replaceShapeWithReadyImage(runId: string, operationId: string, requestDigest: string,
    snapshot: ComponentProjectSnapshot, file: ComponentProjectFile,
    placement: ReturnType<DocumentToolGateway['componentAssetPlacement']>, image: HostImageInput, source: AssetSource | undefined,
    path: string): Promise<ToolResult> {
    const project = snapshot.model.project
    if (file.target?.kind !== 'instance' || placement.target.kind !== 'course-instance') throw new ToolError('invalid-target', '图片重做需要整对象路径')
    const original = project.instances[file.target.instanceId], stateId = file.observedState?.stateId
    if (!original || original.childIds?.length || original.implementationOverride || original.attachments?.length)
      throw new ToolError('invalid-target', '图片重做仅支持没有子图或自定义实现的形状')
    if (stateId && !(placement.container.kind === 'surface' && placement.container.surfaceId === placement.target.surfaceId
      || placement.container.kind === 'instance' && placement.container.instanceId === placement.target.surfaceId))
      throw new ToolError('state-placement-unsupported', '状态内图片重做需要当前页面的直接形状对象')
    if (!stateId && componentContainers(project).some(surface => surface.presentation?.states.some(state => {
      const override = state.overrides[original.id]
      return override && (override.data !== undefined || override.style !== undefined)
    }))) throw new ToolError('state-placement-unsupported', '形状有专用状态内容或样式，不能将基础实现改为图片')
    const effective = stateId ? resolveComponentPresentation(project, placement.target.surfaceId, stateId) : project
    const selected = effective.instances[original.id]
    if (stateId && !selected.frame) throw new ToolError('state-placement-unsupported', '状态图片重做需要有明确几何的形状')
    const prepared = await prepareComponentImageApplication({ snapshot, target: placement.target, image, mode: 'insert', source,
      container: placement.container, index: placement.index - 1, frame: selected.frame },
      { prepareImage: this.options.prepareImage!, createId: this.createId })
    const inserted = prepared.command.edits.find(edit => edit.type === 'instance.insert')
    if (!inserted || inserted.type !== 'instance.insert' || inserted.instances.length !== 1) throw new ToolError('invalid-operation', '图片准备没有产生单一对象')
    const replacement = { ...inserted.instances[0]!, ...(selected.name !== undefined ? { name: selected.name } : {}),
      ...(selected.style !== undefined ? { style: structuredClone(selected.style) } : {}),
      ...(selected.playbackInitialVisibility !== undefined ? { playbackInitialVisibility: selected.playbackInitialVisibility } : {}),
      ...(selected.visibility !== undefined ? { visibility: structuredClone(selected.visibility) } : {}),
      ...(selected.flowPlacement !== undefined ? { flowPlacement: structuredClone(selected.flowPlacement) } : {}),
      ...(selected.flowLayout !== undefined ? { flowLayout: structuredClone(selected.flowLayout) } : {}), visible: selected.visible !== false }
    const readPaths: string[][] = [['instances', original.id], ['@owner', original.id], ['definitions', original.definitionId]]
    if (!stateId) componentContainers(project).forEach(surface => readPaths.push(['@surface', surface.id, 'presentation']))
    const edits: ComponentEdit[] = prepared.command.edits.filter(edit => edit.type !== 'instance.insert' && edit.type !== 'surface.presentation.set')
    if (!stateId) {
      edits.push({ type: 'instance.definition.set', instanceId: original.id, definitionId: replacement.definitionId },
        { type: 'data.set', instanceId: original.id, path: [], value: replacement.data })
    } else {
      edits.push({ ...inserted, instances: [replacement] }, { type: 'instance.patch', instanceId: original.id, patch: { visible: false } })
      for (const behavior of Object.values(effective.instances)) {
        if (componentDefinitionBuiltinKey(effective.definitions[behavior.definitionId]) !== 'guoling.interactions') continue
        const rules = interactionRules(behavior)
        const value = remapComponentInteractionData(behavior.data, { instances: new Map([[original.id, replacement.id]]), surfaces: new Map(),
          rules: new Map(rules.map(rule => [rule.id, rule.id])), actions: new Map(rules.flatMap(rule => rule.actions.map(step => [step.id, step.id]))) })
        if (equalComponentValue(value, behavior.data)) continue
        if (!instanceWithinScope(effective, behavior.id, placement.target.surfaceId))
          throw new ToolError('state-placement-unsupported', '形状有跨页面或全局互动引用，不能仅替换一个展示状态')
        readPaths.push(['instances', behavior.id, 'data'], ['instances', behavior.id, 'definitionId'], ['@owner', behavior.id])
        edits.push({ type: 'data.set', instanceId: behavior.id, path: [], value })
      }
    }
    const command = captureComponentOperation(project, stateId ? presentationComponentEdits(project, placement.target.surfaceId, stateId, edits) : edits)
    command.expected = [...new Map([...command.expected, ...readPaths.map(dependency => ({ path: dependency, ...componentValueAt(project, dependency) })),
      ...this.contentReadExpectations(runId, snapshot)]
      .map(expected => [JSON.stringify(expected.path), expected])).values()]
    return this.commitComponentAsset(runId, operationId, requestDigest, snapshot, command, [path], true)
  }

  private async useLibraryComponent(runId: string, operationId: string, requestDigest: string,
    input: { packageId: string; version?: string; sourceId?: string; project?: string; path: string; rootIds?: string[] }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, 'write')
    const { snapshot, file } = this.componentProjectFiles.captureFile(runId, current, input.path, false, input.project)
    if (file.observedState) throw new ToolError('state-placement-unsupported', '组件库图结构插入属于基础内容；请明确选择基础页面或对象目标。')
    const placement = this.componentAssetPlacement(snapshot, file)
    const component = await this.hostTools.libraryComponent(runId, input.packageId, input.version, input.sourceId)
    if (component.status !== 'ready') return { kind: 'read', data: component }
    const planned = prepareComponentLibraryApplication(snapshot.model.project, component.entry, {
      container: placement.container, index: placement.index, rootIds: input.rootIds,
      ...(file.target?.kind === 'instance' ? { targetBindings: { navigation: file.target.instanceId } } : {}),
      createId: kind => `${kind}_${this.createId()}` })
    const result=await this.commitComponentAsset(runId, operationId, requestDigest, snapshot, planned.command, [input.path])
    return result.kind==='document-operation' && planned.diagnostics.length ? {...result,advisories:planned.diagnostics.map(value=>({step:1,code:'authoring-preserved' as const,message:value.message}))}:result
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
    scope?: 'objects' | 'page' | 'structure'; pages?: string[]; subject?: string[]; schoolStage?: string[]; tags?: string[] }): Promise<ToolResult> {
    const current = await this.componentProjectDocument(runId, input.project, 'read')
    const { project, resources } = current.model, scope = input.scope ?? 'objects'
    const roots = scope === 'objects' ? this.librarySelection(runId, current, input.path, input.project) : undefined
    const pagePaths = scope === 'page' ? input.path ? [input.path] : input.pages : input.pages
    if (scope === 'page' && pagePaths?.length !== 1) throw new ToolError('selection-required', '页面模板需要指定一个已观察页面路径')
    const surfaceIds = scope === 'objects' ? undefined : pagePaths?.map(path => {
      const { file } = this.componentProjectFiles.captureFile(runId, current, path, false, input.project)
      if (file.observedState || file.target?.kind !== 'container' || file.target.container.kind !== 'surface')
        throw new ToolError('invalid-target', '页面模板或结构需要基础页面路径')
      return file.target.container.surfaceId
    }) ?? componentSurfaces(project).map(surface => surface.id)
    const instance = roots?.length ? project.instances[roots[0]] : undefined
    const title = input.title || (scope === 'page' ? componentContainers(project).find(surface => surface.id === surfaceIds![0])!.title
      : scope === 'structure' ? '课程结构' : roots!.length > 1 ? '组合组件' : instance?.name || (instance && project.definitions[instance.definitionId]?.title) || '组件')
    const extracted = extractComponentLibraryApplication(project, resources, { rootIds: roots, surfaceIds,
      kind: scope === 'objects' ? 'objects' : scope, title })
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
    return this.executeIdentifiedCall(runId, this.operationIdentity(runId, callId), input, perform)
  }
  private async executeIdentifiedCall(runId: string, operationId: string, input: ModelToolCall,
    perform?: (operationId: string, requestDigest: string, call: ModelToolCall) => Promise<ToolResult>): Promise<ToolResult> {
    try {
      const call = structuredClone(input), digest = documentDigest(call), key = operationId
      this.captureOperationLeases(runId, operationId)
      const previousDigest = this.callDigests.get(key)?.digest
      if (previousDigest && previousDigest !== digest) return Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      if (!this.run(runId).stopped) this.callDigests.set(key, { runId, digest, retain: toolRegistration(input.name)?.effect !== null })
      const pending = this.pending.get(key)
      if (pending) return pending.digest === digest ? pending.result : Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      const result = (perform ? perform(operationId, digest, call) : this.invoke(runId, operationId, digest, call, input))
        .catch(error => this.error(error, call)).then(value => publicWriteToolResult(input.name, value))
      this.pending.set(key, { digest, result })
      void result.finally(() => {
        this.pending.delete(key)
        if (input.input && typeof input.input === 'object') this.mutationCaptures.delete(input.input)
      })
      return result
    } catch (error) { return Promise.resolve(this.error(error, input)) }
  }
  private error(error: unknown, call?: ModelToolCall): ToolResult {
    if (error instanceof z.ZodError) return compactToolInputError(error, call)
    // Renderer / VM rejections can carry a real Error from another realm.
    // Preserve its diagnostic fields without serializing the unknown payload.
    const foreign = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; actionReceipt?: unknown } : undefined
    const foreignMessage = typeof foreign?.message === 'string' && foreign.message.trim() ? foreign.message : undefined
    const message = error instanceof Error ? error.message
      : typeof error === 'string' && error.trim() ? error : foreignMessage ?? '工具操作失败'
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code
        : foreignMessage && typeof foreign?.code === 'string' ? foreign.code : 'invalid-operation'
    return { kind: 'error', code, message,
      ...(error instanceof ToolError && error.data !== undefined ? { data: error.data }
        : foreign?.actionReceipt ? { data: { actionReceipt: foreign.actionReceipt } } : {}) }
  }

  /** Host-only task facts; old task handles are never reused as current authorization. */
  taskTargetContext(runId: string, target?: { project?: string; path: string; region?: import('../../shared/contracts/component-platform').ComponentFrame }, resumeContext?: unknown) {
    return this.componentProjectFiles.taskTargetContext(runId, target, resumeContext)
  }
  private async rebaseTaskTargetContext(runId: string, context: unknown) {
    const frozen = z.object({ documentId: z.string().min(1), epoch: z.string().min(1),
      target: z.union([z.object({ kind: z.literal('instance'), instanceId: z.string().min(1) }),
        z.object({ kind: z.literal('container'), container: componentContainerSchema, index: z.number().int().nonnegative().optional() })]),
      editingContext: z.object({ surfaceId: z.string().min(1), stateId: z.string().nullable() }).optional(),
      fileKind: z.string().optional(), regionStatus: z.string().optional(), region: z.unknown().optional(),
    }).parse(context)
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(frozen.documentId).drain()
    this.authorizeDocument(run, snapshot)
    if (snapshot.epoch !== frozen.epoch) throw new ToolError('stale-epoch', '原子任务的工程会话已重开；旧目标不能续接当前工程。')
    if (snapshot.model.kind !== 'course-v10') throw new ToolError('unsupported-document', '原子任务的工程格式已变化')
    const state = frozen.editingContext?.stateId ? { surfaceId: frozen.editingContext.surfaceId, stateId: frozen.editingContext.stateId } : undefined
    const target = this.componentAssetPlacement(snapshot as ComponentProjectSnapshot,
      { path: '', kind: 'structure', target: frozen.target, ...(state ? { observedState: state } : {}) }).target
    const project = this.capture(runId, snapshot, target, this.canWrite(run, snapshot, target))
    const region = frozen.regionStatus === 'explicit' || frozen.regionStatus === undefined ? componentFrameSchema.safeParse(frozen.region) : undefined
    return { snapshot: snapshot as ComponentProjectSnapshot, project, target: frozen.target, fileKind: frozen.fileKind,
      ...(region?.success ? { region: region.data } : {}) }
  }

  private async componentProjectDocument(runId: string, selector: string | undefined, access: 'read' | 'write', allowGraph = false): Promise<ComponentProjectSnapshot> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const authorized = new Set(run.grant.documents.map(document => document.documentId))
    const courses = this.registry.listIdentities().filter(snapshot => authorized.has(snapshot.documentId) && snapshot.kind === 'course-v10')
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
      const identity = this.registry.get(opened.documentId).readIdentity()
      if (identity.kind === 'course-v10') found = [identity]
    }
    if (found.length !== 1) throw new ToolError(found.length ? 'project-ambiguous' : 'project-not-found', found.length ? '本任务有多个课件，请指定project文件名' : '本任务没有可用的Project V10工程')
    await this.options.prepareInput?.(found[0]!.documentId)
    const prepared = await this.registry.get(found[0]!.documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    if (prepared.model.kind !== 'course-v10') throw new ToolError('invalid-target', '课件文档已改变')
    const snapshot = prepared as ComponentProjectSnapshot
    this.authorizeDocument(run, snapshot)
    let writableSelection = false
    if (access === 'write' && selector && this.handles.has(selector)) {
      const target = this.resolve(this.handle(runId, selector), snapshot, true)
      writableSelection = target.kind === 'course-instance' || target.kind === 'course-surface'
        || allowGraph && target.kind === 'spatial-graph'
    }
    if (access === 'write' && !this.canWrite(run, snapshot, { kind: 'document' }) && !writableSelection)
      throw new ToolError('not-authorized', '本次任务没有整份作品或所选内容的写权限')
    return snapshot
  }

  private async projectDiscovery(runId: string): Promise<readonly ComponentDiscoveryEntry[]> {
    const run = this.run(runId), entries: ComponentDiscoveryEntry[] = []
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    // A document grant is the existing read boundary; writable selections do not narrow it.
    for (const document of run.grant.documents) {
      const snapshot = await this.registry.get(document.documentId).drain()
      if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
      this.authorizeDocument(run, snapshot)
      if (snapshot.model.kind !== 'course-v10') continue
      const project = snapshot.model.project
      const reference = snapshot.binding.kind === 'file' ? snapshot.binding.path : snapshot.binding.suggestedName
      entries.push(...createProjectDefinitionDiscoveryEntries(project, {
        definitionIds: Object.keys(project.definitions), instanceIds: Object.keys(project.instances),
      }).map(entry => ({ ...entry, project: reference })))
    }
    return entries
  }

  private componentProjectScope(runId: string, selector: string | undefined, snapshot: ComponentProjectSnapshot): ComponentProjectFileScope {
    if (!selector || !this.handles.has(selector)) return { kind: 'document' }
    const target = this.resolve(this.handle(runId, selector), snapshot, false)
    const state = (target.kind === 'course-instance' || target.kind === 'course-surface') && target.stateId
      ? { state: { surfaceId: target.surfaceId, stateId: target.stateId } } : {}
    if (target.kind === 'spatial-graph') return { kind: 'graph', surfaceId: target.surfaceId, graph: target.graph, graphId: target.graphId }
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
    const definition = toolCatalog.find(tool => tool.name === call.name)
    if (!definition) throw new ToolError('unsupported-tool', `未注册工具 ${call.name}；请使用工具目录中的名称`)
    if (!advertised.allowed.has(call.name)) throw new ToolError('service-unavailable', `工具 ${call.name} 的宿主服务未接通或当前文件授权不支持此服务`)
    if (call.name === 'batch') this.parseAllowedBatch(run, call.input)
    if (!advertised.names.has(call.name)) {
      run.loadedNames.add(call.name)
      this.catalogChanged(runId)
    }
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
    const viewAction = viewActionToolRegistration(call.name)
    if (viewAction) return viewAction.handler({ execute: async (name, input) => {
      if (run.currentHtmlDocumentId && run.currentObservationCarrier === 'html') {
        const snapshot = await this.registry.get(run.currentHtmlDocumentId).drain()
        this.authorizeDocument(run, snapshot)
        return this.hostTools.executeHtmlAction(runId, snapshot, { name: name === 'view.click' ? 'html.click' : 'html.input', input, operationId })
      }
      const identity = this.hostTools.viewActionIdentity(runId)
      if (!identity) throw new ToolError('observation-required', '请先观察当前课件页面，再操作返回的元素句柄')
      const snapshot = await this.registry.get(identity.documentId).drain()
      this.authorizeDocument(run, snapshot)
      if (snapshot.epoch !== identity.epoch || snapshot.revision !== identity.revision || snapshot.model.kind !== 'course-v10'
        || !snapshot.model.project.rootIds.includes(identity.locationId) && !snapshot.model.project.instances[identity.locationId]?.container)
        throw new ToolError('observation-stale', '课件版本或页面已变化，请重新观察后操作')
      return this.hostTools.executeViewAction(runId, operationId, name, input)
    } }, call.input)
    const htmlAction = htmlActionToolRegistration(call.name)
    if (htmlAction) return htmlAction.handler({ execute: async (name, input) => {
      const snapshots = await Promise.all(run.grant.documents.map(document => this.registry.get(document.documentId).drain()))
      const candidates = snapshots.filter(snapshot => isSourceDocumentModel(snapshot.model) && snapshot.binding.kind === 'file' && /\.html?$/i.test(snapshot.binding.path))
      const snapshot = candidates.find(value => value.documentId === run.currentHtmlDocumentId)
        ?? candidates.find(value => value.documentId === run.grant.contentOutput?.documentId) ?? (candidates.length === 1 ? candidates[0] : undefined)
      if (!snapshot) throw new ToolError('html-target-required', '请先通过 file.open 明确本任务要观察的 HTML 文件')
      this.authorizeDocument(run, snapshot)
      const result = await this.hostTools.executeHtmlAction(runId, snapshot, { name, input, operationId })
      if (result.kind === 'read' && name !== 'html.errors') {
        run.currentHtmlDocumentId = snapshot.documentId
        run.currentObservationCarrier = 'html'
      }
      return result
    } }, call.input)
    if (call.name === 'view.observe') {
      const input = viewObserveInputSchema.parse(call.input)
      let snapshot: DocumentSnapshot | undefined
      if ('target' in input) {
        const target = await this.resolveObservationTarget(runId, input.target)
        snapshot = await this.registry.get(target.documentId).drain()
      } else {
        const documents = await Promise.all(run.grant.documents.map(document => this.registry.get(document.documentId).drain()))
        const html = documents.filter(document => isSourceDocumentModel(document.model)
          && document.binding.kind === 'file' && /\.html?$/i.test(document.binding.path))
        if ('path' in input && !input.project) {
          const normalized = (path: string) => path.replace(/\\/g, '/').toLowerCase()
          snapshot = html.find(document => document.binding.kind === 'file' && normalized(document.binding.path) === normalized(input.path))
        } else if (!('path' in input)) snapshot = html.find(document => document.documentId === run.currentHtmlDocumentId)
          ?? (documents.length === 1 ? html[0] : undefined)
      }
      if (snapshot && isSourceDocumentModel(snapshot.model) && snapshot.binding.kind === 'file' && /\.html?$/i.test(snapshot.binding.path)) {
        this.authorizeDocument(run, snapshot)
        const { query, offset, limit, cursor, purpose, detail, clip } = input
        if (clip) throw new ToolError('unsupported-clip', 'HTML 观察当前不接受 clip；省略 clip 获取实际 viewport 画面')
        const result = await this.hostTools.executeHtmlAction(runId, snapshot, { name: 'html.observe', operationId,
          input: { query, offset, limit, cursor, purpose, detail: detail === 'high' ? 'full' : 'overview' } })
        if (result.kind === 'read') {
          run.currentHtmlDocumentId = snapshot.documentId
          run.currentObservationCarrier = 'html'
        }
        return result
      }
      if (!('target' in input) && !('path' in input))
        throw new ToolError('observation-target-required', '请提供页面 target/path，或先 file.open 明确要观察的 HTML 文件')
    }
    const office = officeToolRegistration(call.name)
    if (office) return office.handler({ runId, operationId, host: this.hostTools }, call.input)
    const material = materialToolRegistration(call.name)
    if (material) return material.handler({ runId, operationId, host: this.hostTools }, call.input)
    if (call.name === 'artifact.save') return hostArtifactSaveRegistration.handler({ runId, operationId, requestDigest, host: this.hostTools }, call.input)
    const projectTool = projectFileRegistration(call.name)
    if (projectTool) return projectTool.handler({ projectFiles: async (name, input) => {
      if (name === 'project.apply') {
        const parsed = componentProjectFileSchemas[name].parse(input)
        const current = await this.componentProjectDocument(runId, parsed.project, 'write', true)
        this.contentReadExpectations(runId, current)
        if ('from' in parsed && parsed.from && parsed.intent !== 'surface.add' && parsed.intent !== 'enhance' && parsed.intent !== 'program.set' && (this.images.has(parsed.from) || this.hostTools.isImageSource(parsed.from))) {
          const { file } = this.componentProjectFiles.captureFile(runId, current, parsed.path, false, parsed.project)
          // File-bound assets retain their identity through the existing file owner.
          // Only object/page targets use professional-image insertion or replacement.
          if (file.kind !== 'asset') return this.applyImageResourceFile(runId, operationId, requestDigest, { ...parsed, intent: parsed.intent })
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
    if (service) {
      const result = await service.handler({
      runId, operationId, host: this.hostTools,
      fetchImage: input => this.fetchOpenImage(runId, operationId, requestDigest, input),
      useAsset: input => this.useLibraryComponent(runId, operationId, requestDigest, input),
      saveAsset: input => this.saveLibraryComponent(runId, operationId, input),
      importAsset: input => this.hostTools.changeLibrary(runId, operationId, { kind: 'import', ...input }),
      deleteAsset: input => this.hostTools.changeLibrary(runId, operationId, { kind: 'delete', ...input }),
      updateAsset: input => this.updateLibraryComponent(runId, operationId, requestDigest, input),
      }, call.input)
      const job = (call.input as { job?: string } | null)?.job
      if ((call.name === 'job.status' || call.name === 'job.wait') && job && this.imageApplications.has(job)
        && result.kind === 'read' && result.data && typeof result.data === 'object') {
        const image = await this.invokeImageTool(runId, operationId + ':image-status', requestDigest,
          { name: 'image.status', input: { job } })
        if (image.kind === 'read' && image.data && typeof image.data === 'object') {
          const { generation, application, save } = image.data as Record<string, unknown>
          const data = result.data as Record<string, unknown>
          return { ...result, data: { ...data, snapshot: { ...(data.snapshot as object), generation, application, save } } }
        }
      }
      return result
    }
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
      observe: async input => {
        const result = await this.hostTools.observePage({ runId, operationId,
      resolveFileTarget: async (selector, path) => {
        const snapshot = await this.componentProjectDocument(runId, selector, 'read')
        const project = snapshot.model.project
        let locationId = componentProjectSurfaceId(project, path)
        if (!locationId) {
          const target = componentProjectFiles(project, snapshot.model.resources).find(file => file.path === path)?.target
          if (!target) return null
          locationId = target.kind === 'instance' ? courseInstanceScopeId(project, target.instanceId)
            : target.container.kind === 'surface' ? target.container.surfaceId
              : target.container.kind === 'instance' ? courseInstanceScopeId(project, target.container.instanceId)
                : project.entry?.rootInstanceId ?? project.rootIds[0]
        }
        if (!locationId) return null
        let stateId:string|null=null
        if(selector && this.handles.has(selector)){const target=this.resolve(this.handle(runId,selector),snapshot,false);if((target.kind==='course-surface' || target.kind==='course-instance') && target.surfaceId===locationId)stateId=target.stateId ?? null}
        return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
          projectId: project.id, locationId, stateId }
      },
      resolveTarget: async handle => {
        const observed = await this.resolveObservationTarget(runId, handle)
        const snapshot = await this.registry.get(observed.documentId).drain()
        if (snapshot.revision !== observed.revision) return null
        if (snapshot.model.kind === 'course-v10') {
          const project = snapshot.model.project, target = observed.target
          const locationId = target.kind === 'document' ? project.entry?.rootInstanceId ?? project.rootIds[0]
            : target.kind === 'course-surface' || target.kind === 'course-instance' ? target.surfaceId : undefined
          const surface = componentContainers(project).find(value => value.id === locationId)
          if (!locationId || !project.instances[locationId]) return null
          const stateId = target.kind === 'course-instance' || target.kind==='course-surface' ? target.stateId ?? null : null
          if (stateId && !surface?.presentation?.states.some(state => state.id === stateId)) return null
          return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
            projectId: project.id, locationId, stateId }
        }
        return null
        } }, input)
        if (result.kind === 'read') run.currentObservationCarrier = 'course'
        return result
      },
      deliverDocument: (name, input) => this.hostTools.deliverDocument({ runId, operationId, requestDigest,
        resolveHandle: handle => this.currentDeliveryDocument(runId, handle) }, name, input),
      batch: mutations => this.dispatchCanonicalMutations(runId, operationId, requestDigest, mutations, originalCall.input),
    }, call.input)
    if (isHostToolName(call.name)) return this.invokeImageTool(runId, operationId, requestDigest, call)
    return this.dispatchCanonicalMutations(runId, operationId, requestDigest, [mutationCallSchema.parse(call)], originalCall.input)
  }

  /** Compose one existing image job with one existing canonical application. */
  private async invokeImageTool(runId: string, operationId: string, requestDigest: string, call: ModelToolCall): Promise<ToolResult> {
    const parsed = hostToolRegistration(call.name)!.inputSchema.parse(call.input) as z.output<typeof imageInput> & { job?: string }
    const jobId = call.name === 'image.status' ? parsed.job! : `image-${operationId}`
    if (parsed.application && !this.imageApplications.has(jobId)) {
      const original = this.handle(runId, parsed.application.target)
      const snapshot = await this.registry.get(original.documentId).drain()
      const target = this.resolve(original, snapshot, true)
      if (snapshot.model.kind !== 'course-v10' || target.kind !== 'course-surface' && target.kind !== 'course-instance'
        || target.kind === 'course-instance' && (target.authorField || target.dataPath || target.from !== undefined || target.to !== undefined || target.fieldScope))
        throw new ToolError('invalid-target', '图片自动应用需要已观察的页面或完整图片对象')
      if (parsed.application.mode === 'replace' && (target.kind !== 'course-instance'
        || componentDefinitionBuiltinKey(snapshot.model.project.definitions[snapshot.model.project.instances[target.instanceId]?.definitionId]) !== 'guoling.image'))
        throw new ToolError('invalid-target', '图片替换需要专业图片对象')
      if (parsed.application.mode === 'insert' && target.kind === 'course-instance' && !this.isProgramRoot(snapshot.model.project, target.instanceId)) {
        const owner = owningContainer(snapshot.model.project, target.instanceId)
        const parentTarget: ToolTarget = owner?.kind === 'surface' ? { kind: 'course-surface', surfaceId: owner.surfaceId }
          : owner?.kind === 'instance' ? { kind: 'course-instance', surfaceId: target.surfaceId, instanceId: owner.instanceId } : { kind: 'document' }
        if (!owner || !this.canWrite(this.run(runId), snapshot, parentTarget)) throw new ToolError('not-authorized', '在对象旁插入图片需要所属容器的写权限')
      }
      this.imageApplications.set(jobId, { runId, operationId: `${operationId}:image-application`, requestDigest,
        snapshot: structuredClone(snapshot) as ComponentProjectSnapshot, target: structuredClone(target), mode: parsed.application.mode,
        handle: this.capturedHandle(runId, snapshot, target, true) })
    }
    const storedCapture = this.imageApplications.get(jobId)
    // Another run may read the immutable job, but cannot complete an application
    // captured by its original run or overwrite that run's pending result.
    const capture = storedCapture?.runId === runId || storedCapture?.result ? storedCapture : undefined
    const generated = await this.hostTools.invoke(runId, operationId, requestDigest, call.name as Parameters<HostToolCoordinator['invoke']>[3], call.input)
    if (!capture || generated.kind !== 'read' || !generated.data || typeof generated.data !== 'object') return generated
    const data = generated.data as Record<string, unknown>
    const generation = { status: data.status, job: jobId, stopped: data.stopped }
    if (data.status !== 'ready' || data.stopped === true || this.run(runId).stopped) return { ...generated, data: { ...data, generation,
      application: { status: data.stopped || this.run(runId).stopped ? 'not_applied' : 'pending', reason: data.stopped ? '任务已停止，图片候选保留' : '尚未得到可应用图片' }, save: { status: 'not_requested' } } }
    if (!capture.result) {
      try {
        const replay = this.findReceipt(runId, capture.operationId, capture.requestDigest)
        if (replay) capture.result = replay
        else {
          const current = await this.registry.get(capture.snapshot.documentId).drain()
          this.resolve(capture.handle, current, true)
          const resource = (data.resources as { resource?: string }[] | undefined)?.[0]?.resource
          if (!resource) throw new ToolError('invalid-resource', '图片生成未返回可用资源，候选回执已保留')
          const image = await this.readImageResource(runId, capture.snapshot.documentId, resource)
          if (!this.options.prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
          const prepared = await prepareComponentImageApplication({ snapshot: capture.snapshot, target: capture.target, image,
            mode: capture.mode, source: image.source }, { prepareImage: this.options.prepareImage, createId: this.createId })
          // Check the entire captured object, including manual frame/style changes,
          // and leave unrelated document edits free to merge through Session CAS.
          const paths = capture.target.kind === 'course-instance' ? [['instances', capture.target.instanceId], ['@owner', capture.target.instanceId]]
            : [['@surface', capture.target.surfaceId]]
          prepared.command.expected = [...prepared.command.expected, ...paths.map(path => ({ path, ...componentValueAt(capture.snapshot.model.project, path) }))]
          const latest = await this.registry.get(capture.snapshot.documentId).drain()
          this.resolve(capture.handle, latest, true)
          const owner = capture.mode === 'insert' && capture.target.kind === 'course-instance' && !this.isProgramRoot(capture.snapshot.model.project, capture.target.instanceId)
            ? owningContainer(capture.snapshot.model.project, capture.target.instanceId) : undefined
          const requiredTarget: ToolTarget = owner?.kind === 'surface' ? { kind: 'course-surface', surfaceId: owner.surfaceId }
            : owner?.kind === 'instance' ? { kind: 'course-instance', surfaceId: capture.target.surfaceId, instanceId: owner.instanceId }
              : owner?.kind === 'global' || owner?.kind === 'project' ? { kind: 'document' } : capture.target
          capture.result = await this.commitComponentAsset(runId, capture.operationId, capture.requestDigest, capture.snapshot,
            prepared.command, [prepared.instanceId], true, requiredTarget)
        }
      } catch (error) { capture.result = this.error(error) }
    }
    const result = capture.result
    return { ...generated, data: { ...data, generation, application: result.kind === 'document-operation'
      ? { status: result.result.status, receipt: result.result, affected: result.affected }
      : { status: 'not_applied', ...(result.kind === 'error' ? { code: result.code, reason: result.message } : { result }) }, save: { status: 'not_requested' } } }
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
    mutations: BatchMutationCall[], captureInput: unknown, sourceOperation?: { handle: Handle; assertActive?: () => void }): Promise<ToolResult> {
    const run = this.run(runId)
    const observedHandles = sourceOperation ? [sourceOperation.handle] : await this.captureMutationHandles(runId, mutations, captureInput)
    if (observedHandles.some(handle => handle.documentId !== observedHandles[0].documentId)) throw new ToolError('cross-document-batch', '批量原子操作只能属于同一文档')
    const session = this.registry.get(observedHandles[0].documentId)
    const snapshot = await session.drain()
    const readExpectations = this.contentReadExpectations(runId, snapshot)
    const references = mutations.some(mutation => ['interaction.update', 'course.logic', 'object.author', 'object.place'].includes(mutation.name)
      || mutation.name === 'object.insert' && mutation.input.click)
      ? this.authoringReferences(runId, snapshot) : undefined
    const capturedReferences = captureInput && typeof captureInput === 'object' ? this.mutationCaptures.get(captureInput)?.references : undefined
    for (const [value, reference] of capturedReferences ?? []) references?.set(value, reference)
    const observedTargets = observedHandles.map(handle => this.resolve(handle, snapshot, !sourceOperation, true))
    const handles: Handle[] = [], targets: ToolTarget[] = [], expanded: BatchMutationCall[] = []
    const groups: { start: number; count: number; target: ToolTarget; handle: Handle; sourceIndexes: number[] }[] = []
    for (const [index, mutation] of mutations.entries()) {
      const target = observedTargets[index], handle = observedHandles[index], start = targets.length
      if (target.kind !== 'text-selection' || snapshot.model.kind === 'markdown' && target.fragments.every(fragment => fragment.target.kind === 'markdown-range')) {
        handles.push(handle); targets.push(target); expanded.push(mutation)
      }
      else {
        if (mutation.name === 'text.format') {
          for (const fragment of target.fragments) {
            handles.push(this.capturedHandle(runId, snapshot, fragment.target, handle.writable)); targets.push(fragment.target)
            expanded.push(mutation)
          }
          groups.push({ start, count: targets.length - start, target, handle, sourceIndexes: [] })
          continue
        }
        if (mutation.name !== 'text.replace') throw new ToolError('invalid-target', '连续文字选区支持正文替换或文字格式')
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
    const planningBatch = driver.beginPlanningBatch?.(model)
    const pastePlanning = createCourseObjectPastePlanningBatch()
    const applyPlanned = async (command: DocumentCommand) => {
      const next = planningBatch ? await planningBatch.apply(command) : await driver.apply(model, command)
      if (command.type === 'component-platform.apply') pastePlanning.applied(command.edits)
      return next
    }
    // Intermediate commands validate the working model; relationships settle on the final batch.
    const captureWorkingOperation: typeof captureComponentOperation = (project, edits, readPaths) =>
      captureComponentOperation(project, edits, readPaths, { deferTextRelationships: true })
    const mapWorkingPresentation: typeof presentationComponentEdits = (project, surfaceId, stateId, edits) =>
      presentationComponentEdits(project, surfaceId, stateId, edits, { deferTextRelationships: true })
    const finalTargets: ToolTarget[] = []
    const sourceSplices: SourceSplice[] = []
    const componentEdits: ComponentEdit[] = []
    const componentReadPaths = new Map<string, string[]>()
    const componentSplices: ComponentTextSplice[] = []
    const advisories: ToolAdvisory[] = []
    for (let i = 0; i < mutations.length; i += 1) {
      const mutation = mutations[i]
      let target = targets[i]
      if (target.kind === 'course-instance' && target.authorField && mutation.name !== 'text.replace')
        throw new ToolError('invalid-target', '内部作者字段只授权该字段内容；整对象修改请重新选择整个对象')
      if (sourceField(target) && isSourceDocumentModel(model) && isSourceDocumentModel(snapshot.model)) target = mapAcknowledgedSourceTarget(target, sourceSplices, snapshot.model.source, model.source)
      if (model.kind === 'markdown' && mutation.name === 'text.format' && (target.kind === 'markdown-range' || target.kind === 'text-selection')) {
        const ranges = target.kind === 'markdown-range' ? [target] : target.fragments.map(fragment => {
          if (fragment.target.kind !== 'markdown-range') throw new ToolError('invalid-target', 'Markdown 格式需要正文范围')
          return fragment.target
        })
        const beforeSource = model.source, formatted = formatMarkdownSource(beforeSource, ranges, mutation.input.style)
        model = await applyPlanned({ type: 'markdown.replace', source: formatted.source })
        sourceSplices.push(...formatted.splices)
        for (let j = 0; j < finalTargets.length; j++) if (sourceField(finalTargets[j]))
          finalTargets[j] = mapAcknowledgedSourceTarget(finalTargets[j], formatted.splices, beforeSource, formatted.source)
        finalTargets.push(formatted.selectedRanges.length === 1 ? { kind: 'markdown-range', ...formatted.selectedRanges[0] }
          : { kind: 'text-selection', fragments: formatted.selectedRanges.map(range => ({ target: { kind: 'markdown-range', ...range } })) })
        continue
      }
      if (model.kind === 'markdown' && target.kind === 'text-selection' && mutation.name === 'text.replace') {
        const beforeSource = model.source
        const prepared = planAggregateMarkdownTextEdit({ source: beforeSource,
          fragments: target.fragments.map(fragment => {
            if (fragment.target.kind !== 'markdown-range') throw new ToolError('invalid-target', '正文选区载体已改变')
            return { from: fragment.target.from, to: fragment.target.to, separatorBefore: fragment.separatorBefore }
          }), replacement: mutation.input.content })
        const splices = [...prepared.edits].reverse().map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length }))
        model = await applyPlanned({ type: 'markdown.replace', source: prepared.afterSource })
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
          if (selected.some(value => value.kind !== 'course-instance' || value.authorField || value.dataPath || value.from !== undefined || value.fieldScope
            || value.surfaceId !== surfaceId || (value.stateId ?? null) !== (stateId ?? null)))
            throw new ToolError('invalid-target', '对齐需要同页同展示状态的整对象')
          const project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
          const instanceIds = selected.map(value => (value as Extract<ToolTarget, { kind: 'course-instance' }>).instanceId)
          let nextTarget: ToolTarget = target
          let planned: ComponentEdit[]
          if (mutation.input.intent.kind === 'columns') {
            const owner = owningContainer(project, instanceIds[0])
            const ownerTarget: ToolTarget = owner?.kind === 'instance' ? { kind: 'course-instance', surfaceId, instanceId: owner.instanceId, stateId }
              : owner?.kind === 'surface' ? { kind: 'course-surface', surfaceId: owner.surfaceId, stateId } : { kind: 'document' }
            if (!owner || !this.canWrite(run, snapshot, ownerTarget)) throw new ToolError('not-authorized', '分栏需要所选正文容器的结构修改权限')
            const observed = new Map(mutation.input.targets.map((id, index) => [id, instanceIds[index]]))
            const columns = mutation.input.intent.columns?.map(column => column.map(id => {
              const instanceId = observed.get(id)
              if (!instanceId) throw new ToolError('invalid-target', '各列只能引用targets中已观察的对象句柄')
              return instanceId
            }))
            const prepared = prepareCourseFlowColumns(project, { surfaceId, instanceIds, columns,
              ratios: mutation.input.intent.ratios, gap: mutation.input.intent.gap }, this.createId)
            planned = prepared.edits
            nextTarget = { kind: 'course-instance', surfaceId, instanceId: prepared.groupId, stateId }
          } else planned = courseGeometryEdits(project, instanceIds, mutation.input.intent)
          const edits = mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, planned)
          const command = captureWorkingOperation(model.project, edits)
          model = await applyPlanned(command); componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(nextTarget)
          continue
        }
        if (mutation.name === 'object.insert' || mutation.name === 'teacher.ensure') {
          if (target.kind !== 'course-surface' && (target.kind !== 'course-instance' || target.authorField || target.dataPath || target.from !== undefined))
            throw new ToolError('invalid-target', '专业插入需要已观察页面或容器，当前目标不是插入容器。可对文档使用 listChildren 取得页面 target，再把返回的页面 target 用于 object.insert；未修改原文档。')
          if (mutation.name === 'teacher.ensure' && target.kind !== 'course-surface') throw new ToolError('invalid-target', '教师控制台需要已观察页面')
          let project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
          if (target.kind === 'course-instance' && !project.instances[target.instanceId]?.childIds) throw new ToolError('invalid-target', '所选对象不是容器')
          if (target.kind === 'course-instance' && componentIsLocked(project, target.instanceId)) throw new ToolError('locked-target', '容器已锁定，请先解锁')
          let container: ComponentContainer = target.kind === 'course-instance' ? { kind: 'instance', instanceId: target.instanceId } : { kind: 'surface', surfaceId: target.surfaceId }
          let index = mutation.name === 'object.insert' ? mutation.input.index : undefined
          if (mutation.name === 'object.insert' && mutation.input.after) {
            const position = this.handle(runId, mutation.input.after)
            if (position.documentId !== snapshot.documentId) throw new ToolError('cross-document-batch', '插入位置必须属于同一文档')
            const after = this.resolve(position, snapshot, false, true)
            if (after.kind !== 'course-instance' || after.authorField || after.dataPath || after.from !== undefined
              || after.surfaceId !== target.surfaceId || (after.stateId ?? null) !== (target.stateId ?? null))
              throw new ToolError('invalid-target', 'after需要同一展示状态中的整对象句柄')
            const children = containerChildIds(project, container), offset = children.indexOf(after.instanceId)
            if (offset < 0) throw new ToolError('invalid-target', 'after对象已不在目标插入容器中，请重新定位')
            index = offset + 1
          }
          if (mutation.name === 'object.insert' && mutation.input.at) {
            const insertionSurfaceId = target.surfaceId
            if (componentContainers(project).find(value => value.id === insertionSurfaceId)?.kind !== 'flow')
              throw new ToolError('invalid-target', 'at只用于Flow正文插入')
            const position = this.handle(runId, mutation.input.at)
            if (position.documentId !== snapshot.documentId) throw new ToolError('cross-document-batch', '插入光标必须属于同一文档')
            const observed = this.resolve(position, snapshot, false, true)
            const mapped = mapExternalCourseTextTarget(snapshot.model, model, observed)
            const selection = flowInsertionSelection(model, target.surfaceId, mapped, target.stateId)
            const split = prepareFlowBodyInsertion(project, target.surfaceId, selection, { deferTextRelationshipCleanup: true })
            const preparedOwner: ToolTarget = split.container.kind === 'instance'
              ? { kind: 'course-instance', surfaceId: target.surfaceId, instanceId: split.container.instanceId, stateId: target.stateId }
              : { kind: 'course-surface', surfaceId: target.surfaceId, stateId: target.stateId }
            if (!containsTarget(target, preparedOwner, model) || !this.canWrite(run, snapshot, preparedOwner))
              throw new ToolError('not-authorized', '正文插入位置不属于本次授权的目标容器')
            if (split.edits.length) {
              const splitEdits = mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, split.edits)
              const splitCommand = captureWorkingOperation(model.project, splitEdits)
              model = await applyPlanned(splitCommand); componentEdits.push(...splitCommand.edits)
              for (const expected of splitCommand.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
              if (model.kind !== 'course-v10') throw new Error('正文插入改变了文档格式')
              project = resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
            }
            container = split.container; index = split.index
          }
          const prepared = mutation.name === 'teacher.ensure' ? prepareCourseTeacherControllerEdits(project, target.surfaceId)
            : prepareCourseElementEdits(project, target.surfaceId, null, mutation.input.kind, { ...mutation.input, container, index })
          for (const edit of prepared.edits) if (edit.type === 'instance.insert') {
            const owner: ToolTarget = edit.container.kind === 'global' || edit.container.kind === 'project' ? { kind: 'document' } : edit.container.kind === 'surface'
              ? { kind: 'course-surface', surfaceId: edit.container.surfaceId, stateId: target.stateId }
              : { kind: 'course-instance', surfaceId: target.surfaceId, instanceId: edit.container.instanceId, stateId: target.stateId }
            if (!this.canWrite(run, snapshot, owner)) throw new ToolError('not-authorized', '插入容器不属于本次授权范围')
          }
          const edits = mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, prepared.edits)
          const command = captureWorkingOperation(model.project, edits)
          model = await applyPlanned(command); componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          const insertedTarget: Extract<ToolTarget, { kind: 'course-instance' }> = {
            kind: 'course-instance', surfaceId: target.surfaceId, instanceId: prepared.instanceIds[0]!, stateId: target.stateId,
          }
          if (mutation.name === 'object.insert' && mutation.input.appearance !== undefined) {
            // Reuse post-insert appearance semantics, including the captured presentation state.
            const insertedModel = model as Extract<DocumentModel, { kind: 'course-v10' }>
            const appearanceEdits = mapWorkingPresentation(insertedModel.project, target.surfaceId, target.stateId ?? null,
              courseInstanceAppearanceEdits(insertedModel, insertedTarget, mutation.input.appearance))
            if (appearanceEdits.length) {
              const appearanceCommand = captureWorkingOperation(insertedModel.project, appearanceEdits)
              model = await applyPlanned(appearanceCommand); componentEdits.push(...appearanceCommand.edits)
              for (const expected of appearanceCommand.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
            }
          }
          if (mutation.name === 'object.insert' && mutation.input.click) {
            const click = mutation.input.click
            const insertedModel = model as Extract<DocumentModel, { kind: 'course-v10' }>
            const project = resolveComponentPresentation(insertedModel.project, target.surfaceId, target.stateId ?? null)
            const clickEdits = mapWorkingPresentation(insertedModel.project, target.surfaceId, target.stateId ?? null,
              componentClickInteractionEdits({ project, surfaceId: target.surfaceId, activeStateId: target.stateId ?? null,
                instanceId: insertedTarget.instanceId }, click.action, click.value, references))
            const clickCommand = captureWorkingOperation(insertedModel.project, clickEdits)
            model = await applyPlanned(clickCommand); componentEdits.push(...clickCommand.edits)
            for (const expected of clickCommand.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          }
          finalTargets.push(insertedTarget)
          continue
        }
        if (mutation.name === 'surface.recipe' || mutation.name === 'surface.remix' || mutation.name === 'course.productivity') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '此操作需要已观察页面')
          if ((mutation.name !== 'course.productivity' || mutation.input.request.scope !== 'page') && !this.canWrite(run, snapshot, { kind: 'document' }))
            throw new ToolError('not-authorized', '此操作涉及整课或全局内容，需要整课授权')
          let edits: ComponentEdit[], nextTarget: ToolTarget = target, readPaths: string[][] = []
          if (mutation.name === 'surface.recipe') {
            const result = planCourseRecipeEdits(model.project, { ...mutation.input, surfaceId: target.surfaceId }, { createId: this.createId })
            if (!result.ok) throw new ToolError('invalid-content', result.reason)
            edits = result.edits; nextTarget = { kind: 'course-surface', surfaceId: result.createdLocationId }
          } else if (mutation.name === 'surface.remix') {
            const result = planCourseStyleRemixEdits(model.project, target.surfaceId, mutation.input.replacements, this.createId)
            edits = result.edits; readPaths = result.readPaths; nextTarget = { kind: 'course-surface', surfaceId: result.createdSurfaceId }
          } else {
            const project = mutation.input.request.scope==='course' ? model.project : resolveComponentPresentation(model.project, target.surfaceId, target.stateId ?? null)
            const result = planCourseProductivityEdits(project, target.surfaceId, mutation.input.request)
            edits = result.edits
            advisories.push(...result.unsupported.map(message => ({ step: i + 1, code: 'authoring-preserved' as const, message })))
            if(mutation.input.request.scope!=='course')edits = mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, edits)
          }
          const command = captureWorkingOperation(model.project, edits, readPaths)
          model = await applyPlanned(command); componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(nextTarget)
          continue
        }
        if (mutation.name === 'course.logic' || mutation.name === 'course.media' || mutation.name === 'interaction.update') {
          let edits: ComponentEdit[]
          if (mutation.name === 'interaction.update') {
            if (target.kind !== 'document' && target.kind !== 'course-surface' && target.kind !== 'course-instance') throw new ToolError('invalid-target', '互动需要页面、全局或整对象目标')
            if (target.kind === 'course-instance' && (target.authorField || target.dataPath || target.from !== undefined)) throw new ToolError('invalid-target', '互动需要整对象目标')
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
                else rules.splice(0, rules.length, ...removeComponentRule(rules, ruleId))
                edits = componentRuleEdits(project, owner, rules, references)
              }
            }
            edits = mapWorkingPresentation(model.project, surfaceId, stateId, edits)
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
          const command = captureWorkingOperation(model.project, edits)
          model = await applyPlanned(command); componentEdits.push(...command.edits)
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
          const command = captureWorkingOperation(model.project, edits)
          model = await applyPlanned(command)
          componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'surface.duplicate') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '复制页面需要已观察页面目标')
          if (!this.canWrite(run, snapshot, { kind: 'document' })) throw new ToolError('not-authorized', '复制页面需要整课授权')
          const copy = duplicateSurfaceEdits(model.project, target.surfaceId, this.createId), command = captureWorkingOperation(model.project, copy.edits, copy.readPaths)
          model = await applyPlanned(command); componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push({ kind: 'course-surface', surfaceId: copy.surfaceId })
          continue
        }
        if (mutation.name === 'presentation.update') {
          if (target.kind !== 'course-surface') throw new ToolError('invalid-target', '命名状态需要已授权演示页面目标')
          if (target.stateId !== undefined) throw new ToolError('invalid-target', '管理命名状态需要整页句柄；请从文档列出页面后操作')
          const edits = coursePresentationEdits(model.project, target, mutation.input, this.createId)
          const command = captureWorkingOperation(model.project, edits)
          model = await applyPlanned(command)
          componentEdits.push(...command.edits)
          for (const expected of command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (mutation.name === 'media.insert') {
          const instanceContainer = target.kind === 'course-instance' && !target.authorField && !target.dataPath
            && target.from === undefined && target.to === undefined && Boolean(model.project.instances[target.instanceId]?.container)
          const programRoot = target.kind === 'course-instance' && !target.authorField && !target.dataPath
            && target.from === undefined && target.to === undefined && this.isProgramRoot(model.project, target.instanceId)
          if (target.kind !== 'course-surface' && !instanceContainer && !programRoot) throw new ToolError('invalid-target', '插入媒体需要已授权容器或程序根目标')
          const prepareMedia = this.options.prepareMedia ?? this.options.prepareImage
          if (!prepareMedia) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置媒体读取能力')
          const reference = 'source' in mutation.input ? mutation.input.source : mutation.input.resource
          const media = await this.hostTools.readMediaSource(runId, reference)
          const source = media.source ?? this.images.get(reference)?.source
          const prepared = await prepareComponentMediaApplication({ snapshot: { ...snapshot, model }, target, media,
            mode: 'insert', fit: mutation.input.fit, frame: mutation.input.frame, source, deferTextRelationships: true,
            ...(instanceContainer && target.kind === 'course-instance' ? { container: { kind: 'instance' as const, instanceId: target.instanceId } } : {}) },
          { prepareMedia, createId: this.createId })
          model = await applyPlanned(prepared.command)
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
          const source = media.source ?? this.images.get(reference)?.source
          const prepared = await prepareComponentMediaApplication({ snapshot: { ...snapshot, model }, target, media,
            mode: 'replace', fit: mutation.input.fit, source, deferTextRelationships: true }, { prepareMedia, createId: this.createId })
          model = await applyPlanned(prepared.command)
          componentEdits.push(...prepared.command.edits)
          for (const expected of prepared.command.expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
          finalTargets.push(target)
          continue
        }
        if (target.authorField && mutation.name === 'text.replace') {
          if (mutation.input.format === 'html') throw new ToolError('invalid-content', '作者字段接受正文，不接受 HTML 标记')
          target = mapExternalCourseTextTarget(snapshot.model, model, target) as typeof target
          for (const path of courseAuthorFieldReadPaths(model, target)) componentReadPaths.set(JSON.stringify(path), path)
          const before = model, edits = replaceCourseAuthorField(model, target, mutation.input.content)
          const mapped = mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, edits)
          const command = captureWorkingOperation(model.project, mapped)
          model = await applyPlanned(command)
          componentEdits.push(...command.edits)
          // Earlier batch results still address their own fields after this
          // source edit shifts them. An ambiguous mapping aborts before commit.
          for (let previous = 0; previous < finalTargets.length; previous++)
            finalTargets[previous] = mapExternalCourseTextTarget(before, model, finalTargets[previous])
          const next = mapExternalCourseTextTarget(before, model, target, true)
          if (next.kind !== 'course-instance' || !next.authorField) throw new ToolError('invalid-target', '作者字段已失去精确地址')
          finalTargets.push({ ...next, authorField: { ...next.authorField, initialValue: readTarget(model, next) as string } })
          continue
        }
        if (mutation.name === 'text.replace' || mutation.name === 'text.format') target = mapAcknowledgedComponentTarget(target, componentSplices, model) as typeof target
        if (mutation.name === 'text.replace') target = courseInstanceTextTarget(model, target)
        const textBefore = mutation.name === 'text.replace' ? readCourseInstanceText(model, target) : null
        const splice = mutation.name === 'text.replace' && textBefore !== null && target.dataPath ? {
          surfaceId: target.surfaceId, instanceId: target.instanceId, stateId: target.stateId, fieldScope: target.fieldScope, dataPath: target.dataPath,
          from: target.from ?? 0, to: target.to ?? (typeof textBefore === 'string' ? Array.from(textBefore).length : documentTextLength(textBefore)),
          inserted: Array.from(mutation.input.content).length } : null
        const textFormat = mutation.name === 'text.replace'
          ? mutation.input.format ?? (readEditableTargetContent(model, target).format === 'html' ? 'html' : 'text') : undefined
        let edits: ComponentEdit[] | null
        let mapPresentation = true
        let readPaths: string[][] = []
        if (mutation.name === 'text.replace') {
          try {
            const edit = replaceCourseInstanceText(model, target, mutation.input.content, textFormat)
            const previousText = documentTextContentSchema.safeParse(textBefore)
            const nextText = edit.type === 'data.set' ? documentTextContentSchema.safeParse(edit.value) : null
            edits = edit.type === 'data.set' ? componentDataEdits(model.project, target,
              { kind: 'fields', fields: [{ path: edit.path, value: edit.value }],
                ...(previousText.success && nextText?.success ? { textEdits: [{ path: edit.path,
                  edits: documentReplacementEdits(previousText.data, nextText.data, target.from ?? 0,
                    target.to ?? documentTextLength(previousText.data)) }] } : {}) }) : [edit]
          }
          catch (error) { throw new ToolError('invalid-content', error instanceof Error ? error.message : String(error),
            { documentId: snapshot.documentId, revision: snapshot.revision, currentContent: readEditableTargetContent(model, target),
              rejectedContent: mutation.input.content, supportedRepresentation: 'component-html-source' }) }
        } else if (mutation.name === 'text.format') {
          const edit = formatCourseInstanceText(model, target, mutation.input.style)
          edits = edit.type === 'data.set' ? componentDataEdits(model.project, target,
            { kind: 'fields', fields: [{ path: edit.path, value: edit.value }] }) : [edit]
        } else if (mutation.name === 'object.author') {
          const { project } = courseInstanceContext(model, target), change = mutation.input.change
          if (componentIsLocked(project, target.instanceId)) throw new ToolError('locked-target', '对象已锁定，请先解锁')
          if (change.kind === 'text-interaction') {
            if (!target.dataPath || target.from === undefined || target.to === undefined || target.fieldScope === 'flowLayout')
              throw new ToolError('invalid-target', '正文范围互动需要已观察的正文选区或光标')
            edits = componentTextInteractionEdits(project, { surfaceId: target.surfaceId, instanceId: target.instanceId,
              dataPath: target.dataPath, from: target.from, to: target.to, stateId: target.stateId }, change.intent).edits
          } else {
            if (target.authorField || target.dataPath || target.from !== undefined) throw new ToolError('invalid-target', '此专业内容编辑需要整对象目标')
            edits = change.kind === 'table' ? componentTableDataEdits(project, target, change.edit)
            : change.kind === 'chart' ? componentChartDataEdits(project, target, change.edit.type === 'data' ? { ...change.edit, type: 'table-data' } : change.edit)
              : componentInputRuleEdits({ project, surfaceId: target.surfaceId, instanceId: target.instanceId }, change.request, references)
          }
        } else if (mutation.name === 'object.structure' || mutation.name === 'object.place') {
          if (target.authorField || target.dataPath || target.from !== undefined) throw new ToolError('invalid-target', '结构与载体修改需要整对象目标')
          const { project } = courseInstanceContext(model, target), instanceId = target.instanceId, surfaceId = target.surfaceId, stateId = target.stateId
          const requireContainer = (container: ComponentContainer, containerStateId: string | null | undefined = stateId) => {
            const required: ToolTarget = container.kind === 'global' || container.kind === 'project' ? { kind: 'document' }
              : container.kind === 'surface' ? { kind: 'course-surface', surfaceId: container.surfaceId, stateId: containerStateId }
                : { kind: 'course-instance', surfaceId: courseInstanceScopeId(project, container.instanceId) ?? surfaceId,
                    instanceId: container.instanceId, stateId: containerStateId }
            if (!this.canWrite(run, snapshot, required)) throw new ToolError('not-authorized', '目标容器不属于当前写入范围')
            return container
          }
          const resolveContainer = (id: string): ComponentContainer => {
            const destination = this.handle(runId, id)
            if (destination.documentId !== snapshot.documentId) throw new ToolError('cross-document-batch', '结构操作需要同一课件内的目标')
            const value = this.resolve(destination, snapshot, true)
            if ((value.kind === 'course-surface' || value.kind === 'course-instance')
              && ((value.stateId ?? null) !== (stateId ?? null) || (stateId || value.stateId) && value.surfaceId !== surfaceId))
              throw new ToolError('invalid-target', '展示状态结构操作需要同一页面与展示状态的目标容器')
            if (value.kind === 'course-surface') return requireContainer({ kind: 'surface', surfaceId: value.surfaceId }, value.stateId ?? null)
            if (value.kind === 'course-instance' && !value.authorField && !value.dataPath && value.from === undefined && value.to === undefined
              && (project.instances[value.instanceId]?.childIds || this.isProgramRoot(project, value.instanceId)))
              return requireContainer({ kind: 'instance', instanceId: value.instanceId }, value.stateId ?? null)
            throw new ToolError('invalid-target', '目标不是已观察的页面或容器')
          }
          const containerIdentity = (container: ComponentContainer): ComponentContainer => container.kind === 'surface'
            ? { kind: 'instance', instanceId: container.surfaceId } : container
          const topOwner = (container: ComponentContainer): ComponentContainer => {
            container = containerIdentity(container)
            if (container.kind !== 'instance') return container
            const parent = owningContainer(project, container.instanceId)!
            return project.instances[container.instanceId]?.container || parent.kind === 'project' ? container : topOwner(parent)
          }
          if (mutation.name === 'object.structure') {
            const input = mutation.input, owner = owningContainer(project, instanceId)
            if (!owner) throw new ToolError('invalid-target', '对象归属已不存在')
            if (input.action === 'remove') edits = courseObjectRemovalEdits(project, [instanceId])
            else if (input.action === 'reorder') {
              const scopeId = courseInstanceScopeId(project, instanceId)
              if (scopeId && componentContainers(project).find(surface => surface.id === scopeId)?.kind === 'flow')
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
              const reparent = !equalComponentValue(containerIdentity(owner), containerIdentity(container))
              mapPresentation = input.action === 'move' && !reparent || input.action === 'duplicate' && !!stateId
              // A state-scoped duplicate copies only the observed effective graph, never other author states.
              const copyProject = stateId ? { ...project, instances: Object.fromEntries(Object.entries(project.instances).map(([id, instance]) => {
                if (!instance.container?.presentation) return [id, instance]
                const { presentation: _presentation, ...container } = instance.container
                return [id, { ...instance, container }]
              })) } : model.project
              if (input.action === 'move') edits = courseObjectMoveEdits(reparent ? model.project : project, instanceId, container, index)
              else {
                const copy = pastePlanning.prepare({ documentId: snapshot.documentId, project: copyProject, resources: model.resources, roots: [instanceId] }, {
                  capturedTarget: { documentId: snapshot.documentId, project: stateId ? project : model.project, resources: model.resources, surfaceId: target.surfaceId },
                  container, index, identity: 'copy', keepOwner: !input.destination, offset: { x: 20, y: 20 } })
                edits = copy.edits; readPaths = [...copy.readPaths, ...(stateId ? [['@surface', target.surfaceId, 'presentation']] : [])]
              }
            }
          } else {
            const input = mutation.input.placement
            if (input.kind === 'global') {
              if (input.plane) requireContainer({ kind: 'global', plane: input.plane })
              edits = courseGlobalPlacementEdits(project, instanceId, input, references)
            } else {
              if (componentContainers(project).find(surface => surface.id === surfaceId)?.kind !== 'flow') throw new ToolError('invalid-target', '此排版操作需要讲义对象')
              let parentId: string | null | undefined
              if (input.kind === 'flow-body' && input.parent !== undefined) {
                const container = input.parent ? resolveContainer(input.parent) : requireContainer({ kind: 'surface', surfaceId: target.surfaceId })
                if (container.kind === 'global') throw new ToolError('invalid-target', '正文不能移入全局层')
                const parentOwner = topOwner(container)
                if (parentOwner.kind !== 'instance' || parentOwner.instanceId !== surfaceId) throw new ToolError('invalid-target', '正文容器需要位于当前讲义页面')
                parentId = container.kind === 'instance' && container.instanceId !== surfaceId ? container.instanceId : null
              }
              edits = input.kind === 'flow-overlay'
                ? flowPlacementEdits(project, instanceId, { kind: 'overlay', surfaceId: target.surfaceId, placement: input.placement, frame: input.frame, index: input.index }, references)
                : [...flowPlacementEdits(project, instanceId, { kind: 'document', surfaceId: target.surfaceId,
                  ...(parentId !== undefined ? { parentId } : {}), index: input.index }), ...(input.layout ? flowBodyLayoutEdits(project, instanceId, input.layout) : [])]
            }
          }
        } else if (mutation.name === 'object.update') {
          const properties = await this.resolvedObjectProperties(runId, model, snapshot.documentId, mutation.input.properties)
          edits = courseInstancePropertyEdits(model, target, properties)
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
              input = await this.readComponentSource(runId, implementation.from)
              source = await port.prepareSource(input, file, 'content')
              for (const diagnostic of input.diagnostics ?? []) advisories.push({ step: i + 1,
                code: 'html-import-warning', message: `${diagnostic.code}: ${diagnostic.message}${diagnostic.reference ? ` (${diagnostic.reference})` : ''}` })
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
        const mapped = mapPresentation ? mapWorkingPresentation(model.project, target.surfaceId, target.stateId ?? null, edits) : edits
        for (const expected of captureWorkingOperation(model.project, edits, readPaths).expected) componentReadPaths.set(JSON.stringify(expected.path), expected.path)
        const command = captureWorkingOperation(model.project, mapped, readPaths)
        model = await applyPlanned(command)
        componentEdits.push(...command.edits)
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
        model = await applyPlanned({ type: 'markdown.replace', source })
        sourceSplices.push(...splices)
        for (let j = 0; j < finalTargets.length; j++) {
          const previous = finalTargets[j]
          if (sourceField(previous)) finalTargets[j] = mapAcknowledgedSourceTarget(previous, splices, beforeSource, source)
        }
        finalTargets.push(recoverEditableTargetAfterReplacement(model, target, mutation.input.content) ?? target)
        continue
      }
      if (isSourceDocumentModel(model) && mutation.name === 'text.format' && target.kind === 'html-author-field')
        throw new ToolError('unsupported-operation', 'HTML 文字字段不提供会影响父元素的范围格式；本次未应用。请使用 HTML 元素样式编辑，或在独立原生文本框中设置范围格式。')
      if (!isSourceDocumentModel(model) || mutation.name !== 'text.replace' || target.kind !== 'markdown-range')
        throw new ToolError('unsupported-operation', '此文档工具不支持当前修改')
      model = await applyPlanned({ type: 'markdown.splice', from: target.from, to: target.to, text: mutation.input.content })
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
      model = await driver.apply(snapshot.model, command)
    } else if (isSourceDocumentModel(model)) command = { type: 'markdown.replace', source: model.source, resources: model.resources }
    else throw new ToolError('unsupported-document', '当前文档格式不受支持')
    const acknowledgedTargets = new Map<string, ToolTarget>()
    const aggregateMappings: NonNullable<import('../../shared/workbench/document').DocumentTextChanges['aggregateMappings']> = []
    for (const group of groups) if (group.target.kind === 'course-instance' && group.target.authorField)
      acknowledgedTargets.set(documentDigest(group.target), finalTargets[group.start])
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
    sourceOperation?.assertActive?.()
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
      if (model.kind === 'course-v10') for (const [step, mutation] of mutations.entries()) {
        const target = finalTargets[step]
        if (target?.kind !== 'course-instance' || !['object.insert', 'object.update', 'text.replace'].includes(mutation.name)) continue
        const data = mutation.name === 'object.update' ? mutation.input.properties.data : undefined
        const appearance = data && typeof data === 'object' && !Array.isArray(data) && 'appearance' in data ? data.appearance : undefined
        const suppliedBackgroundColor = !!appearance && typeof appearance === 'object' && !Array.isArray(appearance) && Object.hasOwn(appearance, 'backgroundColor')
        try { advisories.push(...courseTextAdvisories(model.project, target, step, suppliedBackgroundColor)) }
        catch { /* Later batch operations may remove an acknowledged target; preserve the durable ACK. */ }
      }
    }
    return { kind: 'document-operation', result, affected, ...(advisories.length ? { advisories } : {}) }
  }

  private readIdentity(runId: string, snapshot: DocumentSnapshot, target: ToolTarget) {
    return { runId, lease: this.runs.get(runId)?.documentLeases.get(snapshot.documentId) ?? runId, documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, target: documentDigest(target) }
  }

  /** Content observations bind only the semantic fields actually supplied, never sibling frames. */
  private recordContentRead(runId: string, snapshot: DocumentSnapshot, target: ToolTarget): void {
    if (target.kind === 'text-selection') { for (const fragment of target.fragments) this.recordContentRead(runId, snapshot, fragment.target); return }
    if (snapshot.model.kind !== 'course-v10') return
    if (target.kind === 'spatial-graph') {
      const run = this.run(runId)
      let basis = run.contentReads.get(snapshot.documentId)
      if (!basis || basis.epoch !== snapshot.epoch) {
        basis = { epoch: snapshot.epoch, expected: new Map() }; run.contentReads.set(snapshot.documentId, basis)
      }
      for (const path of spatialGraphDependencyPaths(snapshot.model.project, target))
        basis.expected.set(JSON.stringify(path), { path, ...structuredClone(componentValueAt(snapshot.model.project, path)) })
      return
    }
    if (target.kind !== 'course-instance') return
    if(isCourseInstanceRange(target) || target.authorField) {
      const run=this.run(runId);let basis=run.contentReads.get(snapshot.documentId)
      if(!basis || basis.epoch!==snapshot.epoch){basis={epoch:snapshot.epoch,expected:new Map()};run.contentReads.set(snapshot.documentId,basis)}
      basis.ranges ??= new Map();basis.ranges.set(documentDigest(target),{target:structuredClone(target),footprint:targetFootprint(snapshot.model,target)})
      return
    }
    const project = snapshot.model.project, instance = project.instances[target.instanceId]
    if (!instance) return
    const paths: string[][] = [['instances', instance.id, 'definitionId']]
    const fieldScope=target.fieldScope ?? 'data'
    let dataPath = ['instances', instance.id, fieldScope]
    if (target.stateId) {
      const surface = componentContainers(project).find(value => value.id === target.surfaceId)
      const index = surface?.presentation?.states.findIndex(value => value.id === target.stateId) ?? -1
      if (index < 0) return
      const statePath = ['@surface', target.surfaceId, 'presentation', 'states', String(index)]
      paths.push([...statePath, 'id'])
      const overridePath = [...statePath, 'overrides', instance.id, fieldScope]
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
    const rangeChanges:string[]=[]
    for(const [key,entry] of basis.ranges ?? []) {
      let matches=false;try {matches=!entry.conflicted && targetFootprint(snapshot.model,entry.target)===entry.footprint}catch{}
      if(matches)continue
      const path=['instances',entry.target.instanceId,entry.target.fieldScope ?? 'data',...(entry.target.dataPath ?? [])]
      changed.push({path,...structuredClone(componentValueAt(snapshot.model.project,path))});rangeChanges.push(key)
    }
    for (const expected of basis.expected.values()) {
      const current = componentValueAt(snapshot.model.project, expected.path)
      if (current.exists !== expected.exists || !equalComponentValue(current.value, expected.value))
        changed.push({ path: expected.path, ...structuredClone(current) })
    }
    if (changed.length) {
      basis.pending = changed
      basis.pendingRanges=rangeChanges
      throw new ToolError('read-basis-changed', '本次生成直接读取的内容已改变，旧结果未提交。请根据当前事实重新判断并继续本任务。',
        { documentId: snapshot.documentId, revision: snapshot.revision, current: changed })
    }
    return structuredClone([...basis.expected.values(), ...[...basis.ranges?.values() ?? []].flatMap(entry => entry.target.authorField
      ? courseAuthorFieldReadPaths(snapshot.model, entry.target).map(path => ({ path, ...componentValueAt(snapshot.model.kind === 'course-v10' ? snapshot.model.project : {} as never, path) })) : [])])
  }

  /** Main calls only when the changed-facts reply enters a new model request, never to replay a command. */
  acknowledgeContentFacts(runId: string, facts: readonly { documentId: string; current: readonly ComponentExpectation[] }[]): void {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    for (const fact of facts) {
      const basis = run.contentReads.get(fact.documentId)
      if (!basis?.pending || !equalComponentValue(basis.pending, fact.current)) continue
      for (const expected of basis.pending ?? []) basis.expected.set(JSON.stringify(expected.path), expected)
      for(const key of basis.pendingRanges ?? [])basis.ranges?.delete(key)
      delete basis.pendingRanges
      delete basis.pending
    }
  }

  private async read(runId: string, method: string, input: { target: string; state?: string | null; cursor?: string; limit?: number; detail?: 'semantic' | 'object' }): Promise<ToolResult> {
    let handle = this.handle(runId, input.target)
    await this.options.prepareInput?.(handle.documentId)
    const snapshot = await this.registry.get(handle.documentId).drain()
    let target = this.resolve(handle, snapshot, false)
    if (input.state !== undefined) {
      if (snapshot.model.kind !== 'course-v10' || target.kind !== 'course-surface' && target.kind !== 'course-instance')
        throw new ToolError('invalid-target', '展示状态需要页面或对象目标')
      const surfaceId = target.surfaceId
      const surface = componentContainers(snapshot.model.project).find(value => value.id === surfaceId)
      const exact = surface?.presentation?.states.find(value => value.id === input.state)
      const matches = exact ? [exact] : surface?.presentation?.states.filter(value => value.title === input.state) ?? []
      if (input.state !== null && matches.length !== 1) throw new ToolError('invalid-target', '展示状态不存在或同名，请从页面内容中选择')
      const original = this.handle(runId, this.refreshReadHandle(handle, snapshot, target))
      target = { ...target, stateId: input.state === null ? null : matches[0]!.id }
      handle = this.capturedHandle(runId, snapshot, target, original.writable && this.canWrite(this.run(runId), snapshot, target), original.readOnly)
    }
    const current = input.detail === 'object' ? readTarget(snapshot.model, target) : readSemanticTarget(snapshot.model, target)
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
        || cursor.revision !== identity.revision || cursor.target !== identity.target || cursor.method !== method || cursor.digest !== digest) throw new ToolError('stale-cursor', 'cursor 无效或内容已改变；省略 cursor 从首页读取，续读使用该回执的 nextCursor')
      offset = cursor.offset
    }
    const refreshed = this.refreshReadHandle(handle, snapshot, target)
    const refreshedHandle = this.handle(runId, refreshed)
    // Large page requests are served in chunks, not rejected after a paid model round.
    const limit = method === 'listChildren' ? Math.min(input.limit ?? 100, 1000) : Math.min((input.limit ?? 120) * 100, 64_000)
    const end = Math.min(offset + limit, content.length)
    let data: unknown
    if (typeof content === 'string') data = { target: refreshed, text: content.slice(offset, end), offset, total: content.length, truncated: end < content.length }
    else data = content.slice(offset, end).map(child => {
      const writable = !refreshedHandle.readOnly && (refreshedHandle.writable && containsTarget(target, child.target, snapshot.model)
        || this.canWrite(this.run(runId), snapshot, child.target))
      return { target: this.capture(runId, snapshot, child.target, writable, refreshedHandle.readOnly), label: child.label, kind: child.target.kind }
    })
    if (method === 'read' && !offset && snapshot.model.kind === 'course-v10'
      && (target.kind === 'document' || target.kind === 'course-surface' || target.kind === 'spatial-graph'
        || target.kind === 'course-instance' && !target.authorField && !target.dataPath && target.from === undefined)) {
      // File reads capture the current owner independently of a stale mutation
      // handle. Its existing grant and explicit read-only choice still apply.
      const project = this.capture(runId, snapshot, target, !handle.readOnly && this.canWrite(this.run(runId), snapshot, target), handle.readOnly)
      const scope = this.componentProjectScope(runId, project, snapshot as ComponentProjectSnapshot)
      const listing = this.componentProjectFiles.listScope(runId, snapshot as ComponentProjectSnapshot, scope)
      data = { ...data as Record<string, unknown>, authoring: { project, revision: listing.revision,
        files: target.kind === 'spatial-graph' ? listing.files.filter(file => file.type !== 'reference') : listing.files,
        ...(listing.nextOffset !== undefined ? { next: { tool: 'project.list', input: { project, offset: listing.nextOffset } } } : {}) } }
    }
    if(method==='read')this.recordContentRead(runId,snapshot,target)
    if (end < content.length) {
      const nextCursor = `c${this.createId()}`
      this.cursors.set(nextCursor, { ...this.readIdentity(runId, snapshot, target), method, digest, offset: end })
      return { kind: 'read', data, nextCursor }
    }
    return { kind: 'read', data }
  }
}
