// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { projectWebModuleGraph, type WebRuntimeData } from '../../src/components/web/moduleGraph'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { ComponentRuntimeHost, type ComponentRuntimeRequest } from '../../src/player/components/runtime/ComponentRuntimeHost'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { prepareComponentProjectFileSource, readComponentProjectFileInput } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function fixture() {
  const project = createBlankCourseProjectV10('Author modules')
  project.definitions[HTML_PROGRAM_DEFINITION.id] = HTML_PROGRAM_DEFINITION
  project.instances.web = { id: 'web', definitionId: HTML_PROGRAM_DEFINITION.id,
    data: { html: '<h1>Old title</h1><script type="module" src="./main.js"></script>', modules: {
      'main.js': 'import { step } from "./helper.js"; globalThis.step = step;',
      'helper.js': 'export const step = 1;', 'unused.js': 'export const unfinished =', 'notes.js': 'export const notes = "draft";',
    } } }
  testContainerInstance(project, 0).childIds.push('web')
  return project
}

it('admits a single module file with a new dependency and local media in one undoable author transaction', async () => {
  const project = fixture(), before = structuredClone(project.instances.web!)
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const session = await DocumentSession.create({ documentId: 'module-media', epoch: 'epoch', binding: { kind: 'untitled', suggestedName: 'module.glx' }, model },
    new CourseV10Driver(), { async append() {}, async save() { throw new Error('The test does not publish files') } })
  const file = componentProjectFiles(project, model.resources).find(file => file.webModule?.path === 'helper.js')!
  const text = 'import { extra } from "./extra.js"; export const step = extra; export const audio = new URL("./media/tone.wav", import.meta.url);'
  const encode = (value: string) => new TextEncoder().encode(value)
  const wav = Uint8Array.from(Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==', 'base64'))
  const root = await mkdtemp(path.join(tmpdir(), 'author-module-')); roots.push(root)
  for (const [name, bytes] of new Map([['helper.js', encode(text)],
    ['extra.js', encode('import { notes } from "./notes.js"; export const extra = notes === "draft" ? 2 : 0;')],
    ['notes.js', encode('export const notes = "disk draft must not replace owned source";')], ['media/tone.wav', wav]])) {
    const filename = path.join(root, name)
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes)
  }
  const input = await readComponentProjectFileInput({ from: 'helper.js', fileAccess: { permission: 'workspace', workspaceRoot: root } })
  input.assetContext = { assets: {}, bytes: {} }
  const source = await prepareComponentProjectFileSource(input, file, 'content')
  const plan = planContentApply({ project, request: { intent: 'content', target: file.target!, source }, createId: () => 'unexpected-new-object' })
  expect(await session.execute({ documentId: 'module-media', epoch: 'epoch', baseRevision: 0, operationId: 'module-from', actor: 'agent',
    mutation: { type: 'command', command: plan.command } })).toMatchObject({ status: 'applied' })
  const changed = session.read()
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(changed.undoDepth).toBe(1)
  const data = changed.model.project.instances.web!.data as { html: string; modules: Record<string, string>; resourceBindings: Record<string, string> }
  expect(data.html).toBe((before.data as { html: string }).html)
  expect(data.modules['notes.js']).toBe((before.data as { modules: Record<string, string> }).modules['notes.js'])
  expect(data.modules['unused.js']).toBe((before.data as { modules: Record<string, string> }).modules['unused.js'])
  expect(data.modules['main.js']).toBe((before.data as { modules: Record<string, string> }).modules['main.js'])
  expect(data.modules['extra.js']).toContain('notes === "draft"')
  expect(data.modules['helper.js']).toContain('new URL("cw-resource:')
  const assetId = Object.values(data.resourceBindings)[0]!
  expect(changed.model.resources.assets[assetId]).toEqual(wav)
  expect(changed.model.project.instances.web!.implementationOverride).toBeUndefined()
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const runtime = await projectWebModuleGraph(changed.model.project.instances.web!, input => compilation.compile(input))
  expect((runtime.data as unknown as WebRuntimeData).moduleGraph!.modules['extra.js'].code).toContain('notes')
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize(changed.model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected reopened V10')
  expect(reopened.project.instances.web!.data).toEqual(data)
  expect(reopened.resources.assets[assetId]).toEqual(wav)
  expect(await session.execute({ documentId: changed.documentId, epoch: changed.epoch, baseRevision: changed.revision,
    operationId: 'undo-module-from', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = session.read()
  if (undone.model.kind !== 'course-v10') throw new Error('Expected undone V10')
  expect(undone.model.project.instances.web!.data).toEqual(before.data)
  expect(undone.model.resources.assets).toEqual({})
})

it('keeps unfinished and unused author modules through local HTML apply and archive reopen', async () => {
  const project = fixture(), model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const previous = project.instances.web!.data as { html: string; modules: Record<string, string> }
  const service = new ContentApplyService({ session: { project: () => project, resources: () => model.resources,
    async dispatch() { throw new Error('Plan is applied by the canonical driver below') } },
    async measure() { throw new Error('A local edit must not remeasure') }, compilation: {
      async compile() { throw new Error('Unreachable author drafts must not be compiled for local HTML apply') },
    } })
  const plan = await service.plan({ intent: 'content', target: { kind: 'instance', instanceId: 'web' },
    source: { kind: 'html', html: previous.html.replace('Old title', 'Changed title') } })
  expect(plan.diagnostics).toEqual([])
  const driver = new CourseV10Driver(), changed = driver.apply(model, plan.command), reopened = driver.load(driver.serialize(changed))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.instances.web!.data).toMatchObject({ html: expect.stringContaining('Changed title'), modules: previous.modules })
})

it('retains the active Web scope for an unused draft edit and retires it for an active helper edit', async () => {
  const project = fixture(), instance = project.instances.web!, definition = project.definitions[instance.definitionId]!
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  let mounts = 0, disposes = 0, state = 0
  const host = new ComponentRuntimeHost({
    async resolveImplementation(_implementation, _definition, _signal, current) {
      const projected = await projectWebModuleGraph(current, input => compilation.compile(input))
      return { artifactIdentity: 'shared-web-runtime', webModuleGraph: (projected.data as unknown as WebRuntimeData).moduleGraph, implementation: {
        mount() { mounts++; state = 0; return { update() {}, dispose() { disposes++ } } },
      } }
    }, ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} },
      state: { get: () => state, set: (_key, value) => { state = value as number }, subscribe: () => () => {} } }),
  })
  const request = (): ComponentRuntimeRequest => ({ runScopeId: 'web-author-modules', instance: project.instances.web!, definition })
  try {
    const original = await host.sync(request())
    original!.scope.state.set('clicks', 4)
    project.instances.web = { ...instance, data: { ...instance.data as object,
      modules: { ...(instance.data as { modules: Record<string, string> }).modules, 'unused.js': 'export const unfinished = still(' } } }
    const same = await host.sync(request())
    expect(same).toBe(original)
    expect(original!.scope.isActive()).toBe(true)
    expect(original!.scope.state.get('clicks')).toBe(4)
    expect({ mounts, disposes }).toEqual({ mounts: 1, disposes: 0 })
    const current = project.instances.web!.data as { modules: Record<string, string> }
    project.instances.web = { ...project.instances.web!, data: { ...current, modules: { ...current.modules, 'helper.js': 'export const step = 2;' } } }
    const changed = await host.sync(request())
    expect(changed!.scope.generation).not.toBe(original!.scope.generation)
    expect(original!.scope.isActive()).toBe(false)
    expect({ mounts, disposes }).toEqual({ mounts: 2, disposes: 1 })
  } finally { await host.disposeScope('web-author-modules') }
})

