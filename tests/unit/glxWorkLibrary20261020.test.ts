import { expect, it } from 'vitest'
import type { ComponentLibraryEntry, LegacyComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { componentSurface } from '../../src/shared/contracts/component-platform/project'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { componentAssetIds, extractComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'

const blank = (): CourseProjectV10 => ({ schemaVersion: 11, id: 'destination', title: 'Destination', revision: 0,
  rootIds: [], definitions: {}, instances: {}, assets: {}, global: { underlay: [], overlay: [] } })
const program = (): CourseProjectV10 => ({ ...blank(), rootIds: ['program'], entry: { rootInstanceId: 'program' },
  definitions: { code: { id: 'code', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){return {update(){},dispose(){}}}}' } } },
  instances: { program: { id: 'program', definitionId: 'code', data: { title: 'Program' } } } })
const entry = (instances: ComponentLibraryEntry['example']['instances'], rootIds: string[], definitions: ComponentLibraryEntry['definitions']): ComponentLibraryEntry => ({
  schemaVersion: 2, id: 'library', title: 'Library', example: { instances, rootIds }, definitions, assets: {}, resources: { assets: {}, components: {} } })

it('copies nested containers with locally identical state IDs and one canonical ownership tree', () => {
  const source = blank()
  source.id = 'source'
  source.definitions = {
    flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
    spatial: { id: 'spatial', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } },
    slide: { id: 'slide', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
    text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } },
  }
  source.rootIds = ['flow']
  source.entry = { rootInstanceId: 'flow' }
  source.instances.flow = { id: 'flow', definitionId: 'flow', name: 'Reading', data: {}, childIds: ['left', 'right'], container: { kind: 'flow' } }
  for (const id of ['left', 'right']) {
    source.instances[id] = { id, definitionId: 'slide', data: {}, childIds: [`${id}-text`, `${id}-camera`], container: { kind: 'slide',
      presentation: { states: [{ id: 'overview', title: 'Overview', overrides: {} }, { id: 'detail', title: 'Detail', overrides: { [`${id}-text`]: { data: { text: id } } } }] } } }
    source.instances[`${id}-text`] = { id: `${id}-text`, definitionId: 'text', data: { text: id } }
    source.instances[`${id}-camera`] = { id: `${id}-camera`, definitionId: 'spatial', data: {}, childIds: [`${id}-camera-text`], container: { kind: 'spatial',
      spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'detail', pose: { x: 10, y: 10, zoom: 2 }, targetInstanceId: `${id}-camera-text` }] } } }
    source.instances[`${id}-camera-text`] = { id: `${id}-camera-text`, definitionId: 'text', data: { text: '镜头目标' } }
  }
  const extracted = extractComponentLibraryEntry(source, { assets: {}, components: {} }, { id: 'mixed', title: 'Mixed', surfaceIds: ['flow'], kind: 'page' })
  expect(extracted.entry.schemaVersion).toBe(2)
  expect(extracted.entry).not.toHaveProperty('surfaces')
  expect(extracted.entry.example.rootIds).toEqual(['flow'])
  const destination = program()
  const inserted = prepareComponentLibraryInsertion(destination, extracted.entry, { container: { kind: 'project' }, index: 1 })
  const result = applyComponentOperation(destination, inserted.command)
  expect(courseProjectV11Schema.safeParse(result).success).toBe(true)
  const left = inserted.identities.instances.get('left')!, right = inserted.identities.instances.get('right')!
  expect(left).not.toBe(right)
  for (const id of [left, right]) expect(componentSurface(result, id)?.presentation?.states.map(state => state.id)).toEqual(['overview', 'detail'])
  expect(result.instances[inserted.identities.instances.get('left-camera')!].container?.spatial?.frames[0].targetInstanceId).toBe(inserted.identities.instances.get('left-camera-text'))
  expect(result.instances[right].container?.presentation?.states[1].overrides).toHaveProperty(inserted.identities.instances.get('right-text')!)
  expect(destination.rootIds).toEqual(['program'])
})

it('reads a current library archive into container instances and writes only library V2', () => {
  const legacy: LegacyComponentLibraryEntry = { schemaVersion: 1, id: 'legacy', title: 'Legacy',
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } } },
    example: { instances: { text: { id: 'text', definitionId: 'text', data: { text: 'kept' } },
      global: { id: 'global', definitionId: 'text', data: { text: 'overlay' } } }, rootIds: ['text', 'global'] },
    surfaces: [{ id: 'page', kind: 'slide', title: 'Original page', childIds: ['text'] }],
    global: { underlay: [], overlay: ['global'] }, assets: {}, resources: { assets: {}, components: {} } }
  const result = importComponentLibraryArchive(exportComponentLibraryArchive(legacy)).entry
  expect(result.schemaVersion).toBe(2)
  expect(result).not.toHaveProperty('surfaces')
  expect(result.example.rootIds).toEqual(['page'])
  expect(result.example.instances.page.childIds).toEqual(['text'])
  expect(result.global?.overlay).toEqual(['global'])
  expect(legacy.example.instances).not.toHaveProperty('page')
})

