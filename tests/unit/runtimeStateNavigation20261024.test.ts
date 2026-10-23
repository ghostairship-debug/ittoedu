import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentRuntimeContext, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'

const worlds: ComponentRuntimeWorld[] = [], owners: ComponentNavigationOwner[] = []
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.dispose())); owners.splice(0).forEach(owner => owner.dispose()) })

async function harness() {
  let project: CourseProjectV10 = { schemaVersion: 11, id: 'state-navigation', revision: 0, title: 'State', rootIds: ['flow', 'next'],
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      observer: { id: 'observer', role: 'behavior', implementation: { kind: 'builtin', key: 'test.observer' } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: [] },
      next: { id: 'next', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: [] },
      observer: { id: 'observer', definitionId: 'observer', data: {} } }, assets: {}, global: { underlay: ['observer'], overlay: [] },
    logic: { courseState: [{ key: 'gate', valueType: 'boolean', defaultValue: false }], navigationGuards: [{ id: 'guard', effect: 'block',
      toSurfaceIds: ['next'], match: 'all', conditions: [{ type: 'compare', key: 'gate', operator: 'eq', value: false }], message: 'Not yet' }] } }
  let world!: ComponentRuntimeWorld, context!: ComponentRuntimeContext
  const owner = new ComponentNavigationOwner({ project: () => project, surfaceId: () => 'flow', select: () => true,
    courseState: { get: key => world?.getState(key) as never } })
  owners.push(owner)
  const readReading = vi.fn(() => ({ activeInstanceId: null, progress: 0 }))
  owner.registerObservation('flow', { readZoom: () => 1, setZoom() {}, reset() {}, readReading })
  world = new ComponentRuntimeWorld('state-navigation', { teacherController: owner.teacherPort(), studentNavigation: owner,
    builtins: new Map([['test.observer', { mount(value: ComponentRuntimeContext) { context = value; return { update() {}, dispose() {} } } }]]) })
  worlds.push(world)
  await world.sync(project, { assets: {}, components: {} })
  return { world, owner, context, readReading, replace(next: CourseProjectV10) { project = next }, project: () => project }
}

it('keeps runtime state deliveries and isolation without re-entering Flow/navigation on unrelated measurement writes', async () => {
  const run = await harness(), notified = vi.fn(), exact = vi.fn(), all = vi.fn()
  run.owner.subscribe(notified)
  run.context.scope.state.subscribe('measurement', exact)
  run.context.scope.events.subscribe('__runtime.state', all)
  run.readReading.mockClear()
  const source = { x: 10, y: 20 }
  run.context.scope.state.set('measurement', source)
  source.x = 99
  run.context.scope.state.set('measurement', { x: 11, y: 21 })
  expect(exact.mock.calls).toEqual([[{ x: 10, y: 20 }], [{ x: 11, y: 21 }]])
  expect(all).toHaveBeenCalledTimes(2)
  expect(run.world.getState('measurement')).toEqual({ x: 11, y: 21 })
  expect(notified).not.toHaveBeenCalled()
  expect(run.readReading).not.toHaveBeenCalled()
})

it('still notifies and immediately reevaluates navigation guards, including changed guard dependencies', async () => {
  const run = await harness(), notified = vi.fn()
  run.owner.subscribe(notified)
  expect(run.owner.canExecute({ type: 'scene.next' })).toBe(false)
  run.context.scope.state.set('gate', true)
  expect(notified).toHaveBeenCalledOnce()
  expect(run.owner.canExecute({ type: 'scene.next' })).toBe(true)
  const current = run.project()
  run.replace({ ...current, revision: 1, logic: { ...current.logic!, navigationGuards: [{ ...current.logic!.navigationGuards[0],
    conditions: [{ type: 'exists', key: 'newGate', exists: false }] }] } })
  await run.world.sync(run.project(), { assets: {}, components: {} })
  notified.mockClear()
  run.context.scope.state.set('gate', false)
  expect(notified).not.toHaveBeenCalled()
  expect(run.owner.canExecute({ type: 'scene.next' })).toBe(false)
  run.context.scope.state.set('newGate', 'ready')
  expect(notified).toHaveBeenCalledOnce()
  expect(run.owner.canExecute({ type: 'scene.next' })).toBe(true)
})