it('mounts the latest same-source data after retirement and updates later data received during mount', async () => {
  let finishOldDispose!: () => void, markOldDisposing!: () => void, finishNewMount!: () => void, markNewMounting!: () => void
  const oldDisposing = new Promise<void>(resolve => { markOldDisposing = resolve })
  const oldDisposeGate = new Promise<void>(resolve => { finishOldDispose = resolve })
  const newMounting = new Promise<void>(resolve => { markNewMounting = resolve })
  const newMountGate = new Promise<void>(resolve => { finishNewMount = resolve })
  const mounted: string[] = [], updates: string[] = []
  const host = new ComponentRuntimeHost({
    resolveImplementation(_implementation, _definition, _signal, instance) {
      const data = instance.data as { modules: Record<string, string> }
      return { artifactIdentity: 'shared-web-runtime', webModuleGraph: { entries: { '0': 'main.js' },
        modules: { 'main.js': { code: data.modules['main.js']!, imports: [] } } }, implementation: {
        async mount(context) {
          const data = context.instance.data as { modules: Record<string, string>; css: string }
          const code = data.modules['main.js']!
          if (code === 'new') { mounted.push(data.css); markNewMounting(); await newMountGate }
          return { update(value) { updates.push((value.data as { css: string }).css) }, async dispose() {
            if (code === 'old') { markOldDisposing(); await oldDisposeGate }
          } }
        },
      } }
    }, ports: () => ({ target: () => null, events: { emit() {}, subscribe: () => () => {} },
      state: { get: () => undefined, set() {}, subscribe: () => () => {} } }),
  })
  const request = (code: string, css: string): ComponentRuntimeRequest => ({ runScopeId: 'web-retirement',
    definition: HTML_PROGRAM_DEFINITION, instance: { id: 'web', definitionId: HTML_PROGRAM_DEFINITION.id,
      data: { html: '<script type="module" src="main.js"></script>', modules: { 'main.js': code }, css } } })
  try {
    await host.sync(request('old', 'old css'))
    const next = host.sync(request('new', 'first css'))
    await oldDisposing
    const latest = host.sync(request('new', 'latest css'))
    finishOldDispose(); await newMounting
    expect(mounted).toEqual(['latest css'])
    const duringMount = host.sync(request('new', 'during mount css'))
    finishNewMount()
    const [first, second, third] = await Promise.all([next, latest, duringMount])
    expect(second).toBe(first); expect(third).toBe(first)
    expect(updates).toEqual(['during mount css'])
  } finally { finishOldDispose(); finishNewMount(); await host.disposeScope('web-retirement') }
})
