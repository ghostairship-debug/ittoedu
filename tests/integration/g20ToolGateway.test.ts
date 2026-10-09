// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { JSDOM } from 'jsdom'
import { inputDataSchema, inputRuntimeImplementation, inspectComponentInputRules } from '../../src/components/input'
import { createComponentInteractionRuntime } from '../../src/renderer/interactions/componentInteractionRuntime'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform/runtime'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { TABLE_DEFINITION } from '../../src/components/table'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'
import type { ToolResult, ToolRunGrant, ToolTarget } from '../../src/shared/workbench/tools'

const md = new MarkdownDriver(), text = new TextDriver(), course = new CourseV10Driver()
function harness() {
  let sequence = 0
  const states: DurableDocumentState[] = []
  let beforeAppend: (() => Promise<void>) | undefined
  const persistence: DocumentPersistence = {
    async append(state) { await beforeAppend?.(); states.push(structuredClone(state)) },
    async save() { throw new Error('not needed') },
  }
  const registry = new DocumentRegistry({ persistence, drivers: [md, course, text], createId: () => `id-${++sequence}`, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [md, course, text], () => String(++sequence), { prepareImage: prepareImageResource })
  return { registry, gateway, states, persistence, delayAppend(work?: () => Promise<void>) { beforeAppend = work } }
}
const markdown = (text: string) => md.load(new TextEncoder().encode(text))
function status(result: ToolResult) { return result.kind === 'document-operation' ? result.result.status : result.kind }
const replace = (target: string, content: string) => ({ name: 'text.replace', input: { target, content } })
describe('G20 real Registry/Driver tool gateway', () => {
  it('S04-T03 edits the frozen Markdown document, isolates grants and rejects forged targets', async () => {
    const { registry, gateway } = harness()
    const a = await registry.create(markdown('前文 TARGET 后文'), 'a.md')
    const b = await registry.create(markdown('another tab'), 'b.md')
    const target: ToolTarget = { kind: 'markdown-range', from: 3, to: 9 }
    const grant: ToolRunGrant = { runId: 'r', actor: 'agent' as const, documents: [{ documentId: a.documentId, writable: [target] }] }
    await gateway.beginRun(grant)
    ;(grant.documents[0].writable as ToolTarget[]).push({ kind: 'document' })
    const handle = await gateway.issueTarget('r', a.documentId, target)
    const denied = await gateway.issueTarget('r', a.documentId, { kind: 'markdown-range', from: 0, to: 2 })
    expect(await gateway.execute('r', 'denied', replace(denied, 'BAD'))).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(await gateway.execute('r', 'forged-handle', replace('t-forged', 'BAD'))).toMatchObject({ kind: 'error', code: 'invalid-target' })
    expect(await gateway.execute('r', 'forged', { name: 'text.replace', input: { target: handle, content: '新文', epoch: 'forged' } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
    expect(status(await gateway.execute('r', 'ok', replace(handle, '新文')))).toBe('applied')
    expect(a.read().model).toMatchObject({ source: '前文 新文 后文' })
    expect(b.read().model).toMatchObject({ source: 'another tab' })
    expect(a.read().undoDepth).toBe(1)
    const plain = await registry.create(text.load(new TextEncoder().encode('甲乙丙')), 'plain.txt')
    await gateway.beginRun({ runId: 'text', actor: 'agent', documents: [{ documentId: plain.documentId, writable: [{ kind: 'document' }] }] })
    const root = await gateway.issueTarget('text', plain.documentId, { kind: 'document' })
    expect(await gateway.execute('text', 'read-text', { name: 'read', input: { target: root } })).toMatchObject({ kind: 'read', data: { text: '甲乙丙' } })
    const range = await gateway.issueTarget('text', plain.documentId, { kind: 'markdown-range', from: 1, to: 2 })
    expect(status(await gateway.execute('text', 'replace-text', replace(range, '丁')))).toBe('applied')
    expect(plain.read().model).toMatchObject({ kind: 'text', source: '甲丁丙' })
    expect(a.read().model).toMatchObject({ source: '前文 新文 后文' })
  })

  it('maps a disjoint human edit, detects overlapping edits, and observes queued input', async () => {
    const { registry, gateway } = harness()
    const session = await registry.create(markdown('abcDEFghi'), 'a.md')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const handle = await gateway.issueTarget('r', session.documentId, { kind: 'markdown-range', from: 3, to: 6 })
    const readonly = await gateway.issueTarget('r', session.documentId, { kind: 'markdown-range', from: 3, to: 6 }, { readOnly: true })
    expect(await gateway.execute('r', 'readonly-denied', replace(readonly, 'BAD'))).toMatchObject({ kind: 'error', code: 'not-authorized' })
    const snapshot = session.read()
    const human = session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 1, text: 'long' } } })
    expect(status(await gateway.execute('r', 'replace', replace(handle, 'XYZ')))).toBe('applied')
    await human
    expect(session.read().model).toMatchObject({ source: 'longbcXYZghi' })
    // This task's durable ACK advances its original handle, including the human prefix shift.
    expect(status(await gateway.execute('r', 'ack-continued', replace(handle, 'BAD')))).toBe('applied')
    expect(session.read().model).toMatchObject({ source: 'longbcBADghi' })
    const reissue = await gateway.issueTarget('r', session.documentId, { kind: 'markdown-range', from: 6, to: 9 })
    expect(status(await gateway.execute('r', 'ack-fresh', replace(reissue, 'BAD')))).toBe('unchanged')
    expect(session.read().model).toMatchObject({ source: 'longbcBADghi' })
    const overlap = session.read()
    await session.execute({ documentId: overlap.documentId, epoch: overlap.epoch, operationId: 'human-overlap', actor: 'human',
      baseRevision: overlap.revision, mutation: { type: 'command', command: { type: 'markdown.splice', from: 6, to: 9, text: 'HUMAN' } } })
    expect(await gateway.execute('r', 'overlap', replace(reissue, 'DENIED'))).toMatchObject({ kind: 'error', code: 'target-conflict' })
  })

  it('keeps acknowledged source handles continuous, detects an Undo change and permits a Redo restoring their exact content', async () => {
    const { registry, gateway } = harness()
    const session = await registry.create(markdown('abcDEFghi'), 'undo.md')
    const target: ToolTarget = { kind: 'markdown-range', from: 3, to: 6 }
    await gateway.beginRun({ runId: 'undo-run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
    const handle = await gateway.issueTarget('undo-run', session.documentId, target)
    expect(status(await gateway.execute('undo-run', 'first', replace(handle, 'XYZ')))).toBe('applied')
    expect(status(await gateway.execute('undo-run', 'second', replace(handle, 'DEF')))).toBe('applied')
    expect(session.read().model).toMatchObject({ source: 'abcDEFghi' })
    const beforeUndo = session.read()
    expect((await session.execute({ documentId: beforeUndo.documentId,
      epoch: beforeUndo.epoch, operationId: 'human-undo', actor: 'human', baseRevision: beforeUndo.revision,
      mutation: { type: 'undo' } })).status).toBe('applied')
    expect(await gateway.execute('undo-run', 'changed-by-undo', replace(handle, 'BAD'))).toMatchObject({ kind: 'error', code: 'target-conflict' })
    expect(session.read().model).toMatchObject({ source: 'abcXYZghi' })
    const beforeRedo = session.read()
    await session.execute({ documentId: beforeRedo.documentId, epoch: beforeRedo.epoch, operationId: 'human-redo',
      actor: 'human', baseRevision: beforeRedo.revision, mutation: { type: 'redo' } })
    expect(session.read().model).toMatchObject({ source: 'abcDEFghi' })
    // Restoring the exact acknowledged content preserves the frozen grant and existing handle.
    expect(status(await gateway.execute('undo-run', 'restored-content', replace(handle, 'JKL')))).toBe('applied')
    expect(session.read().model).toMatchObject({ source: 'abcJKLghi' })
  })

  it('makes valid Markdown batches one history entry and cross-document batches zero writes', async () => {
    const { registry, gateway } = harness()
    const a = await registry.create(markdown('aaa bbb ccc'), 'a.md'), b = await registry.create(markdown('ddd'), 'b.md')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [a, b].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
    const handles = await Promise.all([[a, 0, 3], [a, 8, 11], [b, 0, 3]].map(async ([session, from, to]) => gateway.issueTarget('r', (session as typeof a).documentId, { kind: 'markdown-range', from: from as number, to: to as number })))
    expect(await gateway.execute('r', 'cross', { name: 'batch', input: { operations: [replace(handles[0], 'A'), replace(handles[2], 'D')] } })).toMatchObject({ code: 'cross-document-batch' })
    expect(a.read().undoDepth).toBe(0)
    const result = await gateway.execute('r', 'batch', { name: 'batch', input: { operations: [replace(handles[0], 'A'), replace(handles[1], 'C')] } })
    expect(status(result)).toBe('applied')
    expect(a.read().model).toMatchObject({ source: 'A bbb C' })
    expect(a.read().undoDepth).toBe(1)
    if (result.kind !== 'document-operation') throw new Error('result')
    expect(status(await gateway.execute('r', 'continue', replace(result.affected[1], 'CC')))).toBe('applied')
  })

  it('S04-T04 rolls back all three same-document steps when the second is invalid', async () => {
    const { registry, gateway, states } = harness()
    const a = await registry.create(markdown('aaa bbb ccc'), 'a.md')
    const b = await registry.create(markdown('ddd'), 'b.md')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [a, b].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
    const [first, second, third, other] = await Promise.all([
      [a, 0, 3], [a, 4, 7], [a, 8, 11], [b, 0, 3],
    ].map(([session, from, to]) => gateway.issueTarget('r', (session as typeof a).documentId, { kind: 'markdown-range', from: from as number, to: to as number })))
    const before = a.read(), otherBefore = b.read(), durableCount = states.length
    const invalid = await gateway.execute('r', 'invalid-three', { name: 'batch', input: { operations: [
      replace(first, 'A'),
      { name: 'object.update', input: { target: second, properties: { opacity: 0.4 } } },
      replace(third, 'C'),
    ] } })
    expect(invalid.kind).toBe('error')
    expect(a.read()).toEqual(before)
    expect(b.read()).toEqual(otherBefore)
    expect(states).toHaveLength(durableCount)

    const crossDocument = await gateway.execute('r', 'cross-three', { name: 'batch', input: { operations: [
      replace(first, 'A'), replace(other, 'D'), replace(third, 'C'),
    ] } })
    expect(crossDocument).toMatchObject({ kind: 'error', code: 'cross-document-batch' })
    expect(a.read()).toEqual(before)
    expect(b.read()).toEqual(otherBefore)
    expect(states).toHaveLength(durableCount)

    expect(status(await gateway.execute('r', 'valid-three', { name: 'batch', input: { operations: [
      replace(first, 'A'), replace(second, 'B'), replace(third, 'C'),
    ] } }))).toBe('applied')
    const applied = a.read()
    expect(applied.model).toMatchObject({ source: 'A B C' })
    expect(applied.undoDepth).toBe(before.undoDepth + 1)
    expect(applied.revision).toBe(before.revision + 1)
    await a.execute({ documentId: applied.documentId, epoch: applied.epoch, operationId: 'undo-three', actor: 'human', baseRevision: applied.revision, mutation: { type: 'undo' } })
    expect(a.read().model).toEqual(before.model)
  })

  it('waits for durable ACK, returns a lost receipt idempotently and stops later calls', async () => {
    const h = harness()
    const session = await h.registry.create(markdown('before'), 'a.md')
    await h.gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const target = await h.gateway.issueTarget('r', session.documentId, { kind: 'markdown-range', from: 0, to: 6 })
    let release!: () => void, entered!: () => void
    const enteredPromise = new Promise<void>(resolve => { entered = resolve })
    h.delayAppend(() => { entered(); return new Promise<void>(resolve => { release = resolve }) })
    let completed = false
    const result = h.gateway.execute('r', 'call', replace(target, 'after')).then(value => { completed = true; return value })
    await enteredPromise
    expect(completed).toBe(false)
    expect(session.read().model).toMatchObject({ source: 'before' })
    expect(await h.gateway.lookup('r', 'call', replace(target, 'after'))).toBeNull()
    expect(completed).toBe(false)
    h.delayAppend(); release()
    expect(status(await result)).toBe('applied')
    await h.gateway.stop('r')
    expect(status(await h.gateway.execute('r', 'call', replace(target, 'after')))).toBe('applied')
    expect(session.read().undoDepth).toBe(1)
    expect(await h.gateway.execute('r', 'call', replace(target, 'DIFFERENT'))).toMatchObject({ code: 'operation-payload-mismatch' })
    expect(await h.gateway.execute('r', 'late', replace(target, 'LATE'))).toMatchObject({ code: 'run-stopped' })
    // A new gateway can query the persisted request before the old handle exists.
    const next = harness()
    const restored = await next.registry.restore(h.states.at(-1)!)
    const nextGateway = next.gateway
    const recoveryGrant: ToolRunGrant = { runId: 'r', actor: 'agent', documents: [{ documentId: restored.documentId, writable: [{ kind: 'markdown-range', from: 0, to: 600 }] }] }
    nextGateway.recoverRun(recoveryGrant)
    expect(() => nextGateway.recoverRun(recoveryGrant)).not.toThrow()
    expect(() => nextGateway.recoverRun({ ...recoveryGrant, actor: 'human' })).toThrow('恢复身份')
    expect(() => nextGateway.recoverRun({ ...recoveryGrant, documents: [{ documentId: 'foreign', writable: [] }] })).toThrow('恢复身份')
    await expect(nextGateway.issueTarget('r', restored.documentId, { kind: 'markdown-range', from: 0, to: 5 })).rejects.toMatchObject({ code: 'run-stopped' })
    expect(await nextGateway.execute('r', 'new-after-recovery', replace(target, 'BAD'))).toMatchObject({ code: 'run-stopped' })
    expect(await nextGateway.lookup('r', 'call', replace(target, 'after'))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(await nextGateway.lookup('r', 'unknown', replace('expired-handle', 'anything'))).toBeNull()
    expect(await nextGateway.lookup('r', 'call', replace(target, 'DIFFERENT'))).toMatchObject({ kind: 'document-operation', result: { status: 'conflict' } })
    expect(restored.read().model).toMatchObject({ source: 'after' })
    expect(status(await nextGateway.execute('r', 'call', replace(target, 'after')))).toBe('applied')
    expect(restored.read().undoDepth).toBe(1)
  })

  it('returns explicit read pagination, bounded child handles and stale-cursor errors', async () => {
    const { registry, gateway } = harness()
    const session = await registry.create(markdown('x'.repeat(250)), 'a.md')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [] }] })
    const target = await gateway.issueTarget('r', session.documentId, { kind: 'document' })
    const first = await gateway.execute('r', 'read-1', { name: 'read', input: { target, limit: 1 } })
    expect(first).toMatchObject({ kind: 'read', data: { text: 'x'.repeat(100), truncated: true } })
    if (first.kind !== 'read') throw new Error('read')
    const second = await gateway.execute('r', 'read-2', { name: 'read', input: { target, limit: 1, cursor: first.nextCursor } })
    expect(second).toMatchObject({ data: { offset: 100, text: 'x'.repeat(100) } })
    const children = await gateway.execute('r', 'children', { name: 'listChildren', input: { target, limit: 1 } })
    expect(children).toMatchObject({ kind: 'read', data: [{ kind: 'markdown-range' }] })
    const snapshot = session.read()
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, actor: 'human', operationId: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'different' } } })
    expect(await gateway.execute('r', 'read-3', { name: 'read', input: { target, cursor: first.nextCursor } })).toMatchObject({ code: 'stale-cursor' })
  })

})

