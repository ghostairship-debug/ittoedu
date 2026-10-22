import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { CourseNavigationControls } from '../../src/renderer/ui/workspaces/CourseNavigationControls'
import type { ComponentRuntimeContext, CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const programs = vi.hoisted(() => ({ contexts: new Map<string, ComponentRuntimeContext[]>(), retire: new Map<string, () => Promise<void>>() }))
vi.mock('../../src/renderer/components/SandboxComponentImplementation', () => ({
  prepareSandboxComponent: async () => ({ implementation: { mount(context: ComponentRuntimeContext) {
    const id = context.instance.id, contexts = programs.contexts.get(id) ?? []
    contexts.push(context); programs.contexts.set(id, contexts)
    let count = 0
    const button = document.createElement('button')
    button.textContent = `${id}:0`
    button.onclick = () => { button.textContent = `${id}:${++count}` }
    context.root!.append(button)
    return { update() {}, async dispose() { await programs.retire.get(id)?.() } }
  } } }),
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); programs.contexts.clear(); programs.retire.clear() })

function course(): CourseProjectV10 {
  return createTestProjectFromLegacy({ schemaVersion: 10, revision: 3, id: 'reset', title: 'Explicit reset',
    definitions: {
      source: { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export function mount() {}' } },
      html: { id: 'html', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } },
      rules: { id: 'rules', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' } },
    },
    instances: {
      one: { id: 'one', definitionId: 'source', data: {} },
      html: { id: 'html', definitionId: 'html', data: { html: '<button>local program</button>' } },
      two: { id: 'two', definitionId: 'source', data: {} },
      global: { id: 'global', definitionId: 'source', data: {} },
      enter: { id: 'enter', definitionId: 'rules', data: { rules: [{ id: 'enter', name: 'Enter once', enabled: true,
        trigger: { type: 'scene.enter' }, conditions: [], actions: [{ id: 'write', start: 'after-previous', delayMs: 0,
          action: { type: 'course-state.set', key: 'entered', value: true } }] }] } },
    },
    surfaces: ['one', 'two'].map(id => ({ id: 'page-' + id, kind: 'slide', title: id, childIds: id === 'one' ? ['one', 'html', 'enter'] : ['two'], designSize: { width: 800, height: 600 } })),
    assets: {}, global: { underlay: [], overlay: ['global'] },
  })
}

async function editor() {
  vi.stubGlobal('desktopAPI', { compileComponent: vi.fn(async () => ({ status: 'ready', artifact: { format: 'esm', code: '', css: '', diagnostics: [] } })) })
  const project = course(), before = structuredClone(project), report = vi.fn()
  let ports!: CourseV10RuntimePorts
  function Editor() {
    const [surface, select] = useState('page-one'), [mode, setMode] = useState<'edit' | 'run'>('run')
    useEffect(() => { ports.setPlaying(mode === 'run') }, [mode])
    return <CourseV10RuntimeView documentId="reset-doc" model={{ kind: 'course-v10', project, resources: { assets: {}, components: {} } }}
      surfaceId={surface} selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={select} report={report}
      renderWorkspace={runtime => { ports = runtime; return <>
        <CourseNavigationControls canvasMode={mode} onCanvasModeChange={setMode} navigation={runtime.navigation.editorPort()}
          resetPlayback={runtime.resetPlayback} report={report} />
        <div hidden={surface !== 'page-one'}>{runtime.renderInstance('one')}{runtime.renderInstance('html')}</div>
        <div hidden={surface !== 'page-two'}>{runtime.renderInstance('two')}</div>
        {runtime.renderInstance('global')}
      </> }} />
  }
  const ui = render(<Editor />)
  await waitFor(() => expect(ui.getByRole('button', { name: 'one:0' })).toBeTruthy())
  const finish = async () => { ui.unmount(); await act(async () => { await ports.world.dispose() }) }
  return { ui, project, before, report, read: () => ports, finish }
}

it.each(['run', 'edit'] as const)('returns current Source and HTML closure/DOM state to initial from the real toolbar in %s', async mode => {
  const run = await editor()
  try {
    fireEvent.click(run.ui.getByRole('button', { name: 'one:0' }))
    fireEvent.click(run.ui.getByRole('button', { name: 'html:0' }))
    fireEvent.click(run.ui.getByRole('button', { name: 'global:0' }))
    const original = programs.contexts.get('one')![0], global = programs.contexts.get('global')![0]
    fireEvent.click(run.ui.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'two:0' })).toBeTruthy())
    await waitFor(() => expect(run.ui.getByRole('button', { name: '上一步' })).toBeEnabled())
    fireEvent.click(run.ui.getByRole('button', { name: 'two:0' }))
    const other = programs.contexts.get('two')![0]
    fireEvent.click(run.ui.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'one:1' })).toBeTruthy())
    await waitFor(() => expect(run.ui.getByRole('button', { name: '回到初始画面' })).toBeEnabled())
    expect(programs.contexts.get('one')).toHaveLength(1)
    if (mode === 'edit') fireEvent.click(run.ui.getByRole('button', { name: '编辑' }))
    run.read().world.setState('course-progress', 17)
    const stateWrites = vi.spyOn(run.read().world, 'setState')
    fireEvent.click(run.ui.getByRole('button', { name: '回到初始画面' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'one:0' })).toBeTruthy())
    expect(run.ui.getByRole('button', { name: 'html:0' })).toBeTruthy()
    expect(original.scope.isActive()).toBe(false)
    expect(global.scope.isActive()).toBe(true); expect(other.scope.isActive()).toBe(true)
    expect(programs.contexts.get('global')).toHaveLength(1); expect(programs.contexts.get('two')).toHaveLength(1)
    expect(run.ui.getByRole('button', { name: 'global:1' })).toBeTruthy()
    expect(run.read().world.getState('course-progress')).toBe(17)
    expect(stateWrites.mock.calls.filter(([key]) => key === 'entered')).toHaveLength(mode === 'run' ? 1 : 0)
    expect(run.read().world.isPlaying()).toBe(mode === 'run')
    await waitFor(() => expect(run.ui.getByRole('button', { name: '下一步' })).toBeEnabled())
    fireEvent.click(run.ui.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'two:1' })).toBeTruthy())
    expect(run.project).toEqual(run.before)
  } finally { await run.finish() }
})

