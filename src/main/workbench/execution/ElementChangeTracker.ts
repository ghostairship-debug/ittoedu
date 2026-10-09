import { randomUUID } from 'node:crypto'
import type { DocumentSession, CommittedDocumentOperation } from '../../../core/documents/DocumentSession'
import { isSourceDocumentModel, type DocumentModel, type DocumentCommand, type DocumentSnapshot } from '../../../shared/workbench/document'
import type { ElementChangeView, ElementRevertResult, ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { elementChangeUnits, elementUnitLabel, readComponentElementFields, readComponentStateElementFields, readComponentStateOverrideRoots,
  restoreComponentElementEdits, restoreComponentStateElementEdits, sameFieldValue } from '../../../core/drivers/course/elementFields'
import { normalizeDocumentText, type FlowTextContent } from '../../../shared/document/content'
import { CardTextEdits, sourceTextCodec, flowTextCodec, type PeerTextOperation } from './CardTextEdits'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits } from '../../../core/drivers/courseV10Operations'
import { courseInstanceContext, courseInstanceFieldIdentity, courseInstanceTextTarget, courseInstanceTextEdit, isCourseInstanceRange, mapHtmlAuthorFieldTarget, mapMarkdownRange, prepareHtmlAuthorFieldEdit, readHtmlAuthorField, readCourseInstanceText, readEditableTargetContent, type CourseInstanceTarget } from '../../../core/tools/ToolTargets'
import type { TextCodec } from './CardTextEdits'
import { documentSourceEdits } from '../../../shared/document/sourceMerge'
import { mapAcknowledgedRange } from '../../../core/tools/ToolReadCoverage'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { documentDigest } from '../../../core/documents/documentDigest'

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
  if (target.dataPath) target = courseInstanceTextTarget(model, target)
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
  private readonly sourceSelectionBaseline?: { source: string; target: Extract<ExecutionSelectionTarget, { kind: 'text-selection' }> }
  private sourceSelectionApplied?: { source: string; target: Extract<ExecutionSelectionTarget, { kind: 'text-selection' }> }
  private readonly htmlText?: CardTextEdits<string>
  private readonly componentText?: CardTextEdits<string> | CardTextEdits<FlowTextContent>
  private readonly fragmentTrackers?: ElementChangeTracker[]
  private readonly richComponentText: boolean = false
  private readonly componentIdentity?: ReturnType<typeof courseInstanceFieldIdentity>
  private fieldAvailable = false
  constructor(readonly conversationId: string, readonly documentId: string,
    private target: ExecutionSelectionTarget, private readonly session: DocumentSession, snapshot: DocumentSnapshot) {
    this.revision = snapshot.revision; this.epoch = snapshot.epoch
    if (!cardPeers.has(session)) cardPeers.set(session, { trackers: new Set(), inverses: new Map() })
    cardPeers.get(session)!.trackers.add(this)
    if (target.kind === 'text-selection') {
      if (isSourceDocumentModel(snapshot.model) && target.fragments.every(fragment => fragment.target.kind === 'markdown-range')) {
        const bounds = target.fragments.map(fragment => fragment.target as Extract<ExecutionSelectionTarget, { kind: 'markdown-range' }>)
        this.source = new CardTextEdits(sourceTextCodec, snapshot.model.source, { from: Math.min(...bounds.map(t => t.from)), to: Math.max(...bounds.map(t => t.to)) })
        this.sourceSelectionBaseline = { source: snapshot.model.source, target: structuredClone(target) }
      } else this.fragmentTrackers = target.fragments.map(fragment => new ElementChangeTracker(conversationId, documentId, fragment.target, session, snapshot))
    }
    this.fieldAvailable = snapshot.model.kind === 'course-v10' && target.kind === 'course-instance' && componentFields(snapshot.model, target) !== null
    if (isCourseInstanceRange(target) && snapshot.model.kind === 'course-v10') {
      this.componentIdentity = courseInstanceFieldIdentity(snapshot.model, target)
      const content = componentText(snapshot.model, target)
      const context = courseInstanceContext(snapshot.model, target)
      this.richComponentText = content !== null && (typeof content !== 'string' || componentDefinitionBuiltinKey(context.project.definitions[context.instance.definitionId]) === 'guoling.table')
      if (this.richComponentText && content !== null) this.componentText = new CardTextEdits(flowTextCodec, normalizeDocumentText(typeof content === 'string' ? { inlines: [{ type: 'text', text: content }] } : content), target)
      else if (typeof content === 'string') this.componentText = new CardTextEdits(componentStringCodec, content, target)
    }
    if (target.kind === 'markdown-range' && isSourceDocumentModel(snapshot.model))
      this.source = new CardTextEdits(sourceTextCodec, snapshot.model.source, target)
    if (target.kind === 'html-author-field') {
      const { value } = readHtmlAuthorField(snapshot.model, target)
      this.htmlText = new CardTextEdits(componentStringCodec, value, { from: 0, to: Array.from(value).length })
    }
    this.off.push(session.subscribeCommits(commit => {
      try { this.observe(commit) } catch { this.invalidate() }
    }), session.subscribe(event => {
      if (event.type === 'closed') { this.invalidate(); this.dispose() }
      else if (event.snapshot.epoch !== this.epoch || event.snapshot.revision !== this.revision) this.invalidate()
    }))
  }
  bindRun(runId: string): void { this.runId = runId; this.fragmentTrackers?.forEach(tracker => tracker.bindRun(runId)) }
  finish(): void {
    this.finished = true; this.fragmentTrackers?.forEach(tracker => tracker.finish())
    // A run can change text and then restore it without leaving a net inverse.
    if (this.runId && (this.source ?? this.componentText ?? this.htmlText)?.changed === false)
      for (const peer of cardPeers.get(this.session)!.trackers) if (peer.conversationId === this.conversationId) {
        peer.source?.releaseUnchangedPeer(this.runId); peer.componentText?.releaseUnchangedPeer(this.runId); peer.htmlText?.releaseUnchangedPeer(this.runId)
      }
  }
  dispose(): void { this.fragmentTrackers?.forEach(tracker => tracker.dispose()); for (const stop of this.off.splice(0)) stop(); cardPeers.get(this.session)?.trackers.delete(this) }
  private invalidate(message = UNTRACEABLE): void { this.missing = true; this.missingMessage = message; this.source?.invalidate(); this.componentText?.invalidate(); this.htmlText?.invalidate() }
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
    if (this.fragmentTrackers) return
    if (this.source) {
      if (!isSourceDocumentModel(before) || !isSourceDocumentModel(after)) { this.invalidate(); return }
      const command = operation.mutation.type === 'command' ? operation.mutation.command : null
      if (this.target.kind !== 'text-selection') {
        const exact = command?.type === 'markdown.splice' ? { from: command.from, to: command.to, inserted: command.text.length } : undefined
        this.source.advance(before.source, after.source, own, inverse, exact, provenance)
        return
      }
      // Session supplies canonical splice coordinates. Recover each inserted segment
      // from its final committed position; the gaps never become an owned inverse.
      const acknowledged = (own || inverse || !!provenance) && operation.textChanges?.aggregateMappings?.find(mapping => documentDigest(mapping.before) === documentDigest(this.target))
      const splices = operation.textChanges?.source
      const stages: { before: string; after: string; from: number; to: number; inserted: number }[] = []
      let current = before.source
      if (splices?.length) for (let index = 0; index < splices.length; index++) {
        const edit = splices[index]!, span = { kind: 'markdown-range' as const, from: edit.from, to: edit.from + edit.inserted }
        const final = mapAcknowledgedRange(span, splices.slice(index + 1))
        const next = current.slice(0, edit.from) + after.source.slice(final.from, final.to) + current.slice(edit.to)
        stages.push({ before: current, after: next, ...edit }); current = next
      }
      if (!stages.length || current !== after.source) {
        stages.length = 0; current = before.source
        const edits = command?.type === 'markdown.splice' ? [{ from: command.from, to: command.to, text: command.text }]
          : documentSourceEdits(before.source, after.source).reverse()
        for (const edit of edits) {
          const next = current.slice(0, edit.from) + edit.text + current.slice(edit.to)
          stages.push({ before: current, after: next, from: edit.from, to: edit.to, inserted: edit.text.length }); current = next
        }
      }
      if (provenance) this.source.advance(before.source, after.source, own, inverse, undefined, provenance)
      for (const [index, stage] of stages.entries()) {
        const selected = acknowledged ? acknowledged.sourceIndexes.includes(index) : this.target.kind !== 'text-selection' || this.target.fragments.some(fragment => fragment.target.kind === 'markdown-range'
          && fragment.target.from <= stage.from && stage.to <= fragment.target.to)
        if (!provenance) this.source.advance(stage.before, stage.after, own && selected, inverse, stage)
        if (!acknowledged && this.target.kind === 'text-selection') this.target = { ...this.target, fragments: this.target.fragments.map(fragment => ({ ...fragment,
          target: fragment.target.kind === 'markdown-range' ? mapAcknowledgedRange(fragment.target, [stage]) : fragment.target })) }
      }
      if (acknowledged) this.target = structuredClone(acknowledged.after)
      return
    }
    if (this.htmlText && this.target.kind === 'html-author-field') {
      const a = readHtmlAuthorField(before, this.target)
      const target = this.target.source && isSourceDocumentModel(before) && isSourceDocumentModel(after)
        ? mapHtmlAuthorFieldTarget(before.source, after.source, this.target, true) : this.target
      const b = readHtmlAuthorField(after, target)
      // The source mapper proves the same node across its first software anchor.
      if (!this.target.source && !sameFieldValue(a.identity, b.identity)) { this.invalidate(); return }
      this.target = target
      this.htmlText.advance(a.value, b.value, own, inverse, undefined, provenance)
      return
    }
    if (this.componentText && this.target.kind === 'course-instance') {
      if (!sameFieldValue(this.componentIdentity, courseInstanceFieldIdentity(before, this.target))
        || !sameFieldValue(this.componentIdentity, courseInstanceFieldIdentity(after, this.target))) { this.invalidate('原文字字段所在行、项或单元格已改变，请重新选择。'); return }
      const a = componentText(before, this.target), b = componentText(after, this.target)
      if (a === null || b === null || !this.richComponentText && typeof a !== typeof b) { this.invalidate(); return }
      this.observeComponentRoots(before, after, own, inverse && reversing?.direction === 'redo')
      if (this.richComponentText) {
        const normalized = (value: string | FlowTextContent) => normalizeDocumentText(typeof value === 'string' ? { inlines: [{ type: 'text', text: value }] } : value)
        ;(this.componentText as CardTextEdits<FlowTextContent>).advance(normalized(a), normalized(b), own, inverse, undefined, provenance)
      } else (this.componentText as CardTextEdits<string>).advance(a as string, b as string, own, inverse, undefined, provenance)
      if (this.target.dataPath) this.target = courseInstanceTextTarget(after, this.target)
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
    if (this.target.kind === 'text-selection') {
      const children = this.fragmentTrackers?.map(tracker => tracker.view(submissionId))
      const unavailable = this.missing ? this.missingMessage : children?.find(view => view.unavailable)?.unavailable
        ?? (this.source && !this.source.traceable ? UNTRACEABLE : undefined)
      const changed = this.source?.changed ?? children?.some(view => view.state === 'applied' || view.state === 'undone') ?? false
      const target = { ...this.target, fragments: this.target.fragments.map((fragment, index) => ({ ...fragment,
        target: children?.[index]?.target as typeof fragment.target ?? fragment.target })) }
      let content: string | undefined
      try { content = readEditableTargetContent(this.session.read().model, target).text } catch { /* An unavailable target is reported below. */ }
      return { submissionId, state: changed ? (this.source?.undone ?? this.undone) ? 'undone' : 'applied' : 'none', fields: changed ? ['文字'] : [],
        target, ...(content === undefined ? {} : { content }), epoch: this.epoch, revision: this.revision,
        ...(unavailable || content === undefined ? { unavailable: unavailable ?? UNTRACEABLE } : {}) }
    }
    const text = this.source ?? this.componentText ?? this.htmlText
    if (text) {
      const place = this.htmlText ? { target: structuredClone(this.target), content: this.htmlText.content }
        : text.range && text.range.to > text.range.from ? {
        target: { ...this.target, ...text.range } as ExecutionSelectionTarget,
        content: typeof text.content === 'string' ? text.content : JSON.stringify(text.content),
      } : {}
      return { submissionId, state: text.changed ? text.undone ? 'undone' : 'applied' : 'none',
        fields: text.changed ? ['文字'] : [], ...place, epoch: this.epoch, revision: this.revision,
        ...(this.missing || !text.traceable ? { unavailable: this.missing ? this.missingMessage : UNTRACEABLE } : {}) }
    }
    const fields = [...new Set(elementChangeUnits(this.before, this.after).map(elementUnitLabel))]
    const unsupported = this.target.kind === 'course-instance' && !this.fieldAvailable
    return { submissionId, state: fields.length ? this.undone ? 'undone' : 'applied' : 'none', fields,
      ...(this.missing ? { unavailable: this.missingMessage } : unsupported ? { unavailable: UNSUPPORTED } : {}) }
  }
  private prepareInverse(snapshot: DocumentSnapshot, direction: 'undo' | 'redo', force: boolean): { command: DocumentCommand; textChanges?: import('../../../shared/workbench/document').DocumentTextChanges; accept(): void } | ElementRevertResult {
      let command: DocumentCommand, textChanges: import('../../../shared/workbench/document').DocumentTextChanges | undefined,
        accept = () => { this.undone = direction === 'undo' }
      if (this.fragmentTrackers && snapshot.model.kind === 'course-v10') {
        let model: DocumentModel = snapshot.model
        const edits: import('../../../shared/contracts/component-platform/operations').ComponentEdit[] = [], accepts: (() => void)[] = []
        for (const tracker of this.fragmentTrackers) {
          if (tracker.view('').state === 'none') continue
          const prepared = tracker.prepareInverse({ ...snapshot, model }, direction, force)
          if ('status' in prepared) return prepared
          if (prepared.command.type !== 'component-platform.apply') return { status: 'unavailable', message: UNTRACEABLE }
          edits.push(...prepared.command.edits); accepts.push(prepared.accept)
          model = { ...model, project: applyComponentOperation(model.project, prepared.command) }
        }
        command = captureComponentOperation(snapshot.model.project, edits)
        accept = () => { accepts.forEach(value => value()); this.undone = direction === 'undo' }
      } else if (this.source && isSourceDocumentModel(snapshot.model)) {
        const inverse = this.source.prepare(snapshot.model.source, direction)
        if (!inverse) return { status: 'unavailable', message: UNTRACEABLE }
        command = { type: 'markdown.replace', source: inverse.value }; accept = inverse.accept
        textChanges = { source: documentSourceEdits(snapshot.model.source, inverse.value).reverse().map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length })), flow: [] }
        if (this.target.kind === 'text-selection' && this.sourceSelectionBaseline) {
          const applied = { source: snapshot.model.source, target: structuredClone(this.target) }
          const original = direction === 'undo' ? this.sourceSelectionBaseline : this.sourceSelectionApplied
          if (!original) return { status: 'unavailable', message: UNTRACEABLE }
          try {
            const after = { ...original.target, fragments: original.target.fragments.map(fragment => ({ ...fragment,
              target: fragment.target.kind === 'markdown-range'
                ? mapMarkdownRange(original.source, inverse.value, fragment.target) : fragment.target })) }
            textChanges.aggregateMappings = [{ before: applied.target, after, sourceIndexes: textChanges.source.map((_, index) => index) }]
          } catch { return { status: 'unavailable', message: UNTRACEABLE } }
          accept = () => { inverse.accept(); if (direction === 'undo') this.sourceSelectionApplied = applied }
        }
      } else if (this.htmlText && this.target.kind === 'html-author-field') {
        const { value } = readHtmlAuthorField(snapshot.model, this.target)
        const inverse = this.htmlText.prepare(value, direction)
        if (!inverse) return { status: 'unavailable', message: UNTRACEABLE }
        const edit = prepareHtmlAuthorFieldEdit(snapshot.model, this.target, inverse.value)
        command = { type: 'markdown.replace', source: edit.source }
        textChanges = { source: edit.splices, flow: [] }
        accept = inverse.accept
      } else if (snapshot.model.kind === 'course-v10' && this.target.kind === 'course-instance') {
        const t: CourseInstanceTarget = this.target
        if (!componentFields(snapshot.model, t)) return { status: 'unavailable', message: UNTRACEABLE }
        const context = courseInstanceContext(snapshot.model, t), stateOwned = !!t.stateId && context.owner.kind === 'surface'
        if (this.componentText) {
          const original = readCourseInstanceText(snapshot.model, t)
          const content = this.richComponentText && original !== null ? normalizeDocumentText(typeof original === 'string' ? { inlines: [{ type: 'text', text: original }] } : original) : original
          const inverse = content === null ? null : typeof content === 'string'
            ? (this.componentText as CardTextEdits<string>).prepare(content, direction)
            : (this.componentText as CardTextEdits<FlowTextContent>).prepare(content, direction)
          if (!inverse || !t.dataPath) return { status: 'unavailable', message: UNTRACEABLE }
          const roots = componentRoots(snapshot.model, t), dataRoot = JSON.stringify([t.instanceId, 'data'])
          if (direction === 'undo' && stateOwned && roots && Object.hasOwn(this.rootsBefore, dataRoot)
            && this.rootsBefore[dataRoot] === undefined && sameFieldValue(roots[dataRoot], this.rootsAfter[dataRoot])) {
            const inherited = readCourseInstanceText(snapshot.model, { ...t, stateId: null })
            if (!sameFieldValue(this.richComponentText && inherited !== null ? normalizeDocumentText(typeof inherited === 'string' ? { inlines: [{ type: 'text', text: inherited }] } : inherited) : inherited, inverse.value)) return { status: 'conflict', fields: ['文字'] }
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
      return { command, textChanges, accept }
  }
  async revert(submissionId: string, direction: 'undo' | 'redo', force = false): Promise<ElementRevertResult> {
    const view = this.view(submissionId)
    if (view.state === 'none' || view.state === 'pending' || view.unavailable)
      return { status: 'unavailable', message: view.unavailable ?? '这次请求没有已完成的可撤销修改。' }
    const wasUndone = (this.source ?? this.componentText ?? this.htmlText)?.undone ?? this.undone
    if ((direction === 'undo') === wasUndone) return { status: 'unavailable', message: '这次修改已处于所选状态。' }
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.session.drain()
      if (this.missing || snapshot.epoch !== this.epoch) return { status: 'unavailable', message: this.missing ? this.missingMessage : UNTRACEABLE }
      const prepared = this.prepareInverse(snapshot, direction, force)
      if ('status' in prepared) return prepared
      const { command, textChanges, accept } = prepared
      const operationId = randomUUID(); this.inverses.add(operationId); this.fragmentTrackers?.forEach(tracker => tracker.inverses.add(operationId))
      cardPeers.get(this.session)!.inverses.set(operationId, { tracker: this, direction })
      try {
        const result = await this.session.execute({ documentId: this.documentId, epoch: snapshot.epoch,
          baseRevision: snapshot.revision, operationId, actor: 'human', ...(textChanges ? { textChanges } : {}), mutation: { type: 'command', command } })
        if (result.status === 'applied' || result.status === 'unchanged') {
          accept(); return { status: 'applied', change: this.view(submissionId) }
        }
        if (result.status !== 'conflict') return { status: 'unavailable', message: 'message' in result ? result.message : '未能确认本次修改。' }
      } finally { this.inverses.delete(operationId); this.fragmentTrackers?.forEach(tracker => tracker.inverses.delete(operationId)); cardPeers.get(this.session)!.inverses.delete(operationId) }
    }
    return { status: 'unavailable', message: '文档正在被修改，请稍后再试。' }
  }
}
