// @vitest-environment node
import { expect, it } from 'vitest'
import { transform } from 'esbuild'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareComponentAuthorSource, componentAuthorSourceEdits, componentAuthorSourceModules, componentAuthorSourceDependencyPaths, resolveComponentAuthorSourceDependencyPaths } from '../../src/core/components/source/componentAuthorSource'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { canonicalComponentFileEdits } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import type { ComponentImplementation } from '../../src/shared/contracts/component-platform'
import type { ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'

const bytes = (value: string) => new TextEncoder().encode(value)
const driver = new CourseV10Driver()
const source = (text: string, moduleBindings?: Record<string, string>): Extract<ComponentImplementation, { kind: 'source' }> =>
  ({ kind: 'source', language: 'javascript', source: text, ...(moduleBindings ? { moduleBindings } : {}) })
function model() {
  const project = createBlankCourseProjectV10('作者入口')
  project.definitions.web = { id: 'web', title: 'Web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  for (const id of ['a', 'b']) project.instances[id] = { id, definitionId: 'web', data: { html: `<h1>${id}</h1>` } }
  project.surfaces[0].childIds = ['a', 'b']
  return { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} as Record<string, Record<string, Uint8Array>> } }
}
const snapshot = (current: ReturnType<typeof model>) => ({ model: current }) as ComponentProjectSnapshot

it('reads the same short entry without mutating builtin, then persists a real shared source dependency and keeps HTML editing', async () => {
  let current = model()
  const before = structuredClone(current), prepared = prepareComponentAuthorSource(current.project, current.project.definitions.web.implementation)!
  const files = componentProjectFiles(current.project, current.resources)
  const entry = files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && !file.authorSource?.dependencyId)!
  expect(entry.content).toBe(prepared.implementation.source)
  expect(current).toEqual(before)
  expect(entry.content).toContain("import implementation from './implementation'")
  const apiReference = files.find(file => file.kind === 'reference' && file.path === entry.references?.[0]?.path)!
  expect(apiReference).toBeDefined()
  for (const api of ['context.root', 'scope.state', 'get(name)', 'set(name, value)', 'subscribe(name, listener)',
    'scope.cleanup', 'return mounted', 'tc.read().scenes', 'tc.execute', 'context.scope.signal']) expect(apiReference.content).toContain(api)
  expect(apiReference.content).toContain('subscribe 不回放当前值')
  const dependency = files.find(file => file.authorSource?.dependencyId && file.content?.includes('mountWebContent'))!
  expect(dependency.note).toContain('仅深改底层实现时按需读取')
  const modified = entry.content!.replace('return implementation.mount(context);', 'context.root.dataset.custom = "a";\n    return implementation.mount(context);')
  const edits = canonicalComponentFileEdits(snapshot(current), entry, modified)
  current = driver.apply(current, captureComponentOperation(current.project, edits)) as typeof current
  expect(current.project.instances.b).toEqual(before.project.instances.b)
  expect(current.project.definitions.web).toEqual(before.project.definitions.web)
  const instanceSource = current.project.instances.a.implementationOverride
  if (instanceSource?.kind !== 'source') throw new Error('Expected short source')
  expect(prepareComponentAuthorSource(current.project, instanceSource)?.implementation).toBe(instanceSource)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  expect((await compilation.compile(componentCompilationInput(current.project, instanceSource, current.resources))).status).toBe('ready')
  const second = prepareComponentAuthorSource(current.project, current.project.definitions.web.implementation)!
  expect(second.definitions).toEqual([])
  expect(second.implementation.moduleBindings).toEqual(instanceSource.moduleBindings)
  const html = componentProjectFiles(current.project, current.resources).find(file => file.target?.kind === 'instance' && file.target.instanceId === 'a' && file.kind === 'html')!
  expect(html.content).toBe('<h1>a</h1>')
  const service = new ContentApplyService({ session: { project: () => current.project, resources: () => current.resources, async dispatch() { throw new Error('plan only') } },
    async measure() { throw new Error('ordinary HTML edits do not reassemble') }, compilation })
  const plan = await service.plan({ intent: 'content', target: html.target!, source: { kind: 'html', html: '<h1>普通改字</h1>' } })
  current = driver.apply(current, plan.command) as typeof current
  const reopened = driver.load(driver.serialize(current)) as typeof current
  expect(reopened.project.instances.a.data).toMatchObject({ html: '<h1>普通改字</h1>' })
  expect(reopened.project.instances.a.implementationOverride).toEqual(instanceSource)
  expect(reopened.project.instances.b).toEqual(before.project.instances.b)
  expect(componentCompilationInput(reopened.project, instanceSource, reopened.resources).dependencies).toEqual(componentCompilationInput(current.project, instanceSource, current.resources).dependencies)
})

