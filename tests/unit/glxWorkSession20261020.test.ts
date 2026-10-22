// @vitest-environment node
import { expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { migrateCourseProjectV10 } from '../../src/shared/contracts/component-platform/workProjectMigration'
import { componentSurface, owningContainer } from '../../src/shared/contracts/component-platform/project'
import { applyComponentOperation, beginComponentOperationPlanning, captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import type { InteractionRule, InteractionActionPayload } from '../../src/shared/interactionTypes'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'

const legacy = () => ({ schemaVersion: 10, id: 'work', revision: 7, title: 'Existing work',
  definitions: { content: { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'text' } } },
  instances: { title: { id: 'title', definitionId: 'content', data: { text: 'Original' } },
    second: { id: 'second', definitionId: 'content', data: { text: 'Second' } } },
  surfaces: [{ id: 'one', kind: 'slide', title: 'One', childIds: ['title'], presentation: { states: [
    { id: 'detail', title: 'Detail', overrides: { title: { visible: true } } }] } },
  { id: 'two', kind: 'slide', title: 'Two', childIds: ['second'], presentation: { states: [
    { id: 'detail', title: 'Detail', overrides: { second: { visible: true } } }] } }],
  global: { underlay: [], overlay: [] }, assets: {} })

it('maps existing surface commands directly to canonical containers and preserves field CAS', () => {
  const project = migrateCourseProjectV10(legacy()), original = structuredClone(project)
  const camera = { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
  const command = captureComponentOperation(project, [
    { type: 'surface.insert', index: 1, surface: { id: 'world', kind: 'spatial', title: 'World', childIds: [], spatial: camera } },
    { type: 'instance.insert', container: { kind: 'surface', surfaceId: 'world' }, index: 0,
      instances: [{ id: 'world-title', definitionId: 'content', data: { text: 'World title' } }], rootIds: ['world-title'] },
    { type: 'surface.title.set', surfaceId: 'world', title: 'Renamed' },
  ])
  const next = applyComponentOperation(project, command)
  expect(next.rootIds).toEqual(['one', 'world', 'two'])
  expect(next.instances.world).toMatchObject({ name: 'Renamed', childIds: ['world-title'], container: { kind: 'spatial', spatial: camera } })
  expect(owningContainer(next, 'world')).toEqual({ kind: 'project' })
  expect(owningContainer(next, 'world-title')).toEqual({ kind: 'instance', instanceId: 'world' })
  expect(Object.hasOwn(next, 'surfaces')).toBe(false)
  expect(project).toEqual(original)

  const stale = captureComponentOperation(next, [{ type: 'spatial.set', surfaceId: 'world', spatial: { ...camera, home: { ...camera.home, zoom: 2 } } }])
  const independent = applyComponentOperation(next, captureComponentOperation(next, [{ type: 'data.set', instanceId: 'title', path: ['text'], value: 'Independent' }]))
  expect(applyComponentOperation(independent, stale).instances.world.container?.spatial?.home.zoom).toBe(2)
  const changed = applyComponentOperation(independent, captureComponentOperation(independent, [{ type: 'spatial.set', surfaceId: 'world', spatial: { ...camera, home: { ...camera.home, zoom: 3 } } }]))
  expect(() => applyComponentOperation(changed, stale)).toThrow('变化')
})

it('keeps local presentation edits on the owned container and retains shared text', () => {
  const project = migrateCourseProjectV10(legacy())
  const stateEdits = presentationComponentEdits(project, 'one', 'detail', [{ type: 'instance.patch', instanceId: 'title', patch: { visible: false } }])
  const next = applyComponentOperation(project, captureComponentOperation(project, stateEdits))
  expect(next.instances.title.visible).toBeUndefined()
  expect(next.instances.one.container?.presentation?.states[0].overrides.title.visible).toBe(false)
  expect(next.instances.two.container?.presentation?.states[0].overrides.second.visible).toBe(true)
  const title = applyComponentOperation(next, captureComponentOperation(next, [{ type: 'data.set', instanceId: 'title', path: ['text'], value: 'Shared' }]))
  expect(title.instances.title.data).toEqual({ text: 'Shared' })
})

it('cleans presentation actions by their explicit sibling target before the behavior default range', () => {
  const project = migrateCourseProjectV10(legacy())
  project.definitions.interactions = { id: 'interactions', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  const rule = (id: string, action: InteractionActionPayload): InteractionRule => ({ id, enabled: true,
    trigger: { type: 'node.click', nodeId: 'title' }, conditions: [],
    actions: [{ id: `${id}-action`, start: 'after-previous', delayMs: 0, action }] })
  const rules = [rule('to-sibling', { type: 'presentation.set', containerId: 'two', stateId: 'detail' }),
    rule('default-local', { type: 'presentation.set', stateId: 'detail' }),
    rule('explicit-local', { type: 'presentation.set', containerId: 'one', stateId: 'detail' })]
  project.instances.behavior = { id: 'behavior', definitionId: 'interactions', data: { rules } as unknown as JsonValue,
    attachments: [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: 'one' } }] }
  project.instances.one.childIds!.push('behavior')
  const remaining = (value: typeof project) => (value.instances.behavior.data as unknown as { rules: InteractionRule[] }).rules.map(value => value.id)

  const removeLocal = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'surface.presentation.set', surfaceId: 'one', presentation: { states: [] } },
  ]))
  expect(remaining(removeLocal)).toEqual(['to-sibling'])
  expect(removeLocal.instances.two.container?.presentation?.states[0].id).toBe('detail')

  const removeSibling = captureComponentOperation(project, [
    { type: 'container.patch', instanceId: 'two', patch: { presentation: { states: [] } } },
  ])
  expect(remaining(applyComponentOperation(project, removeSibling))).toEqual(['default-local', 'explicit-local'])
  const concurrent = structuredClone(project)
  concurrent.instances.behavior.data = { rules: [...rules, rule('new-action', { type: 'scene.next' })] } as unknown as JsonValue
  expect(() => applyComponentOperation(concurrent, removeSibling)).toThrow('变化')
})

