import { afterEach, expect, it, vi } from 'vitest'
import { installCourseNavigationReady, type WebCourseNavigation } from '../../src/components/web/courseNavigation'
import { createNavigationControlBinder } from '../../src/player/behaviors/navigation/bindNavigationControl'
import { navigationCoverage } from '../../src/player/behaviors/navigation/navigationControls'
import type { TeacherControllerAction, TeacherControllerSnapshot } from '../../src/shared/contracts/component-platform'

const snapshot = (): TeacherControllerSnapshot => ({ locationId: 'b', interactive: true,
  scenes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', targets: [
    { id: 'one', name: 'One', kind: 'state', action: { type: 'scene.go', sceneId: 'b', targetStateId: 'one' } },
    { id: 'two', name: 'Two', kind: 'state', action: { type: 'scene.go', sceneId: 'b', targetStateId: 'two' } },
  ] }, { id: 'c', name: 'C' }],
  progress: { sceneIndex: 1, sceneCount: 3, stepIndex: 1, stepCount: 3, sceneName: 'B', stepName: 'One' },
  zoom: 1, muted: false, fullscreen: false })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('recognizes authored page arrows without imposing a page-internal step sequence or an extra directory', () => {
  expect(navigationCoverage(snapshot(), { actions: [{ type: 'scene.previous' }, { type: 'scene.next' }] }))
    .toMatchObject({ previous: true, next: true, needsDirectory: false })
  expect(navigationCoverage(snapshot(), { actions: [{ type: 'scene.next', containerId: 'unrelated' }] }).next).toBe(false)
  expect(navigationCoverage(snapshot(), { actions: [{ type: 'scene.go', sceneId: 'missing' }] }).next).toBe(false)
})

it('the parser-time HTML navigation proxy preserves real bindings, shadow ownership and teardown', async () => {
  const root = document.createElement('main'), host = document.createElement('section')
  root.append(host); document.body.append(root)
  const shadow = host.attachShadow({ mode: 'open' }), button = document.createElement('button')
  button.textContent = 'Continue'; shadow.append(button)
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 } as DOMRect)
  const actions = new Map<number, { action: TeacherControllerAction; visible: boolean }>(), execute = vi.fn(async () => true)
  const binder = createNavigationControlBinder({ root, live: () => true, read: snapshot, canExecute: () => true, execute,
    report: (id, action, visible) => { actions.set(id, { action, visible }) }, remove: id => { actions.delete(id) } })
  const bridge = installCourseNavigationReady()
  const ready = (window as unknown as { courseNavigationReady: Promise<WebCourseNavigation> }).courseNavigationReady
  try {
    bridge.connect({ read: snapshot, readLocation: () => 'b', subscribe: () => () => {}, canExecute: () => true, execute,
      bindControl: binder.bind })
    const navigation = await ready
    const unbind = navigation.bindControl!(button, { type: 'scene.next' })
    expect([...actions.values()]).toEqual([{ action: { type: 'scene.next' }, visible: true }])
    button.click(); await Promise.resolve()
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: 'scene.next' })
    unbind(); expect(actions.size).toBe(0)
    button.click(); expect(execute).toHaveBeenCalledOnce()
    expect(() => navigation.bindControl!(document.createElement('button'), { type: 'scene.next' })).toThrow('当前组件内容')
  } finally { bridge.dispose(); binder.dispose() }
})
