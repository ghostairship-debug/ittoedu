import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { splitBlock } from 'prosemirror-commands'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { projectFlowDocument, flowDocumentEdits } from '../../src/core/components/document/flowDocumentProjection'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { createTableData } from '../../src/components/table/data'
import { parseDocumentMarkdown, serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { projectDocumentRanges } from '../../src/shared/document/textInteraction'
import { normalizeDocumentText, type DocumentBlock, type FlowTextContent } from '../../src/shared/document/content'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const rich = (id: string): FlowTextContent => ({ inlines: [
  { type: 'text', text: '•  ' }, { type: 'text', text: '分选：' },
  // The live failure also reverses link/style object insertion order in PM.
  { type: 'text', text: 'Coffee reference', link: { href: 'https://example.org/coffee' }, style: { underline: true, color: '#5a6356' } },
  { type: 'math', formulaId: `${id}-formula`, latex: 'x', accessibleText: 'x' },
  { type: 'text', text: 'tail', code: true, rangeIds: [`${id}-range`] },
] })
function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'reading', revision: 0, title: 'Reading', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: Object.fromEntries(['group', 'text', 'container.flow', 'document-block', 'table'].map(key => [key, { id: key, role: 'content', implementation: { kind: 'builtin', key: 'guoling.' + key } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['reading', 'neighbor'], container: { kind: 'flow' } },
      reading: { id: 'reading', definitionId: 'group', data: {}, childIds: ['first', 'second'], style: { display: 'grid', gridTemplateColumns: '1fr', gap: '24px' } },
      first: { id: 'first', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('First paragraph'))) },
      second: { id: 'second', definitionId: 'text', data: JSON.parse(JSON.stringify({ ...createTextComponentData(), content: rich('second') })) },
      neighbor: { id: 'neighbor', definitionId: 'text', data: JSON.parse(JSON.stringify({ ...createTextComponentData(), content: rich('neighbor') })) },
    } }
}
function apply(project: CourseProjectV10, blocks: DocumentBlock[]) {
  const edits = flowDocumentEdits(project, 'flow', blocks, project, projectDocumentRanges({ blocks }))
  return edits.length ? applyComponentOperation(project, captureComponentOperation(project, edits)) : project
}
function parsed(source: string) {
  const result = parseDocumentMarkdown(source, { target: 'flow', createId: () => crypto.randomUUID() })
  if (result.status !== 'valid') throw new Error(JSON.stringify(result.diagnostics))
  return result.document
}

