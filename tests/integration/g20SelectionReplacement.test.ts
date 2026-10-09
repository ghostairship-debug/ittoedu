// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { captureComponentOperation, applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { resolveComponentPresentation, componentDefinitionBuiltinKey } from '../../src/shared/contracts/component-platform/project'
import type { PrepareImageResourcePort } from '../../src/core/tools/imageResource'
import type { DocumentDriver, DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const roots: string[] = [], driver = new CourseV10Driver()
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
function equivalent(actual: Extract<DocumentModel, { kind: 'course-v10' }>, expected: Extract<DocumentModel, { kind: 'course-v10' }>) { expect({ ...actual, project: { ...actual.project, revision: expected.project.revision } }).toEqual(expected) }
function rejected(result: ToolResult) { expect(result.kind === 'error' || result.kind === 'document-operation' && result.result.status === 'conflict', JSON.stringify(result)).toBe(true) }
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); return result }
async function harness(prepare?: PrepareImageResourcePort, pauseValidation?: () => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'current-replacement-')); roots.push(root)
  const fixture = createCurrentSelectionFixture(), { surfaceId } = fixture
  let project = fixture.project
  project.definitions[SHAPE_DEFINITION.id] = structuredClone(SHAPE_DEFINITION)
  project.instances.shape = { id: 'shape', definitionId: SHAPE_DEFINITION.id, name: '保留身份的形状', playbackInitialVisibility: 'hidden', visibility: { mode: 'include', surfaceIds: [surfaceId] }, data: defaultShapeData(), frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 20, 30] } }
  project.surfaces[0].childIds.splice(0, 0, 'shape')
  project.surfaces[0].presentation!.states[0].overrides.shape = { frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 75, 30] } }
  project = applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId }, [
    { id: 'click-shape', enabled: true, trigger: { type: 'node.click', nodeId: 'shape' }, conditions: [{ type: 'scene.in', sceneIds: [surfaceId] }],
      actions: [{ id: 'exit-shape', start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'shape', durationMs: 100, easing: 'linear', effect: 'fade' } }] },
    { id: 'completed', enabled: true, trigger: { type: 'animation.completed', actionId: 'exit-shape' }, conditions: [],
      actions: [{ id: 'enter-shape', start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: 'shape', durationMs: 100, easing: 'linear', effect: 'fade' } }] },
  ])))
  const originalBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  project.assets.original = { id: 'original', filename: 'original.svg', path: 'assets/original.svg', mimeType: 'image/svg+xml', byteLength: originalBytes.length, width: 10, height: 10 }
  const model = { ...fixture.model, project, resources: { assets: { original: originalBytes }, components: {} } }, filename = path.join(root, 'replacement.glx')
  await fs.writeFile(filename, driver.serialize(model))
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(filename), session = host.registry.get(opened.documentId)
  const checkedDriver: DocumentDriver = { kind: driver.kind, validate: model => driver.validate(model), load: bytes => driver.load(bytes), serialize: model => driver.serialize(model), withRevision: (model, revision) => driver.withRevision(model, revision),
    apply: async (model, command) => { const next = driver.apply(model, command); await pauseValidation?.(); return next } }
  // The optional host gates the real decoder/validator; unrelated source import remains fail-closed.
  const gateway = prepare || pauseValidation ? new DocumentToolGateway(host.registry, pauseValidation ? [checkedDriver] : [driver], randomUUID, { prepareImage: prepare ?? prepareImageResource, componentContent: { async apply() { throw new Error('No generic content writer in this image host') }, async source() { throw new Error('No source import in this image host') } } }) : host.tools
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const bytes = Uint8Array.from(await sharp({ create: { width: 12, height: 8, channels: 4, background: '#aacc00' } }).png().toBuffer())
  const privateFile = path.join(root, 'private.png'); await fs.writeFile(privateFile, bytes)
  const resource = await gateway.provideImage('r', session.documentId, { bytes, filename: 'ready.png', mimeType: 'image/png' })
  const current = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected V10'); return value }
  const shapePath = componentProjectFiles(project, model.resources).find(file => file.kind === 'data' && file.target?.kind === 'instance' && file.target.instanceId === 'shape')!.path
  const invoke = (name: string, input: unknown, callId: string = randomUUID()) => gateway.execute('r', callId, { name, input })
  const observe = async (selector?: string) => { expect((await invoke('project.read', { path: shapePath, ...(selector ? { project: selector } : {}) })).kind).toBe('read') }
  const replace = (selector?: string, from = resource, callId: string = randomUUID()) => invoke('project.apply', { path: shapePath, from, intent: 'redo', ...(selector ? { project: selector } : {}) }, callId)
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly })
  const history = async (type: 'undo' | 'redo') => { const s = session.read(); expect(await session.execute({ documentId: s.documentId, epoch: s.epoch, baseRevision: s.revision, operationId: randomUUID(), actor: 'human', mutation: { type } })).toMatchObject({ status: 'applied' }) }
  const human = async (edits: Parameters<typeof captureComponentOperation>[1]) => { const s = session.read(); expect(await session.execute({ documentId: s.documentId, epoch: s.epoch, baseRevision: s.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current().project, edits) } })).toMatchObject({ status: 'applied' }) }
  return { host, gateway, session, project, current, resource, bytes, privateFile, shapePath, surfaceId, issue, invoke, observe, replace, history, human,
    reopen: async () => { await host.internalAPI.save(session.documentId); return (await new DocumentHostService(path.join(root, 'reopen')).open(filename)).model } }
}

