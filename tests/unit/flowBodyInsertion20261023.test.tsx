import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { AllSelection, NodeSelection, TextSelection } from 'prosemirror-state'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { projectFlowDocument, flowDocumentEdits } from '../../src/core/components/document/flowDocumentProjection'
import { prepareFlowBodyInsertion } from '../../src/core/course/courseFlowInsertion'
import { prepareProfessionalElement } from '../../src/core/course/professionalElementDefaults'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { parseTableData } from '../../src/components/table/data'
import { insertDocumentBlocks, planDocumentBlockInsertion } from '../../src/shared/document/blockInsertion'
import { plainDocumentText, type DocumentContent, type DocumentBlock } from '../../src/shared/document/content'
import type { DocumentSelection } from '../../src/shared/document/ports'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { insertCourseMedia, insertCourseElement } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { insertComponentPackagesAtTarget } from '../../src/renderer/components/insertComponentPackages'
import { captureFlowMenuTarget, refreshFlowMenuTarget, releaseFlowMenuTarget, resolveFlowMenuInsertionOptions, insertFlowMenu } from '../../src/renderer/ui/flow/flowInsertCommands'
import { registerFlowMenuCapture, registerFlowWorkspaceDrain } from '../../src/renderer/document/flowWorkspaceRegistry'
import * as editorSession from '../../src/renderer/document/editorSession'
import { SharedDocumentEditor } from '../../src/renderer/document/SharedDocumentEditor'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'

const stops: (() => void)[] = []
afterEach(() => { cleanup(); for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks() })
const point = (blockId: string, offset: number) => ({ blockId, offset, slot: { kind: 'field' as const, field: 'content' as const }, affinity: 'after' as const })
const caret = (blockId: string, offset: number): DocumentSelection => ({ revision: '0', kind: 'text', anchor: point(blockId, offset), head: point(blockId, offset) })
const text = (value: string) => ({ inlines: value ? [{ type: 'text' as const, text: value }] : [] })
const paragraph = (id: string, value: string): DocumentBlock => ({ id, type: 'paragraph', content: text(value) })
const divider: DocumentBlock = { id: 'object', type: 'divider' }

it('splits code points and inline atoms while retaining formatting, ranges and the quote citation only on the tail', () => {
  const quote: DocumentBlock = { id: 'quote', type: 'quote', textAlign: 'center', lineSpacing: 1.5, citation: text('出处'), content: { inlines: [
    { type: 'text', text: '甲😀', style: { bold: true }, rangeIds: ['note'], link: { href: 'https://example.test' } },
    { type: 'math', formulaId: 'formula', latex: 'x', accessibleText: 'x', rangeIds: ['note'] },
    { type: 'text', text: '乙', style: { italic: true }, rangeIds: ['note'] },
    { type: 'component', instanceId: 'inline', accessibleText: '互动' },
  ] } }
  const original = structuredClone(quote)
  const result = insertDocumentBlocks({ blocks: [quote] }, caret('quote', 3), [divider], () => 'tail')
  expect(result.blocks.map(block => block.id)).toEqual(['quote', 'object', 'tail'])
  expect(result.blocks[0]).toEqual({ ...original, content: { inlines: original.content.inlines.slice(0, 2) }, citation: undefined })
  expect(result.blocks[2]).toEqual({ ...original, id: 'tail', content: { inlines: original.content.inlines.slice(2) } })
  expect(quote).toEqual(original)
  for (const offset of [0, 5]) {
    const boundary = insertDocumentBlocks({ blocks: [quote] }, caret('quote', offset), [divider])
    expect(boundary.blocks).toHaveLength(2)
    expect(boundary.blocks.find(block => block.id === 'quote')).toEqual(original)
  }
})

it('preserves a reversed selection and inserts at its logical end in the current nested reading container', () => {
  const content: DocumentContent = { blocks: [{ id: 'group', type: 'course-instance', blocks: [paragraph('a', '甲😀乙'), paragraph('b', '丙丁')] }] }
  const selected: DocumentSelection = { revision: '0', kind: 'text', anchor: point('b', 1), head: point('a', 1) }
  const plan = planDocumentBlockInsertion(content, selected, () => 'tail')
  expect(plan).toMatchObject({ parentId: 'group', index: 2 })
  expect(plan.content.blocks[0]).toMatchObject({ blocks: [paragraph('a', '甲😀乙'), paragraph('b', '丙'), paragraph('tail', '丁')] })
})

