import { randomUUID } from 'node:crypto'
import type { DocumentSession, CommittedDocumentOperation } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel, type DocumentCommand, type DocumentSnapshot } from '../../../shared/workbench/document'
import type { ElementChangeView, ElementRevertResult, ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { elementChangeUnits, elementUnitLabel, readComponentElementFields, readComponentStateElementFields, readComponentStateOverrideRoots,
  restoreComponentElementEdits, restoreComponentStateElementEdits, sameFieldValue } from '../../../core/drivers/course/elementFields'
import type { FlowTextContent } from '../../../shared/document/content'
import { CardTextEdits, sourceTextCodec, flowTextCodec, type PeerTextOperation } from './CardTextEdits'
import { captureComponentOperation, presentationComponentEdits } from '../../../core/drivers/courseV10Operations'
import { courseInstanceContext, courseInstanceFieldIdentity, courseInstanceTextEdit, isCourseInstanceRange, readCourseInstanceText, type CourseInstanceTarget } from '../../../core/tools/ToolTargets'
import type { TextCodec } from './CardTextEdits'

const componentStringCodec: TextCodec<string> = { length: value => Array.from(value).length,
  slice: (value, from, to) => Array.from(value).slice(from, to).join(''), join: values => values.join(''), equal: (a, b) => a === b }
const componentFields = (model: import('../../../shared/workbench/document').DocumentModel, target: CourseInstanceTarget) => {
  try {
    const context = courseInstanceContext(model, target)
    return model.kind === 'course-v10' && target.stateId && context.owner.kind === 'surface'
      ? readComponentStateElementFields(model.project, target.surfaceId, target.stateId, target.instanceId)
      : readComponentElementFields(context.project, target.instanceId)
  } catch { return null }
}
const componentRoots = (model: import('../../../shared/workbench/document').DocumentModel, target: CourseInstanceTarget) => {
  if (target.fieldScope === 'flowLayout') return null
  const context = courseInstanceContext(model, target)
  return model.kind === 'course-v10' && target.stateId && context.owner.kind === 'surface'
    ? readComponentStateOverrideRoots(model.project, target.surfaceId, target.stateId, target.instanceId) : null
}
const componentFieldPath = (key: string, instanceId: string) => {
  const path = JSON.parse(key) as string[]
  while (path[0] === 'descendant') { instanceId = path[1]!; path.splice(0, 2) }
  return { instanceId, path }
}
const overrideMarker = (key: string) => componentFieldPath(key, '').path[0] === 'override'
const componentText = (model: import('../../../shared/workbench/document').DocumentModel, target: CourseInstanceTarget) => {
  try { return readCourseInstanceText(model, target) } catch { return null }
}

const UNTRACEABLE = '原修改的位置已被改写或无法确认；未改动其他位置，请查看文档历史。'
const UNSUPPORTED = '组件和页面 Runtime 的修改请用编辑器的撤销（Ctrl+Z）。'
type Fields = Readonly<Record<string, unknown>>
// Only live card trackers and an in-flight canonical inverse need provenance here.
// DocumentSession remains the sole writer and history; no document content is stored.
const cardPeers = new WeakMap<DocumentSession, { trackers: Set<ElementChangeTracker>;
  inverses: Map<string, { tracker: ElementChangeTracker; direction: 'undo' | 'redo' }> }>()

/** A live card's derived inverse. Authoritative writes and history remain in DocumentSession. */
export class ElementChangeTracker {
  private runId?: string
  private finished = false
  private missing = false
  private missingMessage = UNTRACEABLE
  private undone = false
  private revision: number
  private readonly epoch: string
  private readonly off: (() => void)[] = []
  private readonly inverses = new Set<string>()
  private readonly before: Record<string, unknown> = {}
  private readonly after: Record<string, unknown> = {}
  private readonly rootsBefore: Record<string, unknown> = {}
  private readonly rootsAfter: Record<string, unknown> = {}
  private readonly source?: CardTextEdits<string>
  private readonly componentText?: CardTextEdits<string> | CardTextEdits<FlowTextContent>
  private readonly componentIdentity?: ReturnType<typeof courseInstanceFieldIdentity>
  private fieldAvailable = false
  constructor(readonly conversationId: string, readonly documentId: string,
    private readonly target: ExecutionSelectionTarget, private readonly session: DocumentSession, snapshot: DocumentSnapshot) {
    this.revision = snapshot.revision; this.epoch = snapshot.epoch
    if (!cardPeers.has(session)) cardPeers.set(session, { trackers: new Set(), inverses: new Map() })
    cardPeers.get(session)!.trackers.add(this)
    this.fieldAvailable = snapshot.model.kind === 'course-v10' && target.kind === 'course-instance' && componentFields(snapshot.model, target) !== null
    if (isCourseInstanceRange(target) && snapshot.model.kind === 'course-v10') {
      this.componentIdentity = courseInstanceFieldIdentity(snapshot.model, target)
      const content = componentText(snapshot.model, target)
      if (typeof content === 'string') this.componentText = new CardTextEdits(componentStringCodec, content, target)
      else if (content) this.componentText = new CardTextEdits(flowTextCodec, content, target)
    }
    if (target.kind === 'markdown-range' && isSourceDocumentModel(snapshot.model))
      this.source = new CardTextEdits(sourceTextCodec, snapshot.model.source, target)
    this.off.push(session.subscribeCommits(commit => {
      try { this.observe(commit) } catch { this.invalidate() }
    }), session.subscribe(event => {
      if (event.type === 'closed') { this.invalidate(); this.dispose() }
      else if (event.snapshot.epoch !== this.epoch || event.snapshot.revision !== this.revision) this.invalidate()
    }))
  }
  bindRun(runId: string): void { this.runId = runId }
  finish(): void {
    this.finished = true
    // A run can change text and then restore it without leaving a net inverse.
    if (this.runId && (this.source ?? this.componentText)?.changed === false)
      for (const peer of cardPeers.get(this.session)!.trackers) if (peer.conversationId === this.conversationId) {
        peer.source?.releaseUnchangedPeer(this.runId); peer.componentText?.releaseUnchangedPeer(this.runId)
      }
  }
  dispose(): void { for (const stop of this.off.splice(0)) stop(); cardPeers.get(this.session)?.trackers.delete(this) }
  private invalidate(message = UNTRACEABLE): void { this.missing = true; this.missingMessage = message; this.source?.invalidate(); this.componentText?.invalidate() }
  private observe({ operation, result, before, after }: CommittedDocumentOperation): void {
    if (operation.epoch !== this.epoch || result.beforeRevision !== this.revision) { this.invalidate(); return }
    this.revision = result.revision
    const own = operation.actor === 'agent' && !!this.runId && operation.runId === this.runId
    const inverse = this.inverses.has(operation.operationId)
    const peers = cardPeers.get(this.session)!, reversing = peers.inverses.get(operation.operationId)
    const peer = reversing?.tracker ?? (operation.actor === 'agent'
      ? [...peers.trackers].find(value => value.runId === operation.runId) : undefined)
    const provenance: PeerTextOperation | undefined = peer && peer !== this && peer.conversationId === this.conversationId && peer.runId
      ? { id: peer.runId, direction: reversing?.direction ?? 'apply' } : undefined
    if (this.source) {
      if (!isSourceDocumentModel(before) || !isSourceDocumentModel(after)) { this.invalidate(); return }
      const command = operation.mutation.type === 'command' ? operation.mutation.command : null
      const exact = command?.type === 'markdown.splice' ? { from: command.from, to: command.to, inserted: command.text.length } : undefined
      this.source.advance(before.source, after.source, own, inverse, exact, provenance)
      return
    }
    if (this.componentText && this.target.kind === 'course-instance') {
      if (!sameFieldValue(this.componentIdentity, courseInstanceFieldIdentity(before, this.target))
        || !sameFieldValue(this.componentIdentity, courseInstanceFieldIdentity(after, this.target))) { this.invalidate('原文字字段所在行、项或单元格已改变，请重新选择。'); return }
      const a = componentText(before, this.target), b = componentText(after, this.target)
      if (a === null || b === null || typeof a !== typeof b) { this.invalidate(); return }
      this.observeComponentRoots(before, after, own, inverse && reversing?.direction === 'redo')
      if (typeof a === 'string' && typeof b === 'string') (this.componentText as CardTextEdits<string>).advance(a, b, own, inverse, undefined, provenance)
      else (this.componentText as CardTextEdits<FlowTextContent>).advance(a as FlowTextContent, b as FlowTextContent, own, inverse, undefined, provenance)
      return
    }
    if (before.kind === 'course-v10' && after.kind === 'course-v10' && this.target.kind === 'course-instance') {
      const a = componentFields(before, this.target), b = componentFields(after, this.target)
      this.fieldAvailable = b !== null
      if (!a || !b) { this.invalidate(); return }
      this.observeComponentRoots(before, after, own, inverse && reversing?.direction === 'redo')
      if (own) this.recordFields(a, b)
      return
    }
    this.invalidate()
  }
  private observeComponentRoots(before: import('../../../shared/workbench/document').DocumentModel,
    after: import('../../../shared/workbench/document').DocumentModel, own: boolean, redoInverse: boolean): void {
    if (this.target.kind !== 'course-instance' || !own && !redoInverse) return
    const a = componentRoots(before, this.target), b = componentRoots(after, this.target)
    if (!a || !b) return
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (sameFieldValue(a[key], b[key])) continue
      if (own) {
        if (!Object.hasOwn(this.rootsBefore, key) || !sameFieldValue(this.rootsAfter[key], a[key])) this.rootsBefore[key] = a[key]
        this.rootsAfter[key] = b[key]
      } else if (Object.hasOwn(this.rootsBefore, key) && this.rootsBefore[key] === undefined && a[key] === undefined) this.rootsAfter[key] = b[key]
    }
  }
  private recordFields(a: Fields, b: Fields): void {
    for (const unit of elementChangeUnits(a, b)) for (const key of unit) {
      // A manual rewrite between two AI commits becomes the baseline for the latter,
      // rather than being accidentally rolled back along with the earlier AI commit.
      if (!Object.hasOwn(this.before, key) || !sameFieldValue(this.after[key], a[key])) this.before[key] = a[key]
      this.after[key] = b[key]
    }
  }
  view(submissionId: string): ElementChangeView {
    if (!this.finished) return { submissionId, state: 'pending', fields: [] }
    const text = this.source ?? this.componentText
    if (text) {
      const place = text.range && text.range.to > text.range.from ? {
        target: { ...this.target, ...text.range } as ExecutionSelectionTarget,
        content: typeof text.content === 'string' ? text.content : JSON.stringify(text.content),
      } : {}
      return { submissionId, state: text.changed ? text.undone ? 'undone' : 'applied' : 'none',
        fields: text.changed ? ['文字'] : [], ...place,
        ...(this.missing || !text.traceable ? { unavailable: this.missing ? this.missingMessage : UNTRACEABLE } : {}) }
    }
    const fields = [...new Set(elementChangeUnits(this.before, this.after).map(elementUnitLabel))]
    const unsupported = this.target.kind === 'course-instance' && !this.fieldAvailable
    return { submissionId, state: fields.length ? this.undone ? 'undone' : 'applied' : 'none', fields,
      ...(this.missing ? { unavailable: this.missingMessage } : unsupported ? { unavailable: UNSUPPORTED } : {}) }
  }
  async revert(submissionId: string, direction: 'undo' | 'redo', force = false): Promise<ElementRevertResult> {
    const view = this.view(submissionId)
    if (view.state === 'none' || view.state === 'pending' || view.unavailable)
      return { status: 'unavailable', message: view.unavailable ?? '这次请求没有已完成的可撤销修改。' }
    const wasUndone = (this.source ?? this.componentText)?.undone ?? this.undone
    if ((direction === 'undo') === wasUndone) return { status: 'unavailable', message: '这次修改已处于所选状态。' }
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.session.drain()
      if (this.missing || snapshot.epoch !== this.epoch) return { status: 'unavailable', message: this.missing ? this.missingMessage : UNTRACEABLE }
      let command: DocumentCommand, accept = () => { this.undone = direction === 'undo' }
      if (this.source && isSourceDocumentModel(snapshot.model)) {
        const inverse = this.source.prepare(snapshot.model.source, direction)
        if (!inverse) return { status: 'unavailable', message: UNTRACEABLE }
        command = { type: 'markdown.replace', source: inverse.value }; accept = inverse.accept
      } else if (snapshot.model.kind === 'course-v10' && this.target.kind === 'course-instance') {
        const t: CourseInstanceTarget = this.target
        if (!componentFields(snapshot.model, t)) return { status: 'unavailable', message: UNTRACEABLE }
        const context = courseInstanceContext(snapshot.model, t), stateOwned = !!t.stateId && context.owner.kind === 'surface'
        if (this.componentText) {
          const content = readCourseInstanceText(snapshot.model, t)
          const inverse = content === null ? null : typeof content === 'string'
            ? (this.componentText as CardTextEdits<string>).prepare(content, direction)
            : (this.componentText as CardTextEdits<FlowTextContent>).prepare(content, direction)
          if (!inverse || !t.dataPath) return { status: 'unavailable', message: UNTRACEABLE }
          const roots = componentRoots(snapshot.model, t), dataRoot = JSON.stringify([t.instanceId, 'data'])
          if (direction === 'undo' && stateOwned && roots && Object.hasOwn(this.rootsBefore, dataRoot)
            && this.rootsBefore[dataRoot] === undefined && sameFieldValue(roots[dataRoot], this.rootsAfter[dataRoot])) {
            const inherited = readCourseInstanceText(snapshot.model, { ...t, stateId: null })
            if (!sameFieldValue(inherited, inverse.value)) return { status: 'conflict', fields: ['文字'] }
            const fields = { '["override","data"]': undefined }
            command = captureComponentOperation(snapshot.model.project, restoreComponentStateElementEdits(snapshot.model.project,
              t.surfaceId, t.stateId!, t.instanceId, fields, new Set([dataRoot])))
          } else command = captureComponentOperation(snapshot.model.project, presentationComponentEdits(snapshot.model.project, t.surfaceId, t.stateId ?? null,
            [courseInstanceTextEdit(snapshot.model, t, inverse.value)]))
          accept = inverse.accept
        } else {
          const current = componentFields(snapshot.model, t)
          if (!current) return { status: 'unavailable', message: UNTRACEABLE }
          const [from, to] = direction === 'undo' ? [this.after, this.before] : [this.before, this.after]
          const units = elementChangeUnits(this.before, this.after)
          const roots = componentRoots(snapshot.model, t), [rootFrom, rootTo] = direction === 'undo'
            ? [this.rootsAfter, this.rootsBefore] : [this.rootsBefore, this.rootsAfter]
          const inheritedNow = (key: string) => {
            const { path, instanceId } = componentFieldPath(key, t.instanceId), root = JSON.stringify([instanceId, path[0]])
            return roots && (path[0] === 'data' || path[0] === 'style') && Object.hasOwn(rootFrom, root) && rootFrom[root] === undefined && roots[root] === undefined
          }
          const conflicts = units.filter(unit => unit.some(key => !overrideMarker(key) && !inheritedNow(key) && !sameFieldValue(current[key], from[key])))
          if (conflicts.length && !force) return { status: 'conflict', fields: [...new Set(conflicts.map(elementUnitLabel))] }
          const values = Object.fromEntries(units.flat().map(key => [key, to[key]]))
          const inheritRoots = new Set(roots ? Object.keys(rootTo).filter(key => rootTo[key] === undefined && sameFieldValue(roots[key], rootFrom[key])) : [])
          try { command = captureComponentOperation(snapshot.model.project, stateOwned
            ? restoreComponentStateElementEdits(snapshot.model.project, t.surfaceId, t.stateId!, t.instanceId, values, inheritRoots)
            : restoreComponentElementEdits(context.project, t.instanceId, values)) }
          catch (error) { return { status: 'unavailable', message: error instanceof Error ? error.message : UNSUPPORTED } }
        }
      } else return { status: 'unavailable', message: UNTRACEABLE }
      const operationId = randomUUID(); this.inverses.add(operationId)
      cardPeers.get(this.session)!.inverses.set(operationId, { tracker: this, direction })
      try {
        const result = await this.session.execute({ documentId: this.documentId, epoch: snapshot.epoch,
          baseRevision: snapshot.revision, operationId, actor: 'human', mutation: { type: 'command', command } })
        if (result.status === 'applied' || result.status === 'unchanged') {
          accept(); return { status: 'applied', change: this.view(submissionId) }
        }
        if (result.status !== 'conflict') return { status: 'unavailable', message: 'message' in result ? result.message : '未能确认本次修改。' }
      } finally { this.inverses.delete(operationId); cardPeers.get(this.session)!.inverses.delete(operationId) }
    }
    return { status: 'unavailable', message: '文档正在被修改，请稍后再试。' }
  }
}
