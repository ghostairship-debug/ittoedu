// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createShapeNode, createImageNode, createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { composeCourseProjectLocation } from '../../src/shared/courseLayerComposition'
import { allocateCourseLayerOrder, sortAllCourseLayerLists } from '../../src/core/tools/layerOrder'
import { composeSlideInteraction } from '../../src/core/tools/interactionCompose'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
const project = (snapshot: DocumentSnapshot) => { if (snapshot.model.kind !== 'course-v9') throw new Error('course'); return snapshot.model.project }
function applied(result: ToolResult) { expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result)); return result }
async function harness() {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const surface = model.project.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0], location = model.project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === scene.id)!
  for (const node of [createShapeNode('rectangle', { id: 'a', x: 20, y: 30, width: 80, height: 40 }), createShapeNode('rectangle', { id: 'b', x: 250, y: 100, width: 80, height: 40 }), createShapeNode('rectangle', { id: 'c', x: 630, y: 200, width: 80, height: 40 }), createTextNode({ id: 'fixed-text', text: 'base text', style: { overflow: 'fixed' } }), createTextNode({ id: 'auto-text', text: 'auto text' }), createImageNode({ id: 'picture', assetId: Object.keys(model.resources.assets)[0] })]) {
    const item = sceneNodeToCourseLayerItem(node); item.order = allocateCourseLayerOrder(model.project, 0); scene.layerItems.push(item)
  }
  const stateA = scene.presentation?.initialStateId ?? 'state-a'
  scene.presentation = { initialStateId: stateA, states: [{ id: stateA, name: 'A', layerItemOverrides: { a: { frame: { x: 60 } }, 'fixed-text': { nativeData: { text: 'state A text' } } } }, { id: 'state-b', name: 'B', layerItemOverrides: { a: { frame: { x: 500 } } } }] }
  if (location.kind === 'slide-scene') location.stateId = stateA
  scene.interactions.push(composeSlideInteraction(model.project, { locationId: location.id, surfaceId: surface.id, stateId: stateA }, scene, 'picture-click', { operation: 'compose', trigger: { kind: 'click', node: 'picture' }, effects: [{ kind: 'next-scene' }] }))
  sortAllCourseLayerLists(model.project)
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'named.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id), { prepareImage: prepareImageResource })
  const ownerTarget: ToolTarget = { kind: 'course-owner', owner: 'scene', locationId: location.id, stateId: stateA }
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [ownerTarget] }] })
  const object = (itemId: string, stateId: string | undefined = stateA) => gateway.issueTarget('r', session.documentId, { kind: 'course-object', locationId: location.id, itemId, ...(stateId ? { stateId } : {}) })
  const owner = () => gateway.issueTarget('r', session.documentId, ownerTarget)
  const view = (stateId: string | null) => composeCourseProjectLocation({ project: project(session.read()), locationId: location.id, stateId })
  return { model, location, scene, surface, stateA, registry, session, gateway, object, owner, view, invoke: (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input }) }
}
async function undo(f: Awaited<ReturnType<typeof harness>>, operationId = 'undo') { const before = f.session.read(); await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId, actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } }) }

it('duplicates interaction subgraphs and performs named-state layout/reorder/delete with exact visibility, resource closure and one undo', async () => {
  const f = await harness(), before = f.session.read(), owner = await f.owner(), picture = await f.object('picture'), targets = await Promise.all(['a', 'b', 'c'].map(id => f.object(id)))
  const result = applied(await f.invoke('state-batch', 'batch', { operations: [
    { name: 'layer.duplicate', input: { target: picture, owner, placement: { side: 'right', gap: 16 } } },
    { name: 'layer.align', input: { target: targets[0], targets, mode: 'top' } },
    { name: 'layer.distribute', input: { target: targets[0], targets, axis: 'horizontal' } },
    { name: 'layer.reorder', input: { target: targets[0], owner, position: { kind: 'front' } } },
    { name: 'layer.delete', input: { target: picture } },
  ] }))
  const created = (await f.gateway.resolveEditTarget('r', result.affected[0])).target
  if (created.kind !== 'course-object') throw new Error('object')
  expect(created.stateId).toBe(f.stateA)
  expect(f.view(f.stateA).entries.find(entry => entry.item.layerItemId === created.itemId)?.mounted).toBe(true)
  expect(f.view('state-b').entries.find(entry => entry.item.layerItemId === created.itemId)?.mounted).toBe(false)
  expect(f.view(null).entries.find(entry => entry.item.layerItemId === created.itemId)?.mounted).toBe(false)
  expect(f.view(f.stateA).entries.find(entry => entry.item.layerItemId === 'picture')?.mounted).toBe(false)
  expect(f.view(null).entries.find(entry => entry.item.layerItemId === 'picture')?.mounted).toBe(true)
  const after = f.session.read(), surface = project(after).surfaces.find(surface => surface.id === f.surface.id)!
  if (surface.type !== 'slide') throw new Error('slide')
  expect(surface.scenes[0].interactions).toHaveLength(f.scene.interactions.length + 1)
  expect(JSON.stringify(surface.scenes[0].interactions.at(-1))).toContain(created.itemId)
  expect(surface.scenes[0].presentation!.states[1]).toEqual(f.scene.presentation!.states[1])
  for (const item of f.scene.layerItems) expect(surface.scenes[0].layerItems.find(next => next.layerItemId === item.layerItemId)).toEqual(item)
  expect(after.undoDepth).toBe(1); expect(after.model.resources).toEqual(before.model.resources)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  applied(await f.invoke('delete-state-owned-copy', 'layer.delete', { target: result.affected[0] }))
  expect(f.view(f.stateA).entries.some(entry => entry.item.layerItemId === created.itemId)).toBe(false)
  expect(JSON.stringify(project(f.session.read()))).not.toContain(created.itemId)
  expect(f.session.read().undoDepth).toBe(2)
  await undo(f, 'undo-copy-delete'); expect(f.view(f.stateA).entries.some(entry => entry.item.layerItemId === created.itemId)).toBe(true)
  await undo(f); expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces)
})