it.each([
  ['dispose() {}', 'update()'],
  ['update() {}', 'dispose()'],
  ['', 'update() / dispose()'],
])('warns about an undeclared literal lifecycle during apply and retains its source: %s', async (methods, missing) => {
  let current = model()
  const before = structuredClone(current)
  const entry = componentProjectFiles(current.project, current.resources).find(file =>
    file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && !file.authorSource?.dependencyId)!
  const authored = `export default {\n  mount() {\n    return { ${methods} };\n  },\n};`
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const service = new ContentApplyService({ compilation, async measure() { throw new Error('source does not need measurement') },
    session: { project: () => current.project, resources: () => current.resources, async dispatch(command) {
      const beforeRevision = current.project.revision
      current = driver.apply(current, command) as typeof current
      return { status: 'applied', documentId: 'author', operationId: 'source-apply', beforeRevision,
        revision: current.project.revision, persistence: 'recoverable' }
    } } })
  const applied = await service.apply({ intent: 'canonical', edits: canonicalComponentFileEdits(snapshot(current), entry, authored) })
  expect(applied).toMatchObject({ commit: 'committed', usability: 'partial', diagnostics: [{
    code: 'component-compile', level: 'warning', file: 'component.js', line: 3, column: 11,
    lineText: `    return { ${methods} };`, repairable: true,
  }] })
  expect(applied.diagnostics[0].message).toContain(`未声明 ${missing}`)
  const reopened = driver.load(driver.serialize(current)) as typeof current
  expect(reopened.project.instances.a.implementationOverride).toMatchObject({ kind: 'source', source: authored })
  expect(reopened.project.instances.a.data).toEqual(before.project.instances.a.data)
  expect(reopened.project.instances.b).toEqual(before.project.instances.b)
})

it.each([
  `export default {mount(context){
    context.root.innerHTML='<button>ready</button>';
    const button=context.root.querySelector('button');
    const onClick=()=>{button.textContent='clicked'};
    context.root.addEventListener('click',onClick);
    return {dispose(){context.root.removeEventListener('click',onClick)}};
  }}`,
  'export default {mount(){Object.prototype.update=()=>{};return {dispose(){}}}}',
])('keeps a direct-return advisory nonblocking after DOM or prototype preparation: %s', async authored => {
  const current = model(), compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const implementation = source(authored)
  const compiled = await compilation.compile(componentCompilationInput(current.project, implementation, current.resources))
  expect(compiled).toMatchObject({ status: 'ready', artifact: { code: expect.any(String), diagnostics: [{ severity: 'warning' }] } })
  const service = new ContentApplyService({ compilation, async measure() { throw new Error('source does not need measurement') },
    session: { project: () => current.project, resources: () => current.resources, async dispatch() { throw new Error('plan only') } } })
  const plan = await service.plan({ intent: 'canonical', edits: [{ type: 'implementation.set', instanceId: 'a', implementation }] })
  expect(plan).toMatchObject({ usability: 'partial', diagnostics: [{ code: 'component-compile', level: 'warning' }] })
  expect(plan.diagnostics[0].message).toContain('如未由原型或其他实际实现提供会无法挂载')
  const applied = driver.apply(current, plan.command) as typeof current
  expect(applied.project.instances.a.implementationOverride).toMatchObject({ source: authored })
  expect(applied.project.instances.b).toEqual(current.project.instances.b)
})

it('accepts a complete literal lifecycle without executing candidate Source', async () => {
  const current = model(), implementation = source(`throw new Error('Source must not execute during compilation');
export default { document: 'web', mount() { return { update() {}, dispose() {} }; } };`)
  const result = await new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    .compile(componentCompilationInput(current.project, implementation, current.resources))
  expect(result).toMatchObject({ status: 'ready', artifact: { diagnostics: [] } })
})

