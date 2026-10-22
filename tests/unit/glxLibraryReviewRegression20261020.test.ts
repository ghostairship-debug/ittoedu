import { expect, it } from 'vitest'
import type { ComponentLibraryEntry, LegacyComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { isComponentVisibleAtSurface } from '../../src/shared/contracts/component-platform/project'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { extractComponentLibraryEntry, normalizeComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { builtInWorkAsset } from '../../src/core/components/library/workAssets'
import { componentDefinitionHasLocalSourceChanges } from '../../src/core/components/library/updateSource'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'

const destination = (): CourseProjectV10 => ({ schemaVersion: 11, id: 'destination', title: 'Destination', revision: 0,
  definitions: { page: { id: 'page', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
    fixture: { id: 'fixture', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } } },
  instances: { page: { id: 'page', definitionId: 'page', data: {}, childIds: ['object'], container: { kind: 'slide' } },
    object: { id: 'object', definitionId: 'fixture', data: {} } }, rootIds: ['page'], entry: { rootInstanceId: 'page' },
  assets: {}, global: { underlay: [], overlay: [] } })
const resources = () => ({ assets: {}, components: {} })

it('attaches a real transition asset without inserting its catalog example', () => {
  const project = destination()
  project.definitions.navigation = { id: 'navigation', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } }
  project.instances.navigation = { id: 'navigation', definitionId: 'navigation', data: { buttons: [{ id: 'next', label: 'Next', action: { type: 'step.next' } }] } }
  project.global.overlay.push('navigation')
  const prepared = prepareComponentLibraryInsertion(project, builtInWorkAsset('guoling.work.transition.fade')!, {
    container: { kind: 'instance', instanceId: 'navigation' }, index: 0 })
  expect(prepared.rootIds).toEqual([])
  expect(prepared.command.edits.map(edit => edit.type)).toEqual(['data.set'])
  const after = applyComponentOperation(project, prepared.command)
  expect(Object.keys(after.instances)).toEqual(Object.keys(project.instances))
  expect(after.instances.navigation.data).toMatchObject({ buttons: [{ action: { transition: { effect: 'fade' } } }] })
})

it('rebinds dependency provenance identities while retaining real local source differences', () => {
  for (const modified of [false, true]) {
    const source = 'export default {}', current = modified ? 'export default { local: true }' : source
    const implementation = { kind: 'source' as const, language: 'javascript' as const, workspace: { ownerId: 'dependency-source', entry: 'main.js' } }
    const entry: ComponentLibraryEntry = { schemaVersion: 2, id: 'bundle', title: 'Bundle',
      definitions: { root: { id: 'root', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}', moduleBindings: { dependency: 'dependency' } } },
        dependency: { id: 'dependency', role: 'content', implementation, library: { packageId: 'dependency-package', version: '1',
          baseline: { implementation: structuredClone(implementation), sourceFiles: { 'main.js': source } } } } },
      example: { instances: { root: { id: 'root', definitionId: 'root', data: {} } }, rootIds: ['root'] }, assets: {},
      resources: { assets: {}, components: { 'dependency-source': { 'main.js': new TextEncoder().encode(current) } } } }
    const prepared = prepareComponentLibraryInsertion(destination(), entry, { container: { kind: 'project' }, index: 1 })
    const after = applyComponentOperation(destination(), prepared.command)
    const files = Object.fromEntries(prepared.command.edits.flatMap(edit => edit.type === 'component.files.set' && edit.files !== null ? [[edit.ownerId, edit.files]] : []))
    const dependency = after.definitions[prepared.identities.definitions.get('dependency')!]
    expect(dependency.library?.baseline?.implementation).toEqual(dependency.implementation)
    expect(dependency.library?.baseline?.sourceFiles?.['main.js']).toBe(source)
    expect(componentDefinitionHasLocalSourceChanges(dependency, files)).toBe(modified)
  }
})

it('adapts a V1 page with external targets before applying explicit insertion bindings', () => {
  const legacy: LegacyComponentLibraryEntry = { schemaVersion: 1, id: 'external', title: 'External', kind: 'page',
    definitions: { fixture: { id: 'fixture', role: 'content', implementation: { kind: 'builtin', key: 'fixture' } },
      behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'fixture' } } },
    example: { instances: { root: { id: 'root', definitionId: 'fixture', data: {}, attachments: [
      { instanceId: 'behavior', target: { kind: 'instance', instanceId: 'external-object' } },
      { instanceId: 'behavior', target: { kind: 'surface', surfaceId: 'external-page' } }] },
      behavior: { id: 'behavior', definitionId: 'behavior', data: {} } }, rootIds: ['root', 'behavior'] },
    surfaces: [{ id: 'source-page', title: 'Page', kind: 'slide', childIds: ['root', 'behavior'] }], assets: {}, resources: resources() }
  const normalized = normalizeComponentLibraryEntry(legacy)
  expect(normalized.example.instances.root.attachments).toEqual(legacy.example.instances.root.attachments)
  const prepared = prepareComponentLibraryInsertion(destination(), normalized, { container: { kind: 'project' }, index: 1,
    targetBindings: { 'external-object': 'object' }, surfaceBindings: { 'external-page': 'page' } })
  const after = applyComponentOperation(destination(), prepared.command)
  expect(courseProjectV11Schema.safeParse(after).success).toBe(true)
  expect(after.instances[prepared.identities.instances.get('root')!].attachments).toMatchObject([
    { target: { kind: 'instance', instanceId: 'object' } }, { target: { kind: 'surface', surfaceId: 'page' } }])
})