it('places the same container asset at a work root or explicitly inside another container', () => {
  const destination = blank()
  destination.rootIds = ['flow']
  destination.entry = { rootInstanceId: 'flow' }
  destination.definitions.flow = { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
  destination.instances.flow = { id: 'flow', definitionId: 'flow', data: {}, childIds: [], container: { kind: 'flow' } }
  const asset = entry({ spatial: { id: 'spatial', definitionId: 'spatial', data: {}, childIds: [], container: { kind: 'spatial' } } }, ['spatial'],
    { spatial: { id: 'spatial', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } } })
  asset.kind = 'page'
  const local = prepareComponentLibraryInsertion(destination, asset, { container: { kind: 'instance', instanceId: 'flow' }, index: 0, placement: 'local' })
  const localResult = applyComponentOperation(destination, local.command)
  expect(localResult.rootIds).toEqual(['flow'])
  expect(localResult.instances.flow.childIds).toEqual(local.rootIds)
  const root = prepareComponentLibraryInsertion(destination, asset, { container: { kind: 'instance', instanceId: 'flow' }, index: 0 })
  expect(applyComponentOperation(destination, root.command).rootIds).toEqual(['flow', ...root.rootIds])
})

it('consumes background and transition roles in real placement and navigation edits', () => {
  const destination = program()
  destination.definitions.navigation = { id: 'navigation', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } }
  destination.instances.navigation = { id: 'navigation', definitionId: 'navigation', data: { buttons: [{ id: 'next', label: 'Next', action: { type: 'step.next' } }] } }
  destination.global.overlay.push('navigation')
  const background = entry({ background: { id: 'background', definitionId: 'background', data: {} } }, ['background'],
    { background: { id: 'background', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } })
  background.usage = { kind: 'background', host: 'any', placement: 'underlay' }
  const added = prepareComponentLibraryInsertion(destination, background, { container: { kind: 'project' }, index: 1 })
  const withBackground = applyComponentOperation(destination, added.command)
  expect(withBackground.global.underlay).toEqual(added.rootIds)
  expect(withBackground.instances[added.rootIds[0]].style?.pointerEvents).toBe('none')
  expect(withBackground.rootIds).toEqual(['program'])
  const transition = entry({}, [], {})
  transition.usage = { kind: 'transition', host: 'navigation', transition: { effect: 'fade', durationMs: 180 } }
  const attached = prepareComponentLibraryInsertion(withBackground, transition, { container: { kind: 'project' }, index: 0, targetBindings: { navigation: 'navigation' } })
  expect(attached.command.edits).toEqual([{ type: 'data.set', instanceId: 'navigation', path: ['buttons', '0', 'action', 'transition'], value: transition.usage.transition }])
  const result = applyComponentOperation(withBackground, attached.command)
  expect(result.instances.navigation.data).toMatchObject({ buttons: [{ action: { type: 'step.next', transition: { effect: 'fade', durationMs: 180 } } }] })
  expect(() => prepareComponentLibraryInsertion(destination, transition, { container: { kind: 'project' }, index: 0 })).toThrow('导航控件')
})

it('captures the actual mapped source baseline and retains resources across extraction and insertion', () => {
  const asset = entry({ code: { id: 'code', definitionId: 'code', data: {} } }, ['code'], {
    code: { id: 'code', role: 'content', dataSchema: { type: 'object' }, implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'source', entry: 'main.js' } } },
  })
  asset.resources.components.source = { 'main.js': new TextEncoder().encode('export default { mount() { return { update() {}, dispose() {} } } }') }
  const inserted = prepareComponentLibraryInsertion(program(), asset, { container: { kind: 'project' }, index: 1 })
  const definition = inserted.command.edits.find(edit => edit.type === 'definition.set')
  if (definition?.type !== 'definition.set') throw new Error('Expected definition')
  expect(definition.definition.library?.baseline?.implementation).toEqual(definition.definition.implementation)
  expect(definition.definition.library?.baseline?.sourceFiles?.['main.js']).toContain('mount()')
  expect(definition.definition.implementation.kind === 'source' && definition.definition.implementation.workspace?.ownerId).not.toBe('source')
  expect(new TextDecoder().decode(asset.resources.components.source['main.js'])).toBe('export default { mount() { return { update() {}, dispose() {} } } }')
})

it('keeps container and state-authoring resources in the shared dependency closure', () => {
  const project = blank()
  project.definitions.container = { id: 'container', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }
  project.definitions.content = { id: 'content', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } }
  project.rootIds = ['container']
  project.instances.container = { id: 'container', definitionId: 'container', data: {}, childIds: ['content'], container: {
    kind: 'slide', background: { mode: 'own', assetId: 'background' }, presentation: { states: [{ id: 'detail', title: 'Detail', overrides: {
      content: { authoring: { resourceBindings: { image: 'state-resource' } } },
    } }] },
  } }
  project.instances.content = { id: 'content', definitionId: 'content', data: {} }
  expect(componentAssetIds(project.instances.container, project.definitions.container, project, { assets: {}, components: {} }).sort())
    .toEqual(['background', 'state-resource'])
})
