import { inspectInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { CourseStateStore } from '../../src/player/CourseStateStore'
import { PublishedInteractionController } from '../../src/player/interactions/PublishedInteractionController'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createImageNode, createChartNode, createTableNode } from '../../src/core/tools/nativeNodeFactories'
import { allocateCourseLayerOrder } from '../../src/core/tools/layerOrder'
import sharp from 'sharp'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'
import type { ToolResult, ToolRunGrant, ToolTarget } from '../../src/shared/workbench/tools'
import { flowSurfaceIn, resolveFlowBlock, syncFlowCourseLocations } from '../../src/core/tools/flowDocumentModel'
import { flowTextSlot } from '../../src/core/tools/flowTextSlot'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'

const md = new MarkdownDriver(), course = new CourseV9Driver()
function harness() {
  let sequence = 0
  const states: DurableDocumentState[] = []
  let beforeAppend: (() => Promise<void>) | undefined
  const persistence: DocumentPersistence = {
    async append(state) { await beforeAppend?.(); states.push(structuredClone(state)) },
    async save() { throw new Error('not needed') },
  }
  const registry = new DocumentRegistry({ persistence, drivers: [md, course], createId: () => `id-${++sequence}`, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [md, course], () => String(++sequence), { prepareImage: prepareImageResource })
  return { registry, gateway, states, persistence, delayAppend(work?: () => Promise<void>) { beforeAppend = work } }
}
const markdown = (text: string) => md.load(new TextEncoder().encode(text))
function status(result: ToolResult) { return result.kind === 'document-operation' ? result.result.status : result.kind }
const replace = (target: string, content: string) => ({ name: 'text.replace', input: { target, content } })
function multiSurfaceModel() {
  const model = course.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const mixed = course.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson'))) as typeof model
  model.project.surfaces.push(...mixed.project.surfaces.filter(surface => surface.type !== 'slide'))
  model.project.locations.push(...mixed.project.locations.filter(location => location.kind !== 'slide-scene'))
  model.project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: [
    ...model.project.surfaces.filter(surface => surface.type === 'slide').map(surface => ({ id: `print-${surface.id}`, kind: 'slide-scenes' as const, surfaceId: surface.id, sceneIds: surface.scenes.map(scene => scene.id) })),
    ...mixed.project.mixedPrintPlan!.entries.filter(entry => entry.kind !== 'slide-scenes'),
  ] }
  return model
}

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
    expect(await gateway.execute('r', 'stale', replace(handle, 'BAD'))).toMatchObject({ kind: 'error', code: 'target-conflict' })
  })

  it('uses strict V9 planners for atomic properties/background batches and one undo', async () => {
    const { registry, gateway } = harness()
    const model = course.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
    const surface = model.project.surfaces.find(value => value.type === 'slide')!
    if (surface.type !== 'slide') throw new Error('fixture')
    const scene = surface.scenes[0], item = scene.layerItems.find(value => !value.locked)!
    const location = model.project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === scene.id)!
    const session = await registry.create(model, 'v9.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const readonlyRoot = await gateway.issueTarget('r', session.documentId, { kind: 'document' }, { readOnly: true })
    const inspect = await gateway.execute('r', 'readonly-inspect', { name: 'inspect', input: { target: readonlyRoot } })
    if (inspect.kind !== 'read') throw new Error('inspect')
    const inspectedRoot = (inspect.data as { target: string }).target
    const pages = await gateway.execute('r', 'readonly-pages', { name: 'listChildren', input: { target: inspectedRoot } })
    if (pages.kind !== 'read') throw new Error('pages')
    const page = (pages.data as { target: string }[])[0].target
    const children = await gateway.execute('r', 'readonly-children', { name: 'listChildren', input: { target: page } })
    if (children.kind !== 'read') throw new Error('children')
    const child = (children.data as { target: string; kind: string }[]).find(child => child.kind === 'course-object')!
    expect(await gateway.execute('r', 'readonly-child-update', { name: 'object.update', input: { target: child.target, properties: { opacity: 0.4 } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    const object = await gateway.issueTarget('r', session.documentId, { kind: 'course-object', locationId: location.id, itemId: item.layerItemId })
    const background = await gateway.issueTarget('r', session.documentId, { kind: 'course-background', owner: 'scene', surfaceId: surface.id, sceneId: scene.id })
    const first = { name: 'object.update', input: { target: object, properties: { opacity: 0.4 } } }
    expect(status(await gateway.execute('r', 'bad', { name: 'batch', input: { operations: [first, { name: 'owner.background', input: { target: background, properties: { backgroundAssetId: 'missing-asset' } } }] } }))).toBe('error')
    expect(session.read().undoDepth).toBe(0)
    expect(session.read().model).toEqual(model)
    expect(status(await gateway.execute('r', 'good', { name: 'batch', input: { operations: [first, { name: 'owner.background', input: { target: background, properties: { backgroundColor: '#123456' } } }] } }))).toBe('applied')
    const snapshot = session.read()
    expect(snapshot.undoDepth).toBe(1)
    expect(snapshot.revision).toBe(model.project.revision + 1)
    if (snapshot.model.kind !== 'course-v9' || snapshot.model.project.surfaces[0].type !== 'slide') throw new Error('fixture')
    expect(snapshot.model.project.surfaces[0].scenes[0].backgroundColor).toBe('#123456')
    expect(snapshot.model.project.surfaces[0].scenes[0].layerItems.find(value => value.layerItemId === item.layerItemId)?.opacity).toBe(0.4)
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'undo', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    const undone = session.read().model
    expect(undone.kind === 'course-v9' && undone.project.surfaces).toEqual(model.project.surfaces)
    expect(course.load(course.serialize(session.read().model)).resources).toEqual(model.resources)
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
    expect(() => nextGateway.recoverRun(recoveryGrant)).toThrow('已存在')
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

  it('S04-T05 directly commits Native text, style, position and backgrounds in one resource-preserving history entry', async () => {
    const { registry, gateway } = harness()
    const model = multiSurfaceModel()
    const layer = locateCourseLayer(model.project, 'spatial-label')!.item
    if (layer.kind !== 'native' || layer.content.nativeType !== 'text') throw new Error('fixture')
    layer.content.data.text = '甲乙丙'
    layer.content.data.runs = [{ start: 0, end: 1, style: { bold: true } }, { start: 2, end: 3, style: { underline: true } }]
    const session = await registry.create(model, 'mixed.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const issue = (target: ToolTarget) => gateway.issueTarget('r', session.documentId, target)
    const flowBg = await issue({ kind: 'course-background', owner: 'surface', surfaceId: 'surface-flow' })
    const spatialBg = await issue({ kind: 'course-background', owner: 'surface', surfaceId: 'surface-spatial' })
    const text = await issue({ kind: 'course-object', locationId: 'location-spatial', itemId: 'spatial-label' })
    const parent = await issue({ kind: 'flow-container', surfaceId: 'surface-flow', parentId: null, index: 1 })
    const result = await gateway.execute('r', 'batch-body', { name: 'batch', input: { operations: [
      { name: 'owner.background', input: { target: flowBg, properties: { backgroundColor: '#abcdef', backgroundMode: 'own' } } },
      { name: 'owner.background', input: { target: spatialBg, properties: { backgroundColor: '#123456', backgroundMode: 'own' } } },
      replace(text, '甲新丙'),
      { name: 'object.update', input: { target: text, properties: { frame: { x: 77, y: 88 }, nativeTextStyle: { color: '#345678' } } } },
      { name: 'document.insert', input: { target: parent, block: { type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: '新增标题' }] } } } },
    ] } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    expect(snapshot.undoDepth).toBe(1)
    if (snapshot.model.kind !== 'course-v9' || result.kind !== 'document-operation') throw new Error('result')
    const project = snapshot.model.project
    expect(project.startLocationId).toBe(model.project.startLocationId)
    expect(flowSurfaceIn(project, 'surface-flow').backgroundColor).toBe('#abcdef')
    expect(project.surfaces.find(surface => surface.id === 'surface-spatial')?.backgroundColor).toBe('#123456')
    const changed = locateCourseLayer(project, 'spatial-label')!.item
    if (changed.kind !== 'native' || changed.content.nativeType !== 'text') throw new Error('native')
    expect(changed.content.data).toEqual({ ...layer.content.data, text: '甲新丙', style: { ...layer.content.data.style, color: '#345678' } })
    expect(changed.frame).toEqual({ ...layer.frame, x: 77, y: 88 })
    const inserted = flowSurfaceIn(project, 'surface-flow').blocks[1]
    expect(inserted).toMatchObject({ type: 'heading', content: { inlines: [{ text: '新增标题' }] } })
    expect(project.locations.find(location => location.kind === 'flow-block' && location.blockId === inserted.id)?.label).toBe('新增标题')
    expect(await gateway.execute('r', 'read-new', { name: 'read', input: { target: result.affected[4] } })).toMatchObject({ kind: 'read' })
    expect(course.load(course.serialize(snapshot.model)).resources).toEqual(model.resources)
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'undo-body', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    const undone = session.read().model
    expect(undone.kind === 'course-v9' && undone.project.surfaces).toEqual(model.project.surfaces)
    expect(undone.resources).toEqual(model.resources)
  })

  it('limits Flow rich replacement to the authorized logical range and preserves other blocks, math, styles and resources', async () => {
    const { registry, gateway } = harness()
    const model = multiSurfaceModel(), surface = flowSurfaceIn(model.project, 'surface-flow')
    const block = surface.blocks.find(block => block.id === 'flow-paragraph')!
    if (block.type !== 'paragraph') throw new Error('fixture')
    block.content = { inlines: [{ type: 'text', text: '甲', style: { bold: true } },
      { type: 'math', formulaId: 'gateway-formula', latex: 'x^2', accessibleText: 'x平方' }, { type: 'text', text: '乙😀丙', link: { href: 'https://example.com' } }] }
    const range: Extract<ToolTarget, { kind: 'flow-range' }> = { kind: 'flow-range', surfaceId: surface.id, parentId: null, blockId: block.id, slot: { kind: 'field', field: 'content' }, from: 2, to: 4 }
    const session = await registry.create(model, 'mixed.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [range] }] })
    const target = await gateway.issueTarget('r', session.documentId, range)
    const whole = await gateway.issueTarget('r', session.documentId, { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: block.id })
    expect(await gateway.execute('r', 'widen', { name: 'flow.content', input: { target: whole, content: { inlines: [] } } })).toMatchObject({ code: 'not-authorized' })
    const snapshot = session.read(), human = structuredClone(model.project)
    flowSurfaceIn(human, surface.id).blocks.push({ id: 'human-paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: '人工新段落' }] } })
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-flow', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'command', command: { type: 'course.replace', project: human } } })
    const result = await gateway.execute('r', 'precise', { name: 'flow.content', input: { target, content: { inlines: [{ type: 'text', text: '新', style: { italic: true } }] } } })
    expect(status(result)).toBe('applied')
    const after = session.read()
    if (after.model.kind !== 'course-v9') throw new Error('result')
    const selected = resolveFlowBlock(after.model.project, range).block
    expect(flowTextSlot(selected, range.slot).get().inlines).toEqual([block.content.inlines[0], block.content.inlines[1], { type: 'text', text: '新', style: { italic: true } }, { type: 'text', text: '丙', link: { href: 'https://example.com' } }])
    expect(flowSurfaceIn(after.model.project, surface.id).blocks.at(-1)?.id).toBe('human-paragraph')
    expect(after.undoDepth).toBe(2)
    expect(course.load(course.serialize(after.model)).resources).toEqual(model.resources)
    expect(await gateway.execute('r', 'stale-inspect', { name: 'inspect', input: { target } })).toMatchObject({ code: 'target-conflict' })
    const staleCoordinates = await gateway.issueTarget('r', session.documentId, range)
    expect(await gateway.execute('r', 'stale-grant', { name: 'flow.content', input: { target: staleCoordinates, content: { inlines: [] } } })).toMatchObject({ code: 'not-authorized' })
    await session.execute({ documentId: after.documentId, epoch: after.epoch, operationId: 'undo-flow', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
    const undone = session.read().model
    expect(undone.kind === 'course-v9' && flowSurfaceIn(undone.project, surface.id).blocks).toEqual(flowSurfaceIn(human, surface.id).blocks)
  })

  it('rejects invalid/legacy Flow content and missing-resource insertions without partially applying a batch', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const session = await registry.create(model, 'mixed.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const body = await gateway.issueTarget('r', session.documentId, { kind: 'flow-container', surfaceId: 'surface-flow', parentId: null })
    const block = await gateway.issueTarget('r', session.documentId, { kind: 'flow-block', surfaceId: 'surface-flow', parentId: null, blockId: 'flow-paragraph' })
    const text = await gateway.issueTarget('r', session.documentId, { kind: 'course-object', locationId: 'location-spatial', itemId: 'spatial-label' })
    expect(await gateway.execute('r', 'legacy', { name: 'flow.content', input: { target: block, content: { text: 'old', runs: [] } } })).toMatchObject({ code: 'invalid-input' })
    expect(await gateway.execute('r', 'id', { name: 'document.insert', input: { target: body, block: { id: 'model-chosen', type: 'divider' } } })).toMatchObject({ code: 'invalid-input' })
    const result = await gateway.execute('r', 'bad-media', { name: 'batch', input: { operations: [replace(text, '修改不得提交'),
      { name: 'document.insert', input: { target: body, block: { type: 'media', assetId: 'missing', mediaKind: 'image', layout: 'content-width' } } },
    ] } })
    expect(status(result)).toBe('error')
    expect(session.read().model).toEqual(model)
    expect(session.read().undoDepth).toBe(0)
  })

  it('deletes Flow navigation with its references, preserves unrelated content and resources, and refuses the last heading', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const surface = flowSurfaceIn(model.project, 'surface-flow')
    surface.blocks.push({ id: 'remaining-heading', type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: '保留标题' }] } })
    syncFlowCourseLocations(model.project, surface.id)
    model.project.globalInteractions.push({ id: 'removed-location-rule', enabled: true, trigger: { type: 'presenter.command', command: 'next' }, conditions: [],
      actions: [{ id: 'removed-location-action', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: 'location-flow' } }] })
    const session = await registry.create(model, 'mixed.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const deleted = await gateway.issueTarget('r', session.documentId, { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'flow-heading' })
    const text = await gateway.issueTarget('r', session.documentId, { kind: 'course-object', locationId: 'location-spatial', itemId: 'spatial-label' })
    const result = await gateway.execute('r', 'delete', { name: 'batch', input: { operations: [replace(text, '空间新文字'), { name: 'flow.delete', input: { target: deleted } }] } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    expect(snapshot.model.project.locations.some(location => location.id === 'location-flow')).toBe(false)
    expect(snapshot.model.project.globalInteractions.some(rule => rule.id === 'removed-location-rule')).toBe(false)
    expect(snapshot.model.project.startLocationId).toBe(model.project.startLocationId)
    expect(snapshot.undoDepth).toBe(1)
    const last = await gateway.issueTarget('r', session.documentId, { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'remaining-heading' })
    expect(await gateway.execute('r', 'last', { name: 'flow.delete', input: { target: last } })).toMatchObject({ kind: 'error' })
    expect(session.read().revision).toBe(snapshot.revision)
    expect(course.load(course.serialize(snapshot.model)).resources).toEqual(model.resources)
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: 'undo-delete', actor: 'human', mutation: { type: 'undo' } })
    const undone = session.read().model
    expect(undone.kind === 'course-v9' && undone.project.surfaces).toEqual(model.project.surfaces)
    expect(undone.kind === 'course-v9' && undone.project.globalInteractions).toEqual(model.project.globalInteractions)
    expect(undone.resources).toEqual(model.resources)
  })

  it('requires destination authorization for Flow moves, preserves stable identity, and rejects section cycles atomically', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const surface = flowSurfaceIn(model.project, 'surface-flow')
    surface.blocks.push({ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: '分节' }] }, collapsedByDefault: false, blocks: [] })
    syncFlowCourseLocations(model.project, surface.id)
    const session = await registry.create(model, 'mixed.h5lesson')
    const source: ToolTarget = { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'flow-paragraph' }
    const destination: ToolTarget = { kind: 'flow-container', surfaceId: surface.id, parentId: 'section', index: 0 }
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [source, destination] }] })
    const target = await gateway.issueTarget('r', session.documentId, source)
    const allowed = await gateway.issueTarget('r', session.documentId, destination)
    const denied = await gateway.issueTarget('r', session.documentId, { kind: 'flow-container', surfaceId: surface.id, parentId: null, index: 0 })
    expect(await gateway.execute('r', 'denied-move', { name: 'flow.move', input: { target, destination: denied } })).toMatchObject({ code: 'not-authorized' })
    const result = await gateway.execute('r', 'move', { name: 'flow.move', input: { target, destination: allowed } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    expect(resolveFlowBlock(snapshot.model.project, { surfaceId: surface.id, parentId: 'section', blockId: 'flow-paragraph' }).block).toEqual(surface.blocks.find(block => block.id === 'flow-paragraph'))
    expect(snapshot.undoDepth).toBe(1)
    await gateway.beginRun({ runId: 'cycle', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const section = await gateway.issueTarget('cycle', session.documentId, { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'section' })
    const self = await gateway.issueTarget('cycle', session.documentId, { kind: 'flow-container', surfaceId: surface.id, parentId: 'section' })
    expect(await gateway.execute('cycle', 'cycle', { name: 'flow.move', input: { target: section, destination: self } })).toMatchObject({ kind: 'error', message: '不能将分节移动到自身内部' })
    expect(session.read().model).toEqual(snapshot.model)
    expect(course.load(course.serialize(snapshot.model)).resources).toEqual(model.resources)
  })

  it('applies strict Flow table merge/row insertion in one history entry and rolls back an invalid merged-column move', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const surface = flowSurfaceIn(model.project, 'surface-flow'), text = (text: string) => ({ inlines: [{ type: 'text' as const, text }] })
    surface.blocks.push({ id: 'table', type: 'table', columns: [{ id: 'a', header: text('A') }, { id: 'b', header: text('B') }], rows: [{ id: 'r', cells: { a: text('甲'), b: text('乙') } }] })
    const session = await registry.create(model, 'mixed.h5lesson')
    await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const target = await gateway.issueTarget('r', session.documentId, { kind: 'flow-block', surfaceId: surface.id, parentId: null, blockId: 'table' })
    const result = await gateway.execute('r', 'table-batch', { name: 'batch', input: { operations: [
      { name: 'flow.table', input: { target, change: { kind: 'merge', region: { rowIds: ['r'], columnIds: ['a', 'b'] } } } },
      { name: 'flow.table', input: { target, change: { kind: 'insert-row', afterId: 'r' } } },
    ] } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9' || result.kind !== 'document-operation') throw new Error('course')
    const changed = resolveFlowBlock(snapshot.model.project, { surfaceId: surface.id, parentId: null, blockId: 'table' }).block
    if (changed.type !== 'table') throw new Error('table')
    expect(changed.rows).toHaveLength(2)
    expect(changed.rows[1].id).not.toBe('r')
    expect(changed.rows[0].cells.a).toEqual(text('甲\n乙'))
    expect(changed.rows[0].cells.b).toEqual({ inlines: [] })
    expect(snapshot.undoDepth).toBe(1)
    expect(await gateway.execute('r', 'invalid-table', { name: 'flow.table', input: { target: result.affected[1], change: { kind: 'move-column', id: 'a', direction: 1 } } })).toMatchObject({ kind: 'error' })
    expect(session.read().model).toEqual(snapshot.model)
    expect(course.load(course.serialize(snapshot.model)).resources).toEqual(model.resources)
  })


  it('creates Native objects with host identities on an explicit unmounted owner and preserves state/History/resources', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const surface = model.project.surfaces.find(value => value.id === location.surfaceId)!
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('fixture')
    const scene = surface.scenes.find(value => value.id === location.sceneId)!
    const beforeIds = scene.layerItems.map(item => item.layerItemId)
    const session = await registry.create(model, 'mixed.h5lesson')
    const parent: ToolTarget = { kind: 'course-owner', locationId: location.id, owner: 'scene' }
    await gateway.beginRun({ runId: 'native', actor: 'agent', documents: [{ documentId: session.documentId, writable: [parent] }] })
    const target = await gateway.issueTarget('native', session.documentId, parent)
    const global = await gateway.issueTarget('native', session.documentId, { ...parent, owner: 'global' })
    expect(await gateway.execute('native', 'wrong-owner', { name: 'native.insert', input: { target: global, template: { nativeType: 'text', text: 'denied' } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(await gateway.execute('native', 'forged-id', { name: 'native.insert', input: { target, template: { nativeType: 'text', id: 'chosen-by-model' } } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
    const result = await gateway.execute('native', 'create-batch', { name: 'batch', input: { operations: [
      { name: 'native.insert', input: { target, template: { nativeType: 'text', text: '明确位置', width: 420, height: 70, x: 10, y: 20, style: { fontSize: 27, color: '#123456' } } } },
      { name: 'native.insert', input: { target, template: { nativeType: 'formula', accessibleText: '公式' } } },
      { name: 'native.insert', input: { target, template: { nativeType: 'shape', shapeType: 'rectangle', style: { fillColor: '#abcdef' } } } },
    ] } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    const changed = snapshot.model.project.surfaces.find(value => value.id === surface.id)!
    if (changed.type !== 'slide') throw new Error('slide')
    const items = changed.scenes.find(value => value.id === scene.id)!.layerItems.filter(item => !beforeIds.includes(item.layerItemId))
    expect(items).toHaveLength(3)
    expect(new Set(items.map(item => item.layerItemId)).size).toBe(3)
    expect(items[0]).toMatchObject({ frame: { x: 10, y: 20, width: 420, height: 70 }, content: { nativeType: 'text', data: { text: '明确位置', style: { fontSize: 27, color: '#123456' } } } })
    expect(snapshot.undoDepth).toBe(1)
    expect(snapshot.model.project.surfaces.filter(value => value.id !== surface.id)).toEqual(model.project.surfaces.filter(value => value.id !== surface.id))
    expect(snapshot.model.resources).toEqual(model.resources)
    const undo = await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-native', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect(undo.status).toBe('applied')
    expect(session.read().model.resources).toEqual(model.resources)
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
  })

  it('atomically imports admitted image bytes and creates a Native image with durable undo/redo and replay', async () => {
    const { registry, gateway, states } = harness(), model = multiSurfaceModel()
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const session = await registry.create(model, 'media.h5lesson')
    await gateway.beginRun({ runId: 'image', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const target = await gateway.issueTarget('image', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    const bytes = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 4, background: '#11aa88' } }).png().toBuffer())
    const resource = await gateway.provideImage('image', session.documentId, { bytes, filename: 'photo.png', mimeType: 'image/png' })
    const frozenBytes = bytes.slice(); bytes.fill(0)
    const call = { name: 'media.insert', input: { target, resource, properties: { width: 300, height: 200, fit: 'cover', label: '图片' } } }
    const result = await gateway.execute('image', 'media-create', call)
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9' || result.kind !== 'document-operation') throw new Error('course')
    const id = Object.keys(snapshot.model.project.assets).find(id => !model.project.assets[id])!
    expect(snapshot.model.project.assets[id]).toMatchObject({ width: 3, height: 2, mimeType: 'image/png' })
    expect(snapshot.model.resources.assets[id]).toEqual(frozenBytes)
    expect(snapshot.undoDepth).toBe(1)
    expect(states.at(-1)!.model.resources.assets[id]).toEqual(frozenBytes)
    expect(await gateway.execute('image', 'media-create', call)).toMatchObject({ kind: 'document-operation', result: result.result })
    expect(session.read().undoDepth).toBe(1)
    const reopened = course.load(course.serialize(snapshot.model))
    expect(reopened.resources).toEqual(snapshot.model.resources)
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-image', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect(session.read().model.resources).toEqual(model.resources)
    expect((session.read().model as typeof model).project.assets).toEqual(model.project.assets)
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'redo-image', actor: 'human', baseRevision: session.read().revision, mutation: { type: 'redo' } })
    expect(session.read().model.resources).toEqual(snapshot.model.resources)
  })

  it('refuses invalid image bytes, cross-document resources and stopped runs; failed media batch writes neither metadata nor bytes', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const a = await registry.create(model, 'a.h5lesson'), b = await registry.create(model, 'b.h5lesson')
    await gateway.beginRun({ runId: 'resources', actor: 'agent', documents: [a,b].map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' as const }] })) })
    const bytes = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer())
    await expect(gateway.provideImage('resources', a.documentId, { bytes, filename: 'wrong.jpg', mimeType: 'image/jpeg' })).rejects.toThrow('不匹配')
    const damaged = bytes.slice(); damaged[Buffer.from(damaged).indexOf('IDAT') + 4] ^= 0xff
    expect((await sharp(damaged).metadata()).width).toBe(2)
    await expect(gateway.provideImage('resources', a.documentId, { bytes: damaged, filename: 'broken.png', mimeType: 'image/png' })).rejects.toThrow()
    const noDecoder = new DocumentToolGateway(registry, [md, course], () => 'no-decoder')
    await noDecoder.beginRun({ runId: 'no-decoder', actor: 'agent', documents: [{ documentId: a.documentId, writable: [{ kind: 'document' }] }] })
    await expect(noDecoder.provideImage('no-decoder', a.documentId, { bytes, filename: 'real.png', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'unsupported-resource-preparation' })
    const resource = await gateway.provideImage('resources', a.documentId, { bytes, filename: 'real.png', mimeType: 'image/png' })
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const owner: ToolTarget = { kind: 'course-owner', locationId: location.id, owner: 'scene' }
    const ta = await gateway.issueTarget('resources', a.documentId, owner), tb = await gateway.issueTarget('resources', b.documentId, owner)
    const insert = (target: string) => ({ name: 'media.insert', input: { target, resource, properties: {} } })
    expect(await gateway.execute('resources', 'cross-doc', insert(tb))).toMatchObject({ kind: 'error', code: 'invalid-resource' })
    expect(await gateway.execute('resources', 'bad-batch', { name: 'batch', input: { operations: [insert(ta), { name: 'native.insert', input: { target: ta, template: { nativeType: 'image', assetId: 'missing' } } }] } })).toMatchObject({ kind: 'error' })
    expect(a.read().undoDepth).toBe(0)
    expect(a.read().model).toEqual(model)
    expect(b.read().model).toEqual(model)
    await gateway.stop('resources')
    expect(await gateway.execute('resources', 'late', insert(ta))).toMatchObject({ kind: 'error', code: 'run-stopped' })
    await expect(gateway.provideImage('resources', a.documentId, { bytes, filename: 'late.png', mimeType: 'image/png' })).rejects.toThrow('停止')
    expect(a.read().undoDepth).toBe(0)
  })

  it('resolves host-only Flow source maps and applies common text chunks through the strict range planner', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const surface = flowSurfaceIn(model.project, 'surface-flow'), block = surface.blocks.find(value => value.id === 'flow-paragraph')!
    if (block.type !== 'paragraph') throw new Error('paragraph')
    block.content = { inlines: [{ type: 'text', text: '前', style: { bold: true } }, { type: 'text', text: '中间' }, { type: 'math', formulaId: 'kept-math', latex: 'x', accessibleText: 'x' }] }
    const range: ToolTarget = { kind: 'flow-range', surfaceId: surface.id, parentId: null, blockId: block.id, slot: { kind: 'field', field: 'content' }, from: 1, to: 3 }
    const session = await registry.create(model, 'source-map.h5lesson')
    await gateway.beginRun({ runId: 'source', actor: 'agent', documents: [{ documentId: session.documentId, writable: [range] }] })
    const target = await gateway.issueTarget('source', session.documentId, range)
    const whole = await gateway.issueTarget('source', session.documentId, { kind: 'flow-block', surfaceId: surface.id, blockId: block.id, parentId: null })
    await expect(gateway.resolveEditTarget('source', whole)).rejects.toMatchObject({ code: 'not-authorized' })
    const resolved = await gateway.resolveEditTarget('source', target)
    expect(resolved).toMatchObject({ documentId: session.documentId, epoch: session.read().epoch, revision: session.read().revision, target: range })
    if (resolved.model.kind !== 'course-v9') throw new Error('course')
    resolved.model.project.title = 'isolated host copy'
    expect((session.read().model as typeof model).project.title).toBe(model.project.title)
    expect(await gateway.execute('source', 'text-chunk', replace(target, '正文流'))).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const changed = resolveFlowBlock((session.read().model as typeof model).project, range).block
    expect(flowTextSlot(changed, range.slot).get().inlines).toEqual([block.content.inlines[0], { type: 'text', text: '正文流' }, block.content.inlines[2]])
    await expect(gateway.resolveEditTarget('source', target)).rejects.toMatchObject({ code: 'target-conflict' })
    await gateway.stop('source')
    await expect(gateway.resolveEditTarget('source', target)).rejects.toMatchObject({ code: 'run-stopped' })
    expect(session.read().undoDepth).toBe(1)
  })

  it('applies one admitted image across Slide/Spatial Native images, Flow media and three backgrounds in one undo', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const existingAsset = Object.values(model.project.assets).find(asset => asset.kind === 'image')!
    const slideLocation = model.project.locations.find(location => location.kind === 'slide-scene')!
    const slide = model.project.surfaces.find(surface => surface.id === slideLocation.surfaceId)!
    const spatial = model.project.surfaces.find(surface => surface.type === 'spatial-2d')!
    if (slide.type !== 'slide' || slideLocation.kind !== 'slide-scene' || spatial.type !== 'spatial-2d') throw new Error('fixture')
    const scene = slide.scenes.find(scene => scene.id === slideLocation.sceneId)!
    const spatialLocation = model.project.locations.find(location => location.surfaceId === spatial.id)!
    const slideImage = sceneNodeToCourseLayerItem(createImageNode({ id: 'slide-picture', assetId: existingAsset.id, fit: 'cover', x: 52, y: 65, width: 340, height: 220 }))
    slideImage.order = allocateCourseLayerOrder(model.project, Math.max(...scene.layerItems.map(item => item.order)) + 1); scene.layerItems.push(slideImage)
    const worldImage = sceneNodeToCourseLayerItem(createImageNode({ id: 'world-picture', assetId: existingAsset.id, x: -200, y: 150, width: 420, height: 270 }))
    worldImage.order = allocateCourseLayerOrder(model.project, Math.max(...spatial.world.layerItems.map(item => item.order)) + 1); spatial.world.layerItems.push(worldImage)
    const flow = flowSurfaceIn(model.project, 'surface-flow')
    flow.blocks.push({ id: 'body-picture', type: 'media', mediaKind: 'image', assetId: existingAsset.id, layout: 'content-width', caption: { inlines: [{ type: 'text', text: '保留图片说明', style: { italic: true } }] } })
    const session = await registry.create(model, 'pictures.h5lesson')
    await gateway.beginRun({ runId: 'pictures', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const targets: ToolTarget[] = [
      { kind: 'course-object', locationId: slideLocation.id, itemId: slideImage.layerItemId },
      { kind: 'course-object', locationId: spatialLocation.id, itemId: worldImage.layerItemId },
      { kind: 'flow-block', surfaceId: flow.id, parentId: null, blockId: 'body-picture' },
      { kind: 'course-background', owner: 'scene', surfaceId: slide.id, sceneId: scene.id },
      { kind: 'course-background', owner: 'surface', surfaceId: flow.id },
      { kind: 'course-background', owner: 'surface', surfaceId: spatial.id },
    ]
    const handles = await Promise.all(targets.map(target => gateway.issueTarget('pictures', session.documentId, target)))
    const bytes = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 4, background: 'blue' } }).png().toBuffer())
    const resource = await gateway.provideImage('pictures', session.documentId, { bytes, filename: 'blue.png', mimeType: 'image/png' })
    const result = await gateway.execute('pictures', 'all-pictures', { name: 'batch', input: { operations: handles.map(target => ({ name: 'media.apply', input: { target, resource } })) } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', operationId: gateway.operationIdentity('pictures', 'all-pictures') } })
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    const assetId = Object.keys(snapshot.model.project.assets).find(id => !model.project.assets[id])!
    expect(Object.keys(snapshot.model.project.assets)).toHaveLength(Object.keys(model.project.assets).length + 1)
    for (const before of [slideImage, worldImage]) {
      const after = locateCourseLayer(snapshot.model.project, before.layerItemId)!.item
      if (before.kind !== 'native' || after.kind !== 'native') throw new Error('native')
      expect(after).toEqual({ ...before, content: { ...before.content, data: { ...before.content.data, assetId } } })
    }
    expect(resolveFlowBlock(snapshot.model.project, targets[2] as Extract<ToolTarget, { kind: 'flow-block' }>).block).toEqual({ ...flow.blocks.at(-1), assetId })
    const nextSlide = snapshot.model.project.surfaces.find(value => value.id === slide.id)!
    if (nextSlide.type !== 'slide') throw new Error('slide')
    expect(nextSlide.scenes.find(value => value.id === scene.id)).toMatchObject({ backgroundAssetId: assetId, backgroundMode: 'own' })
    expect(flowSurfaceIn(snapshot.model.project, flow.id)).toMatchObject({ backgroundAssetId: assetId })
    expect(flowSurfaceIn(snapshot.model.project, flow.id).backgroundMode ?? 'own').toBe('own')
    expect(snapshot.model.project.surfaces.find(value => value.id === spatial.id)).toMatchObject({ backgroundAssetId: assetId })
    expect(snapshot.model.project.surfaces.find(value => value.id === spatial.id)!.backgroundMode ?? 'own').toBe('own')
    expect(snapshot.undoDepth).toBe(1)
    for (const [id, original] of Object.entries(model.resources.assets)) expect(snapshot.model.resources.assets[id]).toEqual(original)
    expect(course.load(course.serialize(snapshot.model)).resources).toEqual(snapshot.model.resources)
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-pictures', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect(session.read().model.resources).toEqual(model.resources)
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
  })

  it('rejects unsupported media targets and Native fit on Flow/background without partial resource writes', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const session = await registry.create(model, 'media-rules.h5lesson')
    await gateway.beginRun({ runId: 'media-rules', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const bytes = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: 'green' } }).png().toBuffer())
    const resource = await gateway.provideImage('media-rules', session.documentId, { bytes, filename: 'green.png', mimeType: 'image/png' })
    const background = await gateway.issueTarget('media-rules', session.documentId, { kind: 'course-background', owner: 'surface', surfaceId: 'surface-flow' })
    const paragraph = await gateway.issueTarget('media-rules', session.documentId, { kind: 'flow-block', surfaceId: 'surface-flow', parentId: null, blockId: 'flow-paragraph' })
    const text = await gateway.issueTarget('media-rules', session.documentId, { kind: 'course-object', locationId: 'location-spatial', itemId: 'spatial-label' })
    for (const [id, target] of [['paragraph', paragraph], ['text', text]]) {
      expect(await gateway.execute('media-rules', id, { name: 'media.apply', input: { target, resource } })).toMatchObject({ kind: 'error' })
    }
    expect(await gateway.execute('media-rules', 'bad-fit-batch', { name: 'batch', input: { operations: [
      { name: 'media.apply', input: { target: background, resource } },
      { name: 'media.apply', input: { target: background, resource, fit: 'cover' } },
    ] } })).toMatchObject({ kind: 'error', message: expect.stringContaining('contain') })
    expect(await gateway.execute('media-rules', 'path', { name: 'media.apply', input: { target: background, resource, path: 'D:/secret.png' } })).toMatchObject({ code: 'invalid-input' })
    expect(session.read().model).toEqual(model)
    expect(session.read().undoDepth).toBe(0)
  })

  it('creates Flow surface/global Native overlays without replacing document flow and keeps paper-space semantics through save and undo', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const flow = flowSurfaceIn(model.project, 'surface-flow'), session = await registry.create(model, 'flow-native.h5lesson')
    await gateway.beginRun({ runId: 'flow-native', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const target = await gateway.issueTarget('flow-native', session.documentId, { kind: 'course-owner', locationId: 'location-flow', owner: 'surface' })
    const global = await gateway.issueTarget('flow-native', session.documentId, { kind: 'course-owner', locationId: 'location-flow', owner: 'global' })
    const result = await gateway.execute('flow-native', 'overlay-batch', { name: 'batch', input: { operations: [
      { name: 'native.insert', input: { target, template: { nativeType: 'text', text: '浮层说明', x: 45, y: 90, width: 390, height: 70, paperSpace: 'paper', style: { color: '#123456' } } } },
      { name: 'native.insert', input: { target, template: { nativeType: 'shape', shapeType: 'rectangle', x: 80, y: 210, width: 200, height: 60 } } },
      { name: 'native.insert', input: { target: global, template: { nativeType: 'image', assetId: 'badge', paperSpace: 'viewport', width: 60, height: 60, x: 8, y: 9 } } },
    ] } })
    expect(status(result)).toBe('applied')
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('course')
    const changed = flowSurfaceIn(snapshot.model.project, flow.id)
    expect(changed.blocks).toEqual(flow.blocks)
    const created = changed.surfaceLayerItems.filter(entry => !flow.surfaceLayerItems.some(before => before.item.layerItemId === entry.item.layerItemId))
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ bodyPlane: 'overlay', item: { paperSpace: 'paper', frame: { x: 45, y: 90, width: 390, height: 70 }, content: { nativeType: 'text', data: { text: '浮层说明', style: { color: '#123456' } } } } })
    const hud = snapshot.model.project.globalLayerItems.find(entry => !model.project.globalLayerItems.some(before => before.item.layerItemId === entry.item.layerItemId))!
    expect(hud).toMatchObject({ plane: 'overlay', item: { frame: { x: 8, y: 9, width: 60, height: 60 }, content: { nativeType: 'image' } } })
    expect(hud.item.paperSpace).toBeUndefined()
    expect(snapshot.undoDepth).toBe(1)
    expect(course.load(course.serialize(snapshot.model))).toEqual(snapshot.model)
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-flow-native', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
    expect((session.read().model as typeof model).project.globalLayerItems).toEqual(model.project.globalLayerItems)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('creates Spatial world and Slide scene/surface structured Native content with frozen origins and fresh child identities', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel()
    const spatial = model.project.surfaces.find(surface => surface.type === 'spatial-2d')!
    if (spatial.type !== 'spatial-2d') throw new Error('spatial')
    const location = model.project.locations.find(value => value.surfaceId === spatial.id)!
    if (location.kind !== 'spatial-camera') throw new Error('camera')
    const frame = spatial.camera.frames.find(value => value.id === location.cameraFrameId)!
    const slideLocation = model.project.locations.find(value => value.kind === 'slide-scene')!
    const session = await registry.create(model, 'structured-native.h5lesson')
    await gateway.beginRun({ runId: 'structured', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const parent: Extract<ToolTarget, { kind: 'course-owner' }> = { kind: 'course-owner', locationId: location.id, owner: 'world', insertionOrigin: { x: -500, y: 300 } }
    const world = await gateway.issueTarget('structured', session.documentId, parent)
    parent.insertionOrigin!.x = 90000
    const camera = await gateway.issueTarget('structured', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'world' })
    const scene = await gateway.issueTarget('structured', session.documentId, { kind: 'course-owner', locationId: slideLocation.id, owner: 'scene' })
    const surface = await gateway.issueTarget('structured', session.documentId, { kind: 'course-owner', locationId: slideLocation.id, owner: 'surface' })
    const chart = createChartNode({ title: '模型数据标题' }), table = createTableNode()
    const chartTemplate = { nativeType: 'chart', categories: chart.categories, series: chart.series, title: chart.title }
    const tableTemplate = { nativeType: 'table', columns: table.columns, rows: table.rows }
    const result = await gateway.execute('structured', 'structured-batch', { name: 'batch', input: { operations: [
      { name: 'native.insert', input: { target: world, template: { nativeType: 'text', text: '冻结位置' } } },
      { name: 'native.insert', input: { target: camera, template: { nativeType: 'text', text: '镜头位置' } } },
      { name: 'native.insert', input: { target: world, template: { nativeType: 'formula' } } },
      { name: 'native.insert', input: { target: world, template: { nativeType: 'shape', shapeType: 'rectangle' } } },
      { name: 'native.insert', input: { target: world, template: { nativeType: 'image', assetId: 'badge' } } },
      { name: 'native.insert', input: { target: world, template: chartTemplate } },
      { name: 'native.insert', input: { target: world, template: tableTemplate } },
      { name: 'native.insert', input: { target: scene, template: chartTemplate } },
      { name: 'native.insert', input: { target: surface, template: tableTemplate } },
    ] } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v9' || result.kind !== 'document-operation') throw new Error('course')
    const changed = snapshot.model.project.surfaces.find(value => value.id === spatial.id)!
    if (changed.type !== 'spatial-2d') throw new Error('spatial')
    const created = changed.world.layerItems.filter(item => !spatial.world.layerItems.some(before => before.layerItemId === item.layerItemId))
    expect(created).toHaveLength(7)
    expect(created[0].frame).toMatchObject({ x: -500 - 200 + spatial.world.layerItems.length * 20, y: 300 - 40 })
    expect(created[1].frame).toMatchObject({ x: frame.x - 200 + (spatial.world.layerItems.length + 1) * 20, y: frame.y - 40 })
    expect(changed.camera).toEqual(spatial.camera)
    const childIds = new Set<string>()
    for (const id of [5, 6, 7, 8]) {
      const resolved = await gateway.resolveEditTarget('structured', result.affected[id])
      if (resolved.model.kind !== 'course-v9' || resolved.target.kind !== 'course-object') throw new Error('object')
      const item = locateCourseLayer(resolved.model.project, resolved.target.itemId)!.item
      if (item.kind !== 'native') throw new Error('native')
      const ids = item.content.nativeType === 'chart' ? [...item.content.data.categories.map(value => value.id), ...item.content.data.series.flatMap(value => [value.id, ...value.points.map(point => point.id)])]
        : item.content.nativeType === 'table' ? [...item.content.data.columns.map(value => value.id), ...item.content.data.rows.flatMap(value => [value.id, ...value.cells.map(cell => cell.id)])] : []
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) { expect(childIds.has(id)).toBe(false); childIds.add(id) }
      expect(ids.some(id => [...chart.categories.map(value => value.id), ...table.columns.map(value => value.id)].includes(id))).toBe(false)
    }
    expect(snapshot.undoDepth).toBe(1)
    expect(course.load(course.serialize(snapshot.model))).toEqual(snapshot.model)
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-structured', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('refuses cross-Surface owners and unsupported Native carrier combinations without a partial batch', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'native-policy.h5lesson')
    await gateway.beginRun({ runId: 'policy', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    for (const owner of [
      { kind: 'course-owner' as const, locationId: 'location-flow', owner: 'world' as const },
      { kind: 'course-owner' as const, locationId: 'location-spatial', owner: 'surface' as const },
      { kind: 'course-owner' as const, locationId: 'location-flow', owner: 'surface' as const, insertionOrigin: { x: 0, y: 0 } },
    ]) await expect(gateway.issueTarget('policy', session.documentId, owner)).rejects.toThrow()
    const flow = await gateway.issueTarget('policy', session.documentId, { kind: 'course-owner', locationId: 'location-flow', owner: 'surface' })
    const slideLocation = model.project.locations.find(value => value.kind === 'slide-scene')!
    const global = await gateway.issueTarget('policy', session.documentId, { kind: 'course-owner', locationId: slideLocation.id, owner: 'global' })
    for (const [id, target, template] of [
      ['flow-formula', flow, { nativeType: 'formula' }],
      ['flow-chart', flow, { nativeType: 'chart' }],
      ['global-chart', global, { nativeType: 'chart' }],
      ['global-paper', global, { nativeType: 'text', paperSpace: 'paper' }],
    ] as const) expect(await gateway.execute('policy', id, { name: 'batch', input: { operations: [
      { name: 'native.insert', input: { target: flow, template: { nativeType: 'text', text: 'must rollback' } } },
      { name: 'native.insert', input: { target, template } },
    ] } })).toMatchObject({ kind: 'error' })
    expect(session.read().undoDepth).toBe(0)
    expect(session.read().model).toEqual(model)
  })

  it('creates managed inputs atomically and preserves feedback through answer edits, archive and real Published submission', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'input.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    await gateway.beginRun({ runId: 'input', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const owner = await gateway.issueTarget('input', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    const created = await gateway.execute('input', 'create', { name: 'native.insert', input: { target: owner, template: { nativeType: 'input', answerType: 'text', x: 30, y: 50 } } })
    expect(created).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    if (created.kind !== 'document-operation') throw new Error('receipt')
    const beforeAnswer = session.read()
    const resolved = await gateway.resolveEditTarget('input', created.affected[0])
    if (resolved.model.kind !== 'course-v9' || resolved.target.kind !== 'course-object') throw new Error('input')
    const itemId = resolved.target.itemId
    const inputAt = (project: typeof model.project) => {
      const surface = project.surfaces.find(value => value.id === location.surfaceId)!
      if (surface.type !== 'slide') throw new Error('slide')
      const scene = surface.scenes.find(scene => location.kind === 'slide-scene' && scene.id === location.sceneId)!
      const item = scene.layerItems.find(value => value.layerItemId === itemId)!
      if (item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('input')
      return { surface, scene, item, data: item.content.data }
    }
    const initial = inputAt(resolved.model.project)
    expect(initial.item.frame).toMatchObject({ x: 30, y: 50 })
    expect(initial.data.ruleFamilyRuleIds).toHaveLength(3)
    expect(resolved.model.project.courseState).toHaveLength(model.project.courseState.length + 2)
    expect(beforeAnswer.undoDepth).toBe(1)
    const configured = await gateway.execute('input', 'answer', { name: 'input.answer', input: { target: created.affected[0], answer: { answerType: 'number', min: 10, max: 12 } } })
    expect(configured).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = session.read(), reopened = course.load(course.serialize(after.model))
    expect(reopened).toEqual(after.model)
    if (reopened.kind !== 'course-v9') throw new Error('course')
    const changed = inputAt(reopened.project)
    expect(changed.data.ruleFamilyRuleIds).toHaveLength(4)
    const originalFamily = inspectInputRuleFamily(itemId, initial.data, initial.scene.interactions).config!
    const family = inspectInputRuleFamily(itemId, changed.data, changed.scene.interactions).config!
    expect(family.correct).toEqual(originalFamily.correct)
    expect(family.error).toEqual(originalFamily.error)
    const state = new CourseStateStore(), motions: { type: string; nodeId: string }[] = []
    let submit: ((value: string) => void) | undefined
    const controller = new PublishedInteractionController({ surfaceId: changed.surface.id, rules: changed.scene.interactions,
      surface: { bindNodeClick: () => null, executeNodeMotion: action => { motions.push(action); return true },
        describeInput: id => id === itemId ? { answerType: 'number', stateKey: changed.data.stateKey, validityKey: changed.data.validityKey, defaultValue: 0 } : null,
        bindInputSubmit: (_id, listener) => { submit = listener; return () => { submit = undefined } },
      },
      session: { courseState: state, setCourseStateBatch: entries => state.setMany(entries), currentSceneId: () => changed.scene.id,
        goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
    })
    submit!('１１')
    await vi.waitFor(() => expect(motions).toEqual(family.correct.map(action => expect.objectContaining(action))))
    expect(state.get(changed.data.stateKey)).toBe(11)
    expect(state.get(changed.data.validityKey)).toBe(true)
    motions.length = 0
    submit!('invalid')
    await vi.waitFor(() => expect(motions).toEqual(family.error.map(action => expect.objectContaining(action))))
    expect(state.get(changed.data.validityKey)).toBe(false)
    controller.destroy()
    expect(submit).toBeUndefined()
    await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-answer', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual((beforeAnswer.model as typeof model).project.surfaces)
    const undo = session.read()
    await session.execute({ documentId: session.documentId, epoch: undo.epoch, operationId: 'undo-create', actor: 'human', baseRevision: undo.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.courseState).toEqual(model.project.courseState)
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('composes click rules from frozen handles with one History and executes Published motion then cross-Surface navigation', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'interactions.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const surface = model.project.surfaces.find(value => value.id === location.surfaceId)!
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('slide')
    const scene = surface.scenes.find(value => value.id === location.sceneId)!
    const item = scene.layerItems.find(value => !value.locked && value.kind === 'native' && value.content.nativeType === 'text')!
    await gateway.beginRun({ runId: 'compose', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const owner = await gateway.issueTarget('compose', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    const node = await gateway.issueTarget('compose', session.documentId, { kind: 'course-object', locationId: location.id, itemId: item.layerItemId })
    const destination = await gateway.issueTarget('compose', session.documentId, { kind: 'course-location', locationId: 'location-flow' })
    const result = await gateway.execute('compose', 'compose', { name: 'batch', input: { operations: [
      { name: 'interaction.compose', input: { target: owner, interaction: { name: 'click and navigate', trigger: { kind: 'click', node }, effects: [{ kind: 'hide', nodes: [node], durationMs: 0, effect: 'none' }, { kind: 'go-to-location', location: destination }] } } },
      { name: 'interaction.compose', input: { target: owner, interaction: { name: 'presenter', trigger: { kind: 'presenter', command: 'next' }, effects: [{ kind: 'next-step' }] } } },
    ] } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = session.read(), reopened = course.load(course.serialize(after.model))
    expect(after.undoDepth).toBe(1)
    expect(reopened).toEqual(after.model)
    if (reopened.kind !== 'course-v9') throw new Error('course')
    const storedSurface = reopened.project.surfaces.find(value => value.id === surface.id)!
    if (storedSurface.type !== 'slide') throw new Error('slide')
    const storedRules = storedSurface.scenes.find(value => value.id === scene.id)!.interactions
    const rules = storedRules.filter(value => !scene.interactions.some(before => before.id === value.id))
    expect(rules).toHaveLength(2)
    expect(new Set(rules.flatMap(rule => [rule.id, ...rule.actions.map(step => step.id)])).size).toBe(5)
    let click: (() => void) | undefined
    const execution: string[] = [], state = new CourseStateStore()
    const controller = new PublishedInteractionController({ surfaceId: surface.id, rules,
      surface: { bindNodeClick: (id, listener) => { expect(id).toBe(item.layerItemId); click = listener; return () => { click = undefined } }, executeNodeMotion: action => { execution.push(`${action.type}:${action.nodeId}`); return true } },
      session: { courseState: state, currentSceneId: () => scene.id, goToLocation: id => { execution.push(`go:${id}`); return true }, goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
    })
    click!()
    await vi.waitFor(() => expect(execution).toEqual([`node.exit:${item.layerItemId}`, 'go:location-flow']))
    controller.destroy()
    expect(click).toBeUndefined()
    await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-compose', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual(model.project.surfaces)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('rejects unsupported input owners, invalid answers, hand-edited families and nonterminal navigation with zero partial commits', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'input-errors.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    await gateway.beginRun({ runId: 'errors', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const ownerTarget = { kind: 'course-owner' as const, locationId: location.id, owner: 'scene' as const }
    const owner = await gateway.issueTarget('errors', session.documentId, ownerTarget)
    const flow = await gateway.issueTarget('errors', session.documentId, { kind: 'course-owner', locationId: 'location-flow', owner: 'surface' })
    expect(await gateway.execute('errors', 'flow-input', { name: 'batch', input: { operations: [
      { name: 'native.insert', input: { target: owner, template: { nativeType: 'input' } } },
      { name: 'native.insert', input: { target: flow, template: { nativeType: 'input' } } },
    ] } })).toMatchObject({ kind: 'error' })
    expect(await gateway.execute('errors', 'bad-navigation', { name: 'interaction.compose', input: { target: owner, interaction: { trigger: { kind: 'scene-enter' }, effects: [{ kind: 'next-scene' }, { kind: 'previous-scene' }] } } })).toMatchObject({ kind: 'error' })
    expect(session.read().model).toEqual(model)
    expect(session.read().undoDepth).toBe(0)
    const created = await gateway.execute('errors', 'create', { name: 'native.insert', input: { target: owner, template: { nativeType: 'input' } } })
    if (created.kind !== 'document-operation') throw new Error(JSON.stringify(created))
    const before = session.read()
    for (const [id, answer] of [['duplicates', { answerType: 'text', answers: ['Ａ', 'a'] }], ['bounds', { answerType: 'number', min: 3, max: 1 }]] as const) {
      expect(await gateway.execute('errors', id, { name: 'input.answer', input: { target: created.affected[0], answer } })).toMatchObject({ kind: 'error' })
    }
    expect(session.read()).toEqual(before)
    if (before.model.kind !== 'course-v9') throw new Error('course')
    const changed = structuredClone(before.model.project)
    const surface = changed.surfaces.find(value => value.id === location.surfaceId)!
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('slide')
    const scene = surface.scenes.find(value => value.id === location.sceneId)!
    const item = scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'input')!
    if (item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('input')
    const familyId = item.content.data.ruleFamilyRuleIds[0]
    scene.interactions.find(rule => rule.id === familyId)!.enabled = false
    await session.execute({ documentId: session.documentId, epoch: before.epoch, operationId: 'human-rules', actor: 'human', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'course.replace', project: changed } } })
    expect(await gateway.execute('errors', 'stale-input', { name: 'input.answer', input: { target: created.affected[0], answer: { answerType: 'text', answers: ['new'] } } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
    const fresh = await gateway.issueTarget('errors', session.documentId, { kind: 'course-object', locationId: location.id, itemId: item.layerItemId })
    expect(await gateway.execute('errors', 'hand-edited', { name: 'input.answer', input: { target: fresh, answer: { answerType: 'text', answers: ['new'] } } })).toMatchObject({ kind: 'error' })
    expect(session.read().undoDepth).toBe(2)
  })

  it('completes rule CRUD through discovered handles while preserving omitted fields, archive, no-op History and Published navigation', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'rule-crud.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const surface = model.project.surfaces.find(value => value.id === location.surfaceId)!
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('slide')
    const scene = surface.scenes.find(value => value.id === location.sceneId)!
    const node = scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text' && !item.locked)!
    const ownerTarget = { kind: 'course-owner' as const, locationId: location.id, owner: 'scene' as const }
    await gateway.beginRun({ runId: 'crud', actor: 'agent', documents: [{ documentId: session.documentId, writable: [ownerTarget] }] })
    const owner = await gateway.issueTarget('crud', session.documentId, ownerTarget)
    const created = await gateway.execute('crud', 'create', { name: 'interaction.compose', input: { target: owner, interaction: { name: 'retained title', trigger: { kind: 'click', node: node.label }, effects: [{ kind: 'next-scene' }] } } })
    if (created.kind !== 'document-operation') throw new Error(JSON.stringify(created))
    expect(created.result.status).toBe('applied')
    const ruleHandle = created.affected[0]
    const resolved = await gateway.resolveEditTarget('crud', ruleHandle)
    if (resolved.target.kind !== 'course-interaction') throw new Error('rule target')
    const ruleId = resolved.target.ruleId
    const listing = await gateway.execute('crud', 'list', { name: 'listChildren', input: { target: owner, limit: 100 } })
    expect(listing).toMatchObject({ kind: 'read', data: expect.arrayContaining([expect.objectContaining({ kind: 'course-interaction', label: 'retained title' })]) })
    const read = await gateway.execute('crud', 'read', { name: 'read', input: { target: ruleHandle } })
    if (read.kind !== 'read') throw new Error('read')
    expect(JSON.parse((read.data as { text: string }).text).rule.id).toBe(ruleId)
    const destination = await gateway.issueTarget('crud', session.documentId, { kind: 'course-location', locationId: 'location-flow' })
    const updated = await gateway.execute('crud', 'update', { name: 'interaction.update', input: { target: ruleHandle, interaction: { effects: [{ kind: 'go-to-location', location: destination }] } } })
    expect(updated).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    if (updated.kind !== 'document-operation') throw new Error('update')
    const after = session.read(), reopened = course.load(course.serialize(after.model))
    expect(after.undoDepth).toBe(2)
    expect(reopened).toEqual(after.model)
    if (reopened.kind !== 'course-v9') throw new Error('course')
    const storedSurface = reopened.project.surfaces.find(value => value.id === surface.id)!
    if (storedSurface.type !== 'slide') throw new Error('slide')
    const rule = storedSurface.scenes.find(value => value.id === scene.id)!.interactions.find(value => value.id === ruleId)!
    expect(rule).toMatchObject({ id: ruleId, name: 'retained title', enabled: true, trigger: { type: 'node.click', nodeId: node.layerItemId }, actions: [{ action: { type: 'location.go', locationId: 'location-flow' } }] })
    const unchanged = await gateway.execute('crud', 'noop', { name: 'interaction.update', input: { target: updated.affected[0], interaction: {} } })
    expect(unchanged).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
    expect(session.read().undoDepth).toBe(2)
    let click: (() => void) | undefined, navigated = ''
    const controller = new PublishedInteractionController({ surfaceId: surface.id, rules: [rule], surface: { bindNodeClick: (_id, listener) => { click = listener; return () => { click = undefined } }, executeNodeMotion: () => true },
      session: { courseState: new CourseStateStore(), currentSceneId: () => scene.id, goToLocation: id => { navigated = id; return true }, goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
    })
    click!(); await vi.waitFor(() => expect(navigated).toBe('location-flow')); controller.destroy()
    const removed = await gateway.execute('crud', 'delete', { name: 'interaction.delete', input: { target: updated.affected[0] } })
    expect(removed).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(session.read().undoDepth).toBe(3)
    expect(await gateway.execute('crud', 'read-deleted', { name: 'read', input: { target: updated.affected[0] } })).toMatchObject({ kind: 'error' })
    const snapshot = session.read()
    await session.execute({ documentId: session.documentId, epoch: snapshot.epoch, operationId: 'undo-rule-delete', actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual(reopened.project.surfaces)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('deletes an input family member through the same planner with atomic release, failed-batch rollback and one undo', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'family-delete.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    await gateway.beginRun({ runId: 'family', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const owner = await gateway.issueTarget('family', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    const created = await gateway.execute('family', 'create', { name: 'native.insert', input: { target: owner, template: { nativeType: 'input' } } })
    if (created.kind !== 'document-operation') throw new Error('input')
    const resolved = await gateway.resolveEditTarget('family', created.affected[0])
    if (resolved.model.kind !== 'course-v9' || resolved.target.kind !== 'course-object') throw new Error('input')
    const item = locateCourseLayer(resolved.model.project, resolved.target.itemId)!.item
    if (item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('input')
    const ruleId = item.content.data.ruleFamilyRuleIds[0]
    const target = await gateway.issueTarget('family', session.documentId, { kind: 'course-interaction', locationId: location.id, ruleId })
    const before = session.read()
    expect(await gateway.execute('family', 'rollback', { name: 'batch', input: { operations: [
      { name: 'interaction.delete', input: { target } },
      { name: 'interaction.update', input: { target, interaction: { name: 'already deleted' } } },
    ] } })).toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(before)
    const result = await gateway.execute('family', 'delete', { name: 'interaction.delete', input: { target } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const after = session.read()
    if (after.model.kind !== 'course-v9') throw new Error('course')
    expect(after.undoDepth).toBe(before.undoDepth + 1)
    expect(locateCourseLayer(after.model.project, item.layerItemId)!.item).toMatchObject({ content: { data: { ruleFamilyRuleIds: [] } } })
    expect(course.load(course.serialize(after.model))).toEqual(after.model)
    expect(after.model.project.courseState).toEqual(resolved.model.project.courseState)
    await session.execute({ documentId: session.documentId, epoch: after.epoch, operationId: 'undo-family-delete', actor: 'human', baseRevision: after.revision, mutation: { type: 'undo' } })
    expect((session.read().model as typeof model).project.surfaces).toEqual(resolved.model.project.surfaces)
    expect(session.read().model.resources).toEqual(model.resources)
  })

  it('refuses stale or locked rule edits, cross-document references and delete-receipt privilege expansion', async () => {
    const { registry, gateway } = harness(), model = multiSurfaceModel(), session = await registry.create(model, 'rule-policy.h5lesson')
    const location = model.project.locations.find(value => value.kind === 'slide-scene')!
    const surface = model.project.surfaces.find(value => value.id === location.surfaceId)!
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') throw new Error('slide')
    const scene = surface.scenes.find(value => value.id === location.sceneId)!
    const item = scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text' && !item.locked)!
    await gateway.beginRun({ runId: 'rules', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const owner = await gateway.issueTarget('rules', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    const created = await gateway.execute('rules', 'create', { name: 'interaction.compose', input: { target: owner, interaction: { trigger: { kind: 'click', node: item.label }, effects: [{ kind: 'next-step' }] } } })
    if (created.kind !== 'document-operation') throw new Error('rule')
    const ruleAddress = (await gateway.resolveEditTarget('rules', created.affected[0])).target
    if (ruleAddress.kind !== 'course-interaction') throw new Error('rule address')
    const before = session.read()
    expect(await gateway.execute('rules', 'invalid-reference', { name: 'interaction.update', input: { target: created.affected[0], interaction: { effects: [{ kind: 'show', nodes: ['missing target'] }] } } })).toMatchObject({ kind: 'error' })
    expect(await gateway.execute('rules', 'unsupported-update', { name: 'interaction.update', input: { target: created.affected[0], interaction: { effects: [{ kind: 'next-scene' }, { kind: 'show', nodes: [item.label] }] } } })).toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(before)
    await session.execute({ documentId: session.documentId, epoch: before.epoch, operationId: 'lock-related', actor: 'human', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'course.object.patch', locationId: location.id, itemId: item.layerItemId, patch: { locked: true } } } })
    expect(await gateway.execute('rules', 'stale', { name: 'interaction.delete', input: { target: created.affected[0] } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
    const locked = await gateway.issueTarget('rules', session.documentId, ruleAddress), lockedSnapshot = session.read()
    expect(await gateway.execute('rules', 'locked-update', { name: 'interaction.update', input: { target: locked, interaction: { name: 'must not write' } } })).toMatchObject({ kind: 'error' })
    expect(await gateway.execute('rules', 'locked-delete', { name: 'interaction.delete', input: { target: locked } })).toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(lockedSnapshot)
    await session.execute({ documentId: session.documentId, epoch: lockedSnapshot.epoch, operationId: 'unlock-related', actor: 'human', baseRevision: lockedSnapshot.revision, mutation: { type: 'command', command: { type: 'course.object.patch', locationId: location.id, itemId: item.layerItemId, patch: { locked: false } } } })
    const other = await registry.create(model, 'other-rules.h5lesson')
    await gateway.beginRun({ runId: 'limited-rule', actor: 'agent', documents: [{ documentId: session.documentId, writable: [ruleAddress] }, { documentId: other.documentId, writable: [] }] })
    const limited = await gateway.issueTarget('limited-rule', session.documentId, ruleAddress)
    const foreign = await gateway.issueTarget('limited-rule', other.documentId, { kind: 'course-location', locationId: 'location-flow' })
    const stable = session.read()
    expect(await gateway.execute('limited-rule', 'foreign', { name: 'interaction.update', input: { target: limited, interaction: { effects: [{ kind: 'go-to-location', location: foreign }] } } })).toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(stable)
    const deleted = await gateway.execute('limited-rule', 'delete', { name: 'interaction.delete', input: { target: limited } })
    if (deleted.kind !== 'document-operation') throw new Error('delete')
    expect(deleted.result.status).toBe('applied')
    expect(deleted.affected).toEqual([limited])
    expect(await gateway.execute('limited-rule', 'cannot-create', { name: 'interaction.compose', input: { target: deleted.affected[0], interaction: { trigger: { kind: 'scene-enter' }, effects: [{ kind: 'next-step' }] } } })).toMatchObject({ kind: 'error' })
    const parent = await gateway.issueTarget('limited-rule', session.documentId, { kind: 'course-owner', locationId: location.id, owner: 'scene' })
    expect(await gateway.execute('limited-rule', 'still-limited', { name: 'interaction.compose', input: { target: parent, interaction: { trigger: { kind: 'scene-enter' }, effects: [{ kind: 'next-step' }] } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  })
})