it('routes named-state text/properties/image writes and inserted handles without changing base or another state', async () => {
  const f = await harness(), before = f.session.read(), text = await f.object('fixed-text'), picture = await f.object('picture')
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#00aacc' } }).png().toBuffer()
  const resource = await f.gateway.provideImage('r', f.session.documentId, { filename: 'new.png', mimeType: 'image/png', bytes })
  const result = applied(await f.invoke('content', 'batch', { operations: [
    { name: 'text.replace', input: { target: text, content: 'new A text' } },
    { name: 'object.update', input: { target: text, properties: { opacity: 0.4 } } },
    { name: 'media.apply', input: { target: picture, resource } },
    { name: 'native.insert', input: { target: await f.owner(), template: { nativeType: 'shape', shapeType: 'rectangle' } } },
  ] }))
  const item = f.view(f.stateA).entries.find(entry => entry.item.layerItemId === 'fixed-text')!.item
  expect(item).toMatchObject({ opacity: 0.4, content: { data: { text: 'new A text' } } })
  expect(f.view(null).entries.find(entry => entry.item.layerItemId === 'fixed-text')!.item).toMatchObject({ opacity: 1, content: { data: { text: 'base text' } } })
  expect(f.view('state-b').entries.find(entry => entry.item.layerItemId === 'fixed-text')!.item).toMatchObject({ content: { data: { text: 'base text' } } })
  expect((await f.gateway.resolveEditTarget('r', result.affected[3])).target).toMatchObject({ stateId: f.stateA })
  const after = f.session.read(); expect(after.undoDepth).toBe(1); expect(Object.keys(after.model.resources.assets).length).toBe(Object.keys(before.model.resources.assets).length + 1)
  expect(driver.load(driver.serialize(after.model))).toEqual(after.model)
  await undo(f); expect(project(f.session.read()).surfaces).toEqual(project(before).surfaces); expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('refuses base/other-state escapes, stale overrides and unsupported measurement without History while allowing disjoint other-state edits', async () => {
  const f = await harness(), text = await f.object('fixed-text'), auto = await f.object('auto-text'), base = await f.gateway.issueTarget('r', f.session.documentId, { kind: 'course-object', locationId: f.location.id, itemId: 'fixed-text' }), other = await f.object('fixed-text', 'state-b')
  for (const [id, target] of [['base', base], ['other', other]]) expect(await f.invoke(id, 'text.replace', { target, content: 'wrong' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('auto', 'text.replace', { target: auto, content: 'requires real measurement' })).toMatchObject({ kind: 'error', code: 'unsupported-measurement' })
  expect(await f.invoke('answer', 'input.answer', { target: text, answer: { answerType: 'text', answers: ['x'] } })).toMatchObject({ kind: 'error', code: 'unsupported-named-state-answer' })
  await expect(f.object('fixed-text', 'missing-state')).rejects.toThrow()
  expect(f.session.read().undoDepth).toBe(0)
  const before = f.session.read(), changed = structuredClone(project(before)), surface = changed.surfaces.find(surface => surface.id === f.surface.id)!
  if (surface.type !== 'slide') throw new Error('slide')
  surface.scenes[0].presentation!.states[1].layerItemOverrides['fixed-text'] = { opacity: 0.7 }
  await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-other-state', actor: 'human', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'course.replace', project: changed } } })
  applied(await f.invoke('disjoint', 'text.replace', { target: text, content: 'A after human B' }))
  expect(f.view('state-b').entries.find(entry => entry.item.layerItemId === 'fixed-text')!.item.opacity).toBe(0.7)
  expect(await f.invoke('stale', 'text.replace', { target: text, content: 'stale source' })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read().undoDepth).toBe(2)
})