it('diagnoses unsupported slots and provides explicit block-boundary insertion without replacing selected cell text', () => {
  const list: DocumentBlock = { id: 'list', type: 'list', ordered: false, items: [{ id: 'item', content: text('保留') }] }
  const selection: DocumentSelection = { revision: '0', kind: 'text', anchor: { ...point('list', 1), slot: { kind: 'item', itemId: 'item' } }, head: { ...point('list', 1), slot: { kind: 'item', itemId: 'item' } } }
  expect(() => planDocumentBlockInsertion({ blocks: [list] }, selection)).toThrow('列表项内不能插入块对象')
  expect(insertDocumentBlocks({ blocks: [list] }, { revision: '0', kind: 'object', blockId: 'list' }, [divider]).blocks).toEqual([list, divider])
  expect(() => planDocumentBlockInsertion({ blocks: [] }, { revision: '0', kind: 'cells', tableId: 'table', anchor: { rowId: 'r', columnId: 'c' }, head: { rowId: 'r', columnId: 'c' } })).toThrow('表格下方插入')
})

function course() {
  const project = createBlankCourseProjectV10('正文插入')
  setRootContainers(project, [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['section'] }])
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  project.instances.section = { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, childIds: ['body'],
    data: documentBlockData({ id: 'section', type: 'section', title: text('章节'), collapsedByDefault: false, blocks: [] }) }
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify({ ...createTextComponentData(), content: text('甲😀乙') })) }
  return project
}

it.each(['chart', 'table'] as const)('inserts a %s through the real Flow command with one History entry, Undo and a saved cold reopen', async kind => {
  const project = course(), h = await createV10StoreHost(project)
  stops.push(() => h.bridge.dispose())
  const target = h.kernel.captureTarget(), depth = h.first.read().undoDepth
  const result = await insertFlowMenu(h.kernel, target, { destination: 'document', kind, label: kind }, { flowSelection: caret('body', 2), width: 500, height: 200 })
  const children = h.model().project.instances.section.childIds!
  expect(children[0]).toBe('body'); expect(children[1]).toBe(result.instanceIds[0]); expect(children).toHaveLength(3)
  const body = projectFlowDocument(h.model().project, 'flow').content.blocks[0]
  expect(body.type === 'section' && body.blocks.map(block => 'content' in block ? plainDocumentText(block.content) : block.type)).toEqual(['甲😀', kind, '乙'])
  expect(h.model().project.instances[children[1]].frame).toMatchObject({ width: 500, height: 200 })
  const data = h.model().project.instances[children[1]].data
  if (kind === 'chart') expect(data).toEqual(prepareProfessionalElement(kind).data)
  else {
    const table = parseTableData(data)
    expect(table.columns).toHaveLength(3); expect(table.rows).toHaveLength(3)
    expect(table.rows.every(row => row.cells.length === 3 && row.cells.every(cell => cell.text === ''))).toBe(true)
    expect(table.style).toEqual(parseTableData(prepareProfessionalElement('table').data).style)
  }
  expect(h.operations).toHaveLength(1); expect(h.first.read().undoDepth).toBe(depth + 1)
  await h.bridge.undo(h.first.documentId)
  expect(projectFlowDocument(h.model().project, 'flow')).toEqual(projectFlowDocument(project, 'flow'))
  await h.bridge.redo(h.first.documentId)
  await h.api.save(h.first.documentId, `flow-${kind}.glx`)
  const reopened = h.driver.load(h.disk.get(`flow-${kind}.glx`)!)
  expect(reopened).toEqual(h.model())
})

