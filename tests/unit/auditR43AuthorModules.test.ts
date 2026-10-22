// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { projectWebModuleGraph, type WebRuntimeData } from '../../src/components/web/moduleGraph'
import { HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { ComponentRuntimeHost, type ComponentRuntimeRequest } from '../../src/player/components/runtime/ComponentRuntimeHost'

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