async function courseHarness(setup?: (project: CourseProjectV10) => void) {
  const h = harness(), project = createBlankCourseProjectV10('Current Gateway')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.label = { id: 'label', definitionId: WEB_DEFINITION.id, data: { html: '<p>Original</p>' },
    frame: { width: 200, height: 90, transform: [1, 0, 0, 1, 20, 30] } }
  project.surfaces[0].childIds = ['label']
  setup?.(project)
  const session = await h.registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'current.glx')
  await h.gateway.beginRun({ runId: 'course', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const surfaceId = project.surfaces[0].id
  const address = { kind: 'course-instance' as const, surfaceId, instanceId: 'label' }
  const model = () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current }
  const call = (id: string, name: string, input: unknown) => h.gateway.execute('course', id, { name, input })
  return { ...h, project, session, surfaceId, address, model, call }
}

it('rereads an externally edited V10 object as read-only without renewing its original write authority', async () => {
  const h = await courseHarness(), handle = await h.gateway.issueTarget('course', h.session.documentId, h.address)
  expect(await h.call('write', 'object.update', { target: handle, properties: { data: { html: 'Acknowledged content' } } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const before = h.session.read()
  expect(await h.session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: 'human-opacity', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'style.set', instanceId: 'label', path: ['opacity'], value: .5 }]) } })).toMatchObject({ status: 'applied' })
  const human = h.session.read(), observed = await h.call('observe-human', 'inspect', { target: handle })
  expect(observed).toMatchObject({ kind: 'read', data: { writable: false } })
  if (observed.kind !== 'read') throw new Error('Expected inspection')
  const readOnly = (observed.data as { target: string }).target
  expect(await h.call('read-human', 'read', { target: readOnly })).toMatchObject({ kind: 'read' })
  expect(await h.call('no-renewal', 'object.update', { target: readOnly, properties: { data: { html: 'BAD' } } })).toMatchObject({ code: 'not-authorized' })
  expect(await h.call('old-handle', 'object.update', { target: handle, properties: { data: { html: 'BAD' } } })).toMatchObject({ code: 'target-conflict' })
  expect(h.session.read()).toEqual(human)
  expect(human.undoDepth).toBe(2)
  await h.gateway.stop('course')
})