it.each([
  'export default {mount(context){return implementation.mount(context)}}',
  'export default {...implementation,mount(){return {dispose(){}}}}',
  'export default {mount(){return {...lifecycle,dispose(){}}}}',
  'export default {mount(context){return createLifecycle(context)}}',
  'export default {mount(){return {[method](){}}}}',
  'export default {mount(){return {__proto__: lifecycle,dispose(){}}}}',
  'export default {mount(){return {get update(){return installLifecycle(this)}}}}',
  'export default {mount(){return {then(resolve){resolve({update(){},dispose(){}})}}}}',
  'export default {mount(context){if(context.ready)return createLifecycle(context);return {dispose(){}}}}',
])('leaves delegated or dynamic lifecycle construction unverified: %s', async authored => {
  const current = model(), compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const service = new ContentApplyService({ compilation, async measure() { throw new Error('source does not need measurement') },
    session: { project: () => current.project, resources: () => current.resources, async dispatch() { throw new Error('plan only') } } })
  const plan = await service.plan({ intent: 'canonical', edits: [{ type: 'implementation.set', instanceId: 'a', implementation: source(authored) }] })
  expect(plan).toMatchObject({ usability: 'unverified', diagnostics: [] })
})

it('keeps TypeScript outside the JavaScript-only literal lifecycle diagnostic', async () => {
  const current = model(), implementation: Extract<ComponentImplementation, { kind: 'source' }> = {
    kind: 'source', language: 'typescript', source: 'export default {mount(_context: unknown){return {dispose(){}}}}',
  }
  const result = await new InMemoryComponentCompilation(createEsbuildComponentCompiler())
    .compile(componentCompilationInput(current.project, implementation, current.resources))
  expect(result).toMatchObject({ status: 'ready', artifact: { diagnostics: [] } })
})

it('copies only the modified dependency and ancestor path, preserving sibling sharing, source CAS and byte CAS', async () => {
  const current = model(), root = source("import middle from 'middle'; export default middle;", { middle: 'middle' })
  current.project.definitions.web.implementation = root
  current.project.definitions.middle = { id: 'middle', role: 'mixed', implementation: source("import leaf from './leaf'; import sibling from 'sibling'; export default { mount: leaf, sibling };", { './leaf': 'leaf', sibling: 'sibling' }) }
  current.project.definitions.leaf = { id: 'leaf', role: 'mixed', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'leaf-files', entry: 'leaf.js' } } }
  current.project.definitions.sibling = { id: 'sibling', role: 'mixed', implementation: source('export default 17;') }
  current.resources.components['leaf-files'] = { 'leaf.js': bytes('export default function(){return {update(){},dispose(){}}}'), 'image.bin': new Uint8Array([255, 0, 42]) }
  const prepared = prepareComponentAuthorSource(current.project, root)!, leaf = current.project.definitions.leaf.implementation
  if (leaf.kind !== 'source') throw new Error('Expected leaf')
  const files = { type: 'component.files.set' as const, ownerId: 'leaf-files', expectedFiles: current.resources.components['leaf-files'],
    files: { ...current.resources.components['leaf-files'], 'leaf.js': bytes('export default function(){return {update(){},dispose(){},changed:true}}') } }
  const edits = componentAuthorSourceEdits(current.project, current.resources, { kind: 'instance', instanceId: 'a' }, prepared, leaf, files, 'leaf')
  const command = captureComponentOperation(current.project, edits), changed = driver.apply(current, command) as typeof current
  const copied = edits.filter(edit => edit.type === 'definition.set')
  expect(copied.map(edit => edit.sourceOriginId).sort()).toEqual(['leaf', 'middle'])
  const middle = copied.find(edit => edit.sourceOriginId === 'middle')!.definition.implementation
  expect(middle.kind === 'source' && middle.moduleBindings?.sibling).toBe('sibling')
  expect(changed.project.definitions.leaf).toEqual(current.project.definitions.leaf)
  expect(changed.project.definitions.middle).toEqual(current.project.definitions.middle)
  expect(changed.project.instances.b).toEqual(current.project.instances.b)
  const newLeaf = changed.project.definitions[copied.find(edit => edit.sourceOriginId === 'leaf')!.definition.id].implementation
  if (newLeaf.kind !== 'source' || !newLeaf.workspace) throw new Error('Expected copied workspace')
  expect(newLeaf.workspace.ownerId).not.toBe('leaf-files')
  expect(changed.resources.components['leaf-files']).toEqual(current.resources.components['leaf-files'])
  expect(changed.resources.components[newLeaf.workspace.ownerId]['image.bin']).toEqual(current.resources.components['leaf-files']['image.bin'])
  const staleDefinition = structuredClone(current)
  staleDefinition.project.definitions.middle.title = 'Human changed dependency'
  expect(() => driver.apply(staleDefinition, command)).toThrow('目标内容或归属已变化')
  const staleBytes = structuredClone(current)
  staleBytes.resources.components['leaf-files']['leaf.js'] = bytes('export default "human";')
  expect(() => driver.apply(staleBytes, command)).toThrow('组件源码文件已变化')
  const implementation = changed.project.instances.a.implementationOverride!
  if (implementation.kind !== 'source') throw new Error('Expected copied root')
  expect((await new InMemoryComponentCompilation(createEsbuildComponentCompiler()).compile(componentCompilationInput(changed.project, implementation, changed.resources))).status).toBe('ready')
})

