import { planCreateCourseSound, planUpdateCourseSound, planDeleteCourseSound, planUpdateCourseAudioSettings } from './courseAudio'
import { planSpatialStructure, spatialReferenceHandles } from './spatialStructure'
import { renameCourseSurface, moveCourseSlideScene, addCourseSlidePage, addCourseFlowPage, addCourseSpatialPage, renameCourseLocation, deleteCourseLocation, deleteCourseSurface, duplicateCourseLocation, reorderCourseSurfaces } from './courseLocations'
import { mutateAddSlideScene, mutateReorderSlideScenes } from './slideStructure'
import { stateToolContext } from './presentationStateTools'
import { mutateAddSlidePresentationState, mutateRenameSlidePresentationState, mutateDuplicateSlidePresentationState, mutateDeleteSlidePresentationState, mutateReorderSlidePresentationStates } from './slideStructure'
import { planSelectionReplacement } from './selectionReplacement'
import { selectionReplacementTargets } from './selectionReplacementTargets'
import { planDuplicateSlideSceneLayers, planReorderSlideSceneLayers } from './slideLayerState'
import { patchEffectiveLayerPropertiesAtTarget } from './layerProperties'
import { nativeLayerTextAutoSizeFrame, type NativeTextMeasurePort } from './nativeTextLayout'
import { prepareNativeTextFrame, type AsyncNativeTextMeasurePort } from './prepareNativeTextFrame'
import type { EffectiveLayerPropertyPatch } from '../drivers/course/layerProperties'
import { layerToolContext, requireLayerOwner, sameLayerGroup } from './layerEditing'
import { deleteEffectiveLayerItem, duplicateEffectiveLayerItem, reorderEffectiveLayerItems } from './layerCommands'
import { planSlideMultiLayerFrames } from './layerLayout'
import { HostToolCoordinator, isHostToolName, type HostToolServices } from './HostToolServices'
import { planInputAnswer } from './inputInsertion'
import { composeSlideInteraction, updateComposedInteraction } from './interactionCompose'
import { planAddSlideInteractionRule, planUpdateSlideInteractionRule, planDeleteSlideInteractionRule, locateRule } from './slideInteractions'
import { slideSceneContext } from './slideInsertion'
import { nativeMediaReplacementData, replaceFlowMedia, assertImagePlacementFit } from './imageApplication'
import { planNativeInsertion } from './nativeInsertion'
import type { HostImageInput, PrepareImageResourcePort } from './imageResource'
import type { ImageAssetResource } from './imageAssetMetadata'
import { z } from 'zod'
import type { DocumentDriver, DocumentSnapshot, DocumentModel } from '../../shared/workbench/document'
import type { ModelToolCall, ToolAdvisory, ToolDefinition, ToolGateway, ToolResult, ToolRunGrant, ToolTarget } from '../../shared/workbench/tools'
import { DocumentRegistry } from '../documents/DocumentRegistry'
import { documentDigest } from '../documents/documentDigest'
import { batchInputSchemaFor, describeToolFamily, describeTools, familyOfTool, mutationCallSchema, mutationNamesIn, selectRunToolNames, toolCatalog, toolFamilies, visibleRunToolNames, type BatchMutationCall, type RunToolScope, type ToolFamily } from './ToolCatalog'
import { backgroundOwner, childTargets, containsTarget, mapMarkdownRange, readTarget, targetFootprint } from './ToolTargets'
import { updateBodySurfaceBackground, updateCourseBackground, updateSlideBackgroundOwner } from './courseBackground'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { planNativeTextEdit } from './nativeText'
import { flowBlocksAtParent, planFlowCommittedText, planInsertFlowBlock, planUpdateFlowBlock, planDeleteFlowBlocks, planMoveFlowBlock } from './flowContent'
import { flowSurfaceIn, resolveFlowBlock } from './flowDocumentModel'
import { editFlowTextRange } from './flowTextSlot'
import { documentTextLength, normalizeDocumentText } from '../../shared/document/content'
import { flowBlockSchema } from '../../shared/courseProjectSchema'
import { changeFlowTableStructure } from './flowTableContentOperations'
import { rotatedRectangleAabb } from '../../shared/geometry'

interface Run {
  grant: ToolRunGrant
  toolScopes: RunToolScope[]
  loadedFamilies: Set<ToolFamily>
  advertised?: { definitions: ToolDefinition[]; names: Set<string>; batchSchema?: z.ZodType;
    availableFamilies: { family: ToolFamily; description: string; count: number }[] }
  epochs: Map<string, string>
  sources: Map<string, string>
  rangeFootprints: Map<string, string>
  stopped: boolean
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
interface Cursor { runId: string; handle: string; method: string; digest: string; offset: number }
class ToolError extends Error { constructor(readonly code: string, message: string) { super(message) } }

function textContrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channel = (offset: number) => {
      const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  }
  const first = luminance(foreground), second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** A conservative upper bound on kinds reachable under the frozen grant. Gateway still checks every concrete target. */
function writableKinds(model: DocumentModel, writable: readonly ToolTarget[]): ToolTarget['kind'][] {
  const kinds = new Set<ToolTarget['kind']>()
  for (const target of writable) {
    kinds.add(target.kind)
    if (target.kind === 'document') {
      if (model.kind === 'markdown') kinds.add('markdown-range')
      continue
    }
    if (model.kind !== 'course-v9') continue
    if (target.kind === 'course-audio') kinds.add('course-sound')
    if (target.kind === 'course-location') { kinds.add('course-object'); kinds.add('course-interaction'); kinds.add('course-background') }
    if (target.kind === 'course-owner') {
      kinds.add('course-object')
      if (target.owner !== 'global') kinds.add('course-background')
      if (target.owner === 'scene') { kinds.add('course-state'); kinds.add('course-interaction') }
    }
    if (target.kind === 'course-state') kinds.add('course-background')
    if (target.kind === 'flow-block') kinds.add('flow-range')
    if (target.kind === 'flow-container' && target.index === undefined) { kinds.add('flow-block'); kinds.add('flow-range') }
    if (target.kind === 'course-surface') {
      const surface = model.project.surfaces.find(value => value.id === target.surfaceId)
      if (!surface) continue
      kinds.add('course-location'); kinds.add('course-owner'); kinds.add('course-object'); kinds.add('course-background')
      if (surface.type === 'slide') { kinds.add('course-state'); kinds.add('course-interaction') }
      else if (surface.type === 'flow') { kinds.add('flow-container'); kinds.add('flow-block'); kinds.add('flow-range') }
      else kinds.add('spatial-graph')
    }
  }
  return [...kinds]
}

export interface DocumentToolGatewayOptions { prepareImage?: PrepareImageResourcePort; services?: HostToolServices; measureNativeText?: NativeTextMeasurePort; measureNativeTextAsync?: AsyncNativeTextMeasurePort }

/** Pure host service. It never consults focus/selection and returns success only after durable Session ACK. */
export class DocumentToolGateway implements ToolGateway {
  private readonly images = new Map<string, { runId: string; documentId: string; epoch: string; asset: ImageAssetResource }>()
  private readonly runs = new Map<string, Run>()
  private readonly startingRuns = new Set<string>()
  private readonly writeTaskBarriers = new Map<string, number>()
  private readonly writeTaskGenerations = new Map<string, number>()
  private hostServicesConfigured = false
  private readonly handles = new Map<string, Handle>()
  private readonly cursors = new Map<string, Cursor>()
  private readonly pending = new Map<string, { digest: string; result: Promise<ToolResult> }>()
  private readonly callDigests = new Map<string, string>()

  private readonly hostTools: HostToolCoordinator

  constructor(private readonly registry: DocumentRegistry, private readonly drivers: readonly DocumentDriver[], private readonly createId: () => string, private readonly options: DocumentToolGatewayOptions = {}) {
    this.hostServicesConfigured = options.services !== undefined
    this.hostTools = new HostToolCoordinator(options.services ?? {}, registry, {
      resolve: async (runId, id) => { const handle = this.handle(runId, id), snapshot = await this.registry.get(handle.documentId).drain(); if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止'); return { snapshot, target: this.resolve(handle, snapshot, true) } },
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
      actor: runId => this.run(runId).grant.actor,
      ownsDocument: (runId, documentId) => this.run(runId).grant.documents.some(document => document.documentId === documentId),
      provideImage: (runId, documentId, source) => this.provideImage(runId, documentId, source),
      readImage: (runId, documentId, resource) => this.readImageResource(runId, documentId, resource),
    })
  }

  /** Main finishes service wiring once, before any task has started. */
  configureHostServices(services: HostToolServices): void {
    if (this.hostServicesConfigured || this.runs.size || this.startingRuns.size) throw new Error('宿主服务只能在首个任务前配置一次')
    this.hostTools.configure(services)
    this.hostServicesConfigured = true
  }

  async describe(names?: readonly string[]) { return describeTools(names).filter(tool => this.hostTools.supports(tool.name)) }

  /** Built-in model catalog is fixed from the frozen document kinds and grants, never from current focus. */
  async describeRun(runId: string): Promise<readonly ToolDefinition[]> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const scopes: RunToolScope[] = []
    for (const doc of run.grant.documents) {
      const snapshot = await this.registry.get(doc.documentId).drain()
      this.authorizeDocument(run, snapshot)
      scopes.push(this.runScope(snapshot.model, doc.writable))
    }
    const allowed = selectRunToolNames(scopes).filter(name => this.hostTools.supports(name))
    const names = visibleRunToolNames(allowed, run.loadedFamilies)
    const batchMutationNames = mutationNamesIn(names)
    run.toolScopes = scopes
    run.advertised = {
      definitions: describeTools(names, { batchMutationNames, compactBatch: true }), names: new Set(names),
      availableFamilies: toolFamilies.map(family => ({ family, description: describeToolFamily(family, allowed),
        count: allowed.filter(name => familyOfTool(name) === family).length })).filter(item => item.count > 0),
      ...(names.includes('batch') ? { batchSchema: batchInputSchemaFor(batchMutationNames) } : {}),
    }
    return structuredClone(run.advertised.definitions)
  }