it('performs current rule CRUD through observed V10 targets with one-entry batches, no-op History, archive reopen and stale/read-only rejection', async () => {
  const h = await courseHarness(), page = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const object = await h.gateway.issueTarget('course', h.session.documentId, h.address)
  const rule = { enabled: true, trigger: { type: 'node.click', nodeId: object }, conditions: [], actions: [
    { start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: object, durationMs: 0, easing: 'linear', effect: 'none' } },
  ] }
  const add = { name: 'interaction.update', input: { target: page, change: { kind: 'add', rule } } }
  const before = h.session.read(), durableCount = h.states.length
  expect(await h.call('invalid-batch', 'batch', { operations: [add,
    { name: 'object.author', input: { target: object, change: { kind: 'table', edit: { kind: 'cell-text', cellId: 'missing-cell', text: 'BAD' } } } },
  ] })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(before); expect(h.states).toHaveLength(durableCount)
  expect(await h.call('valid-batch', 'batch', { operations: [add,
    { name: 'object.update', input: { target: object, properties: { opacity: .4 } } },
  ] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const owner = { kind: 'surface' as const, surfaceId: h.surfaceId }
  const rules = () => interactionRules(interactionBehavior(h.model().project, owner))
  const original = rules()[0]!
  expect(original.id).toBeTruthy(); expect(original.actions[0].id).toBeTruthy()
  expect(original.trigger).toEqual({ type: 'node.click', nodeId: 'label' })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const observed = await h.call('read-rules', 'read', { target: page })
  expect(observed).toMatchObject({ kind: 'read' })
  const { id: ruleId, ...sameRule } = original
  const update = { target: page, change: { kind: 'update', ruleId, rule: sameRule } }
  const beforeNoOp = h.session.read()
  expect(await h.call('same-rule', 'interaction.update', update)).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(h.session.read().undoDepth).toBe(beforeNoOp.undoDepth); expect(h.session.read().revision).toBe(beforeNoOp.revision)
  const other = await h.registry.create({ kind: 'course-v10', project: h.project, resources: { assets: {}, components: {} } }, 'reference-other.glx')
  await h.gateway.attachRunDocument('course', other.documentId, false)
  const foreignObject = await h.gateway.issueTarget('course', other.documentId, h.address)
  const beforeForeign = h.session.read(), beforeForeignOther = other.read(), foreignDurableCount = h.states.length
  const rootHandle = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'document' })
  await h.gateway.beginRun({ runId: 'another-author', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [] }] })
  const foreignRunObject = await h.gateway.issueTarget('another-author', h.session.documentId, h.address)
  for (const nodeId of [foreignObject, foreignRunObject, rootHandle]) {
    expect(await h.call(`invalid-reference-${nodeId}`, 'batch', { operations: [
      { name: 'object.update', input: { target: object, properties: { opacity: .7 } } },
      { name: 'interaction.update', input: { target: page, change: { kind: 'add', rule: { ...rule, trigger: { type: 'node.click', nodeId } } } } },
    ] })).toMatchObject({ kind: 'error' })
    expect(h.session.read()).toEqual(beforeForeign); expect(other.read()).toEqual(beforeForeignOther); expect(h.states).toHaveLength(foreignDurableCount)
  }

  const readOnly = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId }, { readOnly: true })
  expect(await h.call('readonly-rule', 'interaction.update', { ...update, target: readOnly })).toMatchObject({ code: 'not-authorized' })
  expect(await h.call('duplicate-rule', 'interaction.update', { target: page, change: { kind: 'duplicate', ruleId } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const duplicate = rules()[1]!
  expect(duplicate.id).not.toBe(ruleId); expect(duplicate.actions[0].id).not.toBe(original.actions[0].id)
  expect(await h.call('remove-duplicate', 'interaction.update', { target: page, change: { kind: 'remove', ruleId: duplicate.id } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(rules()).toEqual([original]); expect(course.load(course.serialize(h.model()))).toEqual(h.model())
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo-rule-remove', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(rules()).toHaveLength(2)
  const restoredRule = h.session.read()
  expect(await h.session.execute({ documentId: restoredRule.documentId, epoch: restoredRule.epoch, baseRevision: restoredRule.revision,
    operationId: 'redo-rule-remove', actor: 'human', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
  expect(rules()).toEqual([original])
  const afterUndo = h.session.read()
  expect(await h.session.execute({ documentId: afterUndo.documentId, epoch: afterUndo.epoch, baseRevision: afterUndo.revision,
    operationId: 'human-owner-title', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'surface.title.set', surfaceId: h.surfaceId, title: 'Human owner edit' }]) } })).toMatchObject({ status: 'applied' })
  const human = h.session.read()
  expect(await h.call('stale-remove', 'interaction.update', { target: page, change: { kind: 'remove', ruleId } })).toMatchObject({ code: 'target-conflict' })
  expect(h.session.read()).toEqual(human)
  await h.gateway.beginRun({ runId: 'object-only', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [h.address] }] })
  const limitedObject = await h.gateway.issueTarget('object-only', h.session.documentId, h.address)
  const click = await h.gateway.execute('object-only', 'own-click', { name: 'interaction.update', input: { target: limitedObject, change: { kind: 'click', action: 'location-go', value: h.surfaceId } } })
  expect(click, JSON.stringify(click)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (click.kind !== 'document-operation') throw new Error('Expected scoped click')
  expect(await h.gateway.execute('object-only', 'receipt-no-expansion', { name: 'interaction.update', input: { target: click.affected[0], change: { kind: 'add', rule } } })).toMatchObject({ kind: 'error' })
  const limitedPage = await h.gateway.issueTarget('object-only', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const afterClick = h.session.read()
  expect(await h.gateway.execute('object-only', 'owner-no-expansion', { name: 'interaction.update', input: { target: limitedPage, change: { kind: 'add', rule } } })).toMatchObject({ code: 'not-authorized' })
  expect(h.session.read()).toEqual(afterClick)
  const currentPage = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  expect(await h.session.execute({ documentId: afterClick.documentId, epoch: afterClick.epoch, baseRevision: afterClick.revision,
    operationId: 'human-lock', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'instance.patch', instanceId: 'label', patch: { locked: true } }]) } })).toMatchObject({ status: 'applied' })
  const locked = h.session.read()
  expect(await h.call('locked-rule', 'interaction.update', { target: currentPage, change: { kind: 'update', ruleId, rule: { ...sameRule, name: 'BAD' } } })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(locked)
})

