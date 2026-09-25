// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { flowSurfaceIn, resolveFlowBlock } from '../../src/core/tools/flowDocumentModel'
import { flowTextSlot } from '../../src/core/tools/flowTextSlot'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import type { DocumentCommand, DocumentModel, DocumentOperationResult, DurableDocumentState } from '../../src/shared/workbench/document'
import type { EditEvent } from '../../src/shared/workbench/editSession'
import type { ToolTarget, ToolResult } from '../../src/shared/workbench/tools'

const markdown = new MarkdownDriver(), course = new CourseV9Driver()
const md = (source: string) => markdown.load(new TextEncoder().encode(source))
const fixture = () => course.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
function harness() {
  let sequence = 0
  const durable = new Map<string, DurableDocumentState>(), disk = new Map<string, Uint8Array>()
  const controls: { append?: () => Promise<void> } = {}
  const registry = new DocumentRegistry({ drivers: [markdown, course], createId: () => `id-${++sequence}`, bindingKey: binding => binding.path,
    persistence: { async append(state) { await controls.append?.(); durable.set(state.documentId, structuredClone(state)) },
      async save(input) {
        if (input.binding.kind !== 'file') throw new Error('File binding required')
        disk.set(input.binding.path, input.bytes.slice()); return { ...input.binding, version: `r${input.revision}` }
      } } })
  const gateway = new DocumentToolGateway(registry, [markdown, course], () => String(++sequence))
  const edits = new EditSessionService(registry, gateway), events: EditEvent[] = []
  edits.subscribe(event => events.push(event))
  const human = async (documentId: string, command: DocumentCommand) => {
    const snapshot = registry.get(documentId).read()
    return registry.get(documentId).execute({ documentId, epoch: snapshot.epoch, operationId: `human-${++sequence}`,
      baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'command', command } })
  }
  const grant = async (runId: string, documentId: string, target: ToolTarget, writable: ToolTarget[] = [{ kind: 'document' }]) => {
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId, writable }] })
    return gateway.issueTarget(runId, documentId, target)
  }
  return { registry, gateway, edits, events, human, grant, durable, disk, controls }
}
function receipt(result: ToolResult): DocumentOperationResult {
  if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result))
  return result.result
}
const textCall = (target: string, content: string) => ({ name: 'text.replace', input: { target, content } })