it('retains dependency source for repair when an unfinished root is saved to the library', () => {
  const current = model()
  current.project.definitions.web.implementation = source("import implementation from './implementation'; export default {", { './implementation': 'implementation' })
  current.project.definitions.implementation = { id: 'implementation', role: 'mixed', implementation: source('export default { mount(){ return { update(){}, dispose(){} }; } };') }
  const prepared = prepareComponentAuthorSource(current.project, current.project.definitions.web.implementation)!
  expect(componentAuthorSourceModules(current.project, current.resources, prepared).map(value => value.id)).toEqual([undefined, 'implementation'])
  const library = extractComponentLibraryEntry(current.project, current.resources, { id: 'saved', title: '待修', rootIds: ['a'] })
  expect(library.entry.definitions.implementation).toMatchObject(current.project.definitions.implementation)
  expect(library.entry.definitions.web.implementation).toMatchObject({ moduleBindings: { './implementation': 'implementation' } })
})

it('follows declared module imports and the same nested author path after COW without guessing a split path', () => {
  const current = model()
  const root = source("import shared from 'middle'; export default shared;", { middle: 'middle' })
  current.project.definitions.web.implementation = root
  current.project.definitions.middle = { id: 'middle', role: 'mixed', implementation: source("export {default} from 'leaf';", { leaf: 'leaf' }) }
  current.project.definitions.leaf = { id: 'leaf', role: 'mixed', implementation: source('export default 1;') }
  const prepared = prepareComponentAuthorSource(current.project, root)!
  expect(componentAuthorSourceModules(current.project, current.resources, prepared).map(value => value.id)).toEqual([undefined, 'middle', 'leaf'])
  const paths = componentAuthorSourceDependencyPaths(current.project, prepared, 'leaf', current.resources)
  expect(paths).toEqual([['middle', 'leaf']])
  const edits = componentAuthorSourceEdits(current.project, current.resources, { kind: 'instance', instanceId: 'a' }, prepared, source('export default 2;'), undefined, 'leaf')
  const changed = driver.apply(current, captureComponentOperation(current.project, edits)) as typeof current
  const next = prepareComponentAuthorSource(changed.project, changed.project.instances.a.implementationOverride)!
  const expectedId = edits.find(edit => edit.type === 'definition.set' && edit.sourceOriginId === 'leaf')
  if (expectedId?.type !== 'definition.set') throw new Error('Missing leaf copy')
  expect(resolveComponentAuthorSourceDependencyPaths(changed.project, next, paths, changed.resources)).toBe(expectedId.definition.id)
  expect(next.implementation.source).toBe(root.source)
  const split = source("import one from 'one'; import two from 'two'; export default one;", { one: 'leaf', two: expectedId.definition.id })
  expect(resolveComponentAuthorSourceDependencyPaths(changed.project, { implementation: split, definitions: [] }, [['one'], ['two']], changed.resources)).toBeUndefined()
})

