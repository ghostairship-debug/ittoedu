import { StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { CourseV10RuntimeView, type CourseV10RuntimePorts } from '../../src/renderer/components/CourseV10RuntimeView'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const project = (): CourseProjectV10 => ({ schemaVersion: 10, id: 'commit', revision: 0, title: '提交后运行',
  definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
  instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('初始文字'))) } },
  surfaces: [{ id: 'page', kind: 'slide', title: '本页', childIds: ['text'], designSize: { width: 800, height: 600 } }],
  global: { underlay: [], overlay: [] }, assets: {} })
const resources = { assets: {}, components: {} }

it('waits for the DOM projection commit before mounting and binding observation, and retires a commit in flight', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const order: string[] = []
  const prepare = ComponentPlatformRuntime.prototype.prepareResources
  vi.spyOn(ComponentPlatformRuntime.prototype, 'prepareResources').mockImplementation(function (model, bytes) {
    order.push('resources'); return prepare.call(this, model, bytes)
  })
  let commit!: () => void
  const release = vi.fn(), disposeProjection = vi.fn(), observed = { readZoom: () => 1, setZoom() {}, reset() {} }
  const model = { kind: 'course-v10' as const, project: project(), resources }
  const player = mountV10Model({ root, model, runScopeId: 'dom-commit',
    onObservation: () => { expect(root.textContent).toContain('初始文字'); order.push('observation'); return release },
    createProjection: ({ runtime, signal }) => ({
      sync: () => new Promise<void>(resolve => {
        order.push('projection-request')
        commit = () => { if (!signal.aborted) { runtime.bind('text', root); order.push('projection-commit') }; resolve() }
        signal.addEventListener('abort', () => resolve(), { once: true })
      }),
      observation: () => observed, revealSurface: () => true, dispose: disposeProjection,
    }),
  })
  await waitFor(() => expect(order).toContain('projection-request'))
  expect(order).toEqual(['resources', 'projection-request']); expect(root.textContent).toBe('')
  let ready = false; void player.ready.then(() => { ready = true })
  await Promise.resolve(); expect(ready).toBe(false)
  commit(); await player.ready
  expect(order.indexOf('projection-commit')).toBeLessThan(order.indexOf('observation'))
  expect(root.textContent).toContain('初始文字')
  const updating = player.update(model)
  await Promise.resolve(); await Promise.resolve()
  await player.dispose(); await updating
  expect(release).toHaveBeenCalledTimes(1); expect(disposeProjection).toHaveBeenCalledTimes(1)
  expect(root.textContent).toBe(''); root.remove()
})

it('retains the actual React runtime through StrictMode, ancestor replacement and pause/resume, then applies the committed model', async () => {
  let ports!: CourseV10RuntimePorts
  const diagnostics = vi.fn(), source = project(), initial = { kind: 'course-v10' as const, project: source, resources }
  const draw = (model: typeof initial, key: string) => <StrictMode><CourseV10RuntimeView documentId="react-document" model={model}
    surfaceId="page" selectedInstanceId={null} player={false} onSelect={() => {}} onSurfaceSelect={() => {}} report={diagnostics}
    projectionKey={key} renderWorkspace={runtime => { ports = runtime; return <section key={key}>{runtime.renderInstance('text')}</section> }} /> </StrictMode>
  const ui = render(draw(initial, 'light'))
  await waitFor(() => expect(ui.container.textContent).toContain('初始文字'))
  const world = ports.world, renderRoot = world.contentElement('text')!.firstElementChild
  world.setState('kept', 7)
  act(() => { ports.setPlaying(true); ports.setPlaying(false); ports.setPlaying(true) })
  ui.rerender(draw(initial, 'deep'))
  await waitFor(() => expect(world.contentElement('text')!.firstElementChild).toBe(renderRoot))
  expect(ports.world).toBe(world); expect(world.getState('kept')).toBe(7); expect(world.isPlaying()).toBe(true)
  const changed = structuredClone(source)
  changed.revision++; changed.instances.text.data = JSON.parse(JSON.stringify(createTextComponentData('正式新文字')))
  ui.rerender(draw({ ...initial, project: changed }, 'deep'))
  await waitFor(() => expect(ui.container.textContent).toContain('正式新文字'))
  expect(ports.world).toBe(world); expect(world.getState('kept')).toBe(7); expect(diagnostics).not.toHaveBeenCalled()
  ui.unmount()
  await act(async () => { await Promise.resolve(); await world.dispose() })
  expect(world.contentElement('text')).toBeUndefined()
})
