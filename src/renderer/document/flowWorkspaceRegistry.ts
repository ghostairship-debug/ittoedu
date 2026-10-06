import type { TextRunStyle } from '../../shared/contracts/native-v1'
import type { FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'

export interface FlowBlockFocusRequest { documentId: string; surfaceId: string; blockId: string; revision: number }
export type FlowMenuPageCapture = { ok: false; reason: string } | { ok: true; documentId: string; projectId: string; revision: number;
  locationId: string; surfaceId: string; generation: number; selectedBlockId: string | null; selectionSignature: string;
  paperWidth: number; bodyWidth: number; paragraphRects: readonly FlowParagraphBlockRect[] }
type FlowWorkspaceReadiness = { ok: boolean; reason?: string }
const flowMenuCaptureListeners = new Set<() => FlowMenuPageCapture>()
const focusListeners = new Set<(request: FlowBlockFocusRequest) => boolean>()
const selectionListeners = new Set<() => void>()
const flushListeners = new Map<string, () => FlowWorkspaceReadiness>()
const drainListeners = new Map<string, () => Promise<FlowWorkspaceReadiness>>()
const caretFormatListeners = new Map<string, (style: TextRunStyle) => boolean>()
let pendingSelection: { documentId: string; surfaceId: string; blockId: string; expires: number } | null = null

export function captureFlowMenuPage(): FlowMenuPageCapture {
  return flowMenuCaptureListeners.size === 1 ? [...flowMenuCaptureListeners][0]() : { ok: false, reason: '当前 Flow 页面尚未就绪' }
}
export function flushFlowWorkspace(documentId: string): FlowWorkspaceReadiness { return flushListeners.get(documentId)?.() ?? { ok: true } }
export async function drainFlowWorkspace(documentId: string): Promise<FlowWorkspaceReadiness> { return drainListeners.get(documentId)?.() ?? flushFlowWorkspace(documentId) }
export function applyFlowCaretStyle(documentId: string, style: TextRunStyle): boolean { return caretFormatListeners.get(documentId)?.(style) ?? false }
export function requestFlowBlockFocus(request: FlowBlockFocusRequest): boolean { return [...focusListeners].some(listener => listener(request)) }
export function requestFlowBlockSelection(request: { documentId: string; surfaceId: string; blockId: string }): void {
  pendingSelection = { ...request, expires: Date.now() + 2000 }; selectionListeners.forEach(listener => listener())
}

export function registerFlowMenuCapture(capture: () => FlowMenuPageCapture): () => void {
  flowMenuCaptureListeners.add(capture)
  return () => { flowMenuCaptureListeners.delete(capture) }
}
export function registerFlowWorkspaceFlush(documentId: string, flush: () => FlowWorkspaceReadiness): () => void {
  flushListeners.set(documentId, flush)
  return () => { flushListeners.delete(documentId) }
}
export function registerFlowWorkspaceDrain(documentId: string, drain: () => Promise<FlowWorkspaceReadiness>): () => void {
  drainListeners.set(documentId, drain)
  return () => { drainListeners.delete(documentId) }
}
export function registerFlowCaretFormat(documentId: string, apply: (style: TextRunStyle) => boolean): () => void {
  caretFormatListeners.set(documentId, apply)
  return () => { caretFormatListeners.delete(documentId) }
}
export function registerFlowBlockFocus(focus: (request: FlowBlockFocusRequest) => boolean): () => void {
  focusListeners.add(focus)
  return () => { focusListeners.delete(focus) }
}
export function registerFlowBlockSelection(documentId: string, surfaceId: string, selectBlock: (blockId: string) => boolean): () => void {
  const select = () => {
    const request = pendingSelection
    if (!request || request.expires < Date.now()) { pendingSelection = null; return }
    if (request.documentId !== documentId || request.surfaceId !== surfaceId || !selectBlock(request.blockId)) return
    pendingSelection = null
  }
  selectionListeners.add(select); select()
  return () => { selectionListeners.delete(select) }
}
