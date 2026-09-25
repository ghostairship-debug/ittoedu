// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { openSlideAuthoringSession, renameSlidePresentationState } from '../../src/renderer/course/slideAuthoringBackend'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
const applied = (r: ToolResult) => { expect(r, JSON.stringify(r)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (r.kind !== 'document-operation') throw new Error('ACK'); return r }
function fixture() {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const surface = model.project.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('slide')
  const scene = surface.scenes[0], location = model.project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === scene.id)!
  scene.presentation = { initialStateId: 'a', thumbnailStateId: 'a', states: [{ id: 'a', name: 'A', layerItemOverrides: {} }, { id: 'b', name: 'B', layerItemOverrides: {} }] }
  if (location.kind === 'slide-scene') location.stateId = 'a'
  scene.interactions.push({ id: 'state-enter', enabled: true, name: 'State enter', trigger: { type: 'presentation.enter', stateId: 'a' }, conditions: [], actions: [{ id: 'state-enter-action', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'b' } }] })
  model.project.globalInteractions.push({ id: 'external-state', enabled: true, name: 'Go', trigger: { type: 'presenter.command', command: 'next' }, conditions: [], actions: [{ id: 'external-state-action', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: scene.id, targetStateId: 'a' } }] })
  surface.scenes.push({ ...structuredClone(scene), id: 'other-scene', name: 'Other', layerItems: [], interactions: [], presentation: { initialStateId: 'other-a', states: [{ id: 'other-a', name: 'Other A', layerItemOverrides: {} }] } })
  model.project.locations.push({ id: 'other-location', label: 'Other', kind: 'slide-scene', surfaceId: surface.id, sceneId: 'other-scene' })
  return { model, surface, scene, location }
}
async function harness(scope?: (v: ReturnType<typeof fixture>) => ToolTarget[]) {
  const v = fixture(); let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(v.model, 'states.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  const ownerTarget: ToolTarget = { kind: 'course-owner', owner: 'scene', locationId: v.location.id }
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: scope?.(v) ?? [ownerTarget] }] })
  const project = () => (session.read().model as typeof v.model).project
  const scene = () => { const s = project().surfaces.find(surface => surface.id === v.surface.id)!; if (s.type !== 'slide') throw new Error('slide'); return s.scenes[0] }
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly })
  return { ...v, session, gateway, project, currentScene: scene, issue, owner: () => issue(ownerTarget), state: (stateId: string) => issue({ kind: 'course-state', locationId: v.location.id, stateId }), invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }), undo: async () => { const s = session.read(); await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId: 'undo', actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } }) } }
}

it('creates, renames and reorders states from explicit handles in one History, then copies state with separate owner authority and preserves resources/reopen', async () => {
  const f = await harness(), owner = await f.owner(), a = await f.state('a'), b = await f.state('b')
  const children = await f.gateway.execute('r', 'children', { name: 'listChildren', input: { target: owner } })
  expect(children).toMatchObject({ kind: 'read' }); if (children.kind !== 'read') throw new Error('read')
  expect((children.data as { kind: string }[]).filter(child => child.kind === 'course-state')).toHaveLength(2)
  const result = applied(await f.invoke('state-batch', 'batch', { operations: [{ name: 'state.rename', input: { target: a, name: '  Renamed  ' } }, { name: 'state.reorder', input: { target: owner, states: [b, a] } }, { name: 'state.create', input: { target: owner, name: 'New' } }] }))
  expect(f.currentScene().presentation!.states.map(s => s.name)).toEqual(['B', 'Renamed', 'New'])
  expect((await f.gateway.resolveEditTarget('r', result.affected[2])).target.kind).toBe('course-state')
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(f.model.resources)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(f.model.project.surfaces)
  const duplicate = applied(await f.invoke('duplicate', 'state.duplicate', { target: await f.state('a'), owner: await f.owner() }))
  expect(f.currentScene().presentation!.states.map(s => s.name)).toEqual(['A', 'A 副本', 'B'])
  expect((await f.gateway.resolveEditTarget('r', duplicate.affected[0])).target).toMatchObject({ kind: 'course-state', locationId: f.location.id })
})

it('deletes a state with navigation and cross-scene target cleanup, refuses last-state deletion atomically, and undoes all derived changes', async () => {
  const f = await harness(), before = f.session.read()
  applied(await f.invoke('delete-a', 'state.delete', { target: await f.state('a') }))
  expect(f.currentScene().presentation).toMatchObject({ initialStateId: 'b', thumbnailStateId: 'b', states: [{ id: 'b' }] })
  expect(f.currentScene().interactions.some(rule => rule.id === 'state-enter')).toBe(false)
  expect(f.project().locations.find(location => location.id === f.location.id)).not.toHaveProperty('stateId')
  expect(f.project().globalInteractions.find(rule => rule.id === 'external-state')!.actions[0].action).not.toHaveProperty('targetStateId')
  expect(await f.invoke('last', 'batch', { operations: [{ name: 'state.rename', input: { target: await f.state('b'), name: 'Uncommitted' } }, { name: 'state.delete', input: { target: await f.state('b') } }] })).toMatchObject({ kind: 'error' })
  expect(f.currentScene().presentation!.states[0].name).toBe('B'); expect(f.session.read().undoDepth).toBe(1)
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().surfaces).toEqual(f.model.project.surfaces); expect(f.project().locations).toEqual(f.model.project.locations); expect(f.project().globalInteractions).toEqual(f.model.project.globalInteractions); expect(f.session.read().model.resources).toEqual(before.model.resources)
})

it('preserves unrelated page edits, matches the manual rename planner and rejects stale or widened state authority', async () => {
  const f = await harness(v => [{ kind: 'course-state', locationId: v.location.id, stateId: 'a' }]), a = await f.state('a'), owner = await f.owner()
  expect(await f.invoke('escape', 'state.duplicate', { target: a, owner })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const before = f.session.read(), human = structuredClone(f.model.project), surface = human.surfaces.find(surface => surface.id === f.surface.id)!
  if (surface.type !== 'slide') throw new Error('slide')
  surface.scenes[1].name = 'Human other page'
  await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human', actor: 'human', baseRevision: before.revision, mutation: { type: 'command', command: { type: 'course.replace', project: human } } })
  const manual = renameSlidePresentationState(openSlideAuthoringSession(f.project(), { locationId: f.location.id }), 'a', '  Same manual  ')
  expect(manual.ok).toBe(true)
  applied(await f.invoke('rename', 'state.rename', { target: a, name: '  Same manual  ' }))
  expect(f.project().surfaces).toEqual(manual.nextSession!.history.present.surfaces)
  expect(await f.invoke('stale', 'state.rename', { target: a, name: 'Lost update' })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  const fresh = await f.state('a')
  expect(await f.invoke('noop', 'state.rename', { target: fresh, name: '   ' })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  expect(f.session.read().undoDepth).toBe(2)
})
