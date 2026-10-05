import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { createLayoutEditor } from '@/renderer/document/editorSession'
import { fromEditorDocument } from '@/renderer/document/documentAdapter'
import { DocumentHostService } from '@/main/workbench/DocumentHostService'
import { captureComponentOperation } from '@/core/drivers/courseV10Operations'
import { flowDocumentEdits, projectFlowDocument } from '@/core/components/document/flowDocumentProjection'
import { TEXT_DEFINITION } from '@/components/text/adapters'
import { createTextComponentData } from '@/components/text/data'
import { TABLE_DEFINITION } from '@/components/table/adapters'
import { createTableData } from '@/components/table/data'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  vi.stubGlobal('Uint8Array', new NodeTextEncoder().encode('').constructor)
})
afterAll(() => {
  geometry.forEach((key, index) => {
    if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!)
    else Reflect.deleteProperty(Range.prototype, key)
  })
  vi.unstubAllGlobals()
})

it('keeps Flow hosts through projection paint while pending DOM input reaches formal ACK and undo', async () => {
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData(id)) })
  const table = (id: string) => ({ id, definitionId: TABLE_DEFINITION.id, data: json(createTableData({ rows: 1, columns: 1 })) })
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'flow-paint', revision: 0, title: 'Flow',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [TABLE_DEFINITION.id]: TABLE_DEFINITION,
      source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } } },
    instances: { first: text('first'), table: table('table'), source: { id: 'source', definitionId: 'source', data: {} },
      last: text('last'), tail: table('tail') },
    surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['first', 'table', 'source', 'last', 'tail'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-k0-flow-paint-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  let snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
  const current = () => { if (snapshot.model.kind !== 'course-v10') throw new Error('V10 required'); return snapshot.model.project }
  let release!: () => void
  const acknowledgement = new Promise<void>(resolve => { release = resolve })
  const change = vi.fn(async (document, operation) => {
    const target = snapshot
    const command = captureComponentOperation(current(), flowDocumentEdits(current(), 'flow', document.content.blocks))
    await acknowledgement
    const receipt = await host.internalAPI.dispatch({ documentId: target.documentId, epoch: target.epoch,
      baseRevision: target.revision, operationId: operation.operationId, historyGroup: operation.historyGroup,
      actor: 'human', mutation: { type: 'command', command } })
    expect(receipt.status).toBe('applied')
    snapshot = await host.internalAPI.read(target.documentId)
  })
  const element = document.createElement('div'); document.body.append(element)
  const mounted = vi.fn(), disposed = vi.fn(), diagnostic = vi.fn()
  const options = { document: projectFlowDocument(project, 'flow'), revision: '0', presentation: 'flow' as const,
    change, diagnostic, undo: async () => {}, redo: async () => {},
    renderObject: (_block: unknown, target: HTMLElement) => {
      const input = document.createElement('input'); input.value = 'running state'; target.append(input); mounted()
      return () => { input.remove(); disposed() }
    } }
  const editor = createLayoutEditor(element, options)
  const paint = () => editor.paintProjection(() => {
    // Query after pending input flush: a genuine input change can update the PM tree.
    for (const block of element.querySelectorAll<HTMLElement>('[data-flow-block-id]')) {
      block.dataset.componentFlowId = block.dataset.flowBlockId!
      block.style.lineHeight = '1.4'
      block.style.padding = '8px'
    }
    for (const cell of element.querySelectorAll<HTMLElement>('td,th')) {
      cell.style.width = '200px'; cell.style.padding = '9px'; cell.style.backgroundColor = '#dbeafe'
    }
  })
  try {
    const children = Array.from(editor.view.dom.children)
    const runningInput = element.querySelector('input')
    paint(); await new Promise(resolve => setTimeout(resolve, 0))
    paint(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(editor.view.dom.children).toHaveLength(children.length)
    children.forEach((child, index) => expect(editor.view.dom.children[index]).toBe(child))
    expect(element.querySelector('input')).toBe(runningInput)
    expect(mounted).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()

    const textNode = element.querySelector('[data-flow-block-id="first"] [data-flow-idle-rich-text]')!.firstChild!
    textNode.nodeValue = '真实输入'
    paint()
    expect(editor.view.state.doc.textContent).toContain('真实输入')
    expect(change).toHaveBeenCalledTimes(1)
    expect(snapshot).toMatchObject({ revision: 0, undoDepth: 0 })
    let acknowledged = false
    const draining = editor.drain().then(value => { acknowledged = value })
    await Promise.resolve(); expect(acknowledged).toBe(false)
    release(); await draining
    expect(acknowledged).toBe(true)
    expect(snapshot).toMatchObject({ revision: 1, undoDepth: 1 })
    expect(projectFlowDocument(current(), 'flow').content.blocks[0]).toMatchObject({ content: { inlines: [{ text: '真实输入' }] } })
    const receipt = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
      baseRevision: snapshot.revision, operationId: 'undo-real-input', actor: 'human', mutation: { type: 'undo' } })
    expect(receipt.status).toBe('applied')
    snapshot = await host.internalAPI.read(snapshot.documentId)
    editor.update({ ...options, document: projectFlowDocument(current(), 'flow'), revision: String(snapshot.revision) })
    expect(editor.view.state.doc.textContent).toContain('first')
    expect(snapshot).toMatchObject({ revision: 2, undoDepth: 0, redoDepth: 1 })
    expect(element.querySelector('input')).toBe(runningInput)

    // A throw must restore observation, and composition still owns its local text.
    expect(() => editor.paintProjection(() => { throw new Error('paint failed') })).toThrow('paint failed')
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composingNode = element.querySelector('[data-flow-block-id="first"] [data-flow-idle-rich-text]')!.firstChild!
    composingNode.nodeValue = '输入法正文'
    paint()
    expect(editor.view.state.doc.textContent).toContain('输入法正文')
    expect(change).toHaveBeenCalledTimes(1)
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve(); expect(await editor.drain()).toBe(true)
    expect(change).toHaveBeenCalledTimes(2)
    expect(fromEditorDocument(editor.view.state.doc).blocks[0]).toMatchObject({ content: { inlines: [{ text: '输入法正文' }] } })
    expect(diagnostic).not.toHaveBeenCalled()
  } finally {
    release(); editor.destroy(); element.remove()
    await host.operate({ type: 'close', documentId: snapshot.documentId, discardDirty: true })
    await rm(directory, { recursive: true, force: true })
  }
})