it('keeps a stop made during slow program retirement and runs both frozen scene reset requests', async () => {
  const run = await editor()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  try {
    fireEvent.click(run.ui.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'two:0' })).toBeTruthy())
    await waitFor(() => expect(run.ui.getByRole('button', { name: '上一步' })).toBeEnabled())
    fireEvent.click(run.ui.getByRole('button', { name: 'two:0' }))
    fireEvent.click(run.ui.getByRole('button', { name: '上一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'one:0' })).toBeTruthy())
    await waitFor(() => expect(run.ui.getByRole('button', { name: '回到初始画面' })).toBeEnabled())
    programs.retire.set('one', () => pending)
    let first!: Promise<void>, second!: Promise<void>
    await act(async () => {
      first = run.read().resetPlayback(true)
      await Promise.resolve(); await Promise.resolve()
    })
    await waitFor(() => expect(programs.contexts.get('one')![0].scope.isActive()).toBe(false))
    second = run.read().world.resetSurfacePrograms('page-two')
    act(() => run.read().setPlaying(false))
    await act(async () => { release(); await first; await second })
    expect(run.read().world.isPlaying()).toBe(false)
    expect(programs.contexts.get('two')![0].scope.isActive()).toBe(false)
    fireEvent.click(run.ui.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(run.ui.getByRole('button', { name: 'two:0' })).toBeTruthy())
    expect(run.project).toEqual(run.before)
  } finally { release(); await run.finish() }
})

it('executes a full course restart queued behind a scene reset and preserves a later stop', async () => {
  const run = await editor()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  try {
    fireEvent.click(run.ui.getByRole('button', { name: 'global:0' }))
    const global = programs.contexts.get('global')![0]
    run.read().world.setState('course-progress', 17)
    programs.retire.set('one', () => pending)
    const sceneReset = run.read().world.resetSurfacePrograms('page-one')
    await waitFor(() => expect(programs.contexts.get('one')![0].scope.isActive()).toBe(false))
    const restart = run.read().navigation.execute({ type: 'course.restart' })
    act(() => run.read().setPlaying(false))
    await act(async () => { release(); await sceneReset; expect(await restart).toBe(false) })
    expect(global.scope.isActive()).toBe(false)
    expect(run.ui.getByRole('button', { name: 'global:0' })).toBeTruthy()
    expect(run.read().world.getState('course-progress')).toBeUndefined()
    expect(run.read().world.isPlaying()).toBe(false)
    expect(run.project).toEqual(run.before)
  } finally { release(); await run.finish() }
})