it('handles nested container configuration, root entry removal and locked source content without a second tree', () => {
  const project = migrateCourseProjectV10(legacy())
  const nested = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'instance.insert', container: { kind: 'instance', instanceId: 'one' }, index: 1,
      instances: [{ id: 'local', definitionId: project.instances.two.definitionId, data: {}, childIds: [], container: { kind: 'slide' } }], rootIds: ['local'] },
    { type: 'container.patch', instanceId: 'local', patch: { presentation: { states: [{ id: 'detail', title: 'Local detail', overrides: {} }] } } },
  ]))
  expect(componentSurface(nested, 'local')?.presentation?.states[0].id).toBe('detail')
  expect(owningContainer(nested, 'local')).toEqual({ kind: 'instance', instanceId: 'one' })
  const locked = applyComponentOperation(nested, captureComponentOperation(nested, [{ type: 'instance.patch', instanceId: 'title', patch: { locked: true } }]))
  expect(() => applyComponentOperation(locked, captureComponentOperation(locked, [{ type: 'surface.remove', surfaceId: 'one' }]))).toThrow('锁定')
  const removed = applyComponentOperation(nested, captureComponentOperation(nested, [{ type: 'surface.remove', surfaceId: 'one' }]))
  expect(removed.rootIds).toEqual(['two'])
  expect(removed.entry).toEqual({ rootInstanceId: 'two' })
  expect(removed.instances.local).toBeUndefined()
})

it('does not advance a planning batch after invalid entry or stale fields', () => {
  const project = migrateCourseProjectV10(legacy()), planning = beginComponentOperationPlanning(project)
  const first = planning.apply(captureComponentOperation(project, [{ type: 'project.title.set', title: 'Planned' }]), { assets: {}, components: {} })
  expect(() => planning.apply(captureComponentOperation(first, [{ type: 'project.entry.set', entry: { rootInstanceId: 'title' } }]), { assets: {}, components: {} })).toThrow('顶层')
  const next = planning.apply(captureComponentOperation(first, [{ type: 'project.title.set', title: 'Still available' }]), { assets: {}, components: {} })
  expect(next.title).toBe('Still available')
  expect(next.entry).toEqual(project.entry)
})

it('opens a V10 archive once, then serializes only the canonical Project 11 author model', () => {
  const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(legacy())) })
  const opened = openCourseProjectV10Archive(bytes)
  expect(opened.project.schemaVersion).toBe(11)
  expect(opened.project.instances.one.container?.kind).toBe('slide')
  const output = createCourseProjectV10Archive(opened)
  const persisted = JSON.parse(strFromU8(unzipSync(output)['project.json']))
  expect(persisted.schemaVersion).toBe(11)
  expect(persisted.rootIds).toEqual(['one', 'two'])
  expect(persisted).not.toHaveProperty('surfaces')
  expect(openCourseProjectV10Archive(output).project).toEqual(opened.project)
})
