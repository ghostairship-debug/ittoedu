import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TABLE_DEFINITION, createTableData, layoutTable } from '../../src/components/table'
import { CHART_DEFINITION, createChartData } from '../../src/components/chart'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { authorFieldIdentity, type CourseInteractionSelection } from '../../src/renderer/documents/interactionSelection'
import { requestObjectEdit } from '../../src/renderer/editing/commands/objectContextMenu'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { insertCourseMedia } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { JsonValue } from '../../src/shared/contracts/component-platform'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

afterEach(() => { cleanup(); vi.restoreAllMocks(); useEditorStore.getState().courseBridge.dispose() })
const selection = (instanceId: string, path: string[]): CourseInteractionSelection => ({ kind: 'author-field', instanceId,
  field: { kind: 'text', fieldScope: 'data', dataPath: path, initialValue: 'old AI snapshot' } })

function fixture() {
  const table = createTableData({ rows: 2, columns: 2 })
  const { text: _text, ...first } = table.rows[0].cells[0]
  table.rows[0].cells[0] = { ...first, content: { inlines: [{ type: 'text', text: 'Rich current cell', style: { bold: true } }] } }
  table.columns[0].header = { inlines: [{ type: 'text', text: 'Current heading' }] }
  const chart = createChartData()
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'native-recovery', revision: 0, title: 'native',
    definitions: { [TABLE_DEFINITION.id]: TABLE_DEFINITION, [CHART_DEFINITION.id]: CHART_DEFINITION },
    instances: { table: { id: 'table', definitionId: TABLE_DEFINITION.id, data: table as unknown as JsonValue,
      frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 30, 50] } },
    chart: { id: 'chart', definitionId: CHART_DEFINITION.id, data: chart as unknown as JsonValue,
      frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 10, 20] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['table', 'chart'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const host = document.createElement('div'); document.body.append(host)
  const begin = vi.fn(() => ({} as SlideContentEdit)), selected = vi.fn()
  const hook = renderHook(() => useSlideNativeTextEditor({ project, readProject: () => project, surfaceId: 'slide', edit: null,
    begin, update() {}, commit: async () => {}, cancel() {}, undo() {}, redo() {}, report() {}, onSelectField: selected, host: () => host }, 'doc:epoch:slide'))
  return { ...hook, project, table, chart, host, begin, selected }
}

it('recovers rich table cells and headers from the formal dataPath without a pointer or edit side effect', () => {
  const f = fixture()
  try {
    const target = selection('table', ['rows', '0', 'cells', '0', 'content']), resolved = f.result.current.resolveSelection(target)!
    const cell = layoutTable(f.table, { width: 600, height: 300 }).cells.find(cell => cell.id === f.table.rows[0].cells[0].id)!
    expect(resolved.spot.localBounds).toEqual({ width: cell.width, height: cell.height, transform: [1, 0, 0, 1, cell.x, cell.y] })
    expect(resolved.spot.localBounds.width).toBeGreaterThan(0); expect(resolved.spot.localBounds.height).toBeGreaterThan(0)
    expect(resolved.spot.initialValue).toEqual(f.table.rows[0].cells[0].content)
    expect(authorFieldIdentity('table', resolved.spot)).toBe(authorFieldIdentity('table', target.kind === 'author-field' ? target.field : {} as never))
    const header = f.result.current.resolveSelection(selection('table', ['columns', '0', 'header']))!
    expect(header.spot.initialValue).toEqual(f.table.columns[0].header)
    expect(header.spot.localBounds.width).toBeGreaterThan(0)
    expect(f.begin).not.toHaveBeenCalled(); expect(f.selected).not.toHaveBeenCalled()
    // The captured semantic child survives a data reorder before an explicit edit request.
    const originalCell = f.table.rows[0].cells[0]
    f.table.rows.reverse(); f.project.instances.table.data = f.table as unknown as JsonValue
    expect(resolved.read()?.dataPath).toEqual(['rows', '1', 'cells', '0', 'content'])
    expect(resolved.read()?.initialValue).toEqual(originalCell.content)
    act(() => expect(resolved.activate()).toBe(true))
    expect(f.begin).toHaveBeenCalledOnce()
    expect(f.selected).toHaveBeenCalledWith(expect.objectContaining({ dataPath: ['rows', '1', 'cells', '0', 'content'] }), expect.any(Function), expect.any(Function))
  } finally { f.unmount(); f.host.remove() }
})

