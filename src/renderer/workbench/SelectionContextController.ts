import type { SlideEditorView } from '../../core/tools/slideLayerView'
import { useSyncExternalStore } from 'react'
import type { DocumentContextSelection } from '../../shared/document/ports'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ExecutionDocumentReference, ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'
import { containsTarget, readTarget, prepareExecutionContentOutput, flowTextSelectionTarget } from '../../core/tools/ToolTargets'
import type { ExecutionContentOutput } from '../../shared/workbench/execution'
import { isCourseInstanceRange, type CourseInstanceTarget } from '../../core/tools/ToolTargets'

export interface SelectionCapture {
  documentId: string
  epoch: string
  revision: number
  targets: ExecutionSelectionTarget[]
  label: string
  /** Only used to map a live Markdown highlight; never a writer or an authorization. */
  source?: string
}
export interface ContextualEditRequest { selection: SelectionCapture; instruction: string; contentOutput?: ExecutionContentOutput }
export function captureSelection(snapshot: DocumentSnapshot, targets: readonly ExecutionSelectionTarget[], label: string, source?: string): SelectionCapture {
  if (!targets.length) throw new Error('没有选中内容，请先选择明确的修改范围。')
  for (const target of targets) {
    if ((target.kind === 'markdown-range' || target.kind === 'flow-range' || isCourseInstanceRange(target)) && target.from >= target.to) throw new Error('选区为空，不会扩大到整份文档。')
    readTarget(snapshot.model, target)
  }
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, targets: structuredClone([...targets]), label, ...(source !== undefined ? { source } : {}) }
}
/** The host owner determines whether an object can carry a named scene state. */
export function captureCourseObjectSelection(snapshot: DocumentSnapshot, locationId: string, itemIds: readonly string[], stateId?: string | null): SelectionCapture {
  return captureCourseInstanceSelection(snapshot, locationId, itemIds, `所选 ${itemIds.length} 个对象${stateId ? '（当前命名态）' : ''}`, stateId)
}
export function captureCourseInstanceSelection(snapshot: DocumentSnapshot, surfaceId: string, instanceIds: readonly string[], label = `所选 ${instanceIds.length} 个对象`, stateId?: string | null): SelectionCapture {
  return captureSelection(snapshot, instanceIds.map(instanceId => ({ kind: 'course-instance', surfaceId, instanceId, stateId: stateId ?? null })), label)
}
export function captureCourseInstanceRange(snapshot: DocumentSnapshot, surfaceId: string, instanceId: string, dataPath: readonly string[], from: number, to: number, label = '所选文字', stateId?: string | null, fieldScope: 'data' | 'flowLayout' = 'data'): SelectionCapture {
  return captureSelection(snapshot, [{ kind: 'course-instance', surfaceId, instanceId, stateId: stateId ?? null, ...(fieldScope !== 'data' ? { fieldScope } : {}), dataPath: [...dataPath], from, to }], label)
}
/** Composition addresses belong to the software; an element card freezes only the selected subtree. */
export function captureCompositionSelection(snapshot: DocumentSnapshot, locationId: string, itemId: string, nodeId: string,
  stateId?: string | null, label = '所选内容'): SelectionCapture {
  if (snapshot.model.kind !== 'course-v10') throw new Error('当前文档不是 Project V10。')
  const root: CourseInstanceTarget = { kind: 'course-instance', surfaceId: locationId, instanceId: itemId, stateId: stateId ?? null }
  const target: CourseInstanceTarget = { ...root, instanceId: nodeId }
  if (!containsTarget(root, target, snapshot.model)) throw new Error('所选内部内容不是这个组件的正式子实例。')
  return captureSelection(snapshot, [target], label)
}
export function matchesCourseObjectState(target: Extract<ExecutionSelectionTarget, { kind: 'course-object' }>, locationId: string | null | undefined, stateId: string | null | undefined, sceneOwned: boolean): boolean {
  return target.locationId === locationId && target.stateId === (sceneOwned ? stateId ?? undefined : undefined)
}
/** SlideEditorView already contains the canonical materialized state, never its base source item. */
export function resolveSlideSelectionLayer(view: SlideEditorView | null | undefined, target: Extract<ExecutionSelectionTarget, { kind: 'course-object' }>) {
  const layer = view?.layers.find(value => value.selectionId === target.itemId)
  return view && layer && matchesCourseObjectState(target, view.locationId, view.presentation?.activeStateId, layer.source === 'scene') ? layer : undefined
}

