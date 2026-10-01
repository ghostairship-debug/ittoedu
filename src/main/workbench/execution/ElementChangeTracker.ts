import { randomUUID } from 'node:crypto'
import type { DocumentSession, CommittedDocumentOperation } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel, type DocumentCommand, type DocumentSnapshot } from '../../../shared/workbench/document'
import type { ElementChangeView, ElementRevertResult, ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { elementChangeUnits, elementUnitLabel, flowSlotContent, lostRuntimeTextEdits, readElementFields,
  readFlowBlockFields, runtimeSourceOf, sameFieldValue, writeElementFields, writeFlowBlockFields } from '../../../core/drivers/course/elementFields'
import { findFlowBlockRecursive } from '../../../core/tools/flowDocumentModel'
import { flowTextSlot } from '../../../core/tools/flowTextSlot'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { FlowTextContent } from '../../../shared/document/content'
import { CardTextEdits, sourceTextCodec, flowTextCodec, type PeerTextOperation } from './CardTextEdits'

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
  private undone = false
  private revision: number
  private readonly epoch: string
  private readonly off: (() => void)[] = []
  private readonly inverses = new Set<string>()
  private readonly before: Record<string, unknown> = {}
  private readonly after: Record<string, unknown> = {}
  private readonly source?: CardTextEdits<string>
  private readonly flow?: CardTextEdits<FlowTextContent>
  private lostTexts: string[] = []
  private fieldAvailable = false
  constructor(readonly conversationId: string, readonly documentId: string,
    private readonly target: ExecutionSelectionTarget, private readonly session: DocumentSession, snapshot: DocumentSnapshot) {
    this.revision = snapshot.revision; this.epoch = snapshot.epoch
    if (!cardPeers.has(session)) cardPeers.set(session, { trackers: new Set(), inverses: new Map() })
    cardPeers.get(session)!.trackers.add(this)
    this.fieldAvailable = snapshot.model.kind === 'course-v9' && this.fields(snapshot.model.project) !== null
    if (target.kind === 'markdown-range' && isSourceDocumentModel(snapshot.model))
      this.source = new CardTextEdits(sourceTextCodec, snapshot.model.source, target)
    if (target.kind === 'flow-range' && snapshot.model.kind === 'course-v9') {
      const content = flowSlotContent(snapshot.model.project, target)
      if (content) this.flow = new CardTextEdits(flowTextCodec, content, target)
    }
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
    if (this.runId && (this.source ?? this.flow)?.changed === false)
      for (const peer of cardPeers.get(this.session)!.trackers) if (peer.conversationId === this.conversationId) {
        peer.source?.releaseUnchangedPeer(this.runId); peer.flow?.releaseUnchangedPeer(this.runId)
      }
  }
  dispose(): void { for (const stop of this.off.splice(0)) stop(); cardPeers.get(this.session)?.trackers.delete(this) }
  private invalidate(): void { this.missing = true; this.source?.invalidate(); this.flow?.invalidate() }
  private fields(project: CourseProjectDocument): Fields | null {
    const t = this.target
    return t.kind === 'course-object' ? readElementFields(project, t.itemId)
      : t.kind === 'flow-block' ? readFlowBlockFields(project, t.surfaceId, t.blockId) : null
  }
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
    if (this.flow && this.target.kind === 'flow-range') {
      const a = before.kind === 'course-v9' ? flowSlotContent(before.project, this.target) : null
      const b = after.kind === 'course-v9' ? flowSlotContent(after.project, this.target) : null
      if (!a || !b) { this.invalidate(); return }
      this.flow.advance(a, b, own, inverse, undefined, provenance)
      return
    }
    if (before.kind !== 'course-v9' || after.kind !== 'course-v9') { this.invalidate(); return }
    const a = this.fields(before.project), b = this.fields(after.project)
    this.fieldAvailable = b !== null
    if (this.target.kind === 'course-object' && own) {
      const source = runtimeSourceOf(before.project, this.target.itemId)
      if (source !== null) this.lostTexts = lostRuntimeTextEdits(after.project, this.target.itemId, source)
    }
    if (!a || !b) {
      if (a && !b) this.invalidate()
      return
    }
    if (!own) return
    for (const unit of elementChangeUnits(a, b)) for (const key of unit) {
      // A manual rewrite between two AI commits becomes the baseline for the latter,
      // rather than being accidentally rolled back along with the earlier AI commit.
      if (!Object.hasOwn(this.before, key) || !sameFieldValue(this.after[key], a[key])) this.before[key] = a[key]
      this.after[key] = b[key]
    }
  }
  view(submissionId: string): ElementChangeView {
    if (!this.finished) return { submissionId, state: 'pending', fields: [] }
    const text = this.source ?? this.flow
    if (text) {
      const place = text.range && text.range.to > text.range.from ? {
        target: { ...this.target, ...text.range } as ExecutionSelectionTarget,
        content: this.source ? this.source.content : JSON.stringify(this.flow!.content),
      } : {}
      return { submissionId, state: text.changed ? text.undone ? 'undone' : 'applied' : 'none',
        fields: text.changed ? ['文字'] : [], ...place,
        ...(this.missing || !text.traceable ? { unavailable: UNTRACEABLE } : {}) }
    }
    const fields = [...new Set(elementChangeUnits(this.before, this.after).map(elementUnitLabel))]
    const unsupported = this.target.kind === 'course-object' && !this.fieldAvailable
    return { submissionId, state: fields.length ? this.undone ? 'undone' : 'applied' : 'none', fields,
      ...(this.lostTexts.length ? { lostTexts: this.lostTexts } : {}),
      ...(this.missing ? { unavailable: UNTRACEABLE } : unsupported ? { unavailable: UNSUPPORTED } : {}) }
  }
  async revert(submissionId: string, direction: 'undo' | 'redo', force = false): Promise<ElementRevertResult> {
    const view = this.view(submissionId)
    if (view.state === 'none' || view.state === 'pending' || view.unavailable)
      return { status: 'unavailable', message: view.unavailable ?? '这次请求没有已完成的可撤销修改。' }
    const wasUndone = (this.source ?? this.flow)?.undone ?? this.undone
    if ((direction === 'undo') === wasUndone) return { status: 'unavailable', message: '这次修改已处于所选状态。' }
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.session.drain()
      if (this.missing || snapshot.epoch !== this.epoch) return { status: 'unavailable', message: UNTRACEABLE }
      let command: DocumentCommand, accept = () => { this.undone = direction === 'undo' }
      if (this.source && isSourceDocumentModel(snapshot.model)) {
        const inverse = this.source.prepare(snapshot.model.source, direction)
        if (!inverse) return { status: 'unavailable', message: UNTRACEABLE }
        command = { type: 'markdown.replace', source: inverse.value }; accept = inverse.accept
      } else if (this.flow && this.target.kind === 'flow-range' && snapshot.model.kind === 'course-v9') {
        const content = flowSlotContent(snapshot.model.project, this.target)
        const inverse = content && this.flow.prepare(content, direction)
        if (!inverse) return { status: 'unavailable', message: UNTRACEABLE }
        const project = structuredClone(snapshot.model.project)
        const flow = project.surfaces.find(s => s.id === (this.target as Extract<ExecutionSelectionTarget, { kind: 'flow-range' }>).surfaceId)
        const block = flow?.type === 'flow' ? findFlowBlockRecursive(flow.blocks, this.target.blockId)?.block : null
        if (!block) return { status: 'unavailable', message: UNTRACEABLE }
        flowTextSlot(block, this.target.slot).set(inverse.value)
        command = { type: 'course.replace', project }; accept = inverse.accept
      } else if (snapshot.model.kind === 'course-v9') {
        const current = this.fields(snapshot.model.project)
        if (!current) return { status: 'unavailable', message: UNTRACEABLE }
        const [from, to] = direction === 'undo' ? [this.after, this.before] : [this.before, this.after]
        const units = elementChangeUnits(this.before, this.after)
        const conflicts = units.filter(unit => unit.some(key => !sameFieldValue(current[key], from[key])))
        if (conflicts.length && !force) return { status: 'conflict', fields: [...new Set(conflicts.map(elementUnitLabel))] }
        const values = Object.fromEntries(units.flat().map(key => [key, to[key]])), t = this.target
        const project = t.kind === 'course-object' ? writeElementFields(snapshot.model.project, t.itemId, values)
          : t.kind === 'flow-block' ? writeFlowBlockFields(snapshot.model.project, t.surfaceId, t.blockId, values) : null
        if (!project) return { status: 'unavailable', message: UNSUPPORTED }
        command = { type: 'course.replace', project }
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