it('resolves only supported native field identities and respects lock when activation is explicit', () => {
  const f = fixture()
  try {
    expect(f.result.current.resolveSelection(selection('table', ['rows', '0', 'cells', '0', 'content', 'inlines', '0', 'text']))).toBeNull()
    expect(f.result.current.resolveSelection(selection('table', ['rows', '0', 'cells', '0', 'text']))).toBeNull()
    expect(f.result.current.resolveSelection(selection('table', ['rows', '50', 'cells', '0', 'content']))).toBeNull()
    const target = selection('table', ['rows', '0', 'cells', '0', 'content'])
    if (target.kind !== 'author-field') throw new Error('field fixture')
    expect(f.result.current.resolveSelection({ ...target, field: { ...target.field, authorKey: 'arbitrary-JSON' } })).toBeNull()
    f.project.instances.table.locked = true
    const locked = f.result.current.resolveSelection(target)!
    expect(locked.spot.localBounds.width).toBeGreaterThan(0)
    act(() => expect(locked.activate()).toBe(false))
    expect(f.begin).not.toHaveBeenCalled()
  } finally { f.unmount(); f.host.remove() }
})

it('recovers chart labels from current SVG geometry and never invents an unpainted label', () => {
  const f = fixture()
  try {
    const target = selection('chart', ['categories', '0', 'label'])
    expect(f.result.current.resolveSelection(target)).toBeNull()
    f.host.innerHTML = '<svg data-native-chart-id="chart"><text data-chart-category-id="a">甲</text></svg>'
    const text = f.host.querySelector('text')!
    Object.defineProperty(text, 'getBBox', { value: () => ({ x: 35, y: 90, width: 180, height: 24 }) })
    const resolved = f.result.current.resolveSelection(target)!
    expect(resolved.spot.localBounds).toEqual({ width: 180, height: 32, transform: [1, 0, 0, 1, 35, 90] })
    expect(resolved.spot.initialValue).toBe('甲')
    expect(f.begin).not.toHaveBeenCalled(); expect(f.selected).not.toHaveBeenCalled()
  } finally { f.unmount(); f.host.remove() }
})

it('routes an explicit edit of the currently selected native image to its existing crop owner', async () => {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:image-crop-test'); URL.revokeObjectURL = vi.fn()
  try {
    const host = await createCourseDocumentHost(), store = () => useEditorStore.getState()
    await store().connectCourseDocuments(host.api); store().setEditingScope('scene')
    await insertCourseMedia(store().courseKernel, store().courseKernel.captureTarget(), [{ meta: { id: 'photo', filename: 'photo.png', mimeType: 'image/png',
      kind: 'image', path: 'assets/photo.png', byteLength: 4, width: 640, height: 360 }, bytes: new Uint8Array([1, 2, 3, 4]) }], { width: 320, height: 180 })
    await store().drainCourseDocument()
    const documentId = store().courseView.activeDocumentId!, id = store().courseView.selectedInstanceIds[0]!, before = host.registry.get(documentId).read()
    function CurrentSelection() {
      const view = useEditorStore(state => state.courseView)
      return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}><main data-testid="canvas">
        <NativeSelectionContext documentId={documentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId} itemIds={view.selectedInstanceIds} enabled
          bounds={() => ({ left: 100, top: 100, width: 320, height: 180 })} />
      </main></CourseEditorChromeContext.Provider>
    }
    render(<CurrentSelection />)
    await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
    const root = screen.getByTestId('canvas')
    act(() => expect(requestObjectEdit(root, 'some-other-object')).toBe(false))
    act(() => expect(requestObjectEdit(root, id)).toBe(true))
    expect(screen.getByRole('dialog', { name: '裁剪图片' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '裁剪图片' })).toBeNull()
    expect(host.registry.get(documentId).read().revision).toBe(before.revision)
    expect(host.registry.get(documentId).read().undoDepth).toBe(before.undoDepth)
    act(() => store().selectNodes([]))
    act(() => expect(requestObjectEdit(root, id)).toBe(false))
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke }
})
