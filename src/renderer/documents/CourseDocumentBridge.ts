import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentModel, DocumentOperationResult, DocumentSnapshot } from '../../shared/workbench/document'
import { normalizeWorkspacePath } from '../../shared/workspaceIdentity'
import { CourseV9Driver } from '../../core/drivers/CourseV9Driver'
import { DocumentProjection, type DocumentProjectionState } from './DocumentProjection'
import { courseViewDocument, courseViewModel, courseViewPatch, projectCourseDocument, type CourseDocumentView } from './CourseDocumentView'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
interface CourseAgentUndoTarget {
  readonly documentId: string
  readonly epoch: string
  readonly expectedTopOperationId: string
  readonly projection: DocumentProjection
  readonly navigation: number
}
export interface CourseDocumentConnection {
  activation: number
  documents: DocumentSnapshot[]
  documentId: string | null
  snapshot: DocumentSnapshot | null
  pending: number
  error: string | null
  connected: boolean
}
export interface CourseDocumentBridgePorts {
  read(): CourseDocumentView
  patch(patch: Record<string, unknown>): void
}

/** Owns only subscriptions, unfinished input and ViewState. Content and History belong to main. */
export class CourseDocumentBridge {
  private api?: DocumentHostAPI
  private projections = new Map<string, DocumentProjection>()
  private views = new Map<string, CourseDocumentView>()
  private attaching = new Map<string, Promise<DocumentProjection>>()
  private visible = new Set<string>()
  private projectionStops = new Map<string, () => void>()
  private active?: DocumentProjection
  private stop?: () => void
  private connecting?: Promise<void>
  private sequence = 0
  private navigation = 0
  private activation = 0
  private lastSubmission: Promise<boolean> = Promise.resolve(true)
  constructor(private readonly ports: CourseDocumentBridgePorts) {}