it('composes prepared media and library insertion with the same split before one canonical commit', async () => {
  for (const kind of ['media', 'library'] as const) {
    const h = await createV10StoreHost(course()); stops.push(() => h.bridge.dispose())
    const target = h.kernel.captureTarget(), options = { destination: 'document' as const, flowSelection: caret('body', 1) }
    if (kind === 'media') await insertCourseMedia(h.kernel, target, [{ meta: { id: 'image', kind: 'image', filename: 'image.png', path: 'assets/image.png', mimeType: 'image/png', width: 10, height: 10, byteLength: 3 }, bytes: Uint8Array.of(1, 2, 3) }], options)
    else expect(await insertComponentPackagesAtTarget(h.kernel, target, [{ schemaVersion: 2, id: 'library', title: '库文字',
      definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION }, example: { rootIds: ['example'], instances: { example: { id: 'example', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('库内容'))) } } }, assets: {}, resources: { assets: {}, components: {} } }], options)).toMatchObject({ ok: true })
    expect(h.model().project.instances.section.childIds).toHaveLength(3)
    expect(h.operations).toHaveLength(1)
    await h.bridge.undo(h.first.documentId)
    expect(projectFlowDocument(h.model().project, 'flow')).toEqual(projectFlowDocument(course(), 'flow'))
  }
})

it.each([false, true])('maps the picker bookmark through typing and the original ACK after switching tabs (editor unmounted: %s)', async unmounted => {
  const project = course(), h = await createV10StoreHost(project), gate = deferred()
  stops.push(() => h.bridge.dispose())
  const host = document.createElement('div'); document.body.append(host)
  const editor = editorSession.createLayoutEditor(host, { document: projectFlowDocument(project, 'flow'), revision: '0',
    change: async document => {
      const target = h.kernel.captureTarget(h.first.documentId)
      const command = h.kernel.capture(flowDocumentEdits(target.project, 'flow', document.content.blocks), target)
      await gate.promise; await h.kernel.editCaptured(command); return true
    }, undo() {}, redo() {}, diagnostic(message) { throw new Error(message) } })
  stops.push(() => { if (!editor.view.isDestroyed) editor.destroy(); host.remove() })
  // section -> title slot -> body paragraph; find the actual paragraph position.
  let at = 0; editor.view.state.doc.descendants((node, pos) => { if (node.attrs.id === 'body') at = pos + 1 })
  editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, at + 3)))
  stops.push(registerFlowMenuCapture(() => ({ ok: true, documentId: h.first.documentId, projectId: project.id, revision: 0, surfaceId: 'flow', locationId: 'flow', generation: 0,
    selectedBlockId: 'body', selectionSignature: '', paperWidth: 800, bodyWidth: 728, paragraphRects: [], insertionSelection: editor.captureInsertionSelection() })))
  const stopDrain = registerFlowWorkspaceDrain(h.first.documentId, async () => ({ ok: await editor.drain() }))
  stops.push(stopDrain)
  const captured = captureFlowMenuTarget(h.kernel)
  editor.view.dispatch(editor.view.state.tr.insertText('新', at))
  await h.kernel.edit([{ type: 'project.title.set', title: '无关标题更新' }])
  await h.bridge.create({ kind: 'course-v10', project: { ...course(), id: 'other' }, resources: { assets: {}, components: {} } })
  if (unmounted) { editor.destroy(); host.remove(); stopDrain() }
  const other = h.bridge.read().snapshot!, otherBefore = h.registry.get(other.documentId).read()
  let ready = false
  const refreshing = refreshFlowMenuTarget(h.kernel, captured).then(target => { ready = true; return target })
  await Promise.resolve(); expect(ready).toBe(false)
  gate.resolve()
  const target = await refreshing, command = { destination: 'document' as const, kind: 'chart' as const, label: '图表' }
  expect(target.project.title).toBe('无关标题更新')
  expect(resolveFlowMenuInsertionOptions(target, command).flowSelection).toMatchObject({ anchor: { blockId: 'body', offset: 3 } })
  await insertFlowMenu(h.kernel, target, command)
  releaseFlowMenuTarget(target)
  const body = projectFlowDocument(h.model().project, 'flow').content.blocks[0]
  expect(body.type === 'section' && body.blocks.map(block => 'content' in block ? plainDocumentText(block.content) : block.type)).toEqual(['新甲😀', 'chart', '乙'])
  expect(h.registry.get(other.documentId).read()).toEqual(otherBefore)
  expect(h.bridge.read().activeDocumentId).toBe(other.documentId)
  expect(() => captured.flowMenuPage!.insertionSelection!.read()).toThrow('失效')
})

