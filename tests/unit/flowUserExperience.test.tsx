import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { selectActiveCourseProjectDocument, useEditorStore } from '@/renderer/store/editorStore'
import { flowSurfaceIn } from '../../src/core/tools/flowDocumentModel'
import { createFormulaNode, createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { selectFlowOverlay, clearFlowEditorSelection } from '@/renderer/course/flowEditorSlice'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { flowPaperMaxWidth, resolveFlowBodyWidth } from '@/shared/flowBodyPresentation'
import { resolveFlowMediaLayoutInlineSize } from '@/shared/flowMediaLayout'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function documentNow() { return selectActiveCourseProjectDocument(useEditorStore.getState())! }

it('applies table blur once, cancels Escape, defers IME, and appends after the last cell in one transaction', () => {
  useEditorStore.getState().addTableNode()
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const cells = () => screen.getAllByRole('textbox', { name: /^单元格 / })
  const past = () => useEditorStore.getState().slideBackend!.getSession().history.past.length
  const baseline = past()
  const first = cells()[0]!
  fireEvent.focus(first)
  fireEvent.change(first, { target: { value: '失焦提交' } })
  fireEvent.blur(first)
  expect(past()).toBe(baseline + 1)
  expect(cells()[0]).toHaveValue('失焦提交')
  fireEvent.focus(cells()[0]!)
  fireEvent.blur(cells()[0]!)
  expect(past()).toBe(baseline + 1)
  fireEvent.focus(cells()[0]!)
  fireEvent.change(cells()[0]!, { target: { value: '取消输入' } })
  fireEvent.keyDown(cells()[0]!, { key: 'Escape' })
  fireEvent.blur(cells()[0]!)
  expect(past()).toBe(baseline + 1)
  expect(cells()[0]).toHaveValue('失焦提交')
  fireEvent.focus(cells()[0]!)
  fireEvent.compositionStart(cells()[0]!)
  fireEvent.change(cells()[0]!, { target: { value: '输入法完成' } })
  fireEvent.blur(cells()[0]!)
  expect(past()).toBe(baseline + 1)
  fireEvent.compositionEnd(cells()[0]!)
  expect(past()).toBe(baseline + 2)
  const count = cells().length
  const last = cells().at(-1)!
  fireEvent.focus(last)
  fireEvent.change(last, { target: { value: '末格' } })
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(past()).toBe(baseline + 3)
  expect(cells().length).toBeGreaterThan(count)
})

it('persists explicit fluid creation and changes the width via properties with Undo/Redo', () => {
  useEditorStore.getState().createNewFlowProject()
  act(() => { const flow = useEditorStore.getState().flowSession!; useEditorStore.getState().applyFlowSelection(clearFlowEditorSelection(flow.history.present, flow.selection.locationId)) })
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const flow = () => { const state = useEditorStore.getState().flowSession!; return flowSurfaceIn(state.history.present, state.selection.surfaceId) }
  expect(flow().layout.widthMode).toBe('fluid')
  const before = useEditorStore.getState().flowSession!.history.past.length
  fireEvent.change(screen.getByLabelText('讲义宽度'), { target: { value: 'reading' } })
  expect(flow().layout.widthMode).toBe('reading')
  expect(useEditorStore.getState().flowSession!.history.past.length).toBe(before + 1)
  expect(courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(documentNow())))).toEqual(documentNow())
  act(() => useEditorStore.getState().undo())
  expect(flow().layout.widthMode).toBe('fluid')
  act(() => useEditorStore.getState().redo())
  expect(flow().layout.widthMode).toBe('reading')
  expect(resolveFlowBodyWidth(flow().layout, 1280)).toBe(688)
  expect(resolveFlowBodyWidth({ ...flow().layout, widthMode: 'fluid' }, 1280)).toBe(1176)
  expect(resolveFlowBodyWidth({ ...flow().layout, widthMode: 'fluid' }, 640)).toBe(536)
  expect(flowPaperMaxWidth({ readingWidth: 760 })).toBe('760px')
  expect(resolveFlowMediaLayoutInlineSize('content-width', { ...flow().layout, widthMode: 'fluid' }, 1248)).toBe(1176)
})