  connection(): CourseDocumentConnection {
    const state = this.active?.read()
    return { activation: this.activation, documents: [...this.visible].flatMap(id => { const state = this.projections.get(id)?.read(), snapshot = state?.committed; return snapshot ? [{ ...snapshot, dirty: snapshot.dirty || Boolean(state.pending.length) }] : [] }), documentId: this.active?.documentId ?? null, snapshot: state?.committed ?? null,
      pending: state?.pending.length ?? 0, error: state?.error?.message ?? null, connected: state?.connected ?? false }
  }
  private render = (): void => {
    const state = this.active?.read()
    if (!state?.committed) return
    const model = state.draft ?? state.committed.model
    if (model.kind !== 'course-v9') throw new Error('此视图只能显示课程文档')
    const current = this.ports.read()
    this.ports.patch({ ...projectCourseDocument(model, current), courseDocument: this.connection(),
      dirty: state.committed.dirty || Boolean(state.pending.length),
      projectPath: state.committed.binding.kind === 'file' ? normalizeWorkspacePath(state.committed.binding.path) : null,
      ...(state.error ? { errorMessage: state.error.message, statusMessage: null } : {}),
    })
  }
  connect(api: DocumentHostAPI): Promise<void> {
    if (this.api === api && !this.active && !this.connecting) return Promise.resolve()
    if (this.api === api && this.active) return this.active.read().connected
      ? Promise.resolve() : this.active.reattach().then(() => { this.render() })
    if (this.connecting) return this.connecting
    if (this.api && this.api !== api) {
      this.stop?.()
      for (const projection of this.projections.values()) projection.dispose()
      for (const stop of this.projectionStops.values()) stop()
      this.projectionStops.clear(); this.visible.clear(); this.attaching.clear(); this.projections.clear(); this.views.clear(); this.active = undefined
    }
    this.api = api
    // Reserve the bootstrap navigation before the asynchronous Main reply.
    // A later user selection must win even if bootstrap finishes last.
    const navigation = ++this.navigation
    this.connecting = (async () => {
      const bootstrap = await api.bootstrapCourse()
      if (api === this.api && navigation === this.navigation) await this.activate(bootstrap.documentId, navigation, false)
    })().catch(error => { if (api === this.api && navigation === this.navigation) this.ports.patch({ errorMessage: error instanceof Error ? error.message : '课程文档服务无法连接' }); throw error })
      .finally(() => { this.connecting = undefined })
    return this.connecting
  }
  private host(): DocumentHostAPI { if (!this.api) throw new Error('课程文档服务尚未连接'); return this.api }
  async activate(documentId: string, navigation = ++this.navigation, visible = true): Promise<void> {
    let projection = this.projections.get(documentId)
    if (!projection) {
      let attaching = this.attaching.get(documentId)
      if (!attaching) {
        const api = this.host()
        attaching = DocumentProjection.attach(api, documentId).then(attached => {
          if (api !== this.api || attached.read().committed?.model.kind !== 'course-v9') {
            attached.dispose(); throw new Error('课程文档连接已经改变或目标不是课程文档')
          }
          this.projections.set(documentId, attached)
          this.projectionStops.set(documentId, attached.subscribe(() => this.ports.patch({ courseDocument: this.connection() })))
          return attached
        }).finally(() => { if (this.attaching.get(documentId) === attaching) this.attaching.delete(documentId) })
        this.attaching.set(documentId, attaching)
      }
      projection = await attaching
    } else await projection.reattach()
    if (visible) this.visible.add(documentId)
    if (navigation !== this.navigation) { this.ports.patch({ courseDocument: this.connection() }); return }
    ++this.activation
    this.present(projection)
  }
  async activatePrepared(documentId: string, prepare: () => Promise<unknown>): Promise<void> {
    const navigation = ++this.navigation
    if (this.active) await prepare()
    if (navigation !== this.navigation) return
    await this.activate(documentId, navigation)
  }
  private present(projection: DocumentProjection): void {
    const documentId = projection.documentId
    if (this.active) this.views.set(this.active.documentId, this.ports.read())
    this.stop?.(); this.active = projection
    const previous = this.views.get(documentId)
    if (previous) this.ports.patch(courseViewPatch(previous as unknown as Record<string, unknown>))
    else this.ports.patch({ slideBackend: null, slideCandidateSnapshot: null, flowSession: null, spatialSession: null,
      courseAuthoringSession: null, v9ContentEdit: null, flowTextEdit: null, flowDocumentDraft: null, spatialContentEdit: null,
      editingTextNodeId: null, spatialClipboard: null, flowClipboard: null, slideCandidateClipboard: null, canvasMode: 'edit' })
    this.stop = projection.subscribe(this.render)
    this.render()
  }
  async create(model: CourseModel, suggestedName: string): Promise<void> {
    const navigation = ++this.navigation
    const snapshot = await this.host().create(model, suggestedName)
    await this.activate(snapshot.documentId, navigation)
  }
  async open(path: string): Promise<void> {
    const navigation = ++this.navigation
    await this.activate((await this.host().open(path)).documentId, navigation)
  }
  async restore(documentId: string): Promise<void> {
    const navigation = ++this.navigation
    await this.activate((await this.host().restore(documentId)).documentId, navigation)
  }
  async recoverable(): Promise<DocumentSnapshot[]> {
    const live = new Set((await this.host().list()).map(snapshot => snapshot.documentId))
    return (await this.host().recoverable()).filter(snapshot => snapshot.model.kind === 'course-v9' && !live.has(snapshot.documentId))
  }
  async discardRecovery(documentId: string): Promise<void> { await this.host().discardRecovery(documentId) }
  async drain(): Promise<DocumentSnapshot> {
    if (this.connecting) await this.connecting
    if (!this.active) throw new Error('课程文档服务尚未连接')
    return this.active.drain()
  }
  /** Prepare stored view drafts without awaiting while a background document is projected. */
  async drainAll(prepareView: () => void): Promise<DocumentSnapshot[]> {
    if (this.connecting) await this.connecting
    const foreground = this.active
    if (!foreground) return []
    const navigation = this.navigation
    const projections = [...this.projections.values()]
    try {
      for (const projection of projections) {
        this.present(projection)
        prepareView()
      }
    } finally {
      this.present(foreground)
    }
    const draftState = () => JSON.stringify([...this.projections.keys()].map(id => {
      const view = this.active?.documentId === id ? this.ports.read() : this.views.get(id)
      return [id, view?.v9ContentEdit, view?.spatialContentEdit, view?.flowTextEdit, view?.flowDocumentDraft]
    }))
    const preparedDrafts = draftState()
    const snapshots = await Promise.all(projections.map(projection => projection.drain()))
    if (navigation !== this.navigation || draftState() !== preparedDrafts) throw new Error('关闭准备期间又有新的输入或文档切换，请确认后再次关闭')
    return snapshots
  }
  readCommitted(): DocumentSnapshot {
    const state = this.active?.read()
    if (!state?.committed || !state.connected || state.error || state.pending.length) throw new Error('课程输入尚未确认，请等待或处理保留的草稿')
    return state.committed
  }
  /** The synchronous result is only a prepared local projection, never a commit receipt. */
  submit(patch: Record<string, unknown>, historyGroup?: string): boolean {
    const projection = this.active
    if (!projection) { this.lastSubmission = Promise.resolve(false); this.ports.patch({ errorMessage: '课程文档服务尚未连接，修改未提交' }); return false }
    const current = this.ports.read(), view = { ...current, ...patch } as CourseDocumentView
    const project = courseViewDocument(view)
    if (!project) { this.ports.patch(courseViewPatch(patch)); return true }
    const base = projection.read().draft ?? projection.read().committed!.model
    if (base.kind !== 'course-v9' || project.id !== base.project.id) throw new Error('候选不属于当前课程文档')
    const model = courseViewModel(view, { ...project, revision: base.project.revision })
    new CourseV9Driver().validate(model)
    const prepared = courseViewPatch(patch)
    // View-only commands have no content revision or durable operation.
    if (JSON.stringify(model) === JSON.stringify(base)) {
      this.ports.patch({ ...prepared, ...projectCourseDocument(base, { ...current, ...prepared } as CourseDocumentView) })
      this.lastSubmission = Promise.resolve(true)
      return true
    }
    this.visible.add(projection.documentId)
    const submission = ++this.sequence
    const status = patch.statusMessage
    this.ports.patch({ ...prepared, ...projectCourseDocument(model, { ...current, ...prepared } as CourseDocumentView), statusMessage: '正在确认课件修改…' })
    this.lastSubmission = projection.edit({ type: 'course.replace', project: model.project, resources: model.resources }, { historyGroup })
      .then(result => {
        const ok = result.status === 'applied' || result.status === 'unchanged'
        if (ok && this.active === projection && submission === this.sequence) this.ports.patch({ errorMessage: null, statusMessage: status ?? '课件修改已确认' })
        return ok
      }).catch(error => {
        if (this.active === projection) this.ports.patch({ errorMessage: error instanceof Error ? error.message : '修改未确认，草稿已保留', statusMessage: null })
        return false
      })
    return true
  }
  acknowledgement(): Promise<boolean> { return this.lastSubmission }
  async history(direction: 'undo' | 'redo'): Promise<boolean> {
    const projection = this.active
    if (!projection) return false
    const result = await projection[direction]()
    return this.finishHistory(projection, result, direction)
  }
  captureLatestAgentUndoTarget(): CourseAgentUndoTarget {
    const projection = this.active
    const snapshot = projection?.read().committed
    if (!projection || !snapshot) throw new Error('课程文档服务尚未连接')
    if (snapshot.undoHead?.actor !== 'agent') throw new Error('最近一次操作不是 AI 修改，请按正常撤销顺序处理')
    return { documentId: snapshot.documentId, epoch: snapshot.epoch,
      expectedTopOperationId: snapshot.undoHead.operationId, projection, navigation: this.navigation }
  }
  async undoLatestAgent(target: CourseAgentUndoTarget): Promise<boolean> {
    if (this.navigation !== target.navigation || this.active !== target.projection
      || this.projections.get(target.documentId) !== target.projection
      || target.projection.read().committed?.epoch !== target.epoch) {
      throw new Error('撤销目标文档已切换或变化，请重新确认最近 AI 修改')
    }
    const result = await target.projection.undoLatestAgent(target.expectedTopOperationId)
    const projection = target.projection
    return this.finishHistory(projection, result, 'undo')
  }
  private finishHistory(projection: DocumentProjection, result: DocumentOperationResult, direction: 'undo' | 'redo'): boolean {
    const ok = result.status === 'applied' || result.status === 'unchanged'
    if (ok && this.active === projection) {
      const session = this.ports.read().courseAuthoringSession
      if (session) this.ports.patch({ courseAuthoringSession: { ...session, token: { ...session.token, generation: session.token.generation + 1 } } })
      this.ports.patch({ editingTextNodeId: null, statusMessage: direction === 'undo' ? '已撤销' : '已重做' })
    } else if (!ok && this.active === projection && 'message' in result) {
      this.ports.patch({ errorMessage: result.message, statusMessage: null })
    }
    return ok
  }
  async save(saveAs = false): Promise<DocumentSnapshot | null> {
    const snapshot = await this.drain()
    const result = await this.host().saveWithDialog(snapshot.documentId, saveAs)
    if (this.active?.documentId === snapshot.documentId) { await this.active.drain(); this.render() }
    return result
  }
  async close(documentId: string): Promise<boolean> {
    const projection = this.projections.get(documentId)
    if (!projection) return true
    await projection.drain()
    if (!await this.host().closeWithDialog(documentId)) return false
    this.visible.delete(documentId); this.views.delete(documentId)
    this.projectionStops.get(documentId)?.(); this.projectionStops.delete(documentId)
    this.projections.delete(documentId); projection.dispose()
    if (this.active === projection) {
      ++this.navigation; this.stop?.(); this.stop = undefined; this.active = undefined
      const next = [...this.visible].reverse().map(id => this.projections.get(id)).find(Boolean)
      if (next) this.present(next)
      else this.ports.patch({ courseDocument: this.connection(), dirty: false, projectPath: null })
    } else this.ports.patch({ courseDocument: this.connection() })
    return true
  }
  state(): DocumentProjectionState | undefined { return this.active?.read() }
}