it.each(['default', 'named'])('preserves one %s root module evaluation when private editing a circular dependency', async exportKind => {
  const current = model()
  current.project.definitions.web.implementation = source("import {b} from 'B'; globalThis.__a05RootRuns++; export const a=()=>1; "
    + (exportKind === 'default' ? 'export default {mount(){return b()}};' : 'export function mount(){return b()};'), { B: 'B' })
  current.project.definitions.B = { id: 'B', role: 'mixed', implementation: source("import {a} from 'A'; export const b=()=>a();", { A: 'web' }) }
  const prepared = prepareComponentAuthorSource(current.project, current.project.definitions.web.implementation)!
  const edits = componentAuthorSourceEdits(current.project, current.resources, { kind: 'instance', instanceId: 'a' }, prepared,
    source("import {a} from 'A'; export const b=()=>a()+1;", { A: 'web' }), undefined, 'B')
  const changed = driver.apply(current, captureComponentOperation(current.project, edits)) as typeof current
  const implementation = changed.project.instances.a.implementationOverride
  if (implementation?.kind !== 'source') throw new Error('Expected private source')
  const compiled = await new InMemoryComponentCompilation(createEsbuildComponentCompiler()).compile(componentCompilationInput(changed.project, implementation, changed.resources))
  if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
  const state = globalThis as typeof globalThis & { __a05RootRuns?: number }
  state.__a05RootRuns = 0
  try {
    const wrapped = await transform(compiled.artifact.code, { format: 'cjs' }), loaded = { exports: {} as { default: { mount(): number } } }
    Function('module', 'exports', wrapped.code)(loaded, loaded.exports)
    expect(loaded.exports.default.mount()).toBe(2)
    expect(state.__a05RootRuns).toBe(1)
  } finally { delete state.__a05RootRuns }
})

it('retains shared root byte CAS and reuses modules already private to the edited instance', () => {
  let current = model()
  current.project.definitions.web.implementation = { kind: 'source', language: 'javascript', workspace: { ownerId: 'root-files', entry: 'main.js' } }
  current.resources.components['root-files'] = { 'main.js': bytes('export default {};'), 'draft.js': bytes('v1') }
  const file = componentProjectFiles(current.project, current.resources).find(file => file.binding?.kind === 'instance-source'
    && file.binding.instanceId === 'a' && file.sourceFile?.path === 'main.js')!
  const command = captureComponentOperation(current.project, canonicalComponentFileEdits(snapshot(current), file, 'export default {custom:true};'))
  const human = structuredClone(current); human.resources.components['root-files']['draft.js'] = bytes('v2')
  expect(() => driver.apply(human, command)).toThrow('组件源码文件已变化')
  current.project.instances.a.implementationOverride = source("import base from './base'; export default base;", { './base': 'private' })
  current.project.definitions.private = { id: 'private', role: 'mixed', implementation: source('export default {value:0};') }
  const count = Object.keys(current.project.definitions).length
  for (let value = 1; value <= 3; value++) {
    const prepared = prepareComponentAuthorSource(current.project, current.project.instances.a.implementationOverride)!
    const edits = componentAuthorSourceEdits(current.project, current.resources, { kind: 'instance', instanceId: 'a' }, prepared,
      source(`export default {value:${value}};`), undefined, 'private')
    current = driver.apply(current, captureComponentOperation(current.project, edits)) as typeof current
    expect(Object.keys(current.project.definitions)).toHaveLength(count)
    expect(current.project.definitions.private.implementation).toMatchObject({ source: `export default {value:${value}};` })
  }
})

it('copies a dependency that is also the direct source implementation of a neighboring instance', () => {
  const current = model(), root = source("import base from './B'; export default base;", { './B': 'B' })
  current.project.instances.a.implementationOverride = root
  current.project.definitions.B = { id: 'B', role: 'content', implementation: source('export default {value:1};') }
  current.project.instances.b.definitionId = 'B'
  const prepared = prepareComponentAuthorSource(current.project, root)!
  const edits = componentAuthorSourceEdits(current.project, current.resources, { kind: 'instance', instanceId: 'a' }, prepared,
    source('export default {value:2};'), undefined, 'B')
  const changed = driver.apply(current, captureComponentOperation(current.project, edits)) as typeof current
  expect(changed.project.definitions.B).toEqual(current.project.definitions.B)
  expect(changed.project.instances.b).toEqual(current.project.instances.b)
  expect(edits.some(edit => edit.type === 'definition.set' && edit.definition.id !== 'B')).toBe(true)
})
