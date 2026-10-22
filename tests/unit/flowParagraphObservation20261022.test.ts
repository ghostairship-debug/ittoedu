import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { observeFlowParagraphLayout } from '../../src/renderer/ui/flow/flowParagraphLayout'
import { createFlowBlockPaint } from '../../src/renderer/ui/flow/flowBlockPaint'
import { createTableData } from '../../src/components/table/data'
import { createTextComponentData, textAppearanceSchema } from '../../src/components/text/data'
import * as tableRender from '../../src/components/table/render'

vi.mock('../../src/components/table/render', async importOriginal => {
  const actual = await importOriginal<typeof tableRender>()
  return { ...actual, layoutTable: vi.fn(actual.layoutTable) }
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function harness(nested = false) {
  let mutation!: MutationCallback, resize!: ResizeObserverCallback, id = 0
  const unobserve = vi.fn(), callbacks = new Map<number, FrameRequestCallback>(), fonts = new EventTarget()
  Object.defineProperty(fonts, 'ready', { value: new Promise(() => {}) })
  vi.stubGlobal('MutationObserver', class { constructor(fn: MutationCallback) { mutation = fn } observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { constructor(fn: ResizeObserverCallback) { resize = fn } observe() {} unobserve = unobserve; disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.set(++id, fn); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const paper = document.createElement('article'), values = new Map<HTMLElement, { y: number; height: number }>()
  const nodes = ['first', 'second', 'after'].map((id, index) => {
    const node = document.createElement('p'); node.dataset.flowBlockId = id; node.textContent = id
    values.set(node, { y: index * 40, height: 30 }); paper.append(node); return node
  })
  let group: HTMLElement | undefined
  if (nested) { group = document.createElement('section'); group.dataset.flowBlockId = 'group'; values.set(group, { y: 0, height: 80 }); paper.prepend(group); group.append(nodes[0], nodes[1]) }
  let width = 800
  const rect = (y: number, height: number) => ({ x: 0, y, left: 0, top: y, right: width, bottom: y + height, width, height, toJSON() {} })
  paper.getBoundingClientRect = () => rect(0, 600)
  for (const [node] of values) {
    node.getBoundingClientRect = vi.fn(() => { const value = values.get(node)!; return rect(value.y, value.height) })
    node.getClientRects = () => [{}] as unknown as DOMRectList
  }
  document.body.append(paper)
  const callback = vi.fn(), stop = observeFlowParagraphLayout(paper, callback)
  const flush = () => { const pending = [...callbacks]; callbacks.clear(); pending.forEach(([, fn]) => fn(0)) }
  const clear = () => { for (const node of values.keys()) vi.mocked(node.getBoundingClientRect).mockClear(); callback.mockClear() }
  const emit = (type: MutationRecord['type'], target: Node, fields: Partial<MutationRecord> = {}) => mutation([{ type, target, ...fields } as MutationRecord], {} as MutationObserver)
  const last = () => callback.mock.calls.at(-1)![0] as { blockId: string; y: number }[]
  return { paper, nodes, group, values, callback, stop, flush, clear, emit, last, fonts, unobserve, setWidth: (next: number) => { width = next },
    resize: (...targets: Element[]) => resize(targets.map(target => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver),
    close() { stop(); if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts); else delete (document as any).fonts } }
}

describe('Flow paragraph dirty geometry', () => {
  it('does not reread earlier trees for a same-size character edit in the last paragraph', () => {
    const h = harness(); try {
      h.flush(); h.clear(); h.emit('characterData', h.nodes[2].firstChild!); h.flush()
      expect(h.nodes[0].getBoundingClientRect).not.toHaveBeenCalled()
      expect(h.nodes[1].getBoundingClientRect).not.toHaveBeenCalled()
      expect(h.nodes[2].getBoundingClientRect).toHaveBeenCalledTimes(1)
      expect(h.callback.mock.calls[0][1].paint).toEqual([])
    } finally { h.close() }
  })

  it('updates following positions after a resize and after margins change without changing the dirty rect', () => {
    const h = harness(); try {
      h.flush(); h.clear(); h.values.get(h.nodes[0])!.height = 60; h.values.get(h.nodes[1])!.y = 70; h.values.get(h.nodes[2])!.y = 110
      h.resize(h.nodes[0]); h.flush()
      expect(h.last().find(value => value.blockId === 'second')?.y).toBe(70)
      expect(h.nodes[2].getBoundingClientRect).toHaveBeenCalledTimes(1)
      h.clear(); h.values.get(h.nodes[1])!.y = 90; h.values.get(h.nodes[2])!.y = 130
      h.emit('attributes', h.nodes[0], { attributeName: 'style' }); h.flush()
      expect(h.last().find(value => value.blockId === 'second')?.y).toBe(90)
      expect(h.callback.mock.calls[0][1].moved).toContain(h.nodes[1])
    } finally { h.close() }
  })

  it('remeasures earlier native-group siblings and later reading trees when a nested item resizes', () => {
    const h = harness(true); try {
      h.flush(); h.clear(); h.values.get(h.nodes[0])!.y = 10; h.values.get(h.nodes[1])!.height = 50; h.values.get(h.nodes[2])!.y = 120
      h.resize(h.nodes[1]); h.flush()
      expect(h.nodes[0].getBoundingClientRect).toHaveBeenCalledTimes(1)
      expect(h.last().find(value => value.blockId === 'first')?.y).toBe(10)
      expect(h.last().find(value => value.blockId === 'after')?.y).toBe(120)
    } finally { h.close() }
  })

  it('invalidates on font/width changes and retires removed nodes before publishing the ordered layout', () => {
    const h = harness(); try {
      h.flush(); h.clear(); h.fonts.dispatchEvent(new Event('loadingdone')); h.flush()
      expect(h.nodes[0].getBoundingClientRect).toHaveBeenCalledTimes(1)
      h.clear(); h.setWidth(700); h.resize(h.paper); h.flush()
      expect(h.nodes[2].getBoundingClientRect).toHaveBeenCalledTimes(1)
      h.nodes[1].remove(); h.emit('childList', h.paper, { removedNodes: [h.nodes[1]] as unknown as NodeList, addedNodes: [] as unknown as NodeList }); h.flush()
      expect(h.unobserve).toHaveBeenCalledWith(h.nodes[1])
      expect(h.last().map(value => value.blockId)).toEqual(['first', 'after'])
      expect(h.callback.mock.calls.at(-1)![1].retired).toEqual([h.nodes[1]])
    } finally { h.close() }
  })

  it('refreshes reading order when an existing block moves before its later resize', () => {
    const h = harness(); try {
      h.flush(); h.paper.prepend(h.nodes[2]); h.values.get(h.nodes[2])!.y = 0
      h.values.get(h.nodes[0])!.y = 40; h.values.get(h.nodes[1])!.y = 80
      h.emit('childList', h.paper, { removedNodes: [h.nodes[2]] as unknown as NodeList, addedNodes: [h.nodes[2]] as unknown as NodeList }); h.flush()
      expect(h.last().map(value => value.blockId)).toEqual(['after', 'first', 'second'])
      expect(h.callback.mock.calls.at(-1)![1].paint).toContain(h.nodes[2])
      h.clear(); h.values.get(h.nodes[2])!.height = 60; h.values.get(h.nodes[0])!.y = 70; h.values.get(h.nodes[1])!.y = 110
      h.resize(h.nodes[2]); h.flush()
      expect(h.last().find(value => value.blockId === 'second')?.y).toBe(110)
      expect(h.nodes[0].getBoundingClientRect).toHaveBeenCalledTimes(1)
    } finally { h.close() }
  })
})

it('reuses projection algorithms through body ACKs and scopes nested slot paths to their exact block owner', () => {
  const data = createTableData({ rows: 1, columns: 1 }), text = createTextComponentData('old')
  let project = { definitions: { table: { implementation: { kind: 'builtin', key: 'guoling.table' } }, text: { implementation: { kind: 'builtin', key: 'guoling.text' } },
    section: { implementation: { kind: 'builtin', key: 'guoling.document-block' } } },
    instances: { section: { id: 'section', definitionId: 'section', data: { type: 'section' }, childIds: ['table'] },
      table: { id: 'table', definitionId: 'table', data }, text: { id: 'text', definitionId: 'text', data: text } } } as unknown as CourseProjectV10
  const paper = document.createElement('article'), section = document.createElement('section'), table = document.createElement('div'), paragraph = document.createElement('p')
  section.dataset.flowBlockId = 'section'; table.dataset.flowBlockId = 'table'; paragraph.dataset.flowBlockId = 'text'
  paragraph.dataset.flowBodyBlock = 'paragraph'
  table.innerHTML = '<table><tbody><tr><td><p></p></td></tr></tbody></table>'
  const slot = table.querySelector('p')!; slot.dataset.documentSlot = `cell:${JSON.stringify([data.rows[0].id, data.columns[0].id])}`
  section.append(table); paper.append(section, paragraph); document.body.append(paper)
  const notify = vi.fn(), paint = createFlowBlockPaint(paper, 'flow', () => project, notify, fn => fn())
  try {
    expect(() => paint.paint([section, table, paragraph])).not.toThrow()
    expect(JSON.parse(slot.dataset.documentPath!)).toEqual(['rows', '0', 'cells', '0', 'text'])
    const parse = vi.spyOn(textAppearanceSchema, 'parse'); vi.mocked(tableRender.layoutTable).mockClear()
    project = structuredClone(project)
    ;(project.instances.table.data as any).rows[0].cells[0].text = 'new body'
    ;(project.instances.text.data as any).content.inlines[0].text = 'new body'
    expect(paint.refresh()).toEqual([])
    expect(parse).not.toHaveBeenCalled(); expect(tableRender.layoutTable).not.toHaveBeenCalled()
    const cell = (project.instances.table.data as any).rows[0].cells[0]
    delete cell.text; cell.content = { inlines: [{ type: 'text', text: 'rich' }] }
    expect(paint.refresh()).toEqual([table])
    expect(JSON.parse(slot.dataset.documentPath!)).toEqual(['rows', '0', 'cells', '0', 'content'])
    expect(tableRender.layoutTable).not.toHaveBeenCalled()
    ;(project.instances.text.data as any).appearance.fontSize = 31
    expect(paint.refresh()).toEqual([paragraph])
    expect(paragraph.style.fontSize).toContain('31px')
    project.definitions.group = { implementation: { kind: 'builtin', key: 'guoling.group' } } as any
    project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['text'], style: { display: 'flex' } } as any
    project.instances.text.style = { gridColumn: '2' }
    paint.refresh()
    const group = document.createElement('section'); group.dataset.flowBlockId = 'group'; group.dataset.flowReadingGroup = 'true'
    paper.append(group); group.append(paragraph)
    expect(paint.paint([paragraph])).toEqual([paragraph])
    expect(paragraph.style.gridColumn).toBe('2')
    expect(paragraph.style.margin).toBe('0px')
  } finally { paint.destroy() }
})
