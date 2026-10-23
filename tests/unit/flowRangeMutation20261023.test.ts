import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { Slice } from 'prosemirror-model'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { documentFlowEditingPlugin } from '../../src/renderer/document/documentFlowEditing'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { DocumentBlock } from '../../src/shared/document/content'
import { flowDocumentEdits, projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const paragraph = (id: string, text: string): DocumentBlock => ({ id, type: 'paragraph', content: { inlines: text ? [{ type: 'text', text }] : [] } })
const group = (id: string, blocks: DocumentBlock[]): DocumentBlock => ({ id, type: 'course-instance', blocks })
const editors: ReturnType<typeof createLayoutEditor>[] = []
afterEach(() => { for (const editor of editors) { const host = editor.view.dom.parentElement; editor.destroy(); host?.remove() } editors.length = 0 })
function fixture(middle = false, selection?: () => void) {
  const host = document.createElement('div'); document.body.append(host)
  const change = vi.fn(() => true)
  const editor = createLayoutEditor(host, { document: { content: { blocks: [group('grid', [group('left', [paragraph('a', 'ABC'), ...(middle ? [paragraph('middle', 'Middle')] : [])]), group('right', [paragraph('b', 'XYZ')])]), paragraph('tail', 'Tail')] }, resources: emptyDocumentResources() }, revision: '0', presentation: 'flow', projectionPlugins: [documentFlowEditingPlugin({ isMultiColumnLayout: id => id === 'grid' })], change, selection, diagnostic: vi.fn(), undo() {}, redo() {} })
  editors.push(editor)
  const position = (id: string) => { let found = -1; editor.view.state.doc.descendants((node, at) => { if (node.attrs.id === id) found = at }); return found }
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position('a') + 2, position('b') + 2)))
  const key = (name: string, shift = false) => editor.view.someProp('handleKeyDown', handle => handle(editor.view, new KeyboardEvent('keydown', { key: name, shiftKey: shift })))
  return { editor, change, position, key, content: () => fromEditorDocument(editor.view.state.doc).blocks }
}
function clipboardEvent(type: string, values: Record<string, string> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: { getData: (key: string) => values[key] ?? '', setData: (key: string, value: string) => { values[key] = value } } })
  return event
}
function dropEvent(): DragEvent {
  if (typeof DragEvent !== 'undefined') return new DragEvent('drop', { bubbles: true, cancelable: true })
  // JSDOM omits DragEvent; keep an actual mouse event with its required drag field.
  return Object.assign(new MouseEvent('drop', { bubbles: true, cancelable: true }), { dataTransfer: null })
}
const expectedText = (left = 'AQ') => [group('grid', [group('left', [paragraph('a', left)]), group('right', [paragraph('b', 'YZ')])]), paragraph('tail', 'Tail')]
describe('Flow range mutation carriers', () => {
  it('keeps both original columns and unselected suffix when replacing selected text', () => {
    const f = fixture()
    f.editor.view.dispatch(f.editor.view.state.tr.insertText('Q'))
    expect(f.content()).toEqual(expectedText())
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('keeps columns when %s Shift-Enter replaces their selected text', shift => {
    const f = fixture()
    expect(f.key('Enter', shift)).toBe(true)
    const grid = f.content()[0]
    if (grid.type !== 'course-instance' || !grid.blocks) throw new Error('Expected columns')
    expect(grid.blocks[1]).toEqual(group('right', [paragraph('b', 'YZ')]))
    expect(grid.blocks[0].id).toBe('left')
    expect(f.content()[1]).toEqual(paragraph('tail', 'Tail'))
    expect(f.editor.view.state.doc.textContent).toBe('AYZTail')
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('keeps the same carrier semantics through default plain paste', () => {
    const f = fixture()
    f.editor.view.pasteText('Q', clipboardEvent('paste', { 'text/plain': 'Q' }))
    expect(f.content()).toEqual(expectedText())
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('keeps the end column when the HTML paste consumer inserts structural content', () => {
    const f = fixture(), event = clipboardEvent('paste', { 'text/html': '<p>Q</p>' })
    expect(f.editor.view.someProp('handlePaste', handle => handle(f.editor.view, event, Slice.empty))).toBe(true)
    const grid = f.content()[0]
    if (grid.type !== 'course-instance' || !grid.blocks) throw new Error('Expected columns')
    expect(grid.blocks[1]).toEqual(group('right', [paragraph('b', 'YZ')]))
    expect(grid.blocks[0].id).toBe('left')
    expect(f.editor.view.state.doc.textContent).toBe('AQYZTail')
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('cuts only selected content and copies no partially selected column carrier', () => {
    const f = fixture(), values: Record<string, string> = {}, event = clipboardEvent('cut', values)
    f.editor.view.dom.dispatchEvent(event)
    expect(f.content()).toEqual(expectedText('A'))
    const payload = JSON.parse(values['application/x-cw-document-slice'])
    expect(JSON.stringify(payload.slice)).not.toContain('layout_group')
    expect(values['text/plain']).toBe('BC\nX')
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('moves a native text range without copying live carriers or changing a fully moved paragraph identity', () => {
    const f = fixture(true), current = f.editor.view
    const slice = current.state.selection.content()
    vi.spyOn(current, 'posAtCoords').mockReturnValue({ pos: f.position('tail') + 5, inside: -1 })
    expect(current.someProp('handleDrop', handle => handle(current, dropEvent(), slice, true))).toBe(true)
    const blocks = f.content()
    expect(blocks[0]).toEqual(group('grid', [group('left', [paragraph('a', 'A')]), group('right', [paragraph('b', 'YZ')])]))
    expect(blocks.find(block => block.id === 'middle')).toEqual(paragraph('middle', 'Middle'))
    expect(current.state.doc.textContent).toBe('AYZTailBCMiddleX')
    const ids: string[] = []; current.state.doc.descendants(node => { if (node.attrs.id) ids.push(node.attrs.id) })
    expect(new Set(ids).size).toBe(ids.length)
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('submits native cross-column drag range marks to the formal planner and moves their note with the selected text', () => {
    let project: CourseProjectV10 = { schemaVersion: 11, id: 'range-drag', revision: 0, title: 'Range drag', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
      definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
        group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
        text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
        note: { id: 'note', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } } },
      instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['grid', 'tail'] },
        grid: { id: 'grid', definitionId: 'group', data: {}, style: { display: 'grid', gridTemplateColumns: '1fr 1fr' }, childIds: ['left', 'right'] },
        left: { id: 'left', definitionId: 'group', data: {}, style: { display: 'flex', flexDirection: 'column' }, childIds: ['a'] },
        right: { id: 'right', definitionId: 'group', data: {}, style: { display: 'flex', flexDirection: 'column' }, childIds: ['b'] },
        a: { id: 'a', definitionId: 'text', childIds: ['note'], data: JSON.parse(JSON.stringify({ ...createTextComponentData(), content: { inlines: [{ type: 'text', text: 'A' }, { type: 'text', text: 'BC', rangeIds: ['R'] }] } })) },
        b: { id: 'b', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('XYZ'))) },
        tail: { id: 'tail', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Tail'))) },
        note: { id: 'note', definitionId: 'note', data: { content: 'BC note' }, attachments: [{ instanceId: 'note', target: { kind: 'text-range', instanceId: 'a', dataPath: ['content'], rangeId: 'R' } }] } } }
    const host = document.createElement('div'); document.body.append(host)
    const diagnostic = vi.fn()
    const editor = createLayoutEditor(host, { document: projectFlowDocument(project, 'flow'), revision: '0', presentation: 'flow',
      projectionPlugins: [documentFlowEditingPlugin({ isMultiColumnLayout: id => id === 'grid' })], diagnostic, undo() {}, redo() {},
      change(next, operation) { project = applyComponentOperation(project, captureComponentOperation(project, flowDocumentEdits(project, 'flow', next.content.blocks, project, operation.rangeProjection))); return true } })
    editors.push(editor)
    const positions: Record<string, number> = {}; editor.view.state.doc.descendants((node, at) => { if (node.attrs.id) positions[node.attrs.id] = at })
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, positions.a + 2, positions.b + 2)))
    const slice = editor.view.state.selection.content()
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: positions.tail + 5, inside: -1 })
    expect(editor.view.someProp('handleDrop', handle => handle(editor.view, dropEvent(), slice, true))).toBe(true)
    expect(diagnostic).not.toHaveBeenCalled()
    expect(textComponentDataSchema.parse(project.instances.a.data).content).toEqual({ inlines: [{ type: 'text', text: 'A' }] })
    expect(textComponentDataSchema.parse(project.instances.b.data).content).toEqual({ inlines: [{ type: 'text', text: 'YZ' }] })
    expect(project.instances.note.attachments?.[0].target).toEqual({ kind: 'text-range', instanceId: 'tail', dataPath: ['content'], rangeId: 'R' })
    expect(project.instances.grid.childIds).toEqual(['left', 'right'])
    expect(project.instances.left.childIds).toEqual(['a'])
    expect(project.instances.right.childIds).toEqual(['b'])
  })
  it('does not delete the selected content when composition begins and ends without an input transaction', async () => {
    const f = fixture(), before = f.content()
    f.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(f.content()).toEqual(before)
    f.editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(f.content()).toEqual(before)
    expect(f.change).not.toHaveBeenCalled()
  })
  it('keeps actual transactions dispatched inside the observer path during composition startup', async () => {
    let deleteInObserver = false
    const f = fixture(false, () => {
      if (!deleteInObserver) return
      deleteInObserver = false
      f.editor.view.dispatch(f.editor.view.state.tr.deleteSelection())
    }), view = f.editor.view, initial = view.state.selection
    view.focus()
    // PM invokes the hook before its default startup flush. Simulate an input
    // consumer re-entering from the real selection observer without composition metadata.
    view.someProp('handleDOMEvents', handlers => handlers.compositionstart?.(view, new CompositionEvent('compositionstart')))
    expect(view.composing).toBe(false)
    const from = view.domAtPos(initial.from), to = view.domAtPos(initial.to)
    document.getSelection()!.setBaseAndExtent(to.node, to.offset, from.node, from.offset)
    deleteInObserver = true
    const observer = (view as unknown as { domObserver: { handleDOMChange(from: number, to: number, typeOver: boolean, added: globalThis.Node[]): void } }).domObserver
    observer.handleDOMChange(-1, -1, false, [])
    expect(deleteInObserver).toBe(false)
    expect(f.content()).toEqual(expectedText('A'))
    expect(f.change).not.toHaveBeenCalled()
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(f.content()).toEqual(expectedText('A'))
    expect(f.change).toHaveBeenCalledTimes(1)
  })
  it('keeps an actual composition replacement local until compositionend and preserves columns', async () => {
    const f = fixture()
    f.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    f.editor.view.dispatch(f.editor.view.state.tr.insertText('中'))
    expect(f.content()).toEqual(expectedText('A中'))
    expect(f.change).not.toHaveBeenCalled()
    f.editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(f.content()).toEqual(expectedText('A中'))
    expect(f.change).toHaveBeenCalledTimes(1)
  })
})