export function captureMarkdownSelection(snapshot: DocumentSnapshot, value: DocumentContextSelection): SelectionCapture {
  if (snapshot.model.kind !== 'markdown' || snapshot.model.source !== value.source) throw new Error('正文输入尚未确认或选区已改变，请重新选择。')
  if (!value.ranges?.length) throw new Error(value.message ?? '正文选区无法定位。')
  return captureSelection(snapshot, value.ranges.map(range => ({ kind: 'markdown-range', from: range.from, to: range.to })), value.label, value.source)
}
/** One block of a Flow document as a whole, found by its identity whatever else changed (an element AI card, M15). */
export function captureFlowBlock(snapshot: DocumentSnapshot, surfaceId: string, blockId: string, label: string): SelectionCapture {
  return captureCourseInstanceSelection(snapshot, surfaceId, [blockId], label)
}
export function captureFlowSelection(snapshot: DocumentSnapshot, surfaceId: string, value: DocumentContextSelection, stateId?: string | null): SelectionCapture {
  if (snapshot.model.kind !== 'course-v10' || !value.selection) throw new Error('请在正文中选择要修改的内容。')
  const selected = value.selection
  if (selected.revision !== String(snapshot.revision)) throw new Error('正文选区已改变，请重新选择。')
  if (selected.kind === 'object') return captureFlowBlock(snapshot, surfaceId, selected.blockId, value.label)
  if (selected.kind !== 'text') throw new Error('请选择一个明确的正文或文字范围。')
  return captureSelection(snapshot, [flowTextSelectionTarget(snapshot.model, surfaceId, selected, stateId)], value.label)
}

