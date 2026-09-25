import { locateCourseLayer } from '../../core/drivers/course/layerProperties'
import type { SlideEditorView } from '../../core/tools/slideLayerView'
import { useSyncExternalStore } from 'react'
import type { DocumentContextSelection } from '../../shared/document/ports'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ExecutionDocumentReference, ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'
import { readTarget } from '../../core/tools/ToolTargets'
import { findFlowBlockRecursive } from '../../core/tools/flowDocumentModel'
import { resolveFlowContextSelection } from '../../core/tools/flowTextSlot'

export interface SelectionCapture {
  documentId: string
  epoch: string
  revision: number
  targets: ExecutionSelectionTarget[]
  label: string
  /** Only used to map a live Markdown highlight; never a writer or an authorization. */
  source?: string
}
export interface ContextualEditRequest { selection: SelectionCapture; instruction: string }
export function captureSelection(snapshot: DocumentSnapshot, targets: readonly ExecutionSelectionTarget[], label: string, source?: string): SelectionCapture {
  if (!targets.length) throw new Error('没有选中内容，请先选择明确的修改范围。')
  for (const target of targets) {
    if ((target.kind === 'markdown-range' || target.kind === 'flow-range') && target.from >= target.to) throw new Error('选区为空，不会扩大到整份文档。')
    readTarget(snapshot.model, target)
  }
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, targets: structuredClone([...targets]), label, ...(source !== undefined ? { source } : {}) }
}
/** The host owner determines whether an object can carry a named scene state. */
export function captureCourseObjectSelection(snapshot: DocumentSnapshot, locationId: string, itemIds: readonly string[], stateId?: string | null): SelectionCapture {
  if (snapshot.model.kind !== 'course-v9') throw new Error('当前文档不是课件。')
  const project = snapshot.model.project
  return captureSelection(snapshot, itemIds.map(itemId => {
    const owner = locateCourseLayer(project, itemId)
    if (!owner) throw new Error('所选对象已不存在。')
    return { kind: 'course-object', locationId, itemId, ...(owner.source === 'scene' && stateId ? { stateId } : {}) }
  }), `所选 ${itemIds.length} 个对象${stateId ? '（当前命名态）' : ''}`)
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
export function captureFlowSelection(snapshot: DocumentSnapshot, surfaceId: string, value: DocumentContextSelection): SelectionCapture {
  if (snapshot.model.kind !== 'course-v9' || !value.selection) throw new Error('请在正文中选择要修改的内容。')
  const surface = snapshot.model.project.surfaces.find(item => item.id === surfaceId)
  if (!surface || surface.type !== 'flow') throw new Error('讲义已不存在。')
  const target = resolveFlowContextSelection(surface.blocks, snapshot.revision, value.selection)
  const block = findFlowBlockRecursive(surface.blocks, target.blockId)
  if (!block) throw new Error('所选正文块已不存在。')
  const base = { surfaceId, blockId: target.blockId, parentId: block.parentId }
  return captureSelection(snapshot, [target.kind === 'text' ? { kind: 'flow-range', ...base, slot: target.textRange.slot, from: target.textRange.start, to: target.textRange.end } : { kind: 'flow-block', ...base }], value.label)
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
    if (JSON.stringify(this.manual.get(id) ?? null) === JSON.stringify(value)) return
    if (value) this.manual.set(id, structuredClone(value)); else this.manual.delete(id)
    this.notify()
  }
  async observe(id: string, revision: number, make: (snapshot: DocumentSnapshot) => SelectionCapture | null) {
    const ticket = (this.tickets.get(id) ?? 0) + 1; this.tickets.set(id, ticket)
    try {
      const snapshot = await this.readDocument(id)
      if (this.tickets.get(id) !== ticket) return
      this.setManual(id, snapshot.revision === revision ? make(snapshot) : null)
    } catch { if (this.tickets.get(id) === ticket) this.setManual(id, null) }
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
  async request(selection: SelectionCapture, instruction: string) {
    if (!instruction.trim() || !selection.targets.length) throw new Error('请选择内容并输入修改要求。')
    const snapshot = await this.prepare(selection.documentId)
    if (snapshot.epoch !== selection.epoch || snapshot.revision !== selection.revision) throw new Error('选中的内容已改变，请重新选择后发送。')
    captureSelection(snapshot, selection.targets, selection.label)
    if (!this.requestHandler) throw new Error('统一创作助手尚未就绪。')
    this.requestHandler({ selection: structuredClone(selection), instruction })
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

export function captureDocumentReference(snapshot: DocumentSnapshot, writable: boolean): ExecutionDocumentReference {
  const manual = workbenchSelection.getManual(snapshot.documentId)
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: writable ? [{ kind: 'document' }] : [],
    ...(manual && manual.epoch === snapshot.epoch && manual.revision === snapshot.revision ? { selection: structuredClone(manual.targets) } : {}) }
}