it('commits admitted V10 media bytes once, preserves durable resources through undo/redo and rejects invalid, foreign, stopped and atomic-failure inputs', async () => {
  const h = await courseHarness(project => { project.surfaces.push({ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }, { id: 'world', kind: 'spatial', title: 'World', childIds: [] }) }), before = h.session.read()
  const page = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const bytes = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 4, background: '#11aa88' } }).png().toBuffer())
  await expect(h.gateway.provideImage('course', h.session.documentId, { bytes, filename: 'wrong.jpg', mimeType: 'image/jpeg' })).rejects.toThrow('不匹配')
  const damaged = bytes.slice(); damaged[Buffer.from(damaged).indexOf('IDAT') + 4] ^= 0xff
  expect((await sharp(damaged).metadata()).width).toBe(3)
  await expect(h.gateway.provideImage('course', h.session.documentId, { bytes: damaged, filename: 'broken.png', mimeType: 'image/png' })).rejects.toThrow()
  const noDecoder = new DocumentToolGateway(h.registry, [md, course, text], () => 'no-decoder')
  await noDecoder.beginRun({ runId: 'no-decoder', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'document' }] }] })
  await expect(noDecoder.provideImage('no-decoder', h.session.documentId, { bytes, filename: 'real.png', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'unsupported-resource-preparation' })
  expect(h.session.read()).toEqual(before)
  const resource = await h.gateway.provideImage('course', h.session.documentId, { bytes, filename: 'image.png', mimeType: 'image/png' })
  const frozenBytes = bytes.slice(); bytes.fill(0)
  const other = await h.registry.create(before.model, 'other.glx')
  await h.gateway.beginRun({ runId: 'foreign', actor: 'agent', documents: [{ documentId: other.documentId, writable: [{ kind: 'document' }] }] })
  const foreign = await h.gateway.issueTarget('foreign', other.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  expect(await h.gateway.execute('foreign', 'foreign-resource', { name: 'media.insert', input: { target: foreign, resource } })).toMatchObject({ code: 'not-authorized' })
  expect(other.read().undoDepth).toBe(0)
  await h.gateway.beginRun({ runId: 'two-documents', actor: 'agent', documents: [h.session, other].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
  const sameRunResource = await h.gateway.provideImage('two-documents', h.session.documentId, { bytes: frozenBytes, filename: 'shared.png', mimeType: 'image/png' })
  const otherPage = await h.gateway.issueTarget('two-documents', other.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const otherBefore = other.read()
  const crossDocument = await h.gateway.execute('two-documents', 'cross-document-resource', { name: 'media.insert', input: { target: otherPage, resource: sameRunResource } })
  expect(crossDocument).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.session.read()).toEqual(before)
  const otherModel = other.read().model
  if (otherModel.kind !== 'course-v10') throw new Error('Expected V10')
  expect(Object.keys(otherModel.project.assets)).toHaveLength(1)
  expect(Object.values(otherModel.resources.assets)[0]).toEqual(frozenBytes)
  expect(other.read().undoDepth).toBe(otherBefore.undoDepth + 1)
  const copied = other.read()
  expect(await other.execute({ documentId: copied.documentId, epoch: copied.epoch, baseRevision: copied.revision,
    operationId: 'undo-cross-copy', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(other.read().model.resources).toEqual(otherBefore.model.resources)
  expect(h.session.read()).toEqual(before)
  const copyUndone = other.read()
  expect(await other.execute({ documentId: copyUndone.documentId, epoch: copyUndone.epoch, baseRevision: copyUndone.revision,
    operationId: 'redo-cross-copy', actor: 'human', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
  const redoneCopy = other.read().model
  if (redoneCopy.kind !== 'course-v10') throw new Error('Expected V10')
  expect(redoneCopy).toEqual({ ...otherModel, project: { ...otherModel.project, revision: redoneCopy.project.revision } })
  expect(h.session.read()).toEqual(before)

  await expect(h.gateway.readImageResource('two-documents', other.documentId, sameRunResource)).rejects.toMatchObject({ code: 'invalid-resource' })
  const foreignCurrent = await h.gateway.issueTarget('foreign', other.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  expect(await h.gateway.execute('foreign', 'unreadable-source', { name: 'media.insert', input: { target: foreignCurrent, resource: sameRunResource } })).toMatchObject({ code: 'not-authorized' })
  const readonlyOther = await h.gateway.issueTarget('two-documents', other.documentId, { kind: 'course-surface', surfaceId: h.surfaceId }, { readOnly: true })
  expect(await h.gateway.execute('two-documents', 'readonly-destination', { name: 'media.insert', input: { target: readonlyOther, resource: sameRunResource } })).toMatchObject({ code: 'not-authorized' })
  const insert = { name: 'media.insert', input: { target: page, resource, fit: 'cover' } }
  const object = await h.gateway.issueTarget('course', h.session.documentId, h.address)
  const beforeUnsupported = h.session.read(), unsupportedDurableCount = h.states.length
  expect(await h.call('unsupported-media-target', 'media.apply', { target: object, resource })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(beforeUnsupported); expect(h.states).toHaveLength(unsupportedDurableCount)
  expect(await h.call('bad-media-batch', 'batch', { operations: [insert,
    { name: 'object.author', input: { target: object, change: { kind: 'table', edit: { kind: 'cell-text', cellId: 'missing-cell', text: 'BAD' } } } },
  ] })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(before)
  const result = await h.gateway.execute('course', 'media-create', insert)
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = h.session.read(), model = h.model(), assetId = Object.keys(model.project.assets)[0]!
  expect(model.project.assets[assetId]).toMatchObject({ width: 3, height: 2, mimeType: 'image/png' })
  expect(model.resources.assets[assetId]).toEqual(frozenBytes)
  expect(h.states.at(-1)!.model.resources.assets[assetId]).toEqual(frozenBytes)
  expect(after.undoDepth).toBe(before.undoDepth + 1)
  expect(await h.gateway.execute('course', 'media-create', insert)).toMatchObject({ kind: 'document-operation', result: result.kind === 'document-operation' ? result.result : undefined, affected: [] })
  expect(h.session.read().undoDepth).toBe(after.undoDepth)
  expect(course.load(course.serialize(model))).toEqual(model)
  expect(await h.session.execute({ documentId: after.documentId, epoch: after.epoch, baseRevision: after.revision,
    operationId: 'undo-image', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().resources).toEqual(before.model.resources)
  expect(h.model().project.assets).toEqual(h.project.assets)
  const undone = h.session.read()
  expect(await h.session.execute({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
    operationId: 'redo-image', actor: 'human', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().resources).toEqual(model.resources)
  if (result.kind !== 'document-operation') throw new Error('Expected media commit')
  const flow = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: 'flow' })
  const world = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: 'world' })
  const baseline = h.session.read(), imageTarget = (await h.gateway.resolveEditTarget('course', result.affected[0])).target
  if (imageTarget.kind !== 'course-instance') throw new Error('Expected image target')
  const slideImage = h.model().project.instances[imageTarget.instanceId]
  expect(await h.call('all-surfaces', 'batch', { operations: [
    { name: 'media.apply', input: { target: result.affected[0], resource, fit: 'contain' } },
    ...[flow, world].map(target => ({ name: 'media.insert', input: { target, resource } })),
    ...[page, flow, world].map(target => ({ name: 'surface.configure', input: { target, settings: { background: { mode: 'own', source: resource } } } })),
  ] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const all = h.model()
  for (const surface of all.project.surfaces) {
    expect(surface.background?.assetId).toBeTruthy()
    expect(all.resources.assets[surface.background!.assetId!]).toEqual(frozenBytes)
    const image = surface.childIds.map(id => all.project.instances[id]).find(instance => instance.definitionId === 'guoling.image')!
    const imageAsset = (image.data as { assetId: string }).assetId
    expect(all.resources.assets[imageAsset]).toEqual(frozenBytes)
    if (surface.id === h.surfaceId) expect(image.frame).toEqual(slideImage.frame)
  }
  expect(h.session.read().undoDepth).toBe(baseline.undoDepth + 1)
  expect(course.load(course.serialize(all))).toEqual(all)
  const allSnapshot = h.session.read()
  expect(await h.session.execute({ documentId: allSnapshot.documentId, epoch: allSnapshot.epoch, baseRevision: allSnapshot.revision,
    operationId: 'undo-all-media', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(model.project.instances)
  expect(h.model().project.assets).toEqual(model.project.assets); expect(h.model().resources).toEqual(model.resources)
  const durable = h.states.filter(state => state.documentId === h.session.documentId).at(-1)!
  await h.registry.close(h.session.documentId, { discardDirty: true })
  const restored = await h.registry.restore(durable)
  expect(restored.read().epoch).not.toBe(after.epoch)
  expect(await h.gateway.execute('two-documents', 'expired-source', { name: 'media.insert', input: { target: otherPage, resource: sameRunResource } })).toMatchObject({ code: 'stale-epoch' })
  await h.gateway.stop('course')
  expect(await h.gateway.execute('course', 'stopped-image', insert)).toMatchObject({ code: 'run-stopped' })
  await expect(h.gateway.provideImage('course', h.session.documentId, { bytes: frozenBytes, filename: 'late.png', mimeType: 'image/png' })).rejects.toThrow('停止')
})

it('keeps Flow rich range grants exact across a concurrent neighbor edit, preserving math, styles, links and canonical undo', async () => {
  const h = await courseHarness(project => {
    project.surfaces[0].kind = 'flow'; project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const data = createTextComponentData('')
    data.content.inlines = [{ type: 'text', text: '甲', style: { bold: true } },
      { type: 'math', formulaId: 'math-one', latex: 'x^2', accessibleText: 'x平方' },
      { type: 'text', text: '乙😀丙', link: { href: 'https://example.org' } }]
    project.instances.paragraph = { id: 'paragraph', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)) }
    project.surfaces[0].childIds.push('paragraph')
  })
  const range: ToolTarget = { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'paragraph', dataPath: ['content'], from: 2, to: 4 }
  await h.gateway.beginRun({ runId: 'range', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [range] }] })
  const handle = await h.gateway.issueTarget('range', h.session.documentId, range)
  const whole = await h.gateway.issueTarget('range', h.session.documentId, { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'paragraph' })
  expect(await h.gateway.execute('range', 'widen', replace(whole, 'BAD'))).toMatchObject({ code: 'not-authorized' })
  const beforeHuman = h.session.read()
  expect(await h.session.execute({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch, baseRevision: beforeHuman.revision,
    operationId: 'human-neighbor', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'data.set', instanceId: 'label', path: ['html'], value: 'Human neighbor content' }]) } })).toMatchObject({ status: 'applied' })
  const before = h.session.read(), original = h.model().project.instances.paragraph.data as unknown as ReturnType<typeof createTextComponentData>
  expect(await h.gateway.execute('range', 'precise', { name: 'text.replace', input: { target: handle, content: '<i>新</i>', format: 'html' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const data = h.model().project.instances.paragraph.data as unknown as ReturnType<typeof createTextComponentData>
  expect(data.content.inlines).toEqual([original.content.inlines[0], original.content.inlines[1],
    { type: 'text', text: '新', style: { italic: true } }, { type: 'text', text: '丙', link: { href: 'https://example.org' } }])
  expect(h.model().project.instances.label.data).toEqual({ html: 'Human neighbor content' })
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(course.load(course.serialize(h.model())).resources).toEqual(before.model.resources)
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo-flow-range', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances.paragraph.data).toEqual(original)
  expect(h.model().project.instances.label.data).toEqual({ html: 'Human neighbor content' })
  expect(await h.gateway.execute('range', 'after-undo', replace(handle, 'BAD'))).toMatchObject({ code: 'target-conflict' })
})

it('moves Flow objects only into authorized destinations and rejects a cyclic move without a partial write', async () => {
  const h = await courseHarness(project => {
    project.surfaces[0].kind = 'flow'
    project.definitions.container = { id: 'container', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } }
    project.instances.section = { id: 'section', definitionId: 'container', data: {}, childIds: [] }
    project.surfaces[0].childIds.push('section')
  })
  const source = h.address, destination = { kind: 'course-instance' as const, surfaceId: h.surfaceId, instanceId: 'section' }
  await h.gateway.beginRun({ runId: 'move', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [source] }] })
  const restricted = await h.gateway.issueTarget('move', h.session.documentId, source)
  const denied = await h.gateway.issueTarget('move', h.session.documentId, destination), before = h.session.read()
  expect(await h.gateway.execute('move', 'denied', { name: 'object.structure', input: { target: restricted, action: 'move', destination: denied } })).toMatchObject({ code: 'not-authorized' })
  expect(h.session.read()).toEqual(before)
  const target = await h.gateway.issueTarget('course', h.session.documentId, source)
  const section = await h.gateway.issueTarget('course', h.session.documentId, destination)
  expect(await h.call('allowed', 'object.structure', { target, action: 'move', destination: section })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(h.model().project.instances.section.childIds).toEqual(['label'])
  expect(h.model().project.instances.label).toEqual(h.project.instances.label)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  const moved = h.session.read()
  expect(await h.call('cycle', 'object.structure', { target: section, action: 'move', destination: section })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(moved)
  expect(course.load(course.serialize(h.model()))).toEqual(h.model())
})

it('merges Flow table cells and inserts a row in one Gateway transaction, rejecting an invalid merged-column move without changing data', async () => {
  const table = createTableData({ rows: 1, columns: 2 }), rowId = table.rows[0].id
  table.rows[0].cells[0].text = '甲'; table.rows[0].cells[1].text = '乙'
  const h = await courseHarness(project => {
    project.surfaces[0].kind = 'flow'; project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
    project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: table as unknown as JsonValue }
    project.surfaces[0].childIds.push('table')
  })
  const target = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'table' })
  const call = (edit: unknown) => ({ name: 'object.author', input: { target, change: { kind: 'table', edit } } })
  expect(await h.call('merge-and-insert', 'batch', { operations: [
    call({ kind: 'merge', region: { rowIds: [rowId], columnIds: table.columns.map(column => column.id) } }),
    call({ kind: 'insert-row', referenceRowId: rowId, position: 'after' }),
  ] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const data = parseTableData(h.model().project.instances.table.data)
  expect(data.rows).toHaveLength(2); expect(data.rows[1].id).not.toBe(rowId)
  expect(data.rows[0].cells.map(cell => cell.text)).toEqual(['甲\n乙', ''])
  expect(h.session.read().undoDepth).toBe(1)
  const beforeInvalid = h.session.read()
  expect(await h.gateway.execute('course', 'invalid-column-move', call({ kind: 'move-column', columnId: table.columns[0].id, direction: 'right' }))).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(beforeInvalid)
  expect(course.load(course.serialize(h.model()))).toEqual(h.model())
})

it('creates and configures a current managed input, preserves hand-edited feedback on explicit unmanage, and retains real numeric submission, save and Undo', async () => {
  const h = await courseHarness(), page = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const created = await h.call('create-input', 'object.insert', { target: page, kind: 'input', x: 30, y: 50 })
  expect(created).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (created.kind !== 'document-operation') throw new Error('Expected input creation')
  const target = created.affected[0], resolved = await h.gateway.resolveEditTarget('course', target)
  if (resolved.target.kind !== 'course-instance') throw new Error('Expected current input')
  const instanceId = resolved.target.instanceId, label = await h.gateway.issueTarget('course', h.session.documentId, h.address)
  const correct = [{ type: 'node.enter', nodeId: label, effect: 'none', durationMs: 0, easing: 'linear' }]
  const error = [{ type: 'node.exit', nodeId: label, effect: 'none', durationMs: 0, easing: 'linear' }]
  const config = (value: unknown) => ({ target, change: { kind: 'input-rules', request: { mode: 'apply', config: value } } })
  const invalidBefore = h.session.read()
  expect(await h.call('invalid-answer', 'object.author', config({ answerType: 'number', min: 12, max: 10, correct, error }))).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(invalidBefore)
  expect(await h.call('text-answer', 'object.author', config({ answerType: 'text', answers: ['42'], correct, error }))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(inspectComponentInputRules(h.model().project, h.surfaceId, instanceId)).toMatchObject({ managed: true, conflict: false, config: { answerType: 'text', answers: ['42'] } })
  const beforeNumber = h.session.read()
  expect(await h.call('number-answer', 'object.author', config({ answerType: 'number', min: 10, max: 12, correct, error }))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const inspection = inspectComponentInputRules(h.model().project, h.surfaceId, instanceId)
  expect(inspection).toMatchObject({ managed: true, conflict: false, config: { answerType: 'number', min: 10, max: 12,
    correct: [{ type: 'node.enter', nodeId: 'label' }], error: [{ type: 'node.exit', nodeId: 'label' }] } })
  expect(h.session.read().undoDepth).toBe(beforeNumber.undoDepth + 1)
  const numeric = h.model(), data = inputDataSchema.parse(numeric.project.instances[instanceId].data)
  const exerciseNumericSubmission = async (current: ReturnType<typeof h.model>, invalidFeedback: boolean) => {
    const behavior = interactionBehavior(current.project, { kind: 'surface', surfaceId: h.surfaceId })!
    const states = new Map<string, unknown>(), motions: string[] = [], listeners = new Map<string, () => void>()
    const runtime = createComponentInteractionRuntime(() => ({ currentSurfaceId: () => h.surfaceId, currentStateId: () => null,
      courseState: { get: key => states.get(key), set: (key, value) => { states.set(key, value) } },
      subscribeTrigger(trigger, listener) { listeners.set(JSON.stringify(trigger), listener); return () => { listeners.delete(JSON.stringify(trigger)) } },
      executeAction(action) { motions.push(action.type); return true }, report(message) { throw new Error(message) } }))
    const scope = { signal: new AbortController().signal, isActive: () => true, cleanup() {}, state: { get: (key: string) => states.get(key), set: (key: string, value: unknown) => { states.set(key, value) } },
      events: { emit(type: string) { listeners.get(JSON.stringify({ type, nodeId: instanceId }))?.() }, subscribe() { return () => {} } } }
    const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main')!
    const rulesMounted = await runtime.mount({ instance: behavior, scope } as unknown as ComponentRuntimeContext)
    const inputMounted = await inputRuntimeImplementation.mount({ instance: current.project.instances[instanceId], scope, root } as unknown as ComponentRuntimeContext)
    const submit = async (value: string) => {
      root.querySelector('input')!.value = value
      root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    try {
      await submit('１１'); expect(states.get(data.answer!.stateKey)).toBe(11); expect(states.get(data.answer!.validityKey)).toBe(true)
      expect(motions).toContain('node.enter'); motions.length = 0
      await submit('invalid'); expect(states.get(data.answer!.validityKey)).toBe(false); if (invalidFeedback) expect(motions).toContain('node.exit'); else expect(motions).toHaveLength(0)
    } finally { await inputMounted.dispose(); await rulesMounted.dispose(); dom.window.close() }
  }
  await exerciseNumericSubmission(numeric, true)
  const ruleId = data.answer!.ruleFamilyRuleIds[0]
  expect(await h.call('remove-member', 'interaction.update', { target: page, change: { kind: 'remove', ruleId } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(inspectComponentInputRules(h.model().project, h.surfaceId, instanceId)).toMatchObject({ conflict: true })
  const handEdited = h.session.read()
  expect(await h.call('refuse-rebuild', 'object.author', config({ answerType: 'number', min: 10, max: 12, correct, error }))).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(handEdited)
  const unmanage = { name: 'object.author', input: { target, change: { kind: 'input-rules', request: { mode: 'unmanage' } } } }
  expect(await h.call('unmanage-rollback', 'batch', { operations: [unmanage, { name: 'object.author', input: { target, change: { kind: 'table', edit: { kind: 'cell-text', cellId: 'missing-cell', text: 'BAD' } } } }] })).toMatchObject({ kind: 'error' })
  expect(h.session.read()).toEqual(handEdited)
  const handRules = interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))
  const logic = structuredClone(h.model().project.logic)
  expect(await h.gateway.execute('course', 'explicit-unmanage', unmanage)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(inputDataSchema.parse(h.model().project.instances[instanceId].data).answer).toEqual({ ...data.answer!, ruleFamilyRuleIds: [] })
  expect(interactionRules(interactionBehavior(h.model().project, { kind: 'surface', surfaceId: h.surfaceId }))).toEqual(handRules)
  expect(h.model().project.logic).toEqual(logic); expect(h.session.read().undoDepth).toBe(handEdited.undoDepth + 1)
  await exerciseNumericSubmission(h.model(), false)
  expect(course.load(course.serialize(h.model()))).toEqual(h.model())
  const current = h.session.read()
  expect(await h.session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'undo-unmanage', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(handEdited.model.kind === 'course-v10' && handEdited.model.project.instances)
})

it('inserts professional instances on explicit Slide, Flow paper and Spatial owners, preserving identities and resources in one undoable batch while tracking parent order', async () => {
  const h = await courseHarness(project => {
    project.surfaces.push({ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] },
      { id: 'world', kind: 'spatial', title: 'World', childIds: [], spatial: { home: { x: 150, y: -20, zoom: 2, rotation: 20 }, frames: [], paths: [] } })
  })
  const page = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId })
  const flow = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: 'flow' })
  const world = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: 'world' })
  await h.gateway.beginRun({ runId: 'limited', actor: 'agent', documents: [{ documentId: h.session.documentId, writable: [{ kind: 'course-surface', surfaceId: h.surfaceId }] }] })
  const wrongOwner = await h.gateway.issueTarget('limited', h.session.documentId, { kind: 'course-surface', surfaceId: 'world' })
  const before = h.session.read()
  expect(await h.gateway.execute('limited', 'wrong-owner', { name: 'object.insert', input: { target: wrongOwner, kind: 'text' } })).toMatchObject({ code: 'not-authorized' })
  expect(await h.call('forged-identity', 'object.insert', { target: page, kind: 'text', id: 'model-chosen' })).toMatchObject({ code: 'invalid-input' })
  expect(h.session.read()).toEqual(before)
  expect(await h.call('professional-batch', 'batch', { operations: [
    { name: 'object.insert', input: { target: page, kind: 'text', text: '明确位置', x: 10, y: 20, width: 420, height: 70 } },
    ...['formula', 'shape', 'chart', 'table'].map(kind => ({ name: 'object.insert', input: { target: world, kind, center: { x: -500, y: 300 } } })),
    { name: 'object.insert', input: { target: flow, kind: 'table', destination: 'paper', x: 45, y: 90 } },
  ] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = h.model(), roots = current.project.surfaces.flatMap(surface => surface.childIds).filter(id => id !== 'label')
  expect(roots).toHaveLength(6); expect(new Set(roots).size).toBe(roots.length)
  const slideText = current.project.instances[current.project.surfaces[0].childIds[1]]
  expect(slideText.frame).toEqual({ width: 420, height: 70, transform: [1, 0, 0, 1, 10, 20] })
  const paper = current.project.instances[current.project.surfaces.find(surface => surface.id === 'flow')!.childIds[0]]
  expect(paper.flowPlacement).toEqual({ space: 'paper', plane: 'overlay' })
  expect(paper.frame?.transform.slice(4)).toEqual([45, 90])
  expect(current.project.surfaces.find(surface => surface.id === 'world')!.spatial).toEqual(h.project.surfaces.find(surface => surface.id === 'world')!.spatial)
  expect(current.resources).toEqual(before.model.resources); expect(current.project.instances.label).toEqual(h.project.instances.label)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1); expect(course.load(course.serialize(current))).toEqual(current)
  const snapshot = h.session.read()
  expect(await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: 'undo-professionals', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(h.model().project.instances).toEqual(h.project.instances); expect(h.model().project.surfaces).toEqual(h.project.surfaces)
  const owner = await h.gateway.issueTarget('course', h.session.documentId, { kind: 'course-surface', surfaceId: h.surfaceId }), beforeStyle = h.session.read()
  expect(await h.session.execute({ documentId: beforeStyle.documentId, epoch: beforeStyle.epoch, baseRevision: beforeStyle.revision,
    operationId: 'human-style', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'style.set', instanceId: 'label', path: ['opacity'], value: .5 }]) } })).toMatchObject({ status: 'applied' })
  expect(await h.call('insert-after-style', 'object.insert', { target: owner, kind: 'text', text: 'Annotation' })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const reordered = h.session.read()
  expect(await h.session.execute({ documentId: reordered.documentId, epoch: reordered.epoch, baseRevision: reordered.revision,
    operationId: 'human-order', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(h.model().project,
      [{ type: 'instance.move', instanceId: 'label', container: { kind: 'surface', surfaceId: h.surfaceId }, index: 1 }]) } })).toMatchObject({ status: 'applied' })
  const human = h.session.read()
  expect(await h.call('stale-order', 'object.insert', { target: owner, kind: 'text', text: 'BAD' })).toMatchObject({ code: 'target-conflict' })
  expect(h.session.read()).toEqual(human)
})