it('replaces a plain shape with Ready image bytes at its original identity, geometry and order, with durable replay, unchanged neighbors, one History and cold reopen', async () => {
  const f = await harness(), before = f.session.read(), original = f.project.instances.shape
  const readonly = await f.issue({ kind: 'course-surface', surfaceId: f.surfaceId }, true)
  await f.observe(readonly)
  expect(await f.replace(readonly)).toMatchObject({ kind: 'error', code: 'not-authorized' }); expect(f.session.read()).toEqual(before)
  await f.observe()
  await f.human([{ type: 'frame.set', instanceId: 'scene-other', frame: { width: 420, height: 90, transform: [1, 0, 0, 1, 800, 200] } }])
  const neighbor = f.current().project.instances['scene-other'], depth = f.session.read().undoDepth
  applied(await f.replace(undefined, f.resource, 'replace-ready'))
  const after = f.current(), image = after.project.instances.shape
  expect(componentDefinitionBuiltinKey(after.project.definitions[image.definitionId])).toBe('guoling.image')
  expect(image).toMatchObject({ id: original.id, name: original.name, frame: original.frame })
  expect(after.project.surfaces[0].childIds).toEqual(f.project.surfaces[0].childIds)
  expect(after.project.instances['scene-other']).toEqual(neighbor)
  expect(interactionRules(interactionBehavior(after.project, { kind: 'surface', surfaceId: f.surfaceId }))).toEqual(interactionRules(interactionBehavior(f.project, { kind: 'surface', surfaceId: f.surfaceId })))
  expect(after.project.surfaces[0].presentation).toEqual(f.project.surfaces[0].presentation)
  expect(Object.keys(after.resources.assets)).toHaveLength(2)
  expect(after.resources.assets.original).toEqual(before.model.resources.assets.original); expect(after.project.assets.original).toEqual(f.project.assets.original)
  expect(Object.entries(after.resources.assets).find(([id]) => id !== 'original')![1]).toEqual(f.bytes)
  expect(f.session.read().undoDepth).toBe(depth + 1)
  applied(await f.replace(undefined, f.resource, 'replace-ready')); expect(f.session.read().undoDepth).toBe(depth + 1)
  expect(await f.reopen()).toEqual(after)
  await f.history('undo'); expect(f.current().project.instances.shape).toEqual(original); expect(f.current().project.instances['scene-other']).toEqual(neighbor); expect(f.current().resources).toEqual(before.model.resources)
  await f.history('redo'); equivalent(f.current(), after)
})