function insertOverlay(global: boolean, formula: boolean) {
  useEditorStore.getState().createNewFlowProject()
  const state = useEditorStore.getState()
  const session = state.flowSession!
  const document = structuredClone(session.history.present)
  const item = sceneNodeToCourseLayerItem(formula
    ? createFormulaNode({ id: 'test-overlay', ast: { type: 'token', value: 'x' }, accessibleText: 'x' })
    : createTextNode({ id: 'test-overlay', x: 40, y: 24, text: '横幅' }))
  if (global) item.order = Math.max(0, ...document.globalLayerItems.map(entry => entry.item.order)) + 1
  const entry = { item, visibility: { mode: 'all' as const, locationIds: [] } }
  if (global) document.globalLayerItems.push(entry)
  else flowSurfaceIn(document, session.selection.surfaceId).surfaceLayerItems.push(entry)
  state.loadCourseProject(document, null)
  const fresh = useEditorStore.getState().flowSession!
  useEditorStore.getState().applyFlowSelection(selectFlowOverlay(fresh.history.present, fresh.selection.locationId, [item.layerItemId], global ? 'global' : 'page'))
  return item.layerItemId
}

it('exposes global Flow paper placement and undoes it without modifying the shared frame', () => {
  const id = insertOverlay(true, false)
  const before = structuredClone(locateCourseLayer(documentNow(), id)!.item)
  render(<PropertiesTab onReplaceImage={() => {}} />)
  fireEvent.change(screen.getByLabelText('定位空间'), { target: { value: 'paper' } })
  expect(locateCourseLayer(documentNow(), id)!.item).toEqual({ ...before, paperSpace: 'paper' })
  act(() => useEditorStore.getState().undo())
  expect(locateCourseLayer(documentNow(), id)!.item).toEqual(before)
})

it.each([false, true])('owns overlay formula drafts (global=%s), materializes recovery, and commits once on blur', (global) => {
  const id = insertOverlay(global, true)
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'x+y' } })
  expect(useEditorStore.getState().flowTextEdit).toMatchObject({ kind: 'formula', overlayScope: global ? 'global' : 'page', blockId: id, draft: { source: 'x+y' } })
  const before = useEditorStore.getState().flowSession!.history.past.length
  const snapshot = useEditorStore.getState().captureCourseProjectRecoverySnapshot()
  expect(snapshot.ok).toBe(true)
  if (!snapshot.ok) throw new Error(snapshot.reason)
  const recovered = locateCourseLayer(snapshot.snapshot.project, id)!.item
  expect(recovered.kind === 'native' && recovered.content.nativeType === 'formula' && recovered.content.data.accessibleText).toContain('y')
  expect(useEditorStore.getState().flowSession!.history.past.length).toBe(before)
  fireEvent.blur(input)
  expect(useEditorStore.getState().flowTextEdit).toBeNull()
  expect(useEditorStore.getState().flowSession!.history.past.length).toBe(before + 1)
  const item = locateCourseLayer(documentNow(), id)!.item
  expect(item.kind === 'native' && item.content.nativeType === 'formula' && item.content.data.accessibleText).toContain('y')
  act(() => useEditorStore.getState().undo())
  const original = locateCourseLayer(documentNow(), id)!.item
  expect(original.kind === 'native' && original.content.nativeType === 'formula' && original.content.data.accessibleText).toBe('x')
})


it('commits a focused overlay formula after IME blur using the final draft and keeps the selected object', async () => {
  const id = insertOverlay(false, true)
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
  fireEvent.focus(input)
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: 'x+z' } })
  fireEvent.blur(input)
  const before = useEditorStore.getState().flowSession!.history.past.length
  expect(useEditorStore.getState().flowTextEdit?.composing).toBe(true)
  fireEvent.compositionEnd(input)
  await waitFor(() => expect(useEditorStore.getState().flowTextEdit).toBeNull())
  expect(useEditorStore.getState().flowSession!.history.past.length).toBe(before + 1)
  expect(useEditorStore.getState().flowSession!.selection.selectedOverlayIds).toEqual([id])
})


it('keeps invalid global formula drafts for correction and explicitly cancels without history', () => {
  const id = insertOverlay(true, true)
  render(<PropertiesTab onReplaceImage={() => {}} />)
  const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'x+□' } })
  fireEvent.blur(input)
  const before = useEditorStore.getState().flowSession!.history.past.length
  expect(useEditorStore.getState().flowTextEdit?.draft).toMatchObject({ source: 'x+□', valid: false })
  expect(useEditorStore.getState().captureCourseProjectRecoverySnapshot().ok).toBe(false)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(useEditorStore.getState().flowTextEdit).toBeNull()
  expect(useEditorStore.getState().flowSession!.history.past.length).toBe(before)
  expect(useEditorStore.getState().flowSession!.selection.selectedOverlayIds).toEqual([id])
})