/** Renderer selection/pin projection. It cannot dispatch edits or widen host write grants. */
export class SelectionContextController {
  private manual = new Map<string, SelectionCapture>()
  private pinned = new Map<string, SelectionCapture>()
  private version = 0
  private tickets = new Map<string, number>()
  private listeners = new Set<() => void>()
  private requestHandler?: (request: ContextualEditRequest) => void
  private preparers = new Map<string, () => Promise<DocumentSnapshot>>()
  private fallback?: (documentId: string) => Promise<DocumentSnapshot>
  constructor(private readonly readDocument = (id: string) => window.desktopAPI!.documents!.read(id)) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readVersion = () => this.version
  private notify() { ++this.version; for (const listener of this.listeners) listener() }
  getManual(id: string) { return this.manual.get(id) ?? null }
  getPinned(id: string) { return this.pinned.get(id) ?? null }
  setManual(id: string, value: SelectionCapture | null) {
    // Explicit user/card navigation takes precedence over a read of an earlier canvas selection.
    this.tickets.set(id, (this.tickets.get(id) ?? 0) + 1)
    if (JSON.stringify(this.manual.get(id) ?? null) === JSON.stringify(value)) return
    if (value) this.manual.set(id, structuredClone(value)); else this.manual.delete(id)
    this.notify()
  }
  async observe(id: string, revision: number, make: (snapshot: DocumentSnapshot) => SelectionCapture | null, active = () => true) {
    const ticket = (this.tickets.get(id) ?? 0) + 1; this.tickets.set(id, ticket)
    try {
      const snapshot = await this.readDocument(id)
      if (this.tickets.get(id) !== ticket || !active()) return
      this.setManual(id, snapshot.revision === revision ? make(snapshot) : null)
    } catch { if (this.tickets.get(id) === ticket && active()) this.setManual(id, null) }
  }
  register(id: string, prepare: () => Promise<DocumentSnapshot>) { this.preparers.set(id, prepare); return () => { if (this.preparers.get(id) === prepare) this.preparers.delete(id) } }
  setFallback(prepare: (id: string) => Promise<DocumentSnapshot>) { this.fallback = prepare; return () => { if (this.fallback === prepare) this.fallback = undefined } }
  async prepare(id: string) { return this.preparers.get(id)?.() ?? this.fallback?.(id) ?? this.readDocument(id) }
  setPinned(references: readonly ExecutionDocumentReference[]) {
    const next = new Map<string, SelectionCapture>()
    for (const reference of references) if (reference.selection?.length) {
      const old = this.pinned.get(reference.documentId), manual = this.manual.get(reference.documentId)
      const matching = [old, manual].find(value => value?.epoch === reference.epoch && value.revision === reference.revision && JSON.stringify(value.targets) === JSON.stringify(reference.selection))
      next.set(reference.documentId, matching ?? { documentId: reference.documentId, epoch: reference.epoch, revision: reference.revision, targets: structuredClone(reference.selection), label: `选中 ${reference.selection.length} 处内容` })
    }
    if (JSON.stringify([...next]) === JSON.stringify([...this.pinned])) return
    this.pinned = next; this.notify()
  }
  onRequest(handler: (request: ContextualEditRequest) => void) { this.requestHandler = handler; return () => { if (this.requestHandler === handler) this.requestHandler = undefined } }
  async request(selection: SelectionCapture, instruction: string, contentOnly = false) {
    if (!instruction.trim() || !selection.targets.length) throw new Error('请选择内容并输入修改要求。')
    const snapshot = await this.prepare(selection.documentId)
    if (snapshot.epoch !== selection.epoch || snapshot.revision !== selection.revision) throw new Error('选中的内容已改变，请重新选择后发送。')
    captureSelection(snapshot, selection.targets, selection.label)
    if (!this.requestHandler) throw new Error('统一创作助手尚未就绪。')
    const target = selection.targets.length === 1 ? selection.targets[0] : undefined
    const contentOutput = contentOnly && target ? prepareExecutionContentOutput(snapshot, target) : undefined
    this.requestHandler({ selection: structuredClone(selection), instruction, ...(contentOutput ? { contentOutput } : {}) })
  }
}
export const workbenchSelection = new SelectionContextController()
export function usePinnedSelection(documentId: string | null | undefined) {
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  return documentId ? workbenchSelection.getPinned(documentId) : null
}
export function selectionReference(value: SelectionCapture, writable: boolean): ExecutionDocumentReference {
  return { documentId: value.documentId, epoch: value.epoch, revision: value.revision, selection: structuredClone(value.targets), writable: writable ? structuredClone(value.targets) : [] }
}

export function captureDocumentReference(snapshot: DocumentSnapshot, writable: boolean, surfaceId?: string | null,
  manual = workbenchSelection.getManual(snapshot.documentId)): ExecutionDocumentReference {
  const selection = manual && manual.epoch === snapshot.epoch && manual.revision === snapshot.revision
    ? structuredClone(manual.targets) : surfaceId ? [{ kind: 'course-surface' as const, surfaceId }] : undefined
  if (selection) for (const target of selection) readTarget(snapshot.model, target)
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: writable ? [{ kind: 'document' }] : [], ...(selection ? { selection } : {}) }
}
/** Freeze the visible focus before draining pending edits; it is context, not a narrower write grant. */
export async function captureCourseDocumentReference(focus: { documentId: string; surfaceId: string | null }, writable: boolean,
  prepare: (documentId: string) => Promise<DocumentSnapshot>): Promise<ExecutionDocumentReference> {
  const { documentId, surfaceId } = focus, manual = workbenchSelection.getManual(documentId)
  const snapshot = await prepare(documentId)
  if (snapshot.documentId !== documentId) throw new Error('捕获的文档已改变，请重新发送。')
  return captureDocumentReference(snapshot, writable, surfaceId, manual)
}
