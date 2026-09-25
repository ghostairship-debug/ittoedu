// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { planNativeInsertion } from '../../src/core/tools/nativeInsertion'
import { addCourseFlowPage, addCourseSpatialPage, addCourseSlidePage, renameCourseSurface } from '../../src/core/tools/courseLocations'
import { PublishedInteractionController } from '../../src/player/interactions/PublishedInteractionController'
import { CourseStateStore } from '../../src/player/CourseStateStore'
import { inspectInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
function applied(r: ToolResult) { expect(r, JSON.stringify(r)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (r.kind !== 'document-operation') throw new Error('ACK'); return r }
function fixture() { return driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }> }
async function harness(model = fixture(), scope: ToolTarget[] = [{ kind: 'document' }]) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'pages.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: scope }] })
  return { model, session, gateway, issue: (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }), project: () => (session.read().model as typeof model).project,
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }), undo: async (operationId = 'undo') => { const s = session.read(); await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId, actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } }) } }
}

it('creates all three real surface formats atomically and undoes resources/navigation/print data with original-format reopen', async () => {
  const f = await harness(), doc = await f.issue({ kind: 'document' })
  const result = applied(await f.invoke('three-surfaces', 'batch', { operations: ['slide', 'flow', 'spatial-2d'].map(surfaceType => ({ name: 'course.navigation', input: { target: doc, operation: 'add-surface', surfaceType, title: `New ${surfaceType}` } })) }))
  expect(f.project().surfaces).toHaveLength(4); expect(f.project().mixedPrintPlan!.entries).toHaveLength(4)
  for (const handle of result.affected) expect((await f.gateway.resolveEditTarget('r', handle)).target.kind).toBe('course-location')
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(f.model.resources)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(f.model.project.surfaces); expect(f.project().locations).toEqual(f.model.project.locations)
})

it('duplicates Slide tables/charts/input families with independent identities and functioning Published judgement, then undoes once', async () => {
  const model = fixture(), location = model.project.locations.find(location => location.kind === 'slide-scene')!
  let id = 0
  for (const nativeType of ['table', 'chart', 'input'] as const) model.project = planNativeInsertion(model.project, { kind: 'course-owner', owner: 'scene', locationId: location.id }, { nativeType }, () => `factory-${++id}`).project
  const surface = model.project.surfaces.find(surface => surface.id === location.surfaceId)!
  if (surface.type !== 'slide') throw new Error('slide')
  const source = surface.scenes[0], sourceInput = source.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'input')!
  const f = await harness(model), target = await f.issue({ kind: 'course-location', locationId: location.id }), owner = await f.issue({ kind: 'course-surface', surfaceId: surface.id })
  const result = applied(await f.invoke('copy-page', 'slide.duplicate', { target, surface: owner }))
  const newTarget = (await f.gateway.resolveEditTarget('r', result.affected[0])).target
  if (newTarget.kind !== 'course-location') throw new Error('location')
  const afterSurface = f.project().surfaces.find(s => s.id === surface.id)!
  if (afterSurface.type !== 'slide') throw new Error('slide')
  const copy = afterSurface.scenes[1]
  expect(copy.layerItems).toHaveLength(source.layerItems.length)
  expect(copy.layerItems.every(item => !source.layerItems.some(before => before.layerItemId === item.layerItemId))).toBe(true)
  for (const nativeType of ['table', 'chart'] as const) {
    const before = source.layerItems.find(item => item.kind === 'native' && item.content.nativeType === nativeType)!, after = copy.layerItems.find(item => item.kind === 'native' && item.content.nativeType === nativeType)!
    if (before.kind !== 'native' || after.kind !== 'native') throw new Error('native')
    expect(after.content.data).not.toEqual(before.content.data); expect(after.frame).toEqual(before.frame)
  }
  const input = copy.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'input')!
  if (input.kind !== 'native' || input.content.nativeType !== 'input' || sourceInput.kind !== 'native' || sourceInput.content.nativeType !== 'input') throw new Error('input')
  const data = input.content.data, original = sourceInput.content.data
  expect(data.stateKey).not.toBe(original.stateKey); expect(data.validityKey).not.toBe(original.validityKey)
  expect(data.ruleFamilyRuleIds.every(id => copy.interactions.some(rule => rule.id === id))).toBe(true)
  const family = inspectInputRuleFamily(input.layerItemId, data, copy.interactions).config!
  expect(family).toBeTruthy()
  const state = new CourseStateStore(), motions: { type: string; nodeId: string }[] = []; let submit: ((value: string) => void) | undefined
  const controller = new PublishedInteractionController({ surfaceId: surface.id, rules: copy.interactions,
    surface: { bindNodeClick: () => null, executeNodeMotion: action => { motions.push(action); return true }, describeInput: itemId => itemId === input.layerItemId ? { answerType: data.answerType, stateKey: data.stateKey, validityKey: data.validityKey, defaultValue: '' } : null, bindInputSubmit: (_id, listener) => { submit = listener; return () => { submit = undefined } } },
    session: { courseState: state, setCourseStateBatch: entries => state.setMany(entries), currentSceneId: () => copy.id, goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false } })
  submit!('wrong')
  await vi.waitFor(() => expect(motions).toEqual(family.error.map(action => expect.objectContaining(action))))
  expect(state.get(data.validityKey)).toBe(true); expect(state.get(data.stateKey)).toBe('wrong'); expect(state.get(original.stateKey)).toBeUndefined(); controller.destroy()
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(model.resources)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(model.project.surfaces); expect(f.project().courseState).toEqual(model.project.courseState)
})

