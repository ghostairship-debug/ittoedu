import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as editorSession from '../../src/renderer/document/editorSession'
import { ProfessionalContentEditor } from '../../src/renderer/ui/workspaces/ProfessionalContentEditor'
import { createFormulaComponentData, createTextComponentData, type TextComponentData } from '../../src/components/text/data'
import { FORMULA_DEFINITION, TEXT_DEFINITION } from '../../src/components/text/adapters'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})

it('Escape on a whole formula applies through its owner and keeps its draft while the ACK is pending or rejected', async () => {
  const original = createFormulaComponentData('formula', 'x+1'), data = createFormulaComponentData('formula', 'y^2')
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'formula-completion', revision: 0, title: 'formula',
    definitions: { [FORMULA_DEFINITION.id]: FORMULA_DEFINITION }, instances: { formula: { id: 'formula', definitionId: FORMULA_DEFINITION.id,
      frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] }, data: JSON.parse(JSON.stringify(original)) } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['formula'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'slide', activeStateId: null, instanceId: 'formula', instanceIds: ['formula'] }
  const draft: SlideContentEdit = { instanceId: 'formula', definitionId: FORMULA_DEFINITION.id, target, data: JSON.parse(JSON.stringify(data)),
    originalData: project.instances.formula.data, composing: false, source: 'canvas' }
  const host = document.createElement('main'); document.body.append(host)
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_resolve, fail) => { reject = fail }), commit = vi.fn(() => pending), cancel = vi.fn(), report = vi.fn()
  function Harness() {
    const [editing, setEditing] = useState(true)
    return editing ? <ProfessionalContentEditor project={project} draft={draft} target={() => host}
      update={() => {}} updateSpot={() => {}} commit={async () => { await commit(); setEditing(false) }}
      cancel={() => { cancel(); setEditing(false) }} undo={() => {}} redo={() => {}} report={report} /> : null
  }
  const ui = render(<Harness />)
  try {
    const editor = await screen.findByRole('textbox', { name: '正文编辑' })
    await act(async () => { fireEvent.keyDown(editor, { key: 'Escape', keyCode: 27, which: 27 }) })
    expect(commit).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled()
    expect(host.querySelector('[data-component-professional-editor]')).not.toBeNull()
    await act(async () => { reject(new Error('写入暂时失败')); await Promise.resolve() })
    expect(report).toHaveBeenCalledWith('写入暂时失败')
    expect(host.querySelector('[data-component-professional-editor]')).not.toBeNull()
    expect(draft.data).toEqual(data); expect(cancel).not.toHaveBeenCalled()
  } finally { ui.unmount(); host.remove() }
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  geometry.forEach((key, index) => { if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!); else Reflect.deleteProperty(Range.prototype, key) })
})

it('a PM toolbar portaled into the current quick bar opens its palette and formats only its real text range', async () => {
  const data = createTextComponentData('Alpha beta gamma')
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'portaled-colour', revision: 0, title: 'palette',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id,
      frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] }, data: JSON.parse(JSON.stringify(data)) } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'slide', activeStateId: null, instanceId: 'text', instanceIds: ['text'] }
  const draft: SlideContentEdit = { instanceId: 'text', definitionId: TEXT_DEFINITION.id, target, data: project.instances.text.data,
    originalData: project.instances.text.data, composing: false, source: 'canvas' }
  const host = document.createElement('main'); host.className = 'workspace'; document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 700))
  const factory = vi.spyOn(editorSession, 'createLayoutEditor'), update = vi.fn(), commit = vi.fn(async () => {})
  const ui = render(<ProfessionalContentEditor project={project} draft={draft} target={() => host} floatingToolbar
    update={update} updateSpot={() => {}} commit={commit} cancel={() => {}} undo={() => {}} redo={() => {}} report={() => {}} />)
  try {
    await screen.findByRole('toolbar', { name: '文字编辑工具' })
    const editor = factory.mock.results.find(result => result.type === 'return' && result.value)?.value as ReturnType<typeof editorSession.createLayoutEditor>
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 6))))
    fireEvent.click(screen.getByRole('button', { name: '文字颜色' }))
    expect(screen.getByRole('radiogroup', { name: '常用色' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: '红色' })) })
    await waitFor(() => expect(update).toHaveBeenCalled())
    const changed = update.mock.calls.at(-1)![0] as TextComponentData
    expect(changed.content.inlines).toEqual([{ type: 'text', text: 'Alpha', style: { color: '#ef4444' } }, { type: 'text', text: ' beta gamma' }])
    expect(screen.queryByRole('radiogroup', { name: '常用色' })).toBeNull()
    expect(screen.getAllByRole('toolbar')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '高亮' }))
    expect(screen.getByRole('radiogroup', { name: '高亮色' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('radiogroup', { name: '高亮色' })).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  } finally { ui.unmount(); host.remove() }
})
