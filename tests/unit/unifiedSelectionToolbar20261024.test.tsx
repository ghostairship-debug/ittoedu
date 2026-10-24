import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTextComponentData } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { TextFormatActions, type TextFormatView } from '../../src/renderer/editing/quickbar/TextFormatActions'
import { QuickBarButton, SelectionQuickBar } from '../../src/renderer/editing/quickbar/SelectionQuickBar'
import { CanvasPlainTextEditor, type CanvasPlainTextEditorHandle } from '../../src/renderer/ui/CanvasPlainTextEditor'
import { ProfessionalContentEditor } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  geometry.forEach((key, index) => { if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!); else Reflect.deleteProperty(Range.prototype, key) })
})
const bar = (children: React.ReactNode) => <SelectionQuickBar anchor={{ left: 100, top: 100, width: 200, height: 60 }}
  bounds={{ left: 0, top: 0, right: 1000, bottom: 700 }} label="当前目标快捷工具">{children}</SelectionQuickBar>

it('whole-object formatting reports mixed runs and emits the same explicit format commands', () => {
  const patch = vi.fn()
  const view: TextFormatView = { text: 'A😀B', runs: [{ start: 1, end: 3, style: { fontSize: 40, bold: true, fontFamily: 'Georgia' } }],
    style: { fontFamily: 'Arial', fontSize: 16, color: '#000000', bold: false, italic: false, underline: false, highlightColor: null, align: 'left', lineSpacing: 0 } }
  render(bar(<TextFormatActions view={view} patch={patch} />))
  expect(screen.getByText('全文')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'mixed')
  expect(screen.getByRole('spinbutton', { name: '字号' })).toHaveAttribute('placeholder', '混合')
  expect(screen.getByRole('combobox', { name: '字体' })).toHaveValue('__mixed')
  fireEvent.click(screen.getByRole('button', { name: '加粗' }))
  expect(patch).toHaveBeenLastCalledWith({ style: { bold: true } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '字号' }), { target: { value: '24' } })
  expect(patch).toHaveBeenLastCalledWith({ style: { fontSize: 24 } })
  fireEvent.click(screen.getByRole('button', { name: '减小字号' }))
  expect(patch).toHaveBeenLastCalledWith({ fontSizeStep: -1 })
})

it('a plain input keeps its draft and range while a quick-bar field takes focus, then finishes on a real departure', async () => {
  const commit = vi.fn(), ref = createRef<CanvasPlainTextEditorHandle>()
  render(<><CanvasPlainTextEditor editorRef={ref} bounds={{ x: 0, y: 0, width: 200, height: 40 }} value="literal <text>" label="字段" presentation="inline"
    onCommit={commit} onCancel={() => {}} />
    {bar(<><input aria-label="工具条输入" /><QuickBarButton label="全选文字" onClick={() => ref.current?.selectAll()} /></>)}<button>画布外</button></>)
  const input = screen.getByRole('textbox', { name: '字段' }), control = screen.getByRole('textbox', { name: '工具条输入' })
  await act(async () => { control.focus() })
  expect(commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '全选文字' }))
  expect(document.getSelection()?.toString()).toBe('literal <text>')
  input.textContent = 'updated <literal>'
  fireEvent.input(input)
  await act(async () => { screen.getByRole('button', { name: '画布外' }).focus() })
  expect(commit).toHaveBeenCalledOnce()
  expect(commit).toHaveBeenCalledWith('updated <literal>')
})

it('plain completion waits for IME and applies the final composed text once', async () => {
  const commit = vi.fn(), ref = createRef<CanvasPlainTextEditorHandle>()
  render(<CanvasPlainTextEditor editorRef={ref} bounds={{ x: 0, y: 0, width: 200, height: 40 }} value="原稿" label="字段" presentation="inline" onCommit={commit} onCancel={() => {}} />)
  const input = screen.getByRole('textbox', { name: '字段' })
  fireEvent.compositionStart(input)
  act(() => ref.current?.complete())
  expect(commit).not.toHaveBeenCalled()
  input.textContent = '输入完成'
  fireEvent.compositionEnd(input)
  expect(commit).toHaveBeenCalledOnce()
  expect(commit).toHaveBeenCalledWith('输入完成')
})

it('a professional string field supplies one truthful bar with select-all and completion', async () => {
  const data = createTextComponentData('parent')
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'plain-toolbar', revision: 0, title: 'plain',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id,
      frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] }, data: JSON.parse(JSON.stringify(data)) } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const host = document.createElement('main'); host.className = 'workspace'; document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 700))
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources: { assets: {}, components: {} },
    surfaceId: 'slide', activeStateId: null, instanceId: 'text', instanceIds: ['text'] }
  const authorSpot = { id: 'string-field', instanceId: 'text', mountGeneration: 1, kind: 'text' as const, initialValue: 'literal field',
    dataPath: ['label'], localBounds: { width: 200, height: 30, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } }
  const draft: SlideContentEdit = { instanceId: 'text', definitionId: TEXT_DEFINITION.id, target, data: project.instances.text.data,
    originalData: project.instances.text.data, composing: false, source: 'canvas', authorSpot, spotText: 'literal field' }
  const commit = vi.fn(async () => {}), update = vi.fn()
  const ui = render(<ProfessionalContentEditor project={project} draft={draft} target={() => host} floatingToolbar
    update={() => {}} updateSpot={update} commit={commit} cancel={() => {}} undo={() => {}} redo={() => {}} report={() => {}} />)
  try {
    const toolbar = await screen.findByRole('toolbar', { name: '文字编辑工具' })
    expect(screen.getAllByRole('toolbar')).toHaveLength(1)
    expect(within(toolbar).getByText('纯文本')).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: '加粗' })).toBeNull()
    fireEvent.click(within(toolbar).getByRole('button', { name: '全选文字' }))
    expect(document.getSelection()?.toString()).toBe('literal field')
    fireEvent.click(within(toolbar).getByRole('button', { name: '完成编辑' }))
    await waitFor(() => expect(commit).toHaveBeenCalledOnce())
    expect(update).toHaveBeenCalledWith('literal field', false)
  } finally { ui.unmount(); host.remove() }
})