it('reorders/renames/deletes precise surfaces and scenes while rejecting last-page loss, wrong owner and stale destructive handles', async () => {
  const model = fixture(); const flow = addCourseFlowPage(model.project); if (!flow.ok) throw new Error(flow.reason); model.project = flow.project
  const spatial = addCourseSpatialPage(model.project); if (!spatial.ok) throw new Error(spatial.reason); model.project = spatial.project
  const f = await harness(model), surfaces = model.project.surfaces, doc = await f.issue({ kind: 'document' }), owner = await f.issue({ kind: 'course-surface', surfaceId: surfaces[0].id })
  const created = applied(await f.invoke('scene-new', 'slide.create', { target: owner, title: 'Second scene' }))
  const surface = f.project().surfaces[0]; if (surface.type !== 'slide') throw new Error('slide')
  const locations = f.project().locations.filter(location => location.surfaceId === surface.id)
  const freshOwner = await f.issue({ kind: 'course-surface', surfaceId: surface.id }), first = await f.issue({ kind: 'course-location', locationId: locations[0].id })
  expect(await f.invoke('wrong-surface', 'slide.duplicate', { target: first, surface: await f.issue({ kind: 'course-surface', surfaceId: surfaces[1].id }) })).toMatchObject({ kind: 'error' })
  applied(await f.invoke('order-rename', 'batch', { operations: [{ name: 'slide.reorder', input: { target: freshOwner, locations: [created.affected[0], first] } }, { name: 'course.navigation', input: { operation: 'rename-location', target: created.affected[0], title: 'Renamed scene' } }] }))
  expect(f.project().locations[0].id).toBe(locations[1].id)
  expect(f.project().startLocationId).toBe(locations[1].id)
  expect(await f.invoke('stale-delete', 'course.navigation', { operation: 'delete-location', target: created.affected[0] })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  const all = await Promise.all(surfaces.map(surface => f.issue({ kind: 'course-surface', surfaceId: surface.id })))
  applied(await f.invoke('surface-order-delete', 'batch', { operations: [{ name: 'course.navigation', input: { operation: 'reorder-surfaces', target: await f.issue({ kind: 'document' }), surfaces: [...all].reverse() } }, { name: 'surface.delete', input: { target: all[1] } }] }))
  expect(f.project().surfaces.map(surface => surface.id)).toEqual([surfaces[2].id, surfaces[0].id])
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  const limited = await harness(fixture()), only = await limited.issue({ kind: 'course-surface', surfaceId: limited.project().surfaces[0].id })
  expect(await limited.invoke('last-surface', 'surface.delete', { target: only })).toMatchObject({ kind: 'error' }); expect(limited.session.read().undoDepth).toBe(0)
})

it('moves the last scene across Slide surfaces with stable identities, exact rename schema, resource preservation and one undo', async () => {
  const model = fixture(), added = addCourseSlidePage(model.project, { title: 'Destination' }); if (!added.ok) throw new Error(added.reason); model.project = added.project
  const before = structuredClone(model), f = await harness(model), source = model.project.surfaces[0], destination = model.project.surfaces[1], location = model.project.locations.find(location => location.surfaceId === source.id)!
  const target = await f.issue({ kind: 'course-location', locationId: location.id }), destinationHandle = await f.issue({ kind: 'course-surface', surfaceId: destination.id })
  const title = '命名'.repeat(100)
  const renamed = renameCourseSurface(model.project, destination.id, ` ${title} `)
  expect(renamed.surfaces[1].title).toBe(title)
  applied(await f.invoke('rename-move', 'batch', { operations: [{ name: 'surface.rename', input: { target: destinationHandle, name: ` ${title} ` } }, { name: 'slide.move', input: { target, destination: destinationHandle, index: 0 } }] }))
  expect(f.project().surfaces).toHaveLength(1); expect(f.project().surfaces[0].id).toBe(destination.id); expect(f.project().surfaces[0].title).toBe(title)
  expect(f.project().locations.find(entry => entry.id === location.id)).toMatchObject({ surfaceId: destination.id })
  const surface = f.project().surfaces[0]; if (source.type !== 'slide' || surface.type !== 'slide') throw new Error('slide')
  expect(surface.scenes[0]).toEqual(source.scenes[0]); expect(f.project().startLocationId).toBe(location.id)
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(before.resources)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(before.project.surfaces); expect(f.project().locations).toEqual(before.project.locations); expect(f.project().mixedPrintPlan).toEqual(before.project.mixedPrintPlan)
})

it('refuses unauthorized destinations, non-Slide moves and stale source contents without partial title or history changes', async () => {
  const model = fixture(), added = addCourseFlowPage(model.project); if (!added.ok) throw new Error(added.reason); model.project = added.project
  const source = model.project.surfaces[0], destination = model.project.surfaces[1], location = model.project.locations.find(location => location.surfaceId === source.id)!
  const f = await harness(model), target = await f.issue({ kind: 'course-location', locationId: location.id }), destinationHandle = await f.issue({ kind: 'course-surface', surfaceId: destination.id })
  expect(await f.invoke('readonly-move', 'slide.move', { target, destination: await f.issue({ kind: 'course-surface', surfaceId: destination.id }, true) })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('invalid-batch', 'batch', { operations: [{ name: 'surface.rename', input: { target: destinationHandle, name: 'Uncommitted' } }, { name: 'slide.move', input: { target, destination: destinationHandle } }] })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('bad-name', 'surface.rename', { target: destinationHandle, name: 'x'.repeat(501) })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(f.session.read().undoDepth).toBe(0); expect(f.project().surfaces).toEqual(model.project.surfaces)
  const current = f.session.read(), human = structuredClone(model.project), humanSource = human.surfaces[0]
  if (humanSource.type !== 'slide') throw new Error('slide')
  humanSource.scenes[0].name = 'Human edit'
  await f.session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'human-content', actor: 'human', baseRevision: current.revision, mutation: { type: 'command', command: { type: 'course.replace', project: human } } })
  expect(await f.invoke('stale-source', 'slide.move', { target, destination: destinationHandle })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read().undoDepth).toBe(1)
})
