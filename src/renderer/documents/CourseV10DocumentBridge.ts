import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'
import type { DocumentModel, DocumentResources, DocumentSnapshot } from '../../shared/workbench/document'
import { resolveComponentPresentation, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { CourseV10Driver } from '../../core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../core/course/createCourseProjectV10'
import { DocumentProjection } from './DocumentProjection'
import { captureComponentOperation, presentationComponentEdits } from '../../core/drivers/courseV10Operations'
import type { ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'

export interface CapturedCourseTarget {
  readonly documentId: string
  readonly epoch: string
  readonly project: CourseProjectV10
  readonly resources: DocumentResources
  readonly editingProject: CourseProjectV10
  readonly activeStateId: string | null
  readonly surfaceId: string | null
  readonly instanceIds: readonly string[]
  readonly instanceId: string | null
}

export interface CapturedComponentOperation extends ComponentOperationBatch {
  readonly documentId: string
  readonly epoch: string
}

export interface CourseAgentUndoTarget {
  readonly documentId: string
  readonly epoch: string
  readonly expectedTopOperationId: string
  readonly projection: DocumentProjection
  readonly navigation: number
}

export interface CourseV10ViewState {
  documents: readonly DocumentSnapshot[]
  snapshot: DocumentSnapshot | null
  project: CourseProjectV10 | null
  editingProject: CourseProjectV10 | null
  activeStateId: string | null
  /** Conflict drafts are recovery input; only this model may feed runtime. */
  runtimeProject: CourseProjectV10 | null
  views: readonly { documentId: string; model: Extract<DocumentModel, { kind: 'course-v10' }>; surfaceId: string | null; activeStateId: string | null; selectedInstanceIds: readonly string[]; selectedInstanceId: string | null }[]
  activeDocumentId: string | null
  activation: number
  selectedInstanceId: string | null
  selectedInstanceIds: readonly string[]
  surfaceId: string | null
  pending: number
  error: string | null
}

/** V10 domain binding and transient selection. Session and Projection retain their existing owners. */
export class CourseV10DocumentBridge {
  private api?: DocumentHostAPI
  private readonly projections = new Map<string, DocumentProjection>()
  private readonly attaching = new Map<string, Promise<DocumentProjection>>()
  private readonly projectionStops = new Map<string, () => void>()
  private readonly listeners = new Set<() => void>()
  private readonly selections = new Map<string, { instanceIds: readonly string[]; surfaceId: string | null; presentationStates: Record<string, string | null> }>()
  private navigation = 0
  private connected = false
  private connecting?: Promise<void>
  private stopEvents?: () => void
  private state: CourseV10ViewState = { documents: [], snapshot: null, project: null, editingProject: null, activeStateId: null, runtimeProject: null, views: [], activeDocumentId: null,
    activation: 0, selectedInstanceIds: [], selectedInstanceId: null, surfaceId: null, pending: 0, error: null }

  read = (): CourseV10ViewState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<CourseV10ViewState> = {}): void {
    for (const [documentId, projection] of this.projections) {
      const view = projection.read(), model = view.draft ?? view.committed?.model
      if (model?.kind !== 'course-v10') continue
      const old = this.selections.get(documentId)
      const surfaceId = model.project.surfaces.some(surface => surface.id === old?.surfaceId)
        ? old!.surfaceId : model.project.surfaces[0]?.id ?? null
      if (old) for (const [id, stateId] of Object.entries(old.presentationStates)) {
        if (stateId && !model.project.surfaces.find(surface => surface.id === id)?.presentation?.states.some(state => state.id === stateId)) old.presentationStates[id] = null
      }
      const instanceIds = (old?.instanceIds ?? []).filter(id => Boolean(model.project.instances[id]))
      if (!old || old.surfaceId !== surfaceId || instanceIds.length !== old.instanceIds.length) {
        this.selections.set(documentId, { surfaceId, instanceIds, presentationStates: old?.presentationStates ?? {} })
      }
    }
    const active = this.projections.get(patch.activeDocumentId ?? this.state.activeDocumentId ?? '')?.read()
    const model = active?.draft ?? active?.committed?.model
    const runtimeModel = active?.retainedDraftOnly ? active.committed?.model : model
    const selection = this.selections.get(patch.activeDocumentId ?? this.state.activeDocumentId ?? '')
    this.state = { ...this.state, ...patch,
      documents: [...this.projections.values()].flatMap(projection => {
        const view = projection.read()
        return view.committed ? [{ ...view.committed, dirty: view.committed.dirty || Boolean(view.pending.length || view.composing || view.retainedComposition) }] : []
      }), snapshot: active?.committed ?? null,
      views: [...this.projections.values()].flatMap(projection => {
        const view = projection.read()
        const model = view.retainedDraftOnly ? view.committed?.model : view.draft ?? view.committed?.model
        const selection = this.selections.get(projection.documentId)
        return model?.kind === 'course-v10' ? [{ documentId: projection.documentId, model,
          selectedInstanceIds: selection?.instanceIds ?? [], selectedInstanceId: selection?.instanceIds[0] ?? null,
          activeStateId: selection?.presentationStates[selection.surfaceId ?? ''] ?? null,
          surfaceId: selection?.surfaceId ?? model.project.surfaces[0]?.id ?? null }] : []
      }),
      project: model?.kind === 'course-v10' ? model.project : null,
      activeStateId: selection?.presentationStates[selection.surfaceId ?? ''] ?? null,
      editingProject: model?.kind === 'course-v10' ? resolveComponentPresentation(model.project, selection?.surfaceId ?? null, selection?.presentationStates[selection.surfaceId ?? ''] ?? null) : null,
      runtimeProject: runtimeModel?.kind === 'course-v10' ? runtimeModel.project : null,
      selectedInstanceIds: selection?.instanceIds ?? [], selectedInstanceId: selection?.instanceIds[0] ?? null,
      surfaceId: selection?.surfaceId ?? (model?.kind === 'course-v10' ? model.project.surfaces[0]?.id ?? null : null),
      pending: (active?.pending.length ?? 0) + Number(Boolean(active?.composing || active?.retainedComposition)), error: active?.error?.message ?? null }
    for (const listener of this.listeners) listener()
  }

  connect(api: DocumentHostAPI): Promise<void> {
    if (this.api === api && this.connecting) return this.connecting
    if (this.api === api && this.connected) return Promise.resolve()
    if (this.api && this.api !== api) this.dispose()
    this.api = api
    this.stopEvents = api.subscribe(event => {
      if (event.type === 'closed' && this.projections.get(event.documentId)?.read().committed?.epoch === event.epoch)
        queueMicrotask(() => { if (this.api === api) this.detachClosed(event.documentId) })
    })
    const navigation = ++this.navigation
    const pending = api.bootstrapCourse().then(async snapshot => {
      if (api === this.api) this.connected = true
      if (api === this.api && navigation === this.navigation) await this.activate(snapshot.documentId)
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
  async activate(documentId: string): Promise<void> {
    const navigation = ++this.navigation
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
    if (navigation !== this.navigation) return
    this.publish({ activeDocumentId: projection.documentId, activation: this.state.activation + 1 })
  }
  async create(model: Extract<DocumentModel, { kind: 'course-v10' }> = {
    kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} },
  }): Promise<void> {
    const snapshot = await this.host().create(model, `${model.project.title}.h5lesson`)
    await this.activate(snapshot.documentId)
  }
  async open(path: string): Promise<void> { const snapshot = await this.host().open(path); await this.activate(snapshot.documentId) }
  async edit(edits: ComponentEdit[], historyGroup?: string, documentId?: string) {
    return this.editCaptured(this.capture(edits, this.captureTarget(documentId)), historyGroup)
  }
  captureTarget(documentId = this.state.activeDocumentId ?? ''): CapturedCourseTarget {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') throw new Error('课件文档尚未打开')
    const selection = this.selections.get(documentId)
    const project = structuredClone(model.project)
    const surfaceId = selection?.surfaceId ?? model.project.surfaces[0]?.id ?? null
    const activeStateId = selection?.presentationStates[surfaceId ?? ''] ?? null
    return { documentId, epoch: view.committed!.epoch, project, resources: structuredClone(model.resources),
      editingProject: resolveComponentPresentation(project, surfaceId, activeStateId), activeStateId, surfaceId,
      instanceIds: [...(selection?.instanceIds ?? [])], instanceId: selection?.instanceIds[0] ?? null }
  }
  capture(edits: ComponentEdit[], target = this.captureTarget()): CapturedComponentOperation {
    const mapped = presentationComponentEdits(target.project, target.surfaceId, target.activeStateId, edits)
    const command = captureComponentOperation(target.project, mapped)
    if (mapped !== edits) {
      const original = captureComponentOperation(target.project, edits)
      command.expected = [...new Map([...command.expected, ...original.expected].map(value => [JSON.stringify(value.path), value])).values()]
    }
    return { ...command, documentId: target.documentId, epoch: target.epoch }
  }
  async editCaptured(captured: CapturedComponentOperation, historyGroup?: string) {
    const { documentId, epoch, ...command } = captured
    const projection = this.projection(documentId)
    if (projection.read().committed?.epoch !== epoch) throw new Error('捕获的文档会话已关闭，请重新开始编辑')
    const result = await projection.edit(command, { historyGroup })
    if (!('revision' in result)) throw new Error(result.message)
    return result
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
    await projection.drain()
    if (!await this.host().closeWithDialog(documentId)) return false
    this.detachClosed(documentId)
    return true
  }
  private detachClosed(documentId: string): void {
    const projection = this.projections.get(documentId)
    if (!projection) return
    this.projectionStops.get(documentId)?.(); this.projectionStops.delete(documentId)
    projection.dispose(); this.projections.delete(documentId); this.selections.delete(documentId)
    if (this.state.activeDocumentId === documentId) {
      const next = [...this.projections.keys()].at(-1)
      if (next) this.publish({ activeDocumentId: next, activation: this.state.activation + 1 })
      else { this.state = { ...this.state, activeDocumentId: null }; this.publish() }
    } else this.publish()
  }
  select(instanceId: string | null, surfaceId = this.state.surfaceId): void {
    if (this.state.activeDocumentId) this.selectInstances(this.state.activeDocumentId, instanceId ? [instanceId] : [], surfaceId)
  }
  selectSurface(documentId: string, surfaceId: string): void {
    const view = this.projections.get(documentId)?.read(), model = view?.draft ?? view?.committed?.model
    if (model?.kind !== 'course-v10' || !model.project.surfaces.some(surface => surface.id === surfaceId)) return
    this.selections.set(documentId, { instanceIds: [], surfaceId, presentationStates: this.selections.get(documentId)?.presentationStates ?? {} }); this.publish()
  }
  selectInstance(documentId: string, instanceId: string | null): void {
    this.selectInstances(documentId, instanceId ? [instanceId] : [])
  }
  selectInstances(documentId: string, instanceIds: readonly string[], surfaceId?: string | null): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const ids = [...new Set(instanceIds)].filter(id => Boolean(model.project.instances[id]))
    this.selections.set(documentId, { instanceIds: ids, presentationStates: this.selections.get(documentId)?.presentationStates ?? {},
      surfaceId: surfaceId ?? this.selections.get(documentId)?.surfaceId ?? model.project.surfaces[0]?.id ?? null })
    this.publish()
  }
  selectPresentationState(documentId: string, stateId: string | null, surfaceId?: string): void {
    const view = this.projection(documentId).read(), model = view.draft ?? view.committed?.model
    if (model?.kind !== 'course-v10') return
    const old = this.selections.get(documentId), id = surfaceId ?? old?.surfaceId
    const surface = model.project.surfaces.find(surface => surface.id === id)
    if (!surface || stateId && !surface.presentation?.states.some(state => state.id === stateId)) throw new Error('展示状态已不存在')
    this.selections.set(documentId, { instanceIds: old?.instanceIds ?? [], surfaceId: surface.id,
      presentationStates: { ...old?.presentationStates, [surface.id]: stateId } })
    this.publish()
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
