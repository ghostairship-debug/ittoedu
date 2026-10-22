import { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { TABLE_DEFINITION, createTableData, parseTableData } from '../../src/components/table'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { JsonValue } from '../../src/shared/contracts/component-platform'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const probe = vi.hoisted(() => ({ view: null as EditorView | null }))
vi.mock('../../src/renderer/document/editorSession', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/document/editorSession')>()
  return { ...actual, createLayoutEditor: (...args: Parameters<typeof actual.createLayoutEditor>) => {
    const editor = actual.createLayoutEditor(...args)
    // jsdom provides no painted caret geometry. The real PM document, selection,
    // React event chain and commit callback remain active.
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
    probe.view = editor.view
    return editor
  } }
})
const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); probe.view = null
  geometry.forEach((key, index) => {
    if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!)
    else Reflect.deleteProperty(Range.prototype, key)
  })
})

it.each([{ key: 'Escape', keyCode: 27, which: 27 }, { key: 'Enter', keyCode: 13, which: 13, ctrlKey: true }])('native professional completion $key reaches its original owner with browser keyCode', async key => {
  const table = createTableData({ rows: 1, columns: 2 })
  const { text: _text, ...first } = table.rows[0].cells[0]
  table.rows[0].cells[0] = { ...first, content: { inlines: [
    { type: 'text', text: 'Alpha', style: { bold: true } },
    { type: 'math', formulaId: 'kept-math', latex: 'x^2', accessibleText: 'x squared' },
  ] } }
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'native-escape', revision: 0, title: 'native Esc',
    definitions: { [TABLE_DEFINITION.id]: TABLE_DEFINITION }, instances: { item: { id: 'item', definitionId: TABLE_DEFINITION.id,
      data: table as unknown as JsonValue, frame: { width: 400, height: 80, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'page', childIds: ['item'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: 'slide', activeStateId: null, instanceId: 'item', instanceIds: ['item'] }
  const host = document.createElement('div'); document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
  const completed = vi.fn(), cancelled = vi.fn(), report = vi.fn()
  let committed: JsonValue | undefined
  const owner: { entry?: ReturnType<typeof useSlideNativeTextEditor> } = {}
  function Harness() {
    const [edit, setEdit] = useState<SlideContentEdit | null>(null)
    owner.entry = useSlideNativeTextEditor({ project, surfaceId: 'slide', edit, host: () => host,
      begin: instanceId => { const data = structuredClone(project.instances[instanceId].data)
        const draft: SlideContentEdit = { instanceId, definitionId: TABLE_DEFINITION.id, target, data, originalData: data, composing: false, source: 'canvas' }
        setEdit(draft); return draft },
      update: data => setEdit(previous => previous && { ...previous, data: data as JsonValue }),
      commit: async () => { completed(); committed = edit?.data; setEdit(null) },
      cancel: () => { cancelled(); setEdit(null) }, undo() {}, redo() {}, report,
    }, 'doc:epoch:slide')
    return owner.entry.editor
  }
  const ui = render(<Harness />, { container: host })
  try {
    await act(async () => expect(owner.entry!.begin('item', { x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true))
    await act(async () => { const view = probe.view!; view.dispatch(view.state.tr.insertText(' edited', view.state.doc.content.size - 1)) })
    await act(async () => { const view = probe.view!; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4))) })
    const body = host.querySelector<HTMLElement>('.ProseMirror')!
    expect(probe.view!.state.selection.empty).toBe(false)
    await act(async () => { fireEvent.keyDown(body, { key: 'Escape', keyCode: 27, which: 27, isComposing: true }) })
    expect(completed).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(body, key) })
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    expect(host.querySelector('[data-component-professional-editor]')).toBeNull()
    const accepted = parseTableData(committed), content = accepted.rows[0].cells[0].content!
    expect(content.inlines.some(inline => inline.type === 'text' && inline.text.includes('Alpha') && inline.style?.bold)).toBe(true)
    expect(content.inlines).toContainEqual({ type: 'math', formulaId: 'kept-math', latex: 'x^2', accessibleText: 'x squared' })
    expect(content.inlines.some(inline => inline.type === 'text' && inline.text.includes(' edited'))).toBe(true)
    expect(accepted.rows[0].cells[1]).toEqual(table.rows[0].cells[1])
    expect(cancelled).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled()
  } finally { ui.unmount(); host.remove() }
})

it('document scope keeps Escape for its own contextual tools', async () => {
  const outer = vi.fn()
  const ui = render(<div onKeyDown={event => { if (event.key === 'Escape') outer(event.defaultPrevented) }}>
    <SharedDocumentEditor document={{ content: { blocks: [{ id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'document text' }] } }] }, resources: emptyDocumentResources() }}
      revision="doc:1" onDraft={() => {}} onChange={() => true} onUndo={() => {}} onRedo={() => {}} />
  </div>)
  await act(async () => { const view = probe.view!; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5))) })
  await act(async () => { fireEvent.keyDown(ui.getByRole('textbox', { name: '正文编辑' }), { key: 'Escape', keyCode: 27, which: 27 }) })
  expect(outer).toHaveBeenCalledWith(true)
})
