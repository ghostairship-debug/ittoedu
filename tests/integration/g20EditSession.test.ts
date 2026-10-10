// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData } from '../../src/components/text'
import { readCourseInstanceText } from '../../src/core/tools/ToolTargets'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { DocumentCommand, DocumentOperationResult, DurableDocumentState } from '../../src/shared/workbench/document'
import type { EditEvent } from '../../src/shared/workbench/editSession'
import type { ToolTarget, ToolResult } from '../../src/shared/workbench/tools'

const markdown = new MarkdownDriver(), course = new CourseV10Driver()
const md = (source: string) => markdown.load(new TextEncoder().encode(source))
const fixture = () => createCurrentSelectionFixture().model
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
  it('streams disjoint A/B in one document while C is edited, and ACK/late snapshots remove only their own group', async () => {
    const h = harness(), session = await h.registry.create(md('AAA | BBB | CCC'), 'parallel.md')
    const a = await h.grant('run-a', session.documentId, { kind: 'markdown-range', from: 0, to: 3 })
    const b = await h.grant('run-b', session.documentId, { kind: 'markdown-range', from: 6, to: 9 })
    await Promise.all([h.edits.begin({ runId: 'run-a', editId: 'a', targetHandle: a }), h.edits.begin({ runId: 'run-b', editId: 'b', targetHandle: b })])
    expect(h.edits.list(session.documentId).map(value => value.editId)).toEqual(['a', 'b'])
    await h.edits.snapshot('a', 0, 'result A'); await h.edits.snapshot('b', 0, 'result B')
    await h.human(session.documentId, { type: 'markdown.splice', from: 12, to: 15, text: 'human C' })
    expect(h.edits.list(session.documentId)).toHaveLength(2)
    const appliedA = receipt(await h.gateway.execute('run-a', 'a', textCall(a, 'result A')))
    expect(appliedA.status).toBe('applied')
    h.edits.finish('a', appliedA)
    expect(await h.edits.snapshot('a', 99, 'late A')).toBeNull()
    expect(await h.edits.snapshot('b', 1, 'result B')).toMatchObject({ status: 'active' })
    expect(h.edits.list(session.documentId).map(value => value.editId)).toEqual(['b'])
    const appliedB = receipt(await h.gateway.execute('run-b', 'b', textCall(b, 'result B')))
    expect(appliedB.status).toBe('applied')
    expect(session.read()).toMatchObject({ model: { source: 'result A | result B | human C' }, undoDepth: 3 })
    expect(h.edits.list(session.documentId)).toEqual([])
    expect(h.events.filter(event => event.type === 'edit.finished').map(event => event.snapshot.editId)).toEqual(['a', 'b'])
  })

  it('keeps separate ranges of one component text field parallel and rejects an intersecting range or whole field', async () => {
    const h = harness(), model = fixture()
    model.project.instances['flow-paragraph'].data = JSON.parse(JSON.stringify(createTextComponentData('ABCDEFGH'))) as JsonValue
    const session = await h.registry.create(model, 'component-ranges.glx')
    const field: ToolTarget = { kind: 'course-instance', surfaceId: 'flow', instanceId: 'flow-paragraph', stateId: null, dataPath: ['content'] }
    const a = await h.grant('a', session.documentId, { ...field, from: 0, to: 2 })
    const b = await h.grant('b', session.documentId, { ...field, from: 4, to: 6 })
    const overlap = await h.grant('overlap', session.documentId, { ...field, from: 1, to: 5 })
    const whole = await h.grant('whole', session.documentId, field)
    await h.edits.begin({ runId: 'a', editId: 'a', targetHandle: a })
    await h.edits.begin({ runId: 'b', editId: 'b', targetHandle: b })
    await expect(h.edits.begin({ runId: 'overlap', editId: 'overlap', targetHandle: overlap })).rejects.toMatchObject({ code: 'target-busy' })
    await expect(h.edits.begin({ runId: 'whole', editId: 'whole', targetHandle: whole })).rejects.toMatchObject({ code: 'target-busy' })
    await h.edits.snapshot('a', 0, 'long A'); await h.edits.snapshot('b', 0, 'new B')
    const appliedA = receipt(await h.gateway.execute('a', 'a', textCall(a, 'long A')))
    expect(appliedA.status).toBe('applied')
    expect(await h.edits.snapshot('b', 1, 'new B')).toMatchObject({ status: 'active', target: { from: 8, to: 10 } })
    expect(receipt(await h.gateway.execute('b', 'b', textCall(b, 'new B'))).status).toBe('applied')
    const current = session.read().model
    if (current.kind !== 'course-v10') throw new Error('Expected component project')
    expect(readCourseInstanceText(current, field)).toMatchObject({ inlines: [{ type: 'text', text: 'long ACDnew BGH' }] })
    expect(h.edits.list(session.documentId)).toEqual([])
  })

  it('rejects partial source intersections and aggregate fragment overlap, and aborts only the selected edit', async () => {
    const h = harness(), session = await h.registry.create(md('first second third'), 'ranges.md')
    const a = await h.grant('a', session.documentId, { kind: 'markdown-range', from: 0, to: 5 })
    const b = await h.grant('b', session.documentId, { kind: 'markdown-range', from: 6, to: 12 })
    const overlap = await h.grant('overlap', session.documentId, { kind: 'markdown-range', from: 3, to: 8 })
    const aggregate = await h.grant('aggregate', session.documentId, { kind: 'text-selection', fragments: [
      { target: { kind: 'markdown-range', from: 1, to: 3 } }, { target: { kind: 'markdown-range', from: 13, to: 18 }, separatorBefore: ' ' },
    ] })
    await h.edits.begin({ runId: 'a', editId: 'a', targetHandle: a })
    await h.edits.begin({ runId: 'b', editId: 'b', targetHandle: b })
    await expect(h.edits.begin({ runId: 'overlap', editId: 'overlap', targetHandle: overlap })).rejects.toMatchObject({ code: 'target-busy' })
    await expect(h.edits.begin({ runId: 'aggregate', editId: 'aggregate', targetHandle: aggregate })).rejects.toMatchObject({ code: 'target-busy' })
    h.edits.abort('a', 'stop A only')
    expect(h.edits.list(session.documentId).map(value => value.editId)).toEqual(['b'])
    expect(await h.edits.snapshot('a', 1, 'late A')).toBeNull()
    expect(await h.edits.snapshot('b', 0, 'still B')).toMatchObject({ status: 'active' })
    await h.gateway.stop('a')
    expect(await h.edits.snapshot('b', 1, 'next B')).toMatchObject({ status: 'active' })
  })

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

  it('rejects overlapping groups, keeps other documents independent and deduplicates cumulative snapshots', async () => {
    const h = harness(), a = await h.registry.create(md('a'), 'a.md'), b = await h.registry.create(md('b'), 'b.md')
    const ha = await h.grant('ra', a.documentId, { kind: 'markdown-range', from: 0, to: 1 })
    const hb = await h.grant('rb', b.documentId, { kind: 'markdown-range', from: 0, to: 1 })
    const request = { runId: 'ra', editId: 'a', targetHandle: ha }
    const [first, duplicate] = await Promise.all([h.edits.begin(request), h.edits.begin(request)])
    expect(duplicate).toEqual(first)
    await expect(h.edits.begin({ ...request, editId: 'busy' })).rejects.toMatchObject({ code: 'target-busy' })
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

  it('previews Spatial text and exact Flow fields without changing canonical data, preserving concurrent neighboring edits through ACK and Undo', async () => {
    for (const mode of ['spatial', 'flow-object', 'flow-range'] as const) {
      const h = harness(), model = fixture()
      model.project.instances['flow-paragraph'].data = JSON.parse(JSON.stringify(createTextComponentData('甲乙丙丁'))) as JsonValue
      const target: ToolTarget = mode === 'spatial'
        ? { kind: 'course-instance', surfaceId: 'spatial', instanceId: 'spatial-label', stateId: null }
        : { kind: 'course-instance', surfaceId: 'flow', instanceId: 'flow-paragraph', stateId: null,
          ...(mode === 'flow-range' ? { dataPath: ['content'], from: 1, to: 3 } : {}) }
      const session = await h.registry.create(model, 'mixed.glx'), handle = await h.grant('r', session.documentId, target)
      await h.edits.begin({ runId: 'r', editId: 'current', targetHandle: handle })
      await h.edits.snapshot('current', 0, '新😀')
      expect(session.read().model).toEqual(model)
      expect(session.read().undoDepth).toBe(0)
      const neighborData = JSON.parse(JSON.stringify(createTextComponentData('人工保留'))) as JsonValue
      expect(await h.human(session.documentId, captureComponentOperation(model.project,
        [{ type: 'data.set', instanceId: 'flow-neighbor', path: [], value: neighborData }]))).toMatchObject({ status: 'applied' })
      expect(await h.edits.snapshot('current', 1, '新😀')).toMatchObject({ status: 'active', target, revision: 1 })
      const result = receipt(await h.gateway.execute('r', 'current', textCall(handle, '新😀')))
      expect(result.status).toBe('applied'); h.edits.finish('current', result)
      const after = session.read()
      if (after.model.kind !== 'course-v10') throw new Error('Expected current course')
      const whole = { ...target, dataPath: ['content'] }; delete (whole as { from?: number }).from; delete (whole as { to?: number }).to
      expect(readCourseInstanceText(after.model, whole)).toMatchObject({ inlines: [{ type: 'text', text: mode === 'flow-range' ? '甲新😀丁' : '新😀' }] })
      expect(after.model.project.instances['flow-neighbor'].data).toEqual(neighborData)
      expect(after.undoDepth).toBe(2); expect(after.model.resources).toEqual(model.resources)
      expect(h.edits.list(session.documentId)).toEqual([])
      expect(h.events.filter(event => event.type === 'edit.finished')).toHaveLength(1)
      expect(h.events.some(event => event.type === 'edit.aborted')).toBe(false)
      await session.execute({ documentId: after.documentId, epoch: after.epoch, operationId: 'undo-current', actor: 'human',
        baseRevision: after.revision, mutation: { type: 'undo' } })
      const undone = session.read().model
      if (undone.kind !== 'course-v10') throw new Error('Expected current course')
      expect(undone.project.instances[target.instanceId]).toEqual(model.project.instances[target.instanceId])
      expect(undone.project.instances['flow-neighbor'].data).toEqual(neighborData)
      expect(course.load(course.serialize(undone))).toEqual(undone)
    }
  })
})