it('retains object insertion placement when a selected reusable object contains a container', () => {
  const source = destination()
  const extracted = extractComponentLibraryEntry(source, resources(), { id: 'object-container', title: 'Object container', rootIds: ['page'] })
  expect(extracted.entry.kind).toBe('objects')
  const prepared = prepareComponentLibraryInsertion(destination(), extracted.entry, { container: { kind: 'instance', instanceId: 'page' }, index: 1 })
  const after = applyComponentOperation(destination(), prepared.command)
  expect(after.rootIds).toEqual(['page'])
  expect(after.instances.page.childIds).toEqual(['object', ...prepared.rootIds])
})

it('retains nested visibility and scopes copied page globals to only the new work roots', () => {
  const source = destination()
  source.instances.nested = { id: 'nested', definitionId: 'page', data: {}, childIds: ['nested-object'], container: { kind: 'spatial' } }
  source.instances['nested-object'] = { id: 'nested-object', definitionId: 'fixture', data: {}, visibility: { mode: 'include', surfaceIds: ['nested'] } }
  source.instances.page.childIds!.push('nested')
  source.instances.overlay = { id: 'overlay', definitionId: 'fixture', data: {} }
  source.global.overlay.push('overlay')
  const extracted = extractComponentLibraryEntry(source, resources(), { id: 'page-template', title: 'Page', surfaceIds: ['page'] })
  expect(extracted.entry.example.instances['nested-object'].visibility).toEqual(source.instances['nested-object'].visibility)
  const prepared = prepareComponentLibraryInsertion(destination(), extracted.entry, { container: { kind: 'project' }, index: 1 })
  const after = applyComponentOperation(destination(), prepared.command)
  const overlay = after.instances[prepared.identities.instances.get('overlay')!]
  expect(isComponentVisibleAtSurface(overlay, 'page')).toBe(false)
  expect(isComponentVisibleAtSurface(overlay, prepared.identities.instances.get('page')!)).toBe(true)
  expect(after.instances[prepared.identities.instances.get('nested-object')!].visibility?.surfaceIds).toEqual([prepared.identities.instances.get('nested')])
  const local = prepareComponentLibraryInsertion(destination(), extracted.entry, { container: { kind: 'instance', instanceId: 'page' }, index: 1, placement: 'local' })
  const localAfter = applyComponentOperation(destination(), local.command)
  expect(localAfter.rootIds).toEqual(['page'])
  expect(localAfter.instances[local.identities.instances.get('overlay')!].visibility).toEqual({ mode: 'include', surfaceIds: ['page'] })
  extracted.entry.example.instances.overlay.visibility = { mode: 'include', surfaceIds: [] }
  const hidden = prepareComponentLibraryInsertion(destination(), extracted.entry, { container: { kind: 'instance', instanceId: 'page' }, index: 1, placement: 'local' })
  const hiddenAfter = applyComponentOperation(destination(), hidden.command)
  expect(hiddenAfter.instances[hidden.identities.instances.get('overlay')!].visibility).toEqual({ mode: 'include', surfaceIds: [] })
})