describe('Flow keeps unchanged formal blocks through normalized editing projections', () => {
  it('keeps unrelated raw data and frames on a real PM Enter with renewed identities', () => {
    const project = fixture(), host = document.createElement('div')
    document.body.append(host)
    const editor = createLayoutEditor(host, { document: projectFlowDocument(project, 'flow'), revision: '0', presentation: 'flow',
      change: vi.fn(), undo() {}, redo() {}, diagnostic(message) { throw new Error(message) } })
    try {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 4)))
      expect(splitBlock(editor.view.state, editor.view.dispatch)).toBe(true)
      const content = fromEditorDocument(editor.view.state.doc), next = apply(project, content.blocks)
      expect(next.instances.reading.childIds).toHaveLength(3)
      expect(textComponentDataSchema.parse(next.instances.first.data).content.inlines[0]).toMatchObject({ text: 'Fi' })
      for (const id of ['second', 'neighbor']) expect(next.instances[id]).toEqual(project.instances[id])
      expect(next.instances.reading.style).toEqual(project.instances.reading.style)
    } finally { editor.destroy(); host.remove() }
  })

  it('plans no same-source edits and changes only the actual source target', () => {
    const project = fixture(), source = serializeDocumentMarkdown(projectFlowDocument(project, 'flow'))
    expect(flowDocumentEdits(project, 'flow', parsed(source).content.blocks)).toEqual([])
    const next = apply(project, parsed(source.replace('First paragraph', 'Edited paragraph')).content.blocks)
    expect(textComponentDataSchema.parse(next.instances.first.data).content.inlines[0]).toMatchObject({ text: 'Edited paragraph' })
    for (const id of ['reading', 'second', 'neighbor']) expect(next.instances[id]).toEqual(project.instances[id])
  })

  it('does not swallow changed style, link, code, range, math, inline component or paragraph attributes', () => {
    const cases: Array<(block: Extract<DocumentBlock, { type: 'paragraph' }>) => void> = [
      block => { block.content.inlines[0].style = { bold: true } },
      block => { block.content.inlines[2].link = { href: 'https://example.org/changed' } },
      block => { const atom = block.content.inlines[4]; if (atom.type === 'text') atom.code = false },
      block => { block.content.inlines[0].rangeIds = ['changed-range'] },
      block => { const atom = block.content.inlines[3]; if (atom.type === 'math') { atom.formulaId = 'changed-formula'; atom.latex = 'y'; atom.accessibleText = 'y' } },
      block => { const atom = block.content.inlines[5]; if (atom.type === 'component') atom.accessibleText = 'after' },
      block => { block.textAlign = 'right' },
    ]
    for (const mutate of cases) {
      const project = fixture()
      project.instances.second.childIds = ['inline']
      project.instances.inline = { id: 'inline', definitionId: 'group', data: {} }
      const data = textComponentDataSchema.parse(project.instances.second.data)
      data.content.inlines.push({ type: 'component', instanceId: 'inline', accessibleText: 'before' })
      project.instances.second.data = JSON.parse(JSON.stringify(data))
      const blocks = projectFlowDocument(project, 'flow').content.blocks, group = blocks[0]
      if (group.type !== 'course-instance' || group.blocks?.[1].type !== 'paragraph') throw new Error('Expected paragraph')
      const target = group.blocks[1]
      mutate(target)
      const next = apply(project, blocks), after = textComponentDataSchema.parse(next.instances.second.data)
      expect(after.appearance.align).toBe(target.textAlign)
      expect(normalizeDocumentText(after.content)).toEqual(normalizeDocumentText(target.content))
      expect(next.instances.second.data).not.toEqual(project.instances.second.data)
      expect(next.instances.neighbor).toEqual(project.instances.neighbor)
    }
  })

  it('keeps item identity and ordering meaningful when the visible text is identical', () => {
    const project = fixture()
    project.instances.neighbor = { id: 'neighbor', definitionId: 'document-block', data: { type: 'list', ordered: false,
      items: [{ id: 'one', content: { inlines: [{ type: 'text', text: 'same' }] } }, { id: 'two', content: { inlines: [{ type: 'text', text: 'same' }] } }] } }
    const blocks = projectFlowDocument(project, 'flow').content.blocks
    const list = blocks[1]
    if (list.type !== 'list') throw new Error('Expected list')
    list.items.reverse()
    const next = apply(project, blocks)
    expect((next.instances.neighbor.data as any).items.map((item: any) => item.id)).toEqual(['two', 'one'])
  })

  it('retains an unchanged multi-slot list through PM normalization without changing the writer', () => {
    const project = fixture()
    project.instances.neighbor = { id: 'neighbor', definitionId: 'document-block', data: JSON.parse(JSON.stringify({ type: 'list', ordered: false,
      items: [{ id: 'one', content: rich('item-one') }, { id: 'two', content: rich('item-two') }] })) }
    const projection = projectFlowDocument(project, 'flow'), content = fromEditorDocument(toEditorDocument(projection.content))
    expect(flowDocumentEdits(project, 'flow', content.blocks)).toEqual([])
  })

  it('retains an untouched section title and descendants through PM round trip', () => {
    const project = fixture()
    project.instances.neighbor = { id: 'neighbor', definitionId: 'document-block', childIds: ['nested'], data: JSON.parse(JSON.stringify({ type: 'section', title: rich('section'), collapsedByDefault: false })) }
    project.instances.nested = { id: 'nested', definitionId: 'text', data: JSON.parse(JSON.stringify({ ...createTextComponentData(), content: rich('nested') })) }
    const content = fromEditorDocument(toEditorDocument(projectFlowDocument(project, 'flow').content))
    expect(flowDocumentEdits(project, 'flow', content.blocks)).toEqual([])
  })

  it('retains untouched table slots but applies real column order changes with identical text', () => {
    const project = fixture(), table = createTableData({ rows: 1, columns: 2 })
    table.columns[0].header = rich('header')
    const { text: _text, ...cell } = table.rows[0].cells[0]
    table.rows[0].cells[0] = { ...cell, content: rich('cell') }
    project.instances.neighbor = { id: 'neighbor', definitionId: 'table', data: JSON.parse(JSON.stringify(table)) }
    const content = fromEditorDocument(toEditorDocument(projectFlowDocument(project, 'flow').content))
    expect(flowDocumentEdits(project, 'flow', content.blocks)).toEqual([])
    const block = content.blocks[1]
    if (block.type !== 'table') throw new Error('Expected table')
    block.columns.reverse()
    const next = apply(project, content.blocks)
    expect((next.instances.neighbor.data as any).columns.map((column: any) => column.id)).toEqual(table.columns.map(column => column.id).reverse())
  })
})