it('replaces only effective named A geometry and declared click/action/completion references while base and B remain intact, including resources, one History, Undo/Redo and archive', async () => {
  const f = await harness(), before = f.current(), selector = await f.issue({ kind: 'course-surface', surfaceId: f.surfaceId, stateId: 'named-a' })
  await f.observe(selector); applied(await f.replace(selector, f.resource, 'named-ready'))
  const after = f.current(), a = resolveComponentPresentation(after.project, f.surfaceId, 'named-a'), b = resolveComponentPresentation(after.project, f.surfaceId, 'named-b')
  const image = Object.values(a.instances).find(instance => componentDefinitionBuiltinKey(a.definitions[instance.definitionId]) === 'guoling.image')!
  expect(image.frame).toEqual(resolveComponentPresentation(before.project, f.surfaceId, 'named-a').instances.shape.frame)
  expect(image.playbackInitialVisibility).toBe('hidden'); expect(image.visibility).toEqual(before.project.instances.shape.visibility); expect(image.name).toBe(before.project.instances.shape.name); expect(image.visible).toBe(true); expect(a.instances.shape.visible).toBe(false)
  expect(after.project.instances.shape).toEqual(before.project.instances.shape); expect(after.project.instances[image.id].visible).toBe(false); expect(b.instances[image.id].visible).toBe(false)
  for (const id of Object.keys(before.project.instances)) expect(after.project.instances[id]).toEqual(before.project.instances[id])
  expect(after.project.surfaces[0].presentation!.states[1]).toEqual(before.project.surfaces[0].presentation!.states[1])
  expect(after.project.surfaces.slice(1)).toEqual(before.project.surfaces.slice(1)); expect(after.project.global).toEqual(before.project.global)
  const rules = interactionRules(interactionBehavior(a, { kind: 'surface', surfaceId: f.surfaceId })), originalRules = interactionRules(interactionBehavior(before.project, { kind: 'surface', surfaceId: f.surfaceId }))
  expect(rules[0]).toEqual({ ...originalRules[0], trigger: { type: 'node.click', nodeId: image.id }, actions: [{ ...originalRules[0].actions[0], action: { ...originalRules[0].actions[0].action, nodeId: image.id } }] })
  expect(rules[1]).toEqual({ ...originalRules[1], actions: [{ ...originalRules[1].actions[0], action: { ...originalRules[1].actions[0].action, nodeId: image.id } }] })
  expect(interactionRules(interactionBehavior(b, { kind: 'surface', surfaceId: f.surfaceId }))).toEqual(originalRules)
  expect(a.surfaces[0].childIds.indexOf(image.id)).toBe(before.project.surfaces[0].childIds.indexOf('shape'))
  expect(after.resources.assets.original).toEqual(before.resources.assets.original); expect(after.project.assets.original).toEqual(before.project.assets.original); expect(Object.entries(after.resources.assets).find(([id]) => id !== 'original')![1]).toEqual(f.bytes); expect(f.session.read().undoDepth).toBe(1)
  applied(await f.replace(selector, f.resource, 'named-ready')); expect(f.session.read().undoDepth).toBe(1)
  expect(await f.reopen()).toEqual(after)
  await f.history('undo'); equivalent(f.current(), before); await f.history('redo'); equivalent(f.current(), after)
  const paper = await harness(), originalBehavior = interactionBehavior(paper.project, { kind: 'surface', surfaceId: paper.surfaceId })!
  const setup = [{ type: 'instance.move' as const, instanceId: 'shape', container: { kind: 'surface' as const, surfaceId: 'flow' }, index: 0, frame: paper.project.instances.shape.frame! },
    { type: 'instance.flowPlacement.set' as const, instanceId: 'shape', flowPlacement: { space: 'paper' as const, plane: 'underlay' as const, paragraphAnchor: { blockId: 'flow-paragraph', offsetY: 20, xRatio: .4 } } },
    { type: 'instance.flowLayout.set' as const, instanceId: 'shape', flowLayout: { width: 'wide' as const, wrap: 'right' as const } },
    { type: 'instance.patch' as const, instanceId: 'shape', patch: { visibility: { mode: 'include' as const, surfaceIds: ['flow'] } } },
    { type: 'data.set' as const, instanceId: originalBehavior.id, path: ['rules'], value: [] as import('../../src/shared/contracts/component-platform/project').JsonValue },
]
  const staged = applyComponentOperation(paper.project, captureComponentOperation(paper.project, setup))
  await paper.human([...setup, ...componentRuleEdits(staged, { kind: 'surface', surfaceId: 'flow' }, interactionRules(originalBehavior))])
  const paperBefore = paper.current(), paperSelector = await paper.issue({ kind: 'course-surface', surfaceId: 'flow' }), paperPath = componentProjectFiles(paperBefore.project, paperBefore.resources).find(file => file.kind === 'data' && file.target?.kind === 'instance' && file.target.instanceId === 'shape')!.path
  expect((await paper.invoke('project.read', { path: paperPath, project: paperSelector })).kind).toBe('read')
  applied(await paper.invoke('project.apply', { path: paperPath, project: paperSelector, from: paper.resource, intent: 'redo' }))
  const paperAfter = paper.current(), paperImage = paperAfter.project.instances.shape
  expect(paperImage).toMatchObject({ frame: paperBefore.project.instances.shape.frame, flowPlacement: paperBefore.project.instances.shape.flowPlacement, flowLayout: paperBefore.project.instances.shape.flowLayout, playbackInitialVisibility: 'hidden', visibility: { mode: 'include', surfaceIds: ['flow'] } })
  expect(paperAfter.project.surfaces).toEqual(paperBefore.project.surfaces); expect(interactionRules(interactionBehavior(paperAfter.project, { kind: 'surface', surfaceId: 'flow' }))).toEqual(interactionRules(interactionBehavior(paperBefore.project, { kind: 'surface', surfaceId: 'flow' })))
  expect(paper.session.read().undoDepth).toBe(2); expect(await paper.reopen()).toEqual(paperAfter); await paper.history('undo'); equivalent(paper.current(), paperBefore)
})