  private runScope(model: DocumentModel, writable: readonly ToolTarget[]): RunToolScope {
    const canInsertFlow = model.kind === 'course-v9' && writable.some(target =>
      target.kind === 'document' && model.project.surfaces.some(surface => surface.type === 'flow')
      || target.kind === 'course-surface' && model.project.surfaces.some(surface => surface.id === target.surfaceId && surface.type === 'flow')
      || target.kind === 'flow-container' && (() => { try { readTarget(model, target); return true } catch { return false } })())
    return { kind: model.kind, writableTargetKinds: writableKinds(model, writable),
      wholeDocumentWritable: writable.some(target => target.kind === 'document'), canInsertFlow }
  }

  async availableToolFamilies(runId: string): Promise<readonly { family: ToolFamily; description: string; count: number }[]> {
    const run = this.run(runId)
    if (!run.advertised) await this.describeRun(runId)
    return structuredClone(run.advertised!.availableFamilies)
  }

  async loadToolFamilies(runId: string, families: readonly ToolFamily[]): Promise<readonly { family: ToolFamily; description: string; count: number }[]> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const available = await this.availableToolFamilies(runId)
    for (const family of families) if (available.some(item => item.family === family)) run.loadedFamilies.add(family)
    await this.describeRun(runId)
    return available
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
      const toolScopes: RunToolScope[] = []
      for (const doc of grant.documents) {
        if (epochs.has(doc.documentId)) throw new Error('授权文档不能重复')
        const snapshot = await this.registry.get(doc.documentId).drain()
        for (const target of doc.writable) {
          readTarget(snapshot.model, target)
          if (target.kind === 'flow-range' || target.kind === 'flow-container' && target.index !== undefined) rangeFootprints.set(documentDigest({ documentId: doc.documentId, target }), targetFootprint(snapshot.model, target))
        }
        epochs.set(doc.documentId, snapshot.epoch)
        toolScopes.push(this.runScope(snapshot.model, doc.writable))
        if (snapshot.model.kind === 'markdown') sources.set(doc.documentId, snapshot.model.source)
      }
      if (this.runs.has(grant.runId)) throw new Error('任务编号已存在')
      await this.hostTools.beginRun(grant)
      this.assertWriteTasksAllowed(grant, generations)
      this.runs.set(grant.runId, { grant, toolScopes, loadedFamilies: new Set(), epochs, sources, rangeFootprints, stopped: false })
    } finally { this.startingRuns.delete(input.runId) }
  }

  /** Main-only: a file tool has opened a supported document during this live run. */
  async attachRunDocument(runId: string, documentId: string, writable: boolean): Promise<boolean> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const snapshot = await this.registry.get(documentId).drain()
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const targets = writable ? [{ kind: 'document' as const }] : []
    if (run.epochs.has(documentId)) {
      this.authorizeDocument(run, snapshot)
      return !!run.grant.documents.find(item => item.documentId === documentId)?.writable.some(item => item.kind === 'document')
    }
    run.grant = { ...run.grant, documents: [...run.grant.documents, { documentId, writable: targets }] }
    run.epochs.set(documentId, snapshot.epoch)
    run.toolScopes.push(this.runScope(snapshot.model, targets))
    if (snapshot.model.kind === 'markdown') run.sources.set(documentId, snapshot.model.source)
    run.advertised = undefined
    return writable
  }

  /** Recovery registers receipt-query identity only. It cannot renew old target authority. */
  recoverRun(input: ToolRunGrant): void {
    if (!input.runId || this.runs.has(input.runId)) throw new Error('任务编号已存在或无效')
    const ids = input.documents.map(document => document.documentId)
    if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error('恢复文档身份重复或无效')
    const grant: ToolRunGrant = { runId: input.runId, actor: input.actor, documents: ids.map(documentId => ({ documentId, writable: [] })) }
    this.runs.set(input.runId, { grant, toolScopes: [], loadedFamilies: new Set(), epochs: new Map(), sources: new Map(), rangeFootprints: new Map(), stopped: true })
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

  /** Host-only source map for provisional projections; never a model capability or a commit receipt. */
  async resolveEditTarget(runId: string, handleId: string): Promise<{ documentId: string; epoch: string; revision: number; target: ToolTarget; model: DocumentModel }> {
    const run = this.run(runId)
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const handle = this.handle(runId, handleId)
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
    const snapshot = await this.registry.get(handle.documentId).drain()
    const target = this.resolve(handle, snapshot, false)
    const current = readTarget(snapshot.model, target)
    const content = typeof current === 'string' ? current : JSON.stringify(current)
    if (content.length <= maxChars) return { kind: target.kind, text: content, total: content.length, truncated: false }
    const nextCursor = `c${this.createId()}`
    this.cursors.set(nextCursor, { runId, handle: handleId, method: 'read', digest: documentDigest(content), offset: maxChars })
    return { kind: target.kind, text: content.slice(0, maxChars), total: content.length, truncated: true, nextCursor }
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
    if (snapshot.model.kind !== 'course-v9') throw new Error('图片资源需要 V9 文档')
    const prepareImage = this.options.prepareImage
    if (!prepareImage) throw new ToolError('unsupported-resource-preparation', '当前宿主未配置图片解码能力')
    const asset = structuredClone(await prepareImage({ bytes: Uint8Array.from(input.bytes), filename: input.filename, mimeType: input.mimeType }, this.createId))
    const current = this.registry.get(documentId).read()
    this.authorizeDocument(run, current)
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
    const target = this.resolve(handle, snapshot, false, true)
    return { documentId: snapshot.documentId, revision: snapshot.revision, target }
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
    if (!resource || resource.runId !== runId || resource.documentId !== documentId || resource.epoch !== snapshot.epoch) throw new ToolError('invalid-resource', '参考图不属于当前任务/文档')
    return { bytes: Uint8Array.from(resource.asset.bytes), mimeType: resource.asset.meta.mimeType, filename: resource.asset.meta.path.split('/').at(-1) ?? 'reference-image' }
  }

  async stop(runId: string): Promise<void> {
    const run = this.run(runId)
    run.stopped = true
    for (const [id, resource] of this.images) if (resource.runId === runId) this.images.delete(id)
    // Already queued canonical commits finish; later requests cannot cross the barrier.
    await Promise.all([this.hostTools.stop(runId), ...run.grant.documents.map(doc => this.registry.get(doc.documentId).stopRun(runId))])
  }

  private run(runId: string): Run {
    const run = this.runs.get(runId)
    if (!run) throw new ToolError('unknown-run', '任务授权不存在')
    return run
  }
  private authorizeDocument(run: Run, snapshot: DocumentSnapshot): void {
    if (!run.epochs.has(snapshot.documentId)) throw new ToolError('not-authorized', '任务没有此文档的读取权限')
    if (run.epochs.get(snapshot.documentId) !== snapshot.epoch) throw new ToolError('stale-epoch', '文档会话已改变，请重新冻结任务')
  }
  private canWrite(run: Run, snapshot: DocumentSnapshot, target: ToolTarget): boolean {
    return run.grant.documents.find(doc => doc.documentId === snapshot.documentId)!.writable.some(allowed => {
      try {
        const frozen = run.rangeFootprints.get(documentDigest({ documentId: snapshot.documentId, target: allowed }))
        if (frozen && frozen !== targetFootprint(snapshot.model, allowed)) return false
        const mapped = allowed.kind === 'markdown-range' && snapshot.model.kind === 'markdown'
          ? mapMarkdownRange(run.sources.get(snapshot.documentId)!, snapshot.model.source, allowed) : allowed
        if (target.kind === 'course-background' && snapshot.model.kind === 'course-v9' &&
          (mapped.kind === 'course-location' || mapped.kind === 'course-owner' || mapped.kind === 'course-state')) {
          const location = snapshot.model.project.locations.find(value => value.id === mapped.locationId)
          if (!location || !target.surfaceId || location.surfaceId !== target.surfaceId) return false
          if (mapped.kind === 'course-location') return location.kind === 'slide-scene'
            ? target.owner === 'scene' && target.sceneId === location.sceneId && !target.stateId
            : target.owner === 'surface' && !target.sceneId && !target.stateId
          if (mapped.kind === 'course-owner') {
            if (mapped.owner === 'global') return false
            if (mapped.owner === 'scene') return location.kind === 'slide-scene' && target.owner === 'scene'
              && target.sceneId === location.sceneId && target.stateId === mapped.stateId
            return target.owner === 'surface' && !target.sceneId && !target.stateId
          }
          return location.kind === 'slide-scene' && target.owner === 'scene'
            && target.sceneId === location.sceneId && target.stateId === mapped.stateId
        }
        if (mapped.kind === 'course-surface' && snapshot.model.kind === 'course-v9') {
          if (target.kind === 'course-surface') return target.surfaceId === mapped.surfaceId
          if ('locationId' in target) {
            const location = snapshot.model.project.locations.find(location => location.id === target.locationId)
            if (location?.surfaceId !== mapped.surfaceId || target.kind === 'course-owner' && target.owner === 'global') return false
            if (target.kind === 'course-object') return locateCourseLayer(snapshot.model.project, target.itemId)?.source !== 'global'
            return true
          }
          if ('surfaceId' in target) return target.surfaceId === mapped.surfaceId
          return false
        }
        if (mapped.kind === 'course-owner' && target.kind === 'course-object' && snapshot.model.kind === 'course-v9') {
          const layer = locateCourseLayer(snapshot.model.project, target.itemId)
          return mapped.stateId === target.stateId && mapped.locationId === target.locationId && layer?.source === mapped.owner
        }
        return containsTarget(mapped, target)
      } catch { return false }
    })
  }
  private capture(runId: string, snapshot: DocumentSnapshot, target: ToolTarget, writable: boolean, readOnly?: boolean): string {
    const id = `t${this.createId()}`
    if (this.handles.has(id)) throw new Error('句柄编号重复')
    readTarget(snapshot.model, target)
    const footprint = targetFootprint(snapshot.model, target)
    this.handles.set(id, { runId, documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      target: structuredClone(target), footprint, expectedFootprint: footprint, conflicted: false, writable, readOnly,
      ...(target.kind === 'markdown-range' && snapshot.model.kind === 'markdown' ? { source: snapshot.model.source } : {}) })
    return id
  }
  private handle(runId: string, id: string): Handle {
    const handle = this.handles.get(id)
    if (!handle || handle.runId !== runId) throw new ToolError('invalid-target', '目标句柄不存在或不属于此任务')
    return handle
  }
  private handleFootprint(handle: Handle, model: DocumentModel): string {
    const target = handle.target.kind === 'markdown-range' && model.kind === 'markdown'
      ? mapMarkdownRange(handle.source!, model.source, handle.target) : handle.target
    return targetFootprint(model, target)
  }
  private recordAppliedFootprints(runId: string, snapshot: DocumentSnapshot, model: DocumentModel): void {
    for (const handle of this.handles.values()) {
      if (handle.runId !== runId || handle.documentId !== snapshot.documentId || handle.epoch !== snapshot.epoch
        || handle.revision > snapshot.revision || handle.conflicted) continue
      try {
        // A task commit explains a target change only when the target still matched
        // the result of this task's previous acknowledged commit beforehand.
        if (this.handleFootprint(handle, snapshot.model) !== handle.expectedFootprint) {
          handle.conflicted = true
          continue
        }
        handle.expectedFootprint = this.handleFootprint(handle, model)
      } catch { handle.conflicted = true }
    }
  }
  private refreshReadHandle(handle: Handle, snapshot: DocumentSnapshot, target: ToolTarget): string {
    const run = this.run(handle.runId)
    if (handle.conflicted || targetFootprint(snapshot.model, target) !== handle.expectedFootprint) {
      throw new ToolError('target-conflict', '目标内容被本任务以外的操作改变；旧句柄不能续写，请核对新内容后重新发起任务')
    }
    return this.capture(handle.runId, snapshot, target,
      handle.writable && this.canWrite(run, snapshot, target), handle.readOnly)
  }
  private resolve(handle: Handle, snapshot: DocumentSnapshot, write: boolean, verifyFootprint = write): ToolTarget {
    this.authorizeDocument(this.run(handle.runId), snapshot)
    if (handle.epoch !== snapshot.epoch) throw new ToolError('stale-epoch', '目标会话已失效')
    if (write && !handle.writable) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
    if (handle.conflicted) throw new ToolError('target-conflict', '目标内容已由其他操作改变；旧句柄不可续写，请核对新内容后重新发起任务。')
    let target = handle.target
    try {
      if (target.kind === 'markdown-range' && snapshot.model.kind === 'markdown') target = mapMarkdownRange(handle.source!, snapshot.model.source, target)
      if ((verifyFootprint || target.kind === 'flow-range' || target.kind === 'flow-container' && target.index !== undefined)
        && targetFootprint(snapshot.model, target) !== handle.footprint) {
        throw new Error(targetFootprint(snapshot.model, target) === handle.expectedFootprint && handle.expectedFootprint !== handle.footprint
          ? '本任务已修改目标内容；旧句柄不可续写。请 read 或 inspect 原句柄并使用返回的 data.target；同轮多项编辑请用 batch。'
          : '目标内容已由其他操作改变；旧句柄不可续写，请核对新内容后重新发起任务。')
      }
      readTarget(snapshot.model, target)
    } catch (error) { throw new ToolError('target-conflict', error instanceof Error ? error.message : '目标已改变') }
    return target
  }

  /** Stable host event correlation; not exposed to model arguments. */
  operationIdentity(runId: string, callId: string): string {
    if (!callId) throw new ToolError('invalid-call-id', '工具调用缺少宿主编号')
    return `tool:${documentDigest({ runId, callId })}`
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
      const previousDigest = this.callDigests.get(key)
      if (previousDigest && previousDigest !== digest) throw new ToolError('operation-payload-mismatch', '同一调用编号不能提交不同内容')
      return this.findReceipt(runId, operationId, digest) ?? await this.hostTools.lookup(runId, operationId, digest, input.name)
    } catch (error) { return this.error(error) }
  }

  private findReceipt(runId: string, operationId: string, requestDigest: string): ToolResult | null {
    const run = this.run(runId)
    for (const doc of run.grant.documents) {
      const result = this.registry.get(doc.documentId).lookupRequest({ documentId: doc.documentId, operationId, actor: run.grant.actor, runId, requestDigest })
      if (result) return { kind: 'document-operation', result, affected: [] }
    }
    return null
  }

  execute(runId: string, callId: string, input: ModelToolCall): Promise<ToolResult> {
    try {
      const advertised = this.run(runId).advertised
      if (advertised && !advertised.names.has(input.name)) throw new ToolError('tool-not-advertised', '此工具不在本次冻结的可用目录中')
      if (advertised && input.name === 'batch') advertised.batchSchema!.parse(input.input)
      const { call, digest, key, operationId } = this.identifyCall(runId, callId, input)
      const previousDigest = this.callDigests.get(key)
      if (previousDigest && previousDigest !== digest) return Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      this.callDigests.set(key, digest)
      const pending = this.pending.get(key)
      if (pending) return pending.digest === digest ? pending.result : Promise.resolve({ kind: 'error', code: 'operation-payload-mismatch', message: '同一调用编号不能提交不同内容' })
      const result = this.invoke(runId, operationId, digest, call).catch(error => this.error(error))
      this.pending.set(key, { digest, result })
      void result.finally(() => { this.pending.delete(key) })
      return result
    } catch (error) { return Promise.resolve(this.error(error)) }
  }
  private error(error: unknown): ToolResult {
    return { kind: 'error', code: error instanceof z.ZodError ? 'invalid-input' : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'invalid-operation', message: error instanceof Error ? error.message : '工具操作失败' }
  }

  private async importImage(runId: string, snapshot: DocumentSnapshot, model: DocumentModel, driver: DocumentDriver, resourceId: string) {
    if (model.kind !== 'course-v9') throw new Error('图片资源需要 V9 文档')
    const resource = this.images.get(resourceId)
    if (!resource || resource.runId !== runId || resource.documentId !== snapshot.documentId || resource.epoch !== snapshot.epoch) throw new ToolError('invalid-resource', '图片资源不属于本任务与文档，或已失效')
    const { meta, bytes } = resource.asset
    const existing = model.project.assets[meta.id]
    if (existing && (documentDigest(existing) !== documentDigest(meta) || documentDigest(model.resources.assets[meta.id]) !== documentDigest(bytes))) throw new Error('素材身份已冲突')
    const next = await driver.apply(model, { type: 'course.replace', project: { ...model.project, assets: { ...model.project.assets, [meta.id]: meta } }, resources: { ...model.resources, assets: { ...model.resources.assets, [meta.id]: bytes } } })
    return { model: next, assetId: meta.id }
  }

  private existingMediaAsset(model: DocumentModel, reference: ToolTarget) {
    if (model.kind !== 'course-v9' || reference.kind !== 'course-asset') throw new Error('已有媒体需要当前文档的素材短句柄')
    const asset = model.project.assets[reference.assetId]
    if (!asset || asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') throw new Error('素材不是可用的图片、视频或音频')
    if (!model.resources.assets[asset.id] && !asset.remote) throw new Error('已有素材字节不可用')
    return asset
  }

  private async invoke(runId: string, operationId: string, requestDigest: string, call: ModelToolCall): Promise<ToolResult> {
    const run = this.run(runId)
    // Durable replay precedes target validation: a successful call has already changed that target.
    const receipt = this.findReceipt(runId, operationId, requestDigest)
    if (receipt) return receipt
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止')
    const definition = toolCatalog.find(tool => tool.name === call.name)
    if (!definition) throw new ToolError('unsupported-tool', '此工具尚未接入正式 Gateway')
    if (isHostToolName(call.name)) return this.hostTools.invoke(runId, operationId, requestDigest, call.name, call.input)
    const value = definition.inputSchema.parse(call.input)
    if (call.name === 'read' || call.name === 'inspect' || call.name === 'listChildren') return this.read(runId, call.name, value as { target: string; limit?: number; cursor?: string })
    const mutations = call.name === 'batch' ? (value as { operations: BatchMutationCall[] }).operations : [mutationCallSchema.parse({ name: call.name, input: value })]
    // Validate the dependency graph before any private planning or resource work.
    mutations.forEach((mutation, index) => {
      if (mutation.name !== 'selection.replace' || typeof mutation.input.replacement === 'string') return
      const step = mutation.input.replacement.$result.step
      if (step >= index || !['native.insert', 'media.insert', 'document.insert', 'layer.duplicate'].includes(mutations[step].name)) throw new ToolError('invalid-result-reference', '替换只能引用此前创建步骤的主对象结果')
    })
    const handles = mutations.map(mutation => this.handle(runId, mutation.input.target))
    const destinationHandles = mutations.map(mutation => mutation.name === 'flow.move' ? this.handle(runId, mutation.input.destination) : null)
    if (handles.some(handle => handle.documentId !== handles[0].documentId)) throw new ToolError('cross-document-batch', '批量原子操作只能属于同一文档')
    if (destinationHandles.some(handle => handle && handle.documentId !== handles[0].documentId)) throw new ToolError('cross-document-batch', '移动目的地必须属于同一文档')
    const layerHandles = mutations.map(mutation => {
      if (mutation.name === 'spatial.structure' && mutation.input.operation === 'fit-world-content') return [this.handle(runId, mutation.input.surface)]
      if (mutation.name === 'slide.move') return [this.handle(runId, mutation.input.destination)]
      if (mutation.name === 'course.navigation' && mutation.input.operation === 'reorder-surfaces') return mutation.input.surfaces.map(handle => this.handle(runId, handle))
      if (mutation.name === 'slide.duplicate') return [this.handle(runId, mutation.input.surface)]
      if (mutation.name === 'slide.reorder') return mutation.input.locations.map(handle => this.handle(runId, handle))
      if (mutation.name === 'state.duplicate') return [this.handle(runId, mutation.input.owner)]
      if (mutation.name === 'state.reorder') return mutation.input.states.map(handle => this.handle(runId, handle))
      if (mutation.name === 'selection.replace' && typeof mutation.input.replacement === 'string') return [this.handle(runId, mutation.input.replacement)]
      if (mutation.name === 'layer.duplicate' || mutation.name === 'layer.reorder') return [this.handle(runId, mutation.input.owner), ...(mutation.name === 'layer.reorder' && 'sibling' in mutation.input.position ? [this.handle(runId, mutation.input.position.sibling)] : [])]
      if (mutation.name === 'layer.align' || mutation.name === 'layer.distribute') {
        if (!mutation.input.targets.includes(mutation.input.target)) throw new Error('主目标必须包含在成组目标中')
        if (mutation.name === 'layer.align' && mutation.input.primary && !mutation.input.targets.includes(mutation.input.primary)) throw new Error('对齐锚点必须包含在成组目标中')
        return mutation.input.targets.map(id => this.handle(runId, id))
      }
      return []
    })
    if (layerHandles.some(group => group.some(handle => handle.documentId !== handles[0].documentId))) throw new ToolError('cross-document-batch', '图层操作的全部目标必须属于同一文档')
    const referenceHandles = mutations.map(mutation => (mutation.name === 'spatial.structure' ? spatialReferenceHandles(mutation.input)
      : (mutation.name === 'sound.create' || mutation.name === 'sound.update' || mutation.name === 'media.insert' || mutation.name === 'media.apply') && 'asset' in mutation.input && mutation.input.asset ? [mutation.input.asset] : []).map(id => this.handle(runId, id)))
    if (referenceHandles.some(group => group.some(handle => handle.documentId !== handles[0].documentId))) throw new ToolError('cross-document-batch', '工具引用必须属于同一文档')
    const session = this.registry.get(handles[0].documentId)
    const snapshot = await session.drain()
    const targets = handles.map(handle => this.resolve(handle, snapshot, true))
    const destinations = destinationHandles.map(handle => handle ? this.resolve(handle, snapshot, true) : null)
    const layerTargets = layerHandles.map(group => group.map(handle => this.resolve(handle, snapshot, true)))
    const referenceTargets = referenceHandles.map(group => group.map(handle => this.resolve(handle, snapshot, false, true)))
    const driver = this.drivers.find(value => value.kind === snapshot.model.kind)
    if (!driver) throw new Error('文档 Driver 未注册')
    let model = snapshot.model
    const finalTargets: ToolTarget[] = []
    const additionalAffected: { target: ToolTarget; writable: boolean }[] = []
    for (let i = 0; i < mutations.length; i += 1) {
      let mutation = mutations[i]
      let target = targets[i]
      if (target.kind === 'markdown-range' && model.kind === 'markdown' && snapshot.model.kind === 'markdown') target = mapMarkdownRange(snapshot.model.source, model.source, target)
      let mediaAssetId: string | undefined
      if (mutation.name === 'media.apply') {
        if (target.kind !== 'course-object' && target.kind !== 'flow-block' && target.kind !== 'course-background') throw new Error('媒体替换需要已有媒体或正式背景句柄')
        assertImagePlacementFit(target.kind === 'course-background' ? 'background' : target.kind === 'flow-block' ? 'flow' : 'native', mutation.input.fit)
        if ('asset' in mutation.input) mediaAssetId = this.existingMediaAsset(model, referenceTargets[i][0]).id
        else {
          const imported = await this.importImage(runId, snapshot, model, driver, mutation.input.resource)
          model = imported.model; mediaAssetId = imported.assetId
        }
        if (target.kind === 'course-background') {
          if (model.kind !== 'course-v9' || model.project.assets[mediaAssetId]?.kind !== 'image') throw new Error('正式背景只接受图片素材')
          mutation = { name: 'owner.background', input: { target: mutation.input.target, properties: { backgroundAssetId: mediaAssetId, ...(target.owner !== 'course' && !target.stateId ? { backgroundMode: 'own' as const } : {}) } } }
        }
      }
      if (mutation.name === 'text.replace' && (target.kind === 'flow-block' || target.kind === 'flow-range')) {
        mutation = { name: 'flow.content', input: { target: mutation.input.target, content: normalizeDocumentText({ inlines: [{ type: 'text', text: mutation.input.content }] }) } }
      }
      if (mutation.name === 'text.replace') {
        if (target.kind === 'course-object' && model.kind === 'course-v9') {
          const layer = target.stateId ? { item: layerToolContext(model.project, target).entry.item } : locateCourseLayer(model.project, target.itemId)
          if (!layer || layer.item.kind !== 'native' || layer.item.content.nativeType !== 'text') throw new Error('纯文本替换需要 Native 文字对象')
          const planned = planNativeTextEdit(layer.item.content.data, { text: mutation.input.content })
          if (!planned.ok) throw new ToolError(`native-text-${planned.code}`, planned.reason)
          model = await this.patchObject(model, driver, target, { nativeData: planned.data })
        } else {
          if (target.kind !== 'markdown-range') throw new Error('文本替换需要 Markdown 范围或 Native 文字句柄')
          model = await driver.apply(model, { type: 'markdown.splice', from: target.from, to: target.to, text: mutation.input.content })
          // Preserve earlier changed ranges when a later batch splice occurs before them.
          for (let j = 0; j < finalTargets.length; j += 1) {
            const previous = finalTargets[j]
            if (previous.kind === 'markdown-range') {
              if (previous.to > target.from && previous.from < target.to) throw new Error('批量正文范围重叠')
              if (previous.from >= target.to) { const shift = mutation.input.content.length - (target.to - target.from); finalTargets[j] = { ...previous, from: previous.from + shift, to: previous.to + shift } }
            }
          }
          target = { ...target, to: target.from + mutation.input.content.length }
        }
      } else if (mutation.name === 'layer.delete' || mutation.name === 'layer.duplicate' || mutation.name === 'layer.reorder' || mutation.name === 'layer.align' || mutation.name === 'layer.distribute') {
        if (model.kind !== 'course-v9' || target.kind !== 'course-object') throw new Error('图层编辑需要 V9 对象句柄')
        const context = layerToolContext(model.project, target)
        const options = { expectedRevision: model.project.revision }
        if (mutation.name === 'layer.align' || mutation.name === 'layer.distribute') {
          const contexts = layerTargets[i].map(target => layerToolContext((model as Extract<DocumentModel, { kind: 'course-v9' }>).project, target))
          if (context.composition.surfaceType !== 'slide' || contexts.some(other => !sameLayerGroup(context, other))) throw new Error('成组布局必须属于同一 Slide owner 与平面')
          const primary = mutation.name === 'layer.align' && mutation.input.primary ? layerTargets[i][mutation.input.targets.indexOf(mutation.input.primary)] : undefined
          const planned = planSlideMultiLayerFrames(contexts.map(({ entry }) => ({ id: entry.item.layerItemId, frame: entry.item.frame, rotation: entry.item.rotation, locked: entry.item.locked })), mutation.name === 'layer.align' ? { kind: 'align', mode: mutation.input.mode } : { kind: 'distribute', axis: mutation.input.axis }, primary?.kind === 'course-object' ? primary.itemId : undefined)
          if (!planned.ok) throw new Error(planned.reason)
          for (const patch of planned.patches) {
            model = await this.patchObject(model, driver, { ...target, itemId: patch.itemId }, { frame: patch.frame })
            if (patch.itemId !== target.itemId) additionalAffected.push({ target: { ...target, itemId: patch.itemId }, writable: true })
          }
        } else {
          if (mutation.name !== 'layer.delete') requireLayerOwner(model.project, target, layerTargets[i][0])
          if (mutation.name !== 'layer.delete' && context.entry.item.locked) throw new Error('图层已锁定')
          let planned
          if (mutation.name === 'layer.delete') planned = deleteEffectiveLayerItem(model.project, context.command, options)
          else if (mutation.name === 'layer.duplicate') {
            if (context.located.source === 'scene') {
              const duplicated = planDuplicateSlideSceneLayers(model.project, target.locationId, target.stateId ?? null, [target.itemId])
              planned = { ok: true, nextDocument: duplicated.nextDocument, createdLayerItemId: duplicated.createdIds[0] }
              for (const itemId of duplicated.createdIds.slice(1)) additionalAffected.push({ target: { ...target, itemId }, writable: true })
            } else planned = duplicateEffectiveLayerItem(model.project, context.command, options)
          }
          else {
            const ids = context.composition.entries.filter(entry => entry.source === context.entry.source && entry.globalPlane === context.entry.globalPlane && entry.flowBodyPlane === context.entry.flowBodyPlane).map(entry => entry.item.layerItemId).filter(id => id !== context.target.itemId)
            const position = mutation.input.position
            let index = position.kind === 'front' ? ids.length : 0
            if ('sibling' in position) {
              const sibling = layerToolContext(model.project, layerTargets[i][1])
              if (!sameLayerGroup(context, sibling)) throw new Error('排序锚点必须属于同一 owner 与平面')
              index = ids.indexOf(sibling.target.itemId)
              if (index < 0) throw new Error('排序锚点必须是另一个对象')
              if (position.kind === 'after') index++
            }
            ids.splice(index, 0, target.itemId)
            planned = context.located.source === 'scene' ? { ok: true, nextDocument: planReorderSlideSceneLayers(model.project, target.locationId, target.stateId ?? null, ids) } : reorderEffectiveLayerItems(model.project, context.command, ids, options)
          }
          if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法规划图层操作')
          model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
          if (mutation.name === 'layer.duplicate') {
            if (!planned.createdLayerItemId) throw new Error('复制未生成独立身份')
            target = { ...target, itemId: planned.createdLayerItemId }
            const { side, gap } = mutation.input.placement, frame = context.entry.item.frame
            model = await this.patchObject(model, driver, target, { frame: {
              x: frame.x + (side === 'right' ? frame.width + gap : side === 'left' ? -frame.width - gap : 0),
              y: frame.y + (side === 'below' ? frame.height + gap : side === 'above' ? -frame.height - gap : 0),
            } })
          }
        }
      } else if (mutation.name === 'audio.settings' || mutation.name === 'sound.create' || mutation.name === 'sound.update' || mutation.name === 'sound.delete') {
        if (model.kind !== 'course-v9') throw new Error('音频设置需要 V9 文档')
        let project = model.project
        let assetId: string | undefined
        if (referenceTargets[i].length) {
          const reference = referenceTargets[i][0]
          if (reference.kind !== 'course-asset' || project.assets[reference.assetId]?.kind !== 'audio') throw new Error('声音来源需要当前文档音频素材句柄')
          if (!model.resources.assets[reference.assetId] && !project.assets[reference.assetId].remote) throw new Error('音频素材字节不可用')
          assetId = reference.assetId
        }
        if (mutation.name === 'audio.settings' || mutation.name === 'sound.create') {
          if (target.kind !== 'course-audio') throw new Error('音频设置或创建声音需要audio句柄')
          if (mutation.name === 'audio.settings') project = planUpdateCourseAudioSettings(project, mutation.input.properties)
          else {
            if (!assetId) throw new Error('创建声音需要音频素材')
            const planned = planCreateCourseSound(project, assetId, mutation.input.properties)
            project = planned.project; target = { kind: 'course-sound', soundId: planned.soundId }
          }
        } else {
          if (target.kind !== 'course-sound') throw new Error('声音操作需要明确sound句柄')
          project = mutation.name === 'sound.delete' ? planDeleteCourseSound(project, target.soundId)
            : planUpdateCourseSound(project, target.soundId, { ...mutation.input.properties, ...(assetId ? { assetId } : {}) })
        }
        model = await driver.apply(model, { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'spatial.structure') {
        if (model.kind !== 'course-v9') throw new Error('空间结构需要 V9 文档')
        const planned = planSpatialStructure(model.project, target, mutation.input, referenceTargets[i], layerTargets[i][0])
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
        target = planned.target
        if (mutation.input.operation === 'fit-world-content') additionalAffected.push({ target: layerTargets[i][0], writable: true })
      } else if (mutation.name === 'surface.rename' || mutation.name === 'slide.move') {
        if (model.kind !== 'course-v9') throw new Error('表面操作需要 V9 文档')
        let project
        if (mutation.name === 'surface.rename') {
          if (target.kind !== 'course-surface') throw new Error('表面重命名需要surface句柄')
          project = renameCourseSurface(model.project, target.surfaceId, mutation.input.name)
        } else {
          const destination = layerTargets[i][0]
          if (target.kind !== 'course-location' || destination.kind !== 'course-surface') throw new Error('移动需要location与目的surface句柄')
          const result = moveCourseSlideScene(model.project, target.locationId, destination.surfaceId, { toIndex: mutation.input.index })
          if (!result.ok) throw new Error(result.reason)
          project = result.project
        }
        model = await driver.apply(model, { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'course.navigation' || mutation.name === 'slide.create' || mutation.name === 'slide.duplicate' || mutation.name === 'slide.reorder' || mutation.name === 'surface.delete') {
        if (model.kind !== 'course-v9') throw new Error('页面结构需要 V9 文档')
        const project = model.project, beforeIds = new Set(project.locations.map(location => location.id))
        let result: ReturnType<typeof addCourseSlidePage>
        if (mutation.name === 'course.navigation') {
          const value = mutation.input
          if (value.operation === 'add-surface' || value.operation === 'reorder-surfaces') {
            if (target.kind !== 'document') throw new Error('表面创建或排序需要整个文档授权')
            if (value.operation === 'add-surface') result = (value.surfaceType === 'slide' ? addCourseSlidePage : value.surfaceType === 'flow' ? addCourseFlowPage : addCourseSpatialPage)(project, { title: value.title })
            else result = reorderCourseSurfaces(project, layerTargets[i].map(surface => { if (surface.kind !== 'course-surface') throw new Error('表面排序需要surface短句柄'); return surface.surfaceId }))
          } else {
            if (target.kind !== 'course-location') throw new Error('页面重命名或删除需要location短句柄')
            result = value.operation === 'rename-location' ? renameCourseLocation(project, target.locationId, value.title) : deleteCourseLocation(project, target.locationId)
          }
        } else if (mutation.name === 'slide.duplicate') {
          if (target.kind !== 'course-location') throw new Error('复制演示场景需要location短句柄')
          const locationId = target.locationId
          const location = project.locations.find(location => location.id === locationId), owner = layerTargets[i][0]
          if (!location || location.kind !== 'slide-scene' || owner.kind !== 'course-surface' || owner.surfaceId !== location.surfaceId) throw new Error('复制必须有同一演示表面写权限')
          result = duplicateCourseLocation(project, target.locationId)
        } else {
          if (target.kind !== 'course-surface') throw new Error('表面或场景结构操作需要surface短句柄')
          if (mutation.name === 'surface.delete') result = deleteCourseSurface(project, target.surfaceId)
          else {
            const surfaceId = target.surfaceId
            const next = mutation.name === 'slide.create' ? mutateAddSlideScene(project, surfaceId, { name: mutation.input.title })
              : mutateReorderSlideScenes(project, surfaceId, layerTargets[i].map(locationTarget => {
                if (locationTarget.kind !== 'course-location') throw new Error('场景排序需要location短句柄')
                const location = project.locations.find(location => location.id === locationTarget.locationId)
                if (!location || location.kind !== 'slide-scene' || location.surfaceId !== surfaceId) throw new Error('场景排序不能跨表面')
                return location.sceneId
              }))
            result = { ok: true, project: next, activatedLocationId: next.locations.find(location => !beforeIds.has(location.id))?.id ?? next.startLocationId }
          }
        }
        if (!result.ok) throw new Error(result.reason)
        model = await driver.apply(model, { type: 'course.replace', project: { ...result.project, revision: project.revision, updatedAt: project.updatedAt } })
        if (mutation.name === 'slide.create' || mutation.name === 'slide.duplicate' || mutation.name === 'course.navigation' && mutation.input.operation === 'add-surface') target = { kind: 'course-location', locationId: result.activatedLocationId }
      } else if (mutation.name === 'state.create' || mutation.name === 'state.rename' || mutation.name === 'state.duplicate' || mutation.name === 'state.delete' || mutation.name === 'state.reorder') {
        if (model.kind !== 'course-v9') throw new Error('呈现状态需要 V9 文档')
        const creating = mutation.name === 'state.create', reordering = mutation.name === 'state.reorder'
        if (creating || reordering) {
          if (target.kind !== 'course-owner' || target.owner !== 'scene' || target.stateId) throw new Error('创建或排序状态需要场景基础态 owner')
        } else if (target.kind !== 'course-state') throw new Error('该操作需要明确的状态句柄')
        const context = stateToolContext(model.project, target), previousIds = new Set(context.scene.presentation?.states.map(state => state.id) ?? [])
        let project
        if (mutation.name === 'state.create') project = mutateAddSlidePresentationState(model.project, context.surface.id, context.scene.id, mutation.input.name)
        else if (mutation.name === 'state.reorder') {
          const stateIds = layerTargets[i].map(stateTarget => {
            if (stateTarget.kind !== 'course-state' || stateTarget.locationId !== context.location.id) throw new Error('排序状态必须属于同一场景位置')
            const other = stateToolContext((model as Extract<DocumentModel, { kind: 'course-v9' }>).project, stateTarget)
            if (other.scene.id !== context.scene.id) throw new Error('排序状态跨场景')
            return stateTarget.stateId
          })
          project = mutateReorderSlidePresentationStates(model.project, context.surface.id, context.scene.id, stateIds)
        } else {
          if (target.kind !== 'course-state') throw new Error('状态目标无效')
          if (mutation.name === 'state.rename') project = mutateRenameSlidePresentationState(model.project, context.surface.id, context.scene.id, target.stateId, mutation.input.name)
          else if (mutation.name === 'state.delete') project = mutateDeleteSlidePresentationState(model.project, context.surface.id, context.scene.id, target.stateId)
          else {
            const owner = layerTargets[i][0]
            if (owner.kind !== 'course-owner' || owner.owner !== 'scene' || owner.stateId || owner.locationId !== target.locationId) throw new Error('复制状态需要相同场景基础态 owner 写权限')
            stateToolContext(model.project, owner)
            project = mutateDuplicateSlidePresentationState(model.project, context.surface.id, context.scene.id, target.stateId)
          }
        }
        model = await driver.apply(model, { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
        if (creating || mutation.name === 'state.duplicate') {
          const surface = project.surfaces.find(surface => surface.id === context.surface.id)
          const state = surface?.type === 'slide' ? surface.scenes.find(scene => scene.id === context.scene.id)?.presentation?.states.find(state => !previousIds.has(state.id)) : undefined
          if (!state) throw new Error('状态创建未返回新身份')
          target = { kind: 'course-state', locationId: target.locationId, stateId: state.id }
        }
      } else if (mutation.name === 'selection.replace') {
        if (model.kind !== 'course-v9') throw new Error('完整替换需要 V9 文档')
        const replacement = typeof mutation.input.replacement === 'string' ? layerTargets[i][0] : finalTargets[mutation.input.replacement.$result.step]
        const { wire, replacementItemId } = selectionReplacementTargets(model.project, target, replacement)
        const planned = planSelectionReplacement(model.project, wire, replacementItemId)
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
        additionalAffected.push({ target, writable: handles[i].writable })
        target = replacement
      } else if (mutation.name === 'input.answer') {
        if (model.kind !== 'course-v9' || target.kind !== 'course-object') throw new Error('答案修改需要输入题对象句柄')
        if (target.stateId) throw new ToolError('unsupported-named-state-answer', '输入题答案属于场景规则，请使用明确的基础态输入题目标')
        const planned = planInputAnswer(model.project, target.locationId, target.itemId, mutation.input.answer, this.createId)
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'interaction.delete') {
        if (model.kind !== 'course-v9' || target.kind !== 'course-interaction') throw new Error('删除互动需要规则句柄')
        const project = planDeleteSlideInteractionRule(model.project, { locationId: target.locationId, scope: 'scene' }, target.ruleId)
        model = await driver.apply(model, { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'interaction.compose' || mutation.name === 'interaction.update') {
        if (model.kind !== 'course-v9' || mutation.name === 'interaction.compose' && (target.kind !== 'course-owner' || target.owner !== 'scene') || mutation.name === 'interaction.update' && target.kind !== 'course-interaction') throw new Error('互动操作需要 Slide 场景 owner 或规则句柄')
        if (target.kind !== 'course-owner' && target.kind !== 'course-interaction') throw new Error('互动目标无效')
        const { surface, scene } = slideSceneContext(model.project, { scope: 'scene', selection: { locationId: target.locationId, stateId: target.stateId ?? null } })
        const value = structuredClone(mutation.input.interaction)
        const reference = (ref: string, kind: 'object' | 'location' | 'scene'): string => {
          if (!this.handles.has(ref)) return ref
          const handle = this.handle(runId, ref)
          if (handle.documentId !== snapshot.documentId) throw new Error('互动引用必须属于同一文档')
          const addressed = this.resolve(handle, snapshot, false)
          if (targetFootprint(snapshot.model, addressed) !== handle.footprint) throw new Error('互动引用内容已改变')
          if (kind === 'object' && addressed.kind === 'course-object') return addressed.itemId
          if (addressed.kind === 'course-location' && model.kind === 'course-v9') {
            if (kind === 'location') return addressed.locationId
            const location = model.project.locations.find(location => location.id === addressed.locationId)
            if (kind === 'scene' && location?.kind === 'slide-scene') return location.sceneId
          }
          throw new Error('互动引用句柄类型不匹配')
        }
        if (value.trigger?.kind === 'click' || value.trigger?.kind === 'input-submit') value.trigger.node = reference(value.trigger.node, 'object')
        for (const effect of value.effects ?? []) {
          if (effect.kind === 'show' || effect.kind === 'hide') effect.nodes = effect.nodes.map(node => reference(node, 'object'))
          if (effect.kind === 'go-to-location') effect.location = reference(effect.location, 'location')
          if (effect.kind === 'go-to-scene') effect.scene = reference(effect.scene, 'scene')
        }
        const context = { locationId: target.locationId, surfaceId: surface.id, stateId: target.stateId }
        const ruleTarget = { locationId: target.locationId, scope: 'scene' as const }
        let rule, project
        if (mutation.name === 'interaction.update' && target.kind === 'course-interaction') {
          const current = locateRule(model.project, ruleTarget, target.ruleId)
          if (!current) throw new Error('互动规则不存在')
          rule = updateComposedInteraction(model.project, context, scene, current, value)
          project = planUpdateSlideInteractionRule(model.project, ruleTarget, current.id, rule)
        } else {
          rule = composeSlideInteraction(model.project, context, scene, `rule-${this.createId()}`, { operation: 'compose', ...value } as Parameters<typeof composeSlideInteraction>[4])
          project = planAddSlideInteractionRule(model.project, ruleTarget, rule)
        }
        target = { kind: 'course-interaction', locationId: target.locationId, ruleId: rule.id, ...(target.stateId ? { stateId: target.stateId } : {}) }
        model = await driver.apply(model, { type: 'course.replace', project: { ...project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'object.update') {
        if (target.kind !== 'course-object') throw new Error('属性操作需要对象句柄')
        model = await this.patchObject(model, driver, target, mutation.input.properties)
      } else if (mutation.name === 'media.apply') {
        if (model.kind !== 'course-v9' || !mediaAssetId) throw new Error('媒体替换需要 V9 文档与有效素材')
        if (target.kind === 'course-object') {
          const layer = target.stateId ? { item: layerToolContext(model.project, target).entry.item } : locateCourseLayer(model.project, target.itemId)
          const data = nativeMediaReplacementData(model.project, layer?.item, { assetId: mediaAssetId, fit: mutation.input.fit })
          model = await this.patchObject(model, driver, target, { nativeData: data })
        } else if (target.kind === 'flow-block') {
          const { block } = resolveFlowBlock(model.project, target)
          if (mutation.input.fit !== undefined && block.type === 'media' && block.mediaKind !== 'image') throw new Error('Flow 视频与音频不支持图片 fit 属性')
          const planned = planUpdateFlowBlock(model.project, target, replaceFlowMedia(model.project, block, mediaAssetId))
          if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法替换正文媒体')
          model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
        } else throw new Error('媒体替换目标不受支持')
      } else if (mutation.name === 'native.insert' || mutation.name === 'media.insert') {
        if (model.kind !== 'course-v9' || snapshot.model.kind !== 'course-v9') throw new Error('媒体或 Native 创建需要 V9 文档')
        if (mutation.name === 'media.insert' && target.kind === 'flow-container' && 'asset' in mutation.input) {
          if (mutation.input.properties !== undefined) throw new Error('Flow 正文媒体不接受 Native 图层属性')
          const asset = this.existingMediaAsset(model, referenceTargets[i][0])
          const before = flowBlocksAtParent(flowSurfaceIn(snapshot.model.project, target.surfaceId).blocks, target.parentId)
          const current = flowBlocksAtParent(flowSurfaceIn(model.project, target.surfaceId).blocks, target.parentId)
          const anchor = before[target.index ?? before.length]?.id
          const index = anchor ? current.findIndex(block => block.id === anchor) : current.length
          if (index < 0) throw new Error('Flow 插入位置已被本批其他操作删除')
          const block = flowBlockSchema.parse({ id: `block-${this.createId()}`, type: 'media', assetId: asset.id, mediaKind: asset.kind,
            layout: mutation.input.flow?.layout ?? 'content-width', ...(mutation.input.flow?.altText !== undefined ? { altText: mutation.input.flow.altText } : {}),
            ...(mutation.input.flow?.caption !== undefined ? { caption: mutation.input.flow.caption } : {}),
            ...(mutation.input.flow?.wrap !== undefined ? { wrap: mutation.input.flow.wrap } : {}),
          })
          const planned = planInsertFlowBlock(model.project, { surfaceId: target.surfaceId, parentId: target.parentId, index, block })
          if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法插入 Flow 媒体块')
          model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
          target = { kind: 'flow-block', surfaceId: target.surfaceId, parentId: target.parentId, blockId: block.id }
        } else {
          if (target.kind !== 'course-owner') throw new Error('Native 创建需要明确的图层 owner 句柄')
          let template
          if (mutation.name === 'media.insert') {
            if ('asset' in mutation.input) {
              if (mutation.input.flow !== undefined) throw new Error('Native 媒体不接受 Flow 正文属性')
              const asset = this.existingMediaAsset(model, referenceTargets[i][0])
              if (asset.kind !== 'image' && asset.kind !== 'video') throw new Error('音频不能插入 Native 浮层；素材须为图片或视频')
              if (asset.kind === 'video' && mutation.input.properties?.fit !== undefined) throw new Error('Native 视频不支持图片 fit 属性')
              template = { nativeType: asset.kind, assetId: asset.id, ...mutation.input.properties }
            } else {
              const imported = await this.importImage(runId, snapshot, model, driver, mutation.input.resource)
              model = imported.model
              template = { nativeType: 'image' as const, assetId: imported.assetId, ...mutation.input.properties }
            }
          } else template = mutation.input.template
          if (model.kind !== 'course-v9') throw new Error('Native 创建需要 V9 文档')
          const currentProject = model.project
          const planned = planNativeInsertion(currentProject, target, template, this.createId)
          model = await driver.apply(model, { type: 'course.replace', project: { ...planned.project, revision: currentProject.revision, updatedAt: currentProject.updatedAt } })
          target = { kind: 'course-object', locationId: target.locationId, itemId: planned.itemId, ...(target.stateId ? { stateId: target.stateId } : {}) }
        }
      } else if (mutation.name === 'flow.delete' || mutation.name === 'flow.move' || mutation.name === 'flow.table') {
        if (target.kind !== 'flow-block' || model.kind !== 'course-v9' || snapshot.model.kind !== 'course-v9') throw new Error('结构操作需要 Flow 块句柄')
        let planned
        if (mutation.name === 'flow.delete') planned = planDeleteFlowBlocks(model.project, [target])
        else if (mutation.name === 'flow.table') {
          const { block } = resolveFlowBlock(model.project, target)
          if (block.type !== 'table') throw new Error('行列结构操作需要 Flow 表格')
          planned = planUpdateFlowBlock(model.project, target, changeFlowTableStructure(block, mutation.input.change, this.createId))
        } else {
          const destination = destinations[i]
          if (destination?.kind !== 'flow-container') throw new Error('移动目的地需要 Flow 正文容器句柄')
          if (destination.surfaceId !== target.surfaceId) throw new Error('暂不支持跨表面移动 Flow 块')
          const blockId = target.blockId
          const before = flowBlocksAtParent(flowSurfaceIn(snapshot.model.project, destination.surfaceId).blocks, destination.parentId)
          // Destination addresses a gap in the observed parent. Exclude the moved item when finding that gap.
          const afterGap = before.slice(destination.index ?? before.length).find(block => block.id !== blockId)?.id
          const current = flowBlocksAtParent(flowSurfaceIn(model.project, destination.surfaceId).blocks, destination.parentId).filter(block => block.id !== blockId)
          const index = afterGap ? current.findIndex(block => block.id === afterGap) : current.length
          if (index < 0) throw new Error('移动目的位置已被本批其他操作删除')
          planned = planMoveFlowBlock(model.project, target, { surfaceId: destination.surfaceId, parentId: destination.parentId, index })
          target = { ...target, parentId: destination.parentId }
        }
        if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法规划结构操作')
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else if (mutation.name === 'flow.content' || mutation.name === 'document.insert') {
        if (model.kind !== 'course-v9' || snapshot.model.kind !== 'course-v9') throw new Error('Flow 正文需要 V9 文档')
        let planned
        if (mutation.name === 'document.insert') {
          if (target.kind !== 'flow-container') throw new Error('插入需要 Flow 正文容器句柄')
          const before = flowBlocksAtParent(flowSurfaceIn(snapshot.model.project, target.surfaceId).blocks, target.parentId)
          const current = flowBlocksAtParent(flowSurfaceIn(model.project, target.surfaceId).blocks, target.parentId)
          const anchor = before[target.index ?? before.length]?.id
          const index = anchor ? current.findIndex(block => block.id === anchor) : current.length
          const block = flowBlockSchema.parse({ ...mutation.input.block, id: `block-${this.createId()}` })
          planned = planInsertFlowBlock(model.project, { surfaceId: target.surfaceId, parentId: target.parentId, index, block })
          target = { kind: 'flow-block', surfaceId: target.surfaceId, parentId: target.parentId, blockId: block.id }
        } else {
          if (target.kind !== 'flow-block' && target.kind !== 'flow-range') throw new Error('正文修改需要 Flow 块或范围句柄')
          if (target.kind === 'flow-range') {
            if (targetFootprint(model, target) !== targetFootprint(snapshot.model, target)) throw new Error('批量正文范围交叠或偏移，请分开读取后修改')
            const { block } = resolveFlowBlock(model.project, target)
            const next = editFlowTextRange(block, { slot: target.slot, start: target.from, end: target.to }, { content: mutation.input.content })
            planned = planUpdateFlowBlock(model.project, target, next)
            target = { ...target, to: target.from + documentTextLength(mutation.input.content) }
          } else planned = planFlowCommittedText(model.project, target, mutation.input.content)
        }
        if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法规划正文操作')
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      } else {
        if (target.kind !== 'course-background' || model.kind !== 'course-v9') throw new Error('背景操作需要背景句柄')
        backgroundOwner(model, target)
        if (target.owner === 'course' && mutation.input.properties.backgroundMode !== undefined) throw new Error('课程背景没有继承模式')
        const surfaceId = target.surfaceId
        const surface = model.project.surfaces.find(value => value.id === surfaceId)
        const planned = target.owner === 'course' ? updateCourseBackground(model.project, mutation.input.properties)
          : surface && surface.type !== 'slide' ? updateBodySurfaceBackground(model.project, surface.id, surface.type, mutation.input.properties)
            : updateSlideBackgroundOwner(model.project, { surfaceId: target.surfaceId!, ...(target.sceneId ? { sceneId: target.sceneId } : {}), ...(target.stateId ? { stateId: target.stateId } : {}) }, mutation.input.properties)
        if (!planned.ok) throw new Error(planned.reason)
        model = await driver.apply(model, { type: 'course.replace', project: { ...planned.project, revision: model.project.revision, updatedAt: model.project.updatedAt } })
      }
      finalTargets.push(target)
    }
    if (run.stopped) throw new ToolError('run-stopped', '任务已停止，修改未提交')
    const command = model.kind === 'markdown' ? { type: 'markdown.replace' as const, source: model.source, resources: model.resources }
      : { type: 'course.replace' as const, project: model.project, resources: model.resources }
    const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId, baseRevision: snapshot.revision,
      actor: run.grant.actor, runId, requestDigest, mutation: { type: 'command', command } })
    if (result.status === 'applied') this.recordAppliedFootprints(runId, snapshot, model)
    const affected: string[] = []
    const advisories: ToolAdvisory[] = []
    if (result.status === 'applied' || result.status === 'unchanged') {
      // Capture the exact acknowledged model, never a later intervening edit.
      const committed = { ...snapshot, model, revision: result.revision }
      for (let i = 0; i < finalTargets.length; i += 1) {
        // Deleted/moved intermediate targets are still affected. Do not turn their durable ACK into a failure.
        try { affected.push(this.capture(runId, committed, finalTargets[i], handles[i].writable)) }
        catch { affected.push(mutations[i].input.target) }
      }
      for (const changed of additionalAffected) {
        try { affected.push(this.capture(runId, committed, changed.target, changed.writable)) } catch { /* A later step may have removed it. */ }
      }
      if (model.kind === 'course-v9') for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i], target = finalTargets[i]
        if (target.kind !== 'course-object' || !['native.insert', 'object.update', 'text.replace'].includes(mutation.name)) continue
        try {
          const layer = target.stateId ? { item: layerToolContext(model.project, target).entry.item } : locateCourseLayer(model.project, target.itemId)
          if (!layer || layer.item.kind !== 'native' || layer.item.content.nativeType !== 'text') continue
          const { frame } = layer.item, { style } = layer.item.content.data
          if (style.overflow === 'shrink' && frame.height - 2 * style.padding < style.fontSize) {
            advisories.push({ step: i, code: 'native-text-shrink', message: `文字框可用高度 ${Math.max(0, frame.height - 2 * style.padding)}px 小于设定字号 ${style.fontSize}px；shrink 可能把字缩小，请增高文字框或减小 padding。` })
          }
          const suppliedBackgroundColor = mutation.name === 'native.insert'
            ? mutation.input.template.nativeType === 'text' && mutation.input.template.style?.backgroundColor !== undefined
            : mutation.name === 'object.update' && mutation.input.properties.nativeTextStyle?.backgroundColor !== undefined
          if (suppliedBackgroundColor && style.backgroundOpacity === 0) {
            advisories.push({ step: i, code: 'native-text-transparent-background', message: '已设置文字背景色，但 backgroundOpacity 为 0，底色仍透明；需要可见底色时请同时设置非零不透明度。' })
          }
          const source = locateCourseLayer(model.project, target.itemId)
          const location = model.project.locations.find(value => value.id === target.locationId)
          if (source?.source === 'scene' && location?.kind === 'slide-scene'
            && style.backgroundOpacity === 0
            && !layer.item.content.data.runs.some(run => run.style.color !== undefined)) {
            const composition = layerToolContext(model.project, target).composition
            const background = composition.background
            const textBounds = rotatedRectangleAabb({ ...layer.item.frame, rotation: layer.item.rotation })
            // A flat scene background is only the known pixel source when no other
            // mounted layer could occupy this text frame in the exact state.
            const overlappingLayer = composition.entries.some(entry => {
              if (!entry.mounted || entry.item.opacity === 0 || entry.item.layerItemId === target.itemId) return false
              const bounds = rotatedRectangleAabb({ ...entry.item.frame, rotation: entry.item.rotation })
              return bounds.left < textBounds.right && textBounds.left < bounds.right
                && bounds.top < textBounds.bottom && textBounds.top < bounds.bottom
            })
            if (background?.assetId === null && !overlappingLayer) {
              const ratio = textContrastRatio(style.color, background.color)
              const minimum = style.fontSize >= 24 || style.bold && style.fontSize >= 19 ? 3 : 4.5
              if (ratio < minimum) advisories.push({ step: i, code: 'native-text-low-contrast',
                message: `文字颜色 ${style.color} 与场景背景 ${background.color} 的对比度约 ${ratio.toFixed(2)}:1；文字框底色透明。请改用更清晰的文字颜色，或设置可见底色，并检查实际画面。` })
            }
          }
        } catch { /* A later batch step may have removed or replaced the object. */ }
      }
    }
    return { kind: 'document-operation', result, affected, ...(advisories.length ? { advisories } : {}) }
  }

  private async patchObject(model: DocumentModel, driver: DocumentDriver, target: Extract<ToolTarget, { kind: 'course-object' }>, patch: EffectiveLayerPropertyPatch): Promise<DocumentModel> {
    if (!target.stateId) return driver.apply(model, { type: 'course.object.patch', locationId: target.locationId, itemId: target.itemId, patch: { ...patch } })
    if (model.kind !== 'course-v9') throw new Error('命名态属性需要 V9 文档')
    const context = layerToolContext(model.project, target)
    // Exact shared auto-size decision; absent host measurement is a clear failure when required.
    const measureTextFrame = this.options.measureNativeTextAsync || !this.options.measureNativeText
      ? await prepareNativeTextFrame(context.entry.item, patch, this.options.measureNativeTextAsync)
      : (() => { const measured = nativeLayerTextAutoSizeFrame(context.entry.item, patch, this.options.measureNativeText); return () => measured })()
    const planned = patchEffectiveLayerPropertiesAtTarget(model.project, context.command, patch, { expectedRevision: model.project.revision, measureTextFrame })
    if (!planned.ok || !planned.nextDocument) throw new Error(planned.reason ?? '无法修改命名态属性')
    return driver.apply(model, { type: 'course.replace', project: { ...planned.nextDocument, revision: model.project.revision, updatedAt: model.project.updatedAt } })
  }

  private async read(runId: string, method: string, input: { target: string; cursor?: string; limit?: number }): Promise<ToolResult> {
    const handle = this.handle(runId, input.target)
    const snapshot = await this.registry.get(handle.documentId).drain()
    const target = this.resolve(handle, snapshot, false)
    const current = readTarget(snapshot.model, target)
    if (method === 'inspect') {
      const refreshed = this.refreshReadHandle(handle, snapshot, target)
      const refreshedHandle = this.handle(runId, refreshed)
      const advertised = this.run(runId).advertised
      const candidates = advertised?.definitions ?? toolCatalog.filter(tool => this.hostTools.supports(tool.name))
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
      if (!cursor || cursor.runId !== runId || cursor.handle !== input.target || cursor.method !== method || cursor.digest !== digest) throw new ToolError('stale-cursor', '分页内容已改变，请从首页重新读取')
      offset = cursor.offset
    }
    const refreshed = this.refreshReadHandle(handle, snapshot, target)
    const refreshedHandle = this.handle(runId, refreshed)
    const limit = method === 'listChildren' ? input.limit ?? 25 : (input.limit ?? 25) * 100
    const end = Math.min(offset + limit, content.length)
    let data: unknown
    if (typeof content === 'string') data = { target: refreshed, text: content.slice(offset, end), offset, total: content.length, truncated: end < content.length }
    else data = content.slice(offset, end).map(child => {
      const writable = !handle.readOnly && (refreshedHandle.writable && containsTarget(target, child.target)
        || this.canWrite(this.run(runId), snapshot, child.target))
      return { target: this.capture(runId, snapshot, child.target, writable, handle.readOnly), label: child.label, kind: child.target.kind }
    })
    if (end < content.length) {
      const nextCursor = `c${this.createId()}`
      this.cursors.set(nextCursor, { runId, handle: input.target, method, digest, offset: end })
      return { kind: 'read', data, nextCursor }
    }
    return { kind: 'read', data }
  }
}
