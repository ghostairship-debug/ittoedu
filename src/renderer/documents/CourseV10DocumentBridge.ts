import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'
import type { DocumentModel, DocumentOperationResult, DocumentResources, DocumentSnapshot } from '../../shared/workbench/document'
import { componentSurface, componentContainers, resolveComponentPresentation, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { CourseV10Driver } from '../../core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../core/course/createCourseProjectV10'
import { DocumentAckUnknownError, DocumentBlockedInputError, DocumentProjection, type DocumentInputOperationResolution } from './DocumentProjection'
import { captureComponentOperation, presentationComponentEdits, equalComponentValue, componentValueAt } from '../../core/drivers/courseV10Operations'
import type { ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import { containerEditingPath, normalizeEditingContext } from './containerEditingContext'
import { authorFieldFromSpot, interactionInstanceIds, interactionSelectionIdentity, type CourseInteractionSelection } from './interactionSelection'
import type { ComponentAuthorSpot } from '../../shared/contracts/component-platform/runtime'

export interface CapturedCourseTarget {
  readonly documentId: string
  readonly epoch: string
  readonly project: CourseProjectV10
  readonly resources: DocumentResources
  readonly editingProject: CourseProjectV10
  readonly activeStateId: string | null
  readonly surfaceId: string | null
  readonly rootInstanceId?: string | null
  readonly editingContainerId?: string | null
  readonly editingPlane?: 'underlay' | 'overlay'
  readonly instanceIds: readonly string[]
  readonly instanceId: string | null
  readonly activation?: number
  readonly selectionIdentity?: string
}

/** Foreground qualification is primitive view state, never a retained model. */
export type CapturedCourseViewScope = Pick<CapturedCourseTarget,
  'documentId' | 'epoch' | 'surfaceId' | 'activeStateId' | 'activation' | 'selectionIdentity' | 'instanceIds'
  | 'rootInstanceId' | 'editingContainerId' | 'editingPlane'>

export interface CapturedComponentOperation extends ComponentOperationBatch {
  readonly documentId: string
  readonly epoch: string
}

export type CourseComponentInputResolution = 'ready' | 'applied' | 'pending'
type CourseComponentInputResolver = (action: 'retry' | 'cancel') => Promise<CourseComponentInputResolution>

/** Runtime-only capability for the exact operation owned by a retained input. */
export interface CourseComponentInputFailure extends Error {
  readonly operationId: string
  resolveInput: CourseComponentInputResolver
}

export class CourseComponentApplyError extends Error {
  constructor(message: string, readonly operationId: string, readonly resolveInput?: CourseComponentInputResolver) { super(message) }
}

export class CourseComponentUnknownError extends Error implements CourseComponentInputFailure {
  constructor(message: string, readonly operationId: string, readonly resolveInput: CourseComponentInputResolver) { super(message) }
}

export class CourseComponentBlockedError extends Error implements CourseComponentInputFailure {
  constructor(message: string, readonly operationId: string, readonly resolveInput: CourseComponentInputResolver) { super(message) }
}

export function isCourseComponentInputFailure(value: unknown): value is CourseComponentInputFailure {
  return (value instanceof CourseComponentApplyError || value instanceof CourseComponentUnknownError || value instanceof CourseComponentBlockedError)
    && typeof value.resolveInput === 'function'
}

/** The caller already owns the raw input (or has reverted its gesture preview).
 * End only this proposal. Unknown results still use the original receipt and may
 * remain pending; a non-input error says nothing about another pending proposal. */
export async function settleCourseComponentInput(error: unknown): Promise<CourseComponentInputResolution> {
  return isCourseComponentInputFailure(error) ? error.resolveInput('cancel') : 'ready'
}

export interface CourseAgentUndoTarget {
  readonly documentId: string
  readonly epoch: string
  readonly expectedTopOperationId: string
  readonly projection: DocumentProjection
  readonly navigation: number
}

/** Read/settle identity for an input whose original control may no longer exist. */
export interface CourseUnconfirmedInputIdentity {
  readonly documentId: string
  readonly epoch: string
  readonly operationId: string
}

/** Renderer foreground fact only; the Main document was already created/opened. */
export interface CourseDocumentActivationResult {
  readonly documentId: string
  readonly activated: boolean
}

export interface CourseV10ViewState {
  documents: readonly DocumentSnapshot[]
  snapshot: DocumentSnapshot | null
  project: CourseProjectV10 | null
  editingProject: CourseProjectV10 | null
  activeStateId: string | null
  /** Conflict drafts are recovery input; only this model may feed runtime. */
  runtimeProject: CourseProjectV10 | null
  views: readonly { documentId: string; model: Extract<DocumentModel, { kind: 'course-v10' }>; surfaceId: string | null; rootInstanceId?: string | null; editingContainerId?: string | null; editingPlane?: 'underlay' | 'overlay'; presentationStates?: Readonly<Record<string, string | null>>; activeStateId: string | null; selectedInstanceIds: readonly string[]; selectedInstanceId: string | null }[]
  activeDocumentId: string | null
  activation: number
  selectedInstanceId: string | null
  selectedInstanceIds: readonly string[]
  /** Precise author intent; instance IDs above are its compatibility projection. */
  interactionSelection?: CourseInteractionSelection | null
  surfaceId: string | null
  rootInstanceId?: string | null
  editingContainerId?: string | null
  editingPlane?: 'underlay' | 'overlay'
  editingPath?: readonly string[]
  presentationStates?: Readonly<Record<string, string | null>>
  pending: number
  error: string | null
}

export function capturedCourseViewIsCurrent(view: CourseV10ViewState, target: CapturedCourseViewScope): boolean {
  return view.activeDocumentId === target.documentId && view.snapshot?.epoch === target.epoch
    && view.surfaceId === target.surfaceId && view.activeStateId === target.activeStateId
    && (target.activation === undefined || target.activation === view.activation)
    && (!('rootInstanceId' in target) || target.rootInstanceId === view.rootInstanceId)
    && (!('editingContainerId' in target) || target.editingContainerId === view.editingContainerId)
    && (!('editingPlane' in target) || target.editingPlane === view.editingPlane)
    && (target.selectionIdentity === undefined || target.selectionIdentity === interactionSelectionIdentity(view.interactionSelection))
    && view.selectedInstanceIds.length === target.instanceIds.length
    && view.selectedInstanceIds.every((id, index) => id === target.instanceIds[index])
}

/** View states are scoped by their owning container and never saved into the author project. */
export function projectContainerPresentationStates(project: CourseProjectV10, states: Readonly<Record<string, string | null>>): CourseProjectV10 {
  if (!Object.values(states).some(Boolean)) return project
  const depth = (id: string) => {
    for (const root of project.rootIds) {
      const path = containerEditingPath(project, root, id)
      if (path) return path.length
    }
    return 0
  }
  return componentContainers(project).filter(surface => states[surface.id])
    .sort((a, b) => depth(a.id) - depth(b.id))
    .reduce((projection, surface) => resolveComponentPresentation(projection, surface.id, states[surface.id] ?? null), project)
}

/** V10 domain binding and transient selection. Session and Projection retain their existing owners. */
export class CourseV10DocumentBridge {
  private api?: DocumentHostAPI
  private readonly projections = new Map<string, DocumentProjection>()
  private readonly attaching = new Map<string, Promise<DocumentProjection>>()
  private readonly projectionStops = new Map<string, () => void>()
  private readonly listeners = new Set<() => void>()
  private readonly selections = new Map<string, { target: CourseInteractionSelection | null; surfaceId: string | null; rootInstanceId: string | null; editingContainerId: string | null; editingPlane?: 'underlay' | 'overlay'; path: readonly string[]; presentationStates: Record<string, string | null> }>()
  private navigation = 0
  private connected = false
  private connecting?: Promise<void>
  private stopEvents?: () => void
  private state: CourseV10ViewState = { documents: [], snapshot: null, project: null, editingProject: null, activeStateId: null, runtimeProject: null, views: [], activeDocumentId: null,
    activation: 0, selectedInstanceIds: [], selectedInstanceId: null, surfaceId: null, rootInstanceId: null, editingContainerId: null, editingPath: [], presentationStates: {}, pending: 0, error: null }

  read = (): CourseV10ViewState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Selection does not change document content, resource identity or another tab's projection. */
  private publishSelection(documentId: string): void {
    const selected = this.selections.get(documentId)
    if (!selected) return
    const ids = interactionInstanceIds(selected.target)
    const update = { selectedInstanceIds: ids, selectedInstanceId: ids[0] ?? null, surfaceId: selected.surfaceId,
      rootInstanceId: selected.rootInstanceId, editingContainerId: selected.editingContainerId, editingPlane: selected.editingPlane,
      presentationStates: selected.presentationStates, activeStateId: selected.presentationStates[selected.surfaceId ?? ''] ?? null }
    this.state = { ...this.state, views: this.state.views.map(view => view.documentId === documentId ? { ...view, ...update } : view),
      ...(this.state.activeDocumentId === documentId ? { ...update, interactionSelection: selected.target, editingPath: selected.path,
        editingProject: this.state.project ? projectContainerPresentationStates(this.state.project, selected.presentationStates) : null } : {}) }
    for (const listener of this.listeners) listener()
  }
  private publish(patch: Partial<CourseV10ViewState> = {}): void {
    for (const [documentId, projection] of this.projections) {
      const view = projection.read(), model = view.draft ?? view.committed?.model
      if (model?.kind !== 'course-v10') continue
      const old = this.selections.get(documentId)
      const context = normalizeEditingContext(model.project, old?.rootInstanceId, old?.editingContainerId, old?.path)
      if (old) for (const [id, stateId] of Object.entries(old.presentationStates)) {
        if (stateId && !componentSurface(model.project, id)?.presentation?.states.some(state => state.id === stateId)) old.presentationStates[id] = null
      }
      const previousIds = interactionInstanceIds(old?.target)
      const instanceIds = previousIds.filter(id => Boolean(model.project.instances[id]))
      if (!old || old.surfaceId !== context.surfaceId || old.rootInstanceId !== context.rootInstanceId
        || old.editingContainerId !== context.editingContainerId || old.editingPlane !== context.editingPlane || instanceIds.length !== previousIds.length
        || old.path.length !== context.path.length || old.path.some((id, index) => id !== context.path[index])) {
        this.selections.set(documentId, { ...context, target: instanceIds.length === previousIds.length ? old?.target ?? null
          : old?.target?.kind === 'objects' && instanceIds.length ? { kind: 'objects', instanceIds } : null,
          presentationStates: old?.presentationStates ?? {} })
      }
    }
    const active = this.projections.get(patch.activeDocumentId ?? this.state.activeDocumentId ?? '')?.read()
    const model = active?.draft ?? active?.committed?.model
    const runtimeModel = active?.retainedDraftOnly ? active.committed?.model : model
    const selection = this.selections.get(patch.activeDocumentId ?? this.state.activeDocumentId ?? '')
    this.state = { ...this.state, ...patch,
      documents: [...this.projections.values()].flatMap(projection => {
        const view = projection.read()
        return view.committed ? [{ ...view.committed, dirty: view.committed.dirty || !projection.canRelease() }] : []
      }), snapshot: active?.committed ?? null,
      views: [...this.projections.values()].flatMap(projection => {
        const view = projection.read()
        const model = view.retainedDraftOnly ? view.committed?.model : view.draft ?? view.committed?.model
        const selection = this.selections.get(projection.documentId)
        return model?.kind === 'course-v10' ? [{ documentId: projection.documentId, model,
          selectedInstanceIds: interactionInstanceIds(selection?.target), selectedInstanceId: interactionInstanceIds(selection?.target)[0] ?? null,
          activeStateId: selection?.presentationStates[selection.surfaceId ?? ''] ?? null,
          surfaceId: selection?.surfaceId ?? null, rootInstanceId: selection?.rootInstanceId ?? null,
          editingContainerId: selection?.editingContainerId ?? null, editingPlane: selection?.editingPlane, presentationStates: selection?.presentationStates ?? {} }] : []
      }),
      project: model?.kind === 'course-v10' ? model.project : null,
      activeStateId: selection?.presentationStates[selection.surfaceId ?? ''] ?? null,
      editingProject: model?.kind === 'course-v10' ? projectContainerPresentationStates(model.project, selection?.presentationStates ?? {}) : null,
      runtimeProject: runtimeModel?.kind === 'course-v10' ? runtimeModel.project : null,
      selectedInstanceIds: interactionInstanceIds(selection?.target), selectedInstanceId: interactionInstanceIds(selection?.target)[0] ?? null,
      interactionSelection: selection?.target ?? null,
      surfaceId: selection?.surfaceId ?? null, rootInstanceId: selection?.rootInstanceId ?? null,
      editingContainerId: selection?.editingContainerId ?? null, editingPlane: selection?.editingPlane, editingPath: selection?.path ?? [],
      presentationStates: selection?.presentationStates ?? {},
      pending: (active?.pending.length ?? 0) + Number(Boolean(active?.composing || active?.retainedComposition)), error: active?.error?.message ?? null }
    for (const listener of this.listeners) listener()
  }

  connect(api: DocumentHostAPI, onAccepted?: () => void): Promise<void> {
    if (this.api === api) {
      onAccepted?.()
      if (this.connecting) return this.connecting
      if (this.connected) return Promise.resolve()
    }
    if (this.api && this.api !== api) {
      if ([...this.projections.values()].some(projection => !projection.canRelease()))
        return Promise.reject(new Error('文档仍有未确认输入，已保留原连接与输入'))
      this.dispose()
    }
    this.api = api
    onAccepted?.()
    this.stopEvents = api.subscribe(event => {
      if (event.type === 'closed' && this.projections.get(event.documentId)?.read().committed?.epoch === event.epoch)
        queueMicrotask(() => { if (this.api === api) this.detachClosed(event.documentId) })
    })
    const navigation = ++this.navigation
    // Connecting the workbench must not create a user document. An explicit
    // New/Open action (including an AI file.create) owns course creation.
    const pending = api.list().then(async documents => {
      if (api === this.api) this.connected = true
      const snapshot = documents.find(document => document.model.kind === 'course-v10')
      if (snapshot && api === this.api && navigation === this.navigation) await this.activate(snapshot.documentId)
    }).finally(() => { if (this.connecting === pending) this.connecting = undefined })
    this.connecting = pending
    return pending
  }
  private host(): DocumentHostAPI { if (!this.api) throw new Error('课件文档服务尚未连接'); return this.api }
  private projection(documentId = this.state.activeDocumentId ?? ''): DocumentProjection {
    const value = this.projections.get(documentId)
    if (!value) throw new Error('课件文档尚未打开')
    return value
  }
  captureUnconfirmedInput(documentId = this.state.activeDocumentId ?? ''): CourseUnconfirmedInputIdentity | null {
    const view = this.projections.get(documentId)?.read(), operationId = view?.error?.operationId, epoch = view?.committed?.epoch
    return operationId && epoch ? Object.freeze({ documentId, epoch, operationId }) : null
  }
  private unconfirmedInputProjection(target: CourseUnconfirmedInputIdentity): DocumentProjection {
    const projection = this.projections.get(target.documentId)
    if (!projection || projection.read().committed?.epoch !== target.epoch) throw new Error('原输入的文档会话已改变，请重新核实当前文档')
    return projection
  }
  /** This is a query of the original receipt, never a replay or a new proposal. */
  async queryUnconfirmedInput(target: CourseUnconfirmedInputIdentity): Promise<DocumentInputOperationResolution> {
    const projection = this.unconfirmedInputProjection(target)
    const outcome = await projection.queryInputResolution(target.operationId, { refresh: false })
    if (this.unconfirmedInputProjection(target) !== projection) throw new Error('核实输入期间文档连接已改变')
    return outcome
  }
  /** The explicit caller has preserved raw input before ending this exact
   * unapplied proposal. Pending/unknown and every other input keep their owners. */
  async endUnconfirmedInput(target: CourseUnconfirmedInputIdentity): Promise<CourseComponentInputResolution> {
    const projection = this.unconfirmedInputProjection(target), outcome = await this.queryUnconfirmedInput(target)
    if (outcome.status === 'pending' || outcome.status === 'missing') return 'pending'
    if (outcome.status === 'settled' && 'revision' in outcome.result) return 'applied'
    if (this.unconfirmedInputProjection(target) !== projection) throw new Error('核实输入期间文档连接已改变')
    if (outcome.status === 'unsubmitted') await projection.releaseUnsubmittedOperation(target.operationId)
    else await projection.releaseRejectedOperation(target.operationId)
    return 'ready'
  }
  async activate(documentId: string, activateIf?: () => boolean): Promise<boolean> {
    const navigation = ++this.navigation
    return this.activateAtNavigation(documentId, navigation, activateIf)
  }
  captureViewScope(): () => boolean {
    const documentId = this.state.activeDocumentId
    if (!documentId) return () => true
    const { epoch, surfaceId, activeStateId, activation, selectionIdentity, instanceIds, rootInstanceId,
      editingContainerId, editingPlane } = this.captureOwnedTarget(documentId)
    const scope: CapturedCourseViewScope = { documentId, epoch, surfaceId, activeStateId, activation, selectionIdentity,
      instanceIds, rootInstanceId, editingContainerId, editingPlane }
    return () => capturedCourseViewIsCurrent(this.state, scope)
  }
  private async activateAtNavigation(documentId: string, navigation: number, activateIf?: () => boolean): Promise<boolean> {
    let projection = this.projections.get(documentId)
    if (!projection) {
      let pending = this.attaching.get(documentId)
      if (!pending) {
        const api = this.host()
        pending = DocumentProjection.attach(api, documentId, new CourseV10Driver()).then(value => {
          if (api !== this.api) { value.dispose(); throw new Error('文档视图已关闭') }
          if (value.read().committed?.model.kind !== 'course-v10') { value.dispose(); throw new Error('此视图只支持 Project V10') }
          this.projections.set(documentId, value)
          this.projectionStops.set(documentId, value.subscribe(() => this.publish()))
          return value
        }).finally(() => { if (this.attaching.get(documentId) === pending) this.attaching.delete(documentId) })
        this.attaching.set(documentId, pending)
      }
      projection = await pending
    }
    // Creation/opening owns its Main result, but the user still owns foreground
    // navigation while it and this attachment are in flight.
    if (navigation !== this.navigation || activateIf?.() === false) {
      this.publish(); return false
    }
    this.publish({ activeDocumentId: projection.documentId, activation: this.state.activation + 1 })
    return true
  }
  async create(model: Extract<DocumentModel, { kind: 'course-v10' }> = {
    kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} },
  }, activateIf?: () => boolean): Promise<CourseDocumentActivationResult> {
    const host = this.host(), navigation = ++this.navigation, scopeIsCurrent = this.captureViewScope()
    const snapshot = await host.create(model, `${model.project.title}.glx`)
    const activated = host === this.api && await this.activateAtNavigation(snapshot.documentId, navigation, () => scopeIsCurrent() && activateIf?.() !== false)
    return { documentId: snapshot.documentId, activated }
  }
  async open(path: string, activateIf?: () => boolean): Promise<CourseDocumentActivationResult> {
    const host = this.host(), navigation = ++this.navigation, scopeIsCurrent = this.captureViewScope()
    const snapshot = await host.open(path)
    const activated = host === this.api && await this.activateAtNavigation(snapshot.documentId, navigation, () => scopeIsCurrent() && activateIf?.() !== false)
    return { documentId: snapshot.documentId, activated }
  }
  async edit(edits: ComponentEdit[], historyGroup?: string, documentId?: string) {
    return this.editCaptured(this.capture(edits, this.captureOwnedTarget(documentId)), historyGroup)
  }
  captureTarget(documentId = this.state.activeDocumentId ?? '', committed = false): CapturedCourseTarget {
    const target = this.captureOwnedTarget(documentId, committed), project = structuredClone(target.project)
    const selection = this.selections.get(documentId)
    return { ...target, project, resources: structuredClone(target.resources),
      editingProject: projectContainerPresentationStates(project, selection?.presentationStates ?? {}) }
  }
  /** Internal authoring reads only. Models are immutable projection facts; command
   * capture still detaches every actual read value and proposed edit. */
  captureOwnedTarget(documentId = this.state.activeDocumentId ?? '', committed = false): CapturedCourseTarget {
    const view = this.projection(documentId).read(), model = committed ? view.committed?.model : view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') throw new Error('课件文档尚未打开')
    const selection = this.selections.get(documentId)
    const project = model.project
    const surfaceId = selection?.surfaceId ?? null
    const activeStateId = selection?.presentationStates[surfaceId ?? ''] ?? null
    return { documentId, epoch: view.committed!.epoch, activation: this.state.activation, project, resources: model.resources,
      editingProject: this.state.activeDocumentId === documentId && this.state.project === project
        ? this.state.editingProject ?? project : projectContainerPresentationStates(project, selection?.presentationStates ?? {}), activeStateId, surfaceId,
      rootInstanceId: selection?.rootInstanceId ?? null, editingContainerId: selection?.editingContainerId ?? null,
      editingPlane: selection?.editingPlane,
      instanceIds: [...interactionInstanceIds(selection?.target)], instanceId: interactionInstanceIds(selection?.target)[0] ?? null,
      selectionIdentity: interactionSelectionIdentity(selection?.target) }
  }
  capture(edits: ComponentEdit[], target = this.captureOwnedTarget(), readPaths: readonly string[][] = []): CapturedComponentOperation {
    const mapped = presentationComponentEdits(target.project, target.surfaceId, target.activeStateId, edits)
    const command = captureComponentOperation(target.project, mapped, readPaths)
    if (mapped !== edits) {
      const original = captureComponentOperation(target.project, edits, readPaths)
      command.expected = [...new Map([...command.expected, ...original.expected].map(value => [JSON.stringify(value.path), value])).values()]
    }
    return { ...command, documentId: target.documentId, epoch: target.epoch }
  }
  async editCaptured(captured: CapturedComponentOperation, historyGroup?: string) {
    const { documentId, epoch, ...command } = captured
    const projection = this.projection(documentId)
    if (projection.read().committed?.epoch !== epoch) throw new Error('捕获的文档会话已关闭，请重新开始编辑')
    if (projection.read().error?.kind === 'disconnected' && !projection.read().pending.length)
      await projection.recoverConnectionIfIdle()
    // Existing failures must be resolved by their input owners before another proposal is queued.
    if (projection.read().error) throw new Error(projection.read().error!.message)
    let result: DocumentOperationResult
    try { result = await projection.edit(command, { historyGroup }) }
    catch (error) {
      if (error instanceof DocumentAckUnknownError) throw new CourseComponentUnknownError(error.message, error.operationId,
        this.inputResolution(captured, projection, error.operationId, 'unknown'))
      if (error instanceof DocumentBlockedInputError) throw new CourseComponentBlockedError(error.message, error.operationId,
        this.inputResolution(captured, projection, error.operationId, 'unsubmitted'))
      throw error
    }
    if (!('revision' in result)) throw new CourseComponentApplyError(result.message, result.operationId,
      this.inputResolution(captured, projection, result.operationId, 'rejected'))
    return result
  }
  private inputResolution(captured: CapturedComponentOperation, projection: DocumentProjection, operationId: string,
    initialOutcome: 'rejected' | 'unknown' | 'unsubmitted'): CourseComponentInputResolver {
    const { documentId, epoch } = captured, expected = structuredClone(captured.expected)
    let rejected = initialOutcome === 'rejected', unsubmitted = initialOutcome === 'unsubmitted', applied = false
    let pending: Promise<CourseComponentInputResolution> | undefined
    const assertCurrent = () => {
      if (this.projections.get(documentId) !== projection || projection.read().committed?.epoch !== epoch)
        throw new Error('原输入的文档会话已改变，请重新核实草稿')
    }
    const assertExpected = () => {
      const model = projection.read().committed?.model
      if (model?.kind !== 'course-v10') throw new Error('原输入的课件文档已不可用')
      for (const field of expected) {
        const current = componentValueAt(model.project, field.path)
        if (current.exists !== field.exists || current.exists && !equalComponentValue(current.value, field.value))
          throw new Error('原属性已在其他位置改变，请按 Esc 放弃旧草稿后重新编辑')
      }
    }
    const resolve = async (action: 'retry' | 'cancel'): Promise<CourseComponentInputResolution> => {
      assertCurrent()
      // A definite refusal or an envelope never sent to Main needs no extra
      // read merely to stop owning it. Retrying still reads and checks the target.
      if (action === 'cancel' && (rejected || unsubmitted)) {
        if (unsubmitted) await projection.releaseUnsubmittedOperation(operationId)
        else await projection.releaseRejectedOperation(operationId)
        assertCurrent()
        return 'ready'
      }
      const outcome = await projection.queryInputResolution(operationId)
      assertCurrent()
      if (outcome.status === 'pending') return 'pending'
      if (outcome.status === 'unsubmitted') { unsubmitted = true; rejected = false }
      if (outcome.status === 'settled') {
        if ('revision' in outcome.result) applied = true
        else { rejected = true; unsubmitted = false }
      }
      if (applied) return 'applied'
      if (!rejected && !unsubmitted) return 'pending'
      if (action === 'retry') assertExpected()
      if (unsubmitted) await projection.releaseUnsubmittedOperation(operationId)
      else await projection.releaseRejectedOperation(operationId)
      assertCurrent()
      if (action === 'retry') {
        assertExpected()
        const view = projection.read()
        if (view.pending.length || view.composing || view.retainedComposition)
          throw new Error('其他未确认输入仍保留，请先处理后再重试此属性')
        if (!view.connected || view.error) throw new Error(view.error?.message ?? '文档尚未重新连接，请保留草稿后重试')
      }
      return 'ready'
    }
    return action => {
      if (pending) return pending
      const current = resolve(action).finally(() => { if (pending === current) pending = undefined })
      pending = current
      return current
    }
  }
  async releaseRejectedSourceOperation(documentId: string, epoch: string, operationId: string): Promise<void> {
    const projection = this.projection(documentId)
    if (projection.read().committed?.epoch !== epoch) throw new Error('捕获的文档会话已关闭，请重新开始编辑')
    await projection.releaseRejectedOperation(operationId)
  }
  async undo(documentId?: string): Promise<void> { const result = await this.projection(documentId).undo(); if (!('revision' in result)) throw new Error(result.message) }
  async redo(documentId?: string): Promise<void> { const result = await this.projection(documentId).redo(); if (!('revision' in result)) throw new Error(result.message) }
  beginComposition(instanceId: string, path: string[], documentId?: string): void { this.projection(documentId).beginComposition(instanceId, path) }
  updateComposition(value: import('../../shared/contracts/component-platform/project').JsonValue, documentId?: string): Promise<void> { return this.projection(documentId).updateComposition(value) }
  endComposition(documentId?: string): Promise<void> { return this.projection(documentId).endComposition() }
  discardDraft(): void { this.projection().discardDraft() }
  suspendForClose(documentIds: readonly string[]): void {
    for (const id of documentIds) this.projections.get(id)?.suspendForClose()
  }
  resumeAfterCloseCancelled(documentIds: readonly string[]): void {
    for (const id of documentIds) this.projections.get(id)?.resumeAfterCloseCancelled()
  }
  async drain(documentIds?: readonly string[]): Promise<DocumentSnapshot[]> {
    const snapshots: DocumentSnapshot[] = []
    for (const [id, projection] of this.projections) if (!documentIds || documentIds.includes(id)) snapshots.push(await projection.drain())
    return snapshots
  }
  async flushInput(documentIds?: readonly string[]): Promise<void> {
    for (const [id, projection] of this.projections) if (!documentIds || documentIds.includes(id)) await projection.flushInput()
  }
  async save(saveAs = false, directory?: SaveDirectoryContext, documentId?: string): Promise<boolean> {
    const projection = this.projection(documentId)
    await projection.drain()
    const saved = await this.host().saveWithDialog(projection.documentId, saveAs, directory)
    if (!saved) return false
    await projection.reattach()
    this.publish()
    return true
  }
  async close(documentId: string): Promise<boolean> {
    const projection = this.projections.get(documentId)
    if (!projection) return true
    if (!await this.host().closeWithDialog(documentId)) return false
    return this.detachClosed(documentId)
  }
  private detachClosed(documentId: string): boolean {
    const projection = this.projections.get(documentId)
    if (!projection) return true
    // Projection deliberately retains input after an unexpected formal close.
    // Keep that recovery view and its original epoch instead of losing it here.
    if (!projection.canRelease()) { this.publish(); return false }
    this.projectionStops.get(documentId)?.(); this.projectionStops.delete(documentId)
    projection.dispose(); this.projections.delete(documentId); this.selections.delete(documentId)
    if (this.state.activeDocumentId === documentId) {
      const next = [...this.projections.keys()].at(-1)
      if (next) this.publish({ activeDocumentId: next, activation: this.state.activation + 1 })
      else { this.state = { ...this.state, activeDocumentId: null }; this.publish() }
    } else this.publish()
    return true
  }
  select(instanceId: string | null, surfaceId = this.state.surfaceId): void {
    if (this.state.activeDocumentId) this.selectInstances(this.state.activeDocumentId, instanceId ? [instanceId] : [], surfaceId)
  }
  selectSurface(documentId: string, surfaceId: string): void {
    const view = this.projections.get(documentId)?.read(), model = view?.draft ?? view?.committed?.model
    if (model?.kind !== 'course-v10' || !model.project.rootIds.includes(surfaceId)) return
    const context = normalizeEditingContext(model.project, surfaceId)
    this.selections.set(documentId, { ...context, target: null, presentationStates: this.selections.get(documentId)?.presentationStates ?? {} }); this.publishSelection(documentId)
  }
  selectInstance(documentId: string, instanceId: string | null): void {
    this.selectInstances(documentId, instanceId ? [instanceId] : [])
  }
  selectInstances(documentId: string, instanceIds: readonly string[], surfaceId?: string | null): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const ids = [...new Set(instanceIds)].filter(id => Boolean(model.project.instances[id]))
    const old = this.selections.get(documentId)
    const context = surfaceId && model.project.rootIds.includes(surfaceId)
      ? normalizeEditingContext(model.project, surfaceId)
      : normalizeEditingContext(model.project, old?.rootInstanceId, surfaceId ?? old?.editingContainerId, old?.path)
    const target: CourseInteractionSelection | null = ids.length ? { kind: 'objects', instanceIds: ids } : null
    if (old && old.surfaceId === context.surfaceId && old.rootInstanceId === context.rootInstanceId
      && old.editingContainerId === context.editingContainerId && old.editingPlane === context.editingPlane
      && interactionSelectionIdentity(old.target) === interactionSelectionIdentity(target)) return
    this.selections.set(documentId, { ...context, target, presentationStates: old?.presentationStates ?? {} })
    this.publishSelection(documentId)
  }
  selectInteraction(documentId: string, target: CourseInteractionSelection | null, surfaceId?: string | null): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    if (target && interactionInstanceIds(target).some(id => !model.project.instances[id])) return
    const old = this.selections.get(documentId)
    const context = surfaceId && model.project.rootIds.includes(surfaceId) ? normalizeEditingContext(model.project, surfaceId)
      : normalizeEditingContext(model.project, old?.rootInstanceId, surfaceId ?? old?.editingContainerId, old?.path)
    if (old && old.surfaceId === context.surfaceId && old.editingContainerId === context.editingContainerId
      && old.rootInstanceId === context.rootInstanceId && interactionSelectionIdentity(old.target) === interactionSelectionIdentity(target)
      && (old.target?.kind !== 'author-field' || target?.kind !== 'author-field' || equalComponentValue(old.target.field, target.field))) return
    this.selections.set(documentId, { ...context, target, presentationStates: old?.presentationStates ?? {} })
    this.publishSelection(documentId)
  }
  selectAuthorSpot(documentId: string, spot: ComponentAuthorSpot, surfaceId?: string | null): void {
    this.selectInteraction(documentId, { kind: 'author-field', instanceId: spot.instanceId, field: authorFieldFromSpot(spot) }, surfaceId)
  }
  selectPresentationState(documentId: string, stateId: string | null, surfaceId?: string): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const old = this.selections.get(documentId), id = surfaceId ?? old?.surfaceId
    const surface = id ? componentSurface(model.project, id) : undefined
    if (!surface || surface.kind !== 'slide') throw new Error('场景状态仅适用于演示页面；流式页面使用章节标题，空间页面使用镜头')
    if (stateId && !surface.presentation?.states.some(state => state.id === stateId)) throw new Error('展示状态已不存在')
    const context = model.project.rootIds.includes(surface.id) && old?.rootInstanceId !== surface.id
      ? normalizeEditingContext(model.project, surface.id)
      : normalizeEditingContext(model.project, old?.rootInstanceId, old?.editingContainerId, old?.path)
    if (!context.rootInstanceId || !containerEditingPath(model.project, context.rootInstanceId, surface.id)) throw new Error('展示状态不属于当前作品范围')
    this.selections.set(documentId, { ...context, target: old?.target ?? null,
      presentationStates: { ...old?.presentationStates, [surface.id]: stateId } })
    this.publish()
  }
  /** Author inspection changes the editing scope, never the work's navigation root. */
  enterContainer(documentId: string, containerId: string): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const old = this.selections.get(documentId)
    const context = normalizeEditingContext(model.project, old?.rootInstanceId, containerId, old?.path)
    if (context.surfaceId !== containerId) throw new Error('容器不属于当前作品范围')
    this.selections.set(documentId, { ...context, target: null, presentationStates: old?.presentationStates ?? {} })
    this.publish({ activation: this.state.activation + 1 })
  }
  leaveContainer(documentId = this.state.activeDocumentId ?? ''): void {
    const old = this.selections.get(documentId)
    if (!old?.editingContainerId) return
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const parent = old.path.at(-2)
    const context = normalizeEditingContext(model.project, old.rootInstanceId, parent ?? null)
    this.selections.set(documentId, { ...context, target: { kind: 'objects', instanceIds: [old.editingContainerId] }, presentationStates: old.presentationStates })
    this.publish({ activation: this.state.activation + 1 })
  }
  captureLatestAgentUndoTarget(): CourseAgentUndoTarget | null {
    const documentId = this.state.activeDocumentId
    if (!documentId) return null
    const projection = this.projection(documentId), snapshot = projection.read().committed
    if (snapshot?.undoHead?.actor !== 'agent') return null
    return { documentId, epoch: snapshot.epoch, expectedTopOperationId: snapshot.undoHead.operationId, projection, navigation: this.navigation }
  }
  async undoLatestAgent(target = this.captureLatestAgentUndoTarget()): Promise<boolean> {
    if (!target) return false
    const assertCurrent = () => {
      if (target.navigation !== this.navigation || this.state.activeDocumentId !== target.documentId
        || this.projections.get(target.documentId) !== target.projection || target.projection.read().committed?.epoch !== target.epoch) {
        throw new Error('等待课件输入期间已切换文档，请重新选择撤销目标')
      }
    }
    assertCurrent()
    const result = await target.projection.undoLatestAgent(target.expectedTopOperationId, assertCurrent)
    if (!('revision' in result)) throw new Error(result.message)
    return true
  }
  async restore(documentId: string): Promise<void> { await this.host().restore(documentId); await this.activate(documentId) }
  recoverable(): Promise<DocumentSnapshot[]> { return this.host().recoverable() }
  discardRecovery(documentId: string): Promise<void> { return this.host().discardRecovery(documentId) }
  dispose(): void {
    this.stopEvents?.(); this.stopEvents = undefined
    ++this.navigation; this.api = undefined; this.connected = false; this.connecting = undefined
    for (const stop of this.projectionStops.values()) stop()
    for (const projection of this.projections.values()) projection.dispose()
    this.projections.clear(); this.projectionStops.clear(); this.attaching.clear(); this.selections.clear()
    this.state = { ...this.state, activeDocumentId: null }; this.publish()
  }
}