it('rejects unready/foreign/private resources, nonwhole/read-only/old observations, incompatible state overrides and late prepare Stop or source/behavior edits without leaking replacement assets', async () => {
  const f = await harness(); await f.observe()
  const before = f.session.read()
  for (const from of ['not-ready', f.privateFile, { $result: { step: 0 } }]) {
    expect((await f.invoke('project.apply', { path: f.shapePath, from, intent: 'redo' })).kind).toBe('error'); expect(f.session.read()).toEqual(before)
  }
  const target = await f.issue({ kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'shape' })
  for (const operations of [
    [{ name: 'object.update', input: { target: { $result: { step: 1 } }, properties: { visible: false } } }, { name: 'object.insert', input: { target: await f.issue({ kind: 'course-surface', surfaceId: f.surfaceId }), kind: 'shape' } }],
    [{ name: 'object.update', input: { target, properties: { visible: false } } }, { name: 'media.apply', input: { target: { $result: { step: 0 } }, resource: f.resource } }],
    [{ name: 'media.apply', input: { target, resource: { $result: { step: 0, itemId: 'forged' } } } }],
  ]) { expect((await f.invoke('batch', { operations })).kind).toBe('error'); expect(f.session.read()).toEqual(before) }
  await f.gateway.beginRun({ runId: 'other', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'document' }] }] })
  const foreign = await f.gateway.provideImage('other', f.session.documentId, { bytes: f.bytes, filename: 'foreign.png', mimeType: 'image/png' })
  expect(await f.replace(undefined, foreign)).toMatchObject({ kind: 'error', code: 'invalid-resource' }); expect(f.session.read()).toEqual(before)
  await f.gateway.beginRun({ runId: 'narrow', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'shape' }] }] })
  expect(await f.gateway.execute('narrow', 'narrow-redo', { name: 'project.apply', input: { path: f.shapePath, from: f.resource, intent: 'redo' } })).toMatchObject({ kind: 'error', code: 'not-authorized' }); expect(f.session.read()).toEqual(before)
  await f.human([{ type: 'frame.set', instanceId: 'shape', frame: { ...f.project.instances.shape.frame!, width: 200 } }])
  const human = f.session.read(); rejected(await f.replace()); expect(f.session.read()).toEqual(human)
  const overridden = await harness()
  await overridden.human([{ type: 'surface.presentation.set', surfaceId: overridden.surfaceId, presentation: { ...overridden.project.surfaces[0].presentation!, states: overridden.project.surfaces[0].presentation!.states.map((state, index) => index ? state : { ...state, overrides: { ...state.overrides, shape: { data: defaultShapeData() } } }) } }])
  await overridden.observe(); const guarded = overridden.session.read(); expect(await overridden.replace()).toMatchObject({ kind: 'error', code: 'state-placement-unsupported' }); expect(overridden.session.read()).toEqual(guarded)
  const unscoped = await harness()
  await unscoped.human(componentRuleEdits(unscoped.current().project, { kind: 'project' }, interactionRules(interactionBehavior(unscoped.current().project, { kind: 'surface', surfaceId: unscoped.surfaceId }))))
  const a = await unscoped.issue({ kind: 'course-surface', surfaceId: unscoped.surfaceId, stateId: 'named-a' }); await unscoped.observe(a)
  const incompatible = unscoped.session.read(); expect(await unscoped.replace(a)).toMatchObject({ kind: 'error', code: 'state-placement-unsupported' }); expect(unscoped.session.read()).toEqual(incompatible)
  for (const mode of ['stop', 'source', 'behavior', 'final-source', 'final-behavior'] as const) {
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    let preparations = 0
    const final = mode.startsWith('final-')
    const late = await harness(final ? undefined : async (input, createId) => { if (++preparations > 1) { entered(); await gate } return prepareImageResource(input, createId) }, final ? async () => { entered(); await gate } : undefined)
    const selector = mode.includes('behavior') ? await late.issue({ kind: 'course-surface', surfaceId: late.surfaceId, stateId: 'named-a' }) : undefined
    await late.observe(selector)
    const pending = late.replace(selector); await waiting
    if (mode === 'stop') await late.gateway.stop('r')
    else if (mode.includes('source')) await late.human([{ type: 'frame.set', instanceId: 'shape', frame: { ...late.project.instances.shape.frame!, width: 300 } }])
    else {
      const behavior = interactionBehavior(late.current().project, { kind: 'surface', surfaceId: late.surfaceId })!
      await late.human([{ type: 'data.set', instanceId: behavior.id, path: ['rules', '0', 'enabled'], value: false }])
    }
    const unchanged = late.session.read(); release(); rejected(await pending); expect(late.session.read()).toEqual(unchanged)
  }
})