function mountEditor(content: DocumentContent) {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 100, 600, 200))
  const factory = vi.spyOn(editorSession, 'createLayoutEditor'), change = vi.fn(() => true)
  const rendered = render(<SharedDocumentEditor document={{ content, resources: emptyDocumentResources() }} revision="0" target="file" onChange={change} onDraft={() => {}} onUndo={() => {}} onRedo={() => {}} />)
  return { rendered, change, editor: factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor> }
}

it('uses the actual toolbar at a paragraph caret and the keyboard slash menu inside a section', () => {
  const mounted = mountEditor({ blocks: [paragraph('body', '甲😀乙')] })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, 4))))
  fireEvent.click(mounted.rendered.getByRole('button', { name: '插入表格' }))
  expect(fromEditorDocument(mounted.editor.view.state.doc).blocks.map(block => 'content' in block ? plainDocumentText(block.content) : block.type)).toEqual(['甲😀', 'table', '乙'])
  expect(mounted.change).toHaveBeenCalledTimes(1)
  mounted.rendered.unmount(); vi.restoreAllMocks()
  const nested = mountEditor({ blocks: [{ id: 'section', type: 'section', title: text('节'), collapsedByDefault: false, blocks: [paragraph('nested', '')] }] })
  let at = 0; nested.editor.view.state.doc.descendants((node, pos) => { if (node.attrs.id === 'nested') at = pos + 1 })
  act(() => { nested.editor.view.focus(); nested.editor.view.dispatch(nested.editor.view.state.tr.setSelection(TextSelection.create(nested.editor.view.state.doc, at))) })
  fireEvent.keyDown(nested.editor.view.dom, { key: '/' })
  fireEvent.click(nested.rendered.getByRole('menuitem', { name: '插入图表' }))
  expect(fromEditorDocument(nested.editor.view.state.doc).blocks[0]).toMatchObject({ type: 'section', blocks: [{ type: 'chart' }, paragraph('nested', '')] })
  expect(nested.change).toHaveBeenCalledTimes(1)
})

it('rejects a deleted bookmark and releases it without retargeting the next paragraph', () => {
  const mounted = mountEditor({ blocks: [paragraph('one', '第一段'), paragraph('two', '第二段')] })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, 2))))
  const captured = mounted.editor.captureInsertionSelection()
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.delete(0, mounted.editor.view.state.doc.firstChild!.nodeSize)))
  expect(() => captured.read()).toThrow('原正文插入位置已失效')
  captured.release(); captured.release()
  expect(fromEditorDocument(mounted.editor.view.state.doc).blocks).toEqual([paragraph('two', '第二段')])
})

it('keeps the original bookmark in an untouched paragraph when a toolbar operation replaces the PM projection', () => {
  const mounted = mountEditor({ blocks: [paragraph('one', '原落点'), paragraph('two', '别处')] })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, 2))))
  const captured = mounted.editor.captureInsertionSelection()
  let at = 0; mounted.editor.view.state.doc.descendants((node, pos) => { if (node.attrs.id === 'two') at = pos + 1 })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, at + 1))))
  fireEvent.click(mounted.rendered.getByRole('button', { name: '插入表格' }))
  expect(captured.read()).toMatchObject({ kind: 'text', anchor: { blockId: 'one', offset: 1 }, head: { blockId: 'one', offset: 1 } })
  captured.release()
})

it('keeps a sole existing object boundary when the toolbar replaces the full PM projection', () => {
  const mounted = mountEditor({ blocks: [divider] })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(NodeSelection.create(mounted.editor.view.state.doc, 0))))
  const captured = mounted.editor.captureInsertionSelection()
  fireEvent.click(mounted.rendered.getByRole('button', { name: '插入表格' }))
  expect(captured.read(fromEditorDocument(mounted.editor.view.state.doc))).toMatchObject({ kind: 'object', blockId: 'object' })
  captured.release()
})