it('rebinds an extracted object rule from an excluded container to the destination container', () => {
  const source = destination()
  source.definitions.rules = { id: 'rules', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } }
  source.instances.rules = { id: 'rules', definitionId: 'rules', data: { rules: [{ id: 'click', enabled: true,
    name: 'Click', trigger: { type: 'node.click', nodeId: 'object' }, conditions: [], actions: [{ id: 'remember', start: 'after-previous', delayMs: 0,
      action: { type: 'course-state.set', key: 'answer', value: true } }] }] },
    attachments: [{ instanceId: 'rules', target: { kind: 'instance', instanceId: 'page' } }] }
  source.instances.page.childIds!.push('rules')
  const extracted = extractComponentLibraryEntry(source, resources(), { id: 'object-with-rule', title: 'Object', rootIds: ['object'] })
  expect(extracted.entry.example.instances).not.toHaveProperty('page')
  const prepared = prepareComponentLibraryInsertion(destination(), extracted.entry, { container: { kind: 'instance', instanceId: 'page' }, index: 1 })
  const after = applyComponentOperation(destination(), prepared.command)
  expect(after.instances[prepared.identities.instances.get('rules')!].attachments?.[0].target).toEqual({ kind: 'instance', instanceId: 'page' })
  expect(after.instances[prepared.identities.instances.get('rules')!].data).toMatchObject({ rules: [{ trigger: { nodeId: prepared.identities.instances.get('object') } }] })
})

it('scopes a pure-program template global to its new program root without manufacturing a container', () => {
  const entry: ComponentLibraryEntry = { schemaVersion: 2, id: 'program-template', title: 'Program template', kind: 'structure',
    definitions: { code: { id: 'code', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
    example: { instances: { code: { id: 'code', definitionId: 'code', data: {} }, overlay: { id: 'overlay', definitionId: 'code', data: {} } }, rootIds: ['code'] },
    global: { underlay: [], overlay: ['overlay'] }, assets: {}, resources: resources() }
  const prepared = prepareComponentLibraryInsertion(destination(), entry, { container: { kind: 'project' }, index: 1 })
  const after = applyComponentOperation(destination(), prepared.command)
  const overlay = after.instances[prepared.identities.instances.get('overlay')!]
  expect(isComponentVisibleAtSurface(overlay, 'page')).toBe(false)
  expect(isComponentVisibleAtSurface(overlay, prepared.rootIds[0])).toBe(true)
  expect(after.instances[prepared.rootIds[0]].container).toBeUndefined()
})

it('copies an object rule from a Source work root into the actual destination Source scope', () => {
  const program = (rootId: string): CourseProjectV10 => ({ schemaVersion: 11, id: rootId, title: rootId, revision: 0,
    definitions: { code: { id: 'code', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } },
      rules: { id: 'rules', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } } },
    instances: { [rootId]: { id: rootId, definitionId: 'code', data: { html: 'Unselected owner body' }, childIds: ['object'] },
      object: { id: 'object', definitionId: 'code', data: { text: 'Selected object' } } },
    rootIds: [rootId], entry: { rootInstanceId: rootId }, assets: {}, global: { underlay: [], overlay: [] } })
  const source = program('source-program'), target = program('target-program')
  source.instances.rules = { id: 'rules', definitionId: 'rules', data: { rules: [{ id: 'click', name: 'Click', enabled: true,
    trigger: { type: 'node.click', nodeId: 'object' }, conditions: [], actions: [{ id: 'remember', start: 'after-previous', delayMs: 0,
      action: { type: 'course-state.set', key: 'answer', value: true } }] }] },
    attachments: [{ instanceId: 'rules', target: { kind: 'instance', instanceId: 'source-program' } }] }
  source.instances['source-program'].childIds!.push('rules')
  const extracted = extractComponentLibraryEntry(source, resources(), { id: 'program-object', title: 'Object', rootIds: ['object'] })
  expect(extracted.entry.example.instances).not.toHaveProperty('source-program')
  for (const explicitBinding of [false, true]) {
    const prepared = prepareComponentLibraryInsertion(target, extracted.entry, { container: { kind: 'instance', instanceId: 'target-program' }, index: 1,
      ...(explicitBinding ? { surfaceBindings: { 'source-program': 'target-program' } } : {}) })
    const after = applyComponentOperation(target, prepared.command)
    expect(courseProjectV11Schema.safeParse(after).success).toBe(true)
    expect(after.instances[prepared.identities.instances.get('rules')!].attachments?.[0].target).toEqual({ kind: 'instance', instanceId: 'target-program' })
    expect(after.rootIds).toEqual(['target-program'])
    expect(after.instances['target-program'].data).toEqual(target.instances['target-program'].data)
  }
})