it('uses current Flow component structure and source for existing heading and new heading content replacement at the original parent, while retaining neighbors, navigation surface, resources and one atomic History', async () => {
  const f = await harness(), flow = f.current().project.surfaces.find(surface => surface.id === 'flow')!, before = f.current()
  await f.human([{ type: 'definition.set', definition: DOCUMENT_BLOCK_DEFINITION }, { type: 'instance.insert', container: { kind: 'surface', surfaceId: 'flow' }, index: 0, rootIds: ['old-heading', 'new-heading'], instances: [
    { id: 'old-heading', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: documentBlockData({ id: 'old-heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Old' }] } }) },
    { id: 'new-heading', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: documentBlockData({ id: 'new-heading', type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: 'New' }] } }) },
  ] }])
  const initial = f.current(), old = await f.issue({ kind: 'course-instance', surfaceId: 'flow', instanceId: 'old-heading' }), replacement = await f.issue({ kind: 'course-instance', surfaceId: 'flow', instanceId: 'new-heading' })
  for (const input of [{ path: f.shapePath, from: { $result: { step: 0 } }, intent: 'redo' }, { path: f.shapePath, from: { $result: { step: 1, itemId: 'forged' } }, intent: 'redo' }]) {
    expect((await f.invoke('project.apply', input)).kind).toBe('error'); equivalent(f.current(), initial)
  }
  const depth = f.session.read().undoDepth
  applied(await f.invoke('batch', { operations: [{ name: 'object.structure', input: { target: replacement, action: 'move', destination: await f.issue({ kind: 'course-surface', surfaceId: 'flow' }), index: 0 } }, { name: 'object.structure', input: { target: old, action: 'remove' } }] }))
  expect(f.current().project.surfaces.find(surface => surface.id === flow.id)!.childIds).toEqual(['new-heading', ...flow.childIds])
  expect(f.current().project.instances['new-heading']).toEqual(initial.project.instances['new-heading']); expect(f.current().project.instances['old-heading']).toBeUndefined()
  expect(f.current().project.instances['flow-neighbor']).toEqual(before.project.instances['flow-neighbor']); expect(f.current().resources).toEqual(initial.resources); expect(f.session.read().undoDepth).toBe(depth + 1)
  expect(await f.reopen()).toEqual(f.current()); await f.history('undo'); equivalent(f.current(), initial)
  const flowFile = componentProjectFiles(f.current().project, f.current().resources).find(file => file.binding?.kind === 'flow' && file.binding.surfaceId === 'flow')!
  const source = await f.invoke('project.read', { path: flowFile.path }); expect(source.kind).toBe('read'); if (source.kind !== 'read') throw new Error(JSON.stringify(source))
  const content = (source.data as { content: string }).content.replace(/<h1\b/g, '<h2').replace(/<\/h1>/g, '</h2>').replace('Old', 'Created')
  expect(content).not.toBe((source.data as { content: string }).content)
  const replaced = await f.invoke('project.apply', { path: flowFile.path, content })
  expect(replaced, JSON.stringify(replaced)).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
  expect(f.current().project.instances['old-heading'].data).toMatchObject({ type: 'heading', level: 2, content: { inlines: [{ type: 'text', text: 'Created' }] } })
  expect(f.current().project.surfaces.find(surface => surface.id === 'flow')!.childIds).toEqual(initial.project.surfaces.find(surface => surface.id === 'flow')!.childIds)
  expect(f.current().project.instances['flow-neighbor']).toEqual(initial.project.instances['flow-neighbor']); expect(f.current().resources).toEqual(initial.resources)
  expect(f.session.read().undoDepth).toBe(depth + 1); await f.history('undo'); equivalent(f.current(), initial)
})
