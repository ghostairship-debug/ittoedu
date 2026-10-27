import { expect, it } from 'vitest'
import { createComponentCompilationInputReader } from '../../src/core/components/compilation/componentCompilationInput'
import type { ComponentImplementation, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentResources } from '../../src/shared/workbench/document'

type Source = Extract<ComponentImplementation, { kind: 'source' }>
const source = (value = 'export default 1'): Source => ({ kind: 'source', language: 'javascript', source: value })
function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'source-owner', revision: 0, title: 'Source input identity', rootIds: ['app'],
    entry: { rootInstanceId: 'app' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: { app: { id: 'app', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      dependency: { id: 'dependency', role: 'content', version: '1', implementation: source('export const label = "initial"') } },
    instances: { app: { id: 'app', definitionId: 'app', childIds: ['child'], data: {},
      implementationOverride: { ...source('import {label} from "dep"; export default label'), moduleBindings: { dep: 'dependency' } } },
    child: { id: 'child', definitionId: 'text', data: { text: 'before' } } } }
}
const override = (project: CourseProjectV10) => project.instances.app!.implementationOverride as Source

it('reuses the actual compiler input after a child edit clones unchanged source and dependency owners', () => {
  const read = createComponentCompilationInputReader(), project = fixture()
  const initial = read(project, override(project))
  const changed = structuredClone(project)
  changed.instances.child!.data = { text: 'after' }
  const next = read(changed, override(changed))
  expect(next).toBe(initial)
  expect(next.dependencies?.dependency?.files['component.js']).toContain('initial')
  const rewritten = structuredClone(changed)
  override(rewritten).source = 'export default "rewritten"'
  expect(read(rewritten, override(rewritten))).not.toBe(initial)
})

it('invalidates changed dependency source, version and formerly absent bindings', () => {
  const read = createComponentCompilationInputReader(), project = fixture()
  const initial = read(project, override(project))
  const changed = structuredClone(project)
  ;(changed.definitions.dependency!.implementation as Source).source = 'export const label = "changed"'
  const updated = read(changed, override(changed))
  expect(updated).not.toBe(initial)
  expect(updated.dependencies?.dependency?.files['component.js']).toContain('changed')
  changed.definitions.dependency!.version = '2'
  const versioned = read(changed, override(changed))
  expect(versioned).not.toBe(updated)
  expect(versioned.dependencies?.dependency?.version).toBe('2')
  override(changed).moduleBindings = { dep: 'missing' }
  const absent = read(changed, override(changed))
  expect(absent.dependencies?.missing).toBeUndefined()
  const available = structuredClone(changed)
  available.definitions.missing = { id: 'missing', role: 'content', implementation: source('export const label = "available"') }
  const restored = read(available, override(available))
  expect(restored).not.toBe(absent)
  expect(restored.dependencies?.missing?.files['component.js']).toContain('available')
})

it('retains unchanged workspace bytes across author snapshots and observes actual file replacement', () => {
  const read = createComponentCompilationInputReader(), project = fixture()
  project.definitions.dependency!.implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'dependency', entry: 'main.js' } }
  const resources: DocumentResources = { assets: {}, components: { dependency: { 'main.js': new TextEncoder().encode('export const label = "file"') } } }
  const initial = read(project, override(project), resources)
  const changed = structuredClone(project)
  expect(read(changed, override(changed), resources)).toBe(initial)
  resources.components.dependency!['main.js'] = new TextEncoder().encode('export const label = "new file"')
  const next = read(changed, override(changed), resources)
  expect(next).not.toBe(initial)
  expect(next.dependencies?.dependency?.files['main.js']).toContain('new file')
})

it('preserves shared definition identity and does not confuse it with an override root', () => {
  const read = createComponentCompilationInputReader(), project = fixture()
  const inline = read(project, override(project))
  expect(inline.rootDefinitionId).toBeUndefined()
  const shared = structuredClone(project)
  shared.definitions.app!.implementation = override(shared)
  const definition = read(shared, shared.definitions.app!.implementation as Source)
  expect(definition).not.toBe(inline)
  expect(definition.rootDefinitionId).toBe('app')
  const changed = structuredClone(shared)
  changed.instances.child!.data = { text: 'after' }
  expect(read(changed, changed.definitions.app!.implementation as Source)).toBe(definition)
})