describe('S06 real EditSession/Gateway/Registry integration', () => {
  it('maps a disjoint human edit, saves only canonical source and removes its own ACK preview with one generation undo', async () => {
    const h = harness(), session = await h.registry.create(md('head\nTARGET\ntail'), 'lesson.md')
    const handle = await h.grant('run', session.documentId, { kind: 'markdown-range', from: 5, to: 11 })
    const begun = await h.edits.begin({ runId: 'run', editId: 'edit', toolCallId: 'tool', targetHandle: handle })
    expect(begun).toMatchObject({ documentId: session.documentId, epoch: session.read().epoch, baseRevision: 0, sequence: -1, status: 'active' })
    await h.edits.snapshot('edit', 0, '新'); await h.edits.snapshot('edit', 1, '新正文😀')
    expect(session.read().model).toMatchObject({ source: 'head\nTARGET\ntail' })
    expect(session.read().undoDepth).toBe(0)
    await h.registry.save(session.documentId, { kind: 'file', path: 'lesson.md', version: null, bindingVersion: 1 })
    expect(new TextDecoder().decode(h.disk.get('lesson.md'))).toBe('head\nTARGET\ntail')
    await h.human(session.documentId, { type: 'markdown.splice', from: 0, to: 4, text: 'long heading' })
    expect(h.edits.list(session.documentId)[0]).toMatchObject({ target: { from: 13, to: 19 }, revision: 1, value: '新正文😀' })
    await h.edits.snapshot('edit', 2, '新正文😀')
    const result = receipt(await h.gateway.execute('run', 'tool', textCall(handle, '新正文😀')))
    expect(result.status).toBe('applied')
    expect(h.edits.list(session.documentId)).toEqual([])
    expect(h.events.filter(event => event.type === 'edit.finished')).toHaveLength(1)
    expect(h.events.some(event => event.type === 'edit.aborted')).toBe(false)
    h.edits.finish('edit', result); h.edits.finish('edit', result)
    expect(await h.edits.snapshot('edit', 99, 'late text')).toBeNull()
    expect(session.read()).toMatchObject({ undoDepth: 2, model: { source: 'long heading\n新正文😀\ntail' } })
    const current = session.read()
    await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })
    expect(session.read().model).toMatchObject({ source: 'long heading\nTARGET\ntail' })
    await h.registry.save(session.documentId)
    expect(new TextDecoder().decode(h.disk.get('lesson.md'))).toBe('long heading\nTARGET\ntail')
  })

  it('aborts overlapping human edits immediately and cannot resurrect the group with late snapshots or receipts', async () => {
    const h = harness(), session = await h.registry.create(md('abc TARGET xyz'), 'a.md')
    const handle = await h.grant('r', session.documentId, { kind: 'markdown-range', from: 4, to: 10 })
    await h.edits.begin({ runId: 'r', editId: 'call', targetHandle: handle }); await h.edits.snapshot('call', 0, 'candidate')
    await h.human(session.documentId, { type: 'markdown.splice', from: 4, to: 10, text: 'human kept' })
    expect(h.events.at(-1)).toMatchObject({ type: 'edit.aborted', snapshot: { editId: 'call' } })
    expect(h.edits.list(session.documentId)).toEqual([])
    expect(await h.edits.snapshot('call', 1, 'late')).toBeNull()
    const result = await h.gateway.execute('r', 'call', textCall(handle, 'late'))
    expect(result).toMatchObject({ kind: 'error', code: 'target-conflict' })
    h.edits.finish('call', { status: 'applied', documentId: session.documentId, operationId: h.gateway.operationIdentity('r', 'call'), beforeRevision: 1, revision: 2, persistence: 'recoverable' })
    expect(session.read()).toMatchObject({ undoDepth: 1, model: { source: 'abc human kept xyz' } })
    await expect(h.edits.begin({ runId: 'r', editId: 'call', targetHandle: handle })).rejects.toMatchObject({ code: 'edit-id-used' })
  })

  it('enforces one group per document, keeps other documents independent and deduplicates cumulative snapshots', async () => {
    const h = harness(), a = await h.registry.create(md('a'), 'a.md'), b = await h.registry.create(md('b'), 'b.md')
    const ha = await h.grant('ra', a.documentId, { kind: 'markdown-range', from: 0, to: 1 })
    const hb = await h.grant('rb', b.documentId, { kind: 'markdown-range', from: 0, to: 1 })
    const request = { runId: 'ra', editId: 'a', targetHandle: ha }
    const [first, duplicate] = await Promise.all([h.edits.begin(request), h.edits.begin(request)])
    expect(duplicate).toEqual(first)
    await expect(h.edits.begin({ ...request, editId: 'busy' })).rejects.toMatchObject({ code: 'document-busy' })
    await h.edits.begin({ runId: 'rb', editId: 'b', targetHandle: hb })
    await h.edits.snapshot('a', 0, 'first'); await h.edits.snapshot('a', 3, 'replacement')
    expect(await h.edits.snapshot('a', 0, 'first')).toMatchObject({ value: 'replacement', sequence: 3 })
    await expect(h.edits.snapshot('a', 3, 'different')).rejects.toMatchObject({ code: 'sequence-conflict' })
    expect(h.edits.list(a.documentId)).toEqual([])
    expect(await h.edits.snapshot('b', 0, 'still generating')).toMatchObject({ value: 'still generating', status: 'active' })
    expect(a.read().undoDepth).toBe(0); expect(b.read().undoDepth).toBe(0)
  })

  it('honors a stopped run without a revision change and cancels a begin still waiting for main input', async () => {
    const h = harness(), session = await h.registry.create(md('left TARGET right'), 'a.md')
    const target: ToolTarget = { kind: 'markdown-range', from: 5, to: 11 }
    const handle = await h.grant('r', session.documentId, target)
    await h.edits.begin({ runId: 'r', editId: 'running', targetHandle: handle })
    await h.edits.snapshot('running', 0, 'preview')
    await h.gateway.stop('r')
    expect(await h.edits.snapshot('running', 1, 'stopped late')).toBeNull()
    expect(h.edits.list(session.documentId)).toEqual([])
    expect(session.read().revision).toBe(0)
    const second = await h.grant('next', session.documentId, target), entered = deferred(), release = deferred()
    h.controls.append = async () => { entered.resolve(); await release.promise }
    const human = h.human(session.documentId, { type: 'markdown.splice', from: 12, to: 17, text: 'later' })
    await entered.promise
    const starting = h.edits.begin({ runId: 'next', editId: 'cancelled-begin', targetHandle: second })
    h.edits.abort('cancelled-begin', 'stopped while authorizing')
    const rejected = expect(starting).rejects.toMatchObject({ code: 'edit-aborted' })
    h.controls.append = undefined; release.resolve(); await human; await rejected
    expect(h.edits.list(session.documentId)).toEqual([])
  })

  it('keeps previews out of recovery and rejects unauthorized targets and unconfirmed commit receipts', async () => {
    const h = harness(), session = await h.registry.create(md('canonical'), 'a.md')
    const denied = await h.grant('readonly', session.documentId, { kind: 'markdown-range', from: 0, to: 9 }, [])
    await expect(h.edits.begin({ runId: 'readonly', editId: 'denied', targetHandle: denied })).rejects.toMatchObject({ code: 'not-authorized' })
    const handle = await h.grant('r', session.documentId, { kind: 'markdown-range', from: 0, to: 9 })
    await h.edits.begin({ runId: 'r', editId: 'call', targetHandle: handle }); await h.edits.snapshot('call', 0, 'volatile text')
    h.edits.finish('call', { status: 'applied', documentId: session.documentId, operationId: h.gateway.operationIdentity('r', 'call'), beforeRevision: 0, revision: 1, persistence: 'recoverable' })
    expect(h.events.at(-1)).toMatchObject({ type: 'edit.aborted' })
    expect(h.durable.get(session.documentId)?.model).toMatchObject({ source: 'canonical' })
    await h.edits.begin({ runId: 'r', editId: 'close', targetHandle: handle }); await h.edits.snapshot('close', 0, 'not saved')
    const persisted = structuredClone(h.durable.get(session.documentId)!)
    await h.registry.close(session.documentId, { discardDirty: true })
    expect(h.events.at(-1)).toMatchObject({ type: 'edit.aborted', reason: '文档已关闭' })
    const restored = await h.registry.restore(persisted)
    expect(restored.read().epoch).not.toBe(session.read().epoch)
    expect(restored.read().model).toMatchObject({ source: 'canonical' })
    expect(await h.edits.snapshot('close', 1, 'late after reopen')).toBeNull()
    expect(restored.read().undoDepth).toBe(0)
  })

  it('targets unmounted Native text while preserving unrelated Flow content and commits only through Gateway', async () => {
    const h = harness(), model = fixture(), session = await h.registry.create(model, 'mixed.h5lesson')
    const target: ToolTarget = { kind: 'course-object', locationId: 'location-spatial', itemId: 'spatial-label' }
    const handle = await h.grant('r', session.documentId, target)
    await h.edits.begin({ runId: 'r', editId: 'native', targetHandle: handle })
    await h.edits.snapshot('native', 0, '空间正文😀')
    const human = structuredClone(model.project)
    flowSurfaceIn(human, 'surface-flow').blocks.push({ id: 'human-new', type: 'paragraph', content: { inlines: [{ type: 'text', text: '保留人工段落' }] } })
    await h.human(session.documentId, { type: 'course.replace', project: human })
    expect(await h.edits.snapshot('native', 1, '空间正文😀')).toMatchObject({ target, revision: model.project.revision + 1 })
    const result = receipt(await h.gateway.execute('r', 'native', textCall(handle, '空间正文😀')))
    h.edits.finish('native', result)
    const after = session.read()
    if (after.model.kind !== 'course-v9') throw new Error('fixture')
    expect(locateCourseLayer(after.model.project, 'spatial-label')?.item).toMatchObject({ content: { data: { text: '空间正文😀' } } })
    expect(flowSurfaceIn(after.model.project, 'surface-flow').blocks.at(-1)?.id).toBe('human-new')
    expect(after.undoDepth).toBe(2)
    expect(after.model.resources).toEqual(model.resources)
    expect(h.events.filter(event => event.type === 'edit.finished')).toHaveLength(1)
  })

  it.each(['flow-block', 'flow-range'] as const)('supports %s while human edits to another block remain canonical and undoable', async kind => {
    const h = harness(), model = fixture(), surface = flowSurfaceIn(model.project, 'surface-flow')
    const paragraph = surface.blocks.find(block => block.id === 'flow-paragraph')!
    if (paragraph.type !== 'paragraph') throw new Error('fixture')
    paragraph.content = { inlines: [{ type: 'text', text: '甲乙丙丁' }] }
    const target: ToolTarget = kind === 'flow-block'
      ? { kind, surfaceId: surface.id, parentId: null, blockId: paragraph.id }
      : { kind, surfaceId: surface.id, parentId: null, blockId: paragraph.id, slot: { kind: 'field', field: 'content' }, from: 1, to: 3 }
    const session = await h.registry.create(model, 'flow.h5lesson'), handle = await h.grant('r', session.documentId, target)
    await h.edits.begin({ runId: 'r', editId: 'flow', targetHandle: handle }); await h.edits.snapshot('flow', 0, '新😀')
    const human = structuredClone(model.project)
    flowSurfaceIn(human, surface.id).blocks.push({ id: 'other-block', type: 'paragraph', content: { inlines: [{ type: 'text', text: '人工保留' }] } })
    await h.human(session.documentId, { type: 'course.replace', project: human })
    expect(await h.edits.snapshot('flow', 1, '新😀')).toMatchObject({ status: 'active', target })
    const result = receipt(await h.gateway.execute('r', 'flow', textCall(handle, '新😀')))
    h.edits.finish('flow', result)
    const after = session.read()
    if (after.model.kind !== 'course-v9') throw new Error('fixture')
    const block = resolveFlowBlock(after.model.project, target).block
    expect(flowTextSlot(block, { kind: 'field', field: 'content' }).get()).toEqual({ inlines: [{ type: 'text', text: kind === 'flow-block' ? '新😀' : '甲新😀丁' }] })
    expect(flowSurfaceIn(after.model.project, surface.id).blocks.at(-1)?.id).toBe('other-block')
    expect(after.undoDepth).toBe(2)
    expect(h.edits.list(session.documentId)).toEqual([])
    expect(h.events.some(event => event.type === 'edit.aborted')).toBe(false)
  })
})