it('retains the detached original caret through unrelated revisions and diagnoses an ambiguous changed slot', () => {
  const mounted = mountEditor({ blocks: [paragraph('one', '原落点'), paragraph('two', '别处')] })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, 2))))
  const captured = mounted.editor.captureInsertionSelection()
  mounted.rendered.unmount()
  expect(captured.read({ blocks: [paragraph('one', '原落点'), paragraph('two', '别处有修改')] })).toMatchObject({ kind: 'text', anchor: { blockId: 'one', offset: 1 } })
  expect(() => captured.read({ blocks: [paragraph('one', '原落点前增加'), paragraph('two', '别处')] })).toThrow('原正文插入位置已变化')
  expect(() => captured.read({ blocks: [paragraph('two', '别处')] })).toThrow('原正文插入位置已变化')
  captured.release()
})

it('keeps the whole-document selection append semantics when it has no single semantic slot', () => {
  const content = { blocks: [paragraph('one', '保留全部')] }, mounted = mountEditor(content)
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(new AllSelection(mounted.editor.view.state.doc))))
  const captured = mounted.editor.captureInsertionSelection()
  expect(insertDocumentBlocks(content, captured.read(content), [divider]).blocks).toEqual([...content.blocks, divider])
  captured.release()
})

it('offers the actual explicit block-after action for a table slot without blocking a later valid insertion', () => {
  const table: DocumentBlock = { id: 'table', type: 'table', columns: [{ id: 'column', header: text('列') }], rows: [{ id: 'row', cells: { column: text('保留单元格') } }] }
  const mounted = mountEditor({ blocks: [table] })
  let at = 0; mounted.editor.view.state.doc.descendants((node, pos) => { if (node.type.name === 'slot' && node.attrs.key.startsWith('cell:')) at = pos + 1 })
  act(() => mounted.editor.view.dispatch(mounted.editor.view.state.tr.setSelection(TextSelection.create(mounted.editor.view.state.doc, at + 1))))
  fireEvent.click(mounted.rendered.getByRole('button', { name: '插入表格' }))
  expect(mounted.rendered.getByRole('alert')).toHaveTextContent('表格单元格内不能插入块对象')
  expect(fromEditorDocument(mounted.editor.view.state.doc).blocks).toEqual([table])
  fireEvent.click(mounted.rendered.getByRole('button', { name: '在所在块下方插入' }))
  const blocks = fromEditorDocument(mounted.editor.view.state.doc).blocks
  expect(blocks).toHaveLength(2); expect(blocks[0]).toEqual(table); expect(blocks[1].type).toBe('table')
  expect(mounted.rendered.queryByRole('alert')).toBeNull()
})

it('inserts into the active non-entry group root when the current work has no Surface', async () => {
  const project = createBlankCourseProjectV10('多个普通作品根'), entry = project.rootIds[0]
  project.definitions.rootGroup = { id: 'rootGroup', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances[entry] = { id: entry, definitionId: 'rootGroup', data: {}, childIds: [] }
  project.instances.otherRoot = { id: 'otherRoot', definitionId: 'rootGroup', data: {}, childIds: [] }
  project.rootIds.push('otherRoot')
  const h = await createV10StoreHost(project); stops.push(() => h.bridge.dispose())
  h.bridge.selectSurface(h.first.documentId, 'otherRoot')
  const target = h.kernel.captureTarget()
  expect(target).toMatchObject({ surfaceId: null, rootInstanceId: 'otherRoot', instanceId: null })
  const result = await insertCourseElement(h.kernel, target, 'text', { text: '当前作品正文' })
  expect(h.model().project.instances.otherRoot.childIds).toEqual(result.instanceIds)
  expect(h.model().project.instances[entry].childIds).toEqual([])
  expect(h.first.read().undoDepth).toBe(1)
  await h.bridge.undo(h.first.documentId)
  expect(h.model().project.instances.otherRoot.childIds).toEqual([])
})
