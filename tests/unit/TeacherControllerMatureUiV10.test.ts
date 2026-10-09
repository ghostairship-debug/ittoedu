import { describe, expect, it, vi } from 'vitest'
import { createTeacherControllerData, createTeacherControllerRuntimeImplementation } from '../../src/components/teacher-controller'
import type { ComponentInstance, ComponentRuntimeScope, TeacherControllerPort, TeacherControllerSnapshot } from '../../src/shared/contracts/component-platform'
import { jsonValueSchema } from '../../src/shared/contracts/component-platform/schema'

async function fixture(interactive: boolean | undefined, defaultCollapsed: boolean) {
  const root = document.createElement('div'); document.body.append(root)
  const listeners = new Set<() => void>(), cleanups: (() => void)[] = [], controller = new AbortController()
  const snapshot: TeacherControllerSnapshot = { locationId: 'a', scenes: [{ id: 'a', name: '演示' }, { id: 'b', name: '讲义' }],
    progress: { sceneIndex: 0, sceneCount: 2, stepIndex: 0, stepCount: 3, sceneName: '演示', stepName: '开始' },
    interactive, zoom: 1, muted: false, fullscreen: false }
  const notify = () => { for (const listener of listeners) listener() }
  const port: TeacherControllerPort = {
    read: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, canExecute: () => true,
    execute: vi.fn(async action => { if (action.type === 'scene.go') snapshot.locationId = action.sceneId; notify(); return true }),
    setCollapsed: vi.fn(value => { snapshot.collapsed = value; notify() }), moveBy: vi.fn(),
    setZoom: vi.fn(value => { snapshot.zoom = value; notify() }), resetView: vi.fn(),
  }
  const scope: ComponentRuntimeScope = { runScopeId: 'authoring', instanceId: 'controller', generation: 1, signal: controller.signal,
    isActive: () => !controller.signal.aborted, cleanup: dispose => { cleanups.push(dispose) }, target: () => null,
    events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } }
  const instance: ComponentInstance = { id: 'controller', definitionId: 'guoling.navigation',
    data: jsonValueSchema.parse({ ...createTeacherControllerData(), defaultCollapsed, backgroundAssetId: 'texture' }),
    frame: { width: 880, height: 64, transform: [1, 0, 0, 1, 200, 638] } }
  const frame = structuredClone(instance.frame)
  const mounted = await createTeacherControllerRuntimeImplementation(port).mount({ root, instance, scope, resources: { url: id => id === 'texture' ? 'blob:controller-texture' : undefined } })
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`[data-control="${id}"]`)!
  return { root, instance, frame, snapshot, port, notify, button, listeners,
    dispose: async () => { controller.abort(); cleanups.forEach(dispose => dispose()); await mounted.dispose(); root.remove() } }
}

function pointer(target: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
}

describe('mature teacher UI on the V10 navigation port', () => {
  it('restores the 52px round entrance, full controls, directory and zoom while preserving the author frame', async () => {
    const value = await fixture(undefined, true)
    try {
      const panel = value.root.querySelector<HTMLElement>('nav[aria-label="教师控制台"]')!
      const style = getComputedStyle(panel)
      expect([style.width, style.height, style.borderRadius, style.right, style.bottom]).toEqual(['52px', '52px', '50%', '0px', '0px'])
      expect(value.root.style.width).toBe('100%')
      expect(value.root.style.height).toBe('100%')
      expect(value.button('collapse').getAttribute('aria-expanded')).toBe('false')
      expect(panel.style.backgroundImage).toContain('blob:controller-texture')
      value.button('collapse').click()
      expect(panel.classList.contains('collapsed')).toBe(false)
      expect(panel.querySelector('.identity strong')?.textContent).toBe('教师控制台')
      expect(panel.querySelector('.track i')).not.toBeNull()
      expect(panel.querySelectorAll('.steps button svg')).toHaveLength(2)
      expect(panel.querySelector('.tools button svg')).not.toBeNull()
      value.button('directory').click()
      expect(panel.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('场景目录')
      expect(panel.querySelectorAll('.scene-row')).toHaveLength(2)
      expect(value.button('scene-a').getAttribute('aria-current')).toBe('page')
      value.button('scene-b').click(); await Promise.resolve(); await Promise.resolve()
      expect(value.port.execute).toHaveBeenCalledWith({ type: 'scene.go', sceneId: 'b' })
      expect(value.snapshot.locationId).toBe('b')
      expect(panel.querySelector('[role="dialog"]')).toBeNull()
      value.button('zoom').click(); value.button('zoom-in').click()
      expect(value.port.setZoom).toHaveBeenCalledWith(1.25)
      expect(panel.querySelector('.zoom-value')?.textContent).toBe('125%')
      expect(value.instance.frame).toEqual(value.frame)
    } finally { await value.dispose() }
    expect(value.listeners.size).toBe(0)
  })

  it('keeps author controls visually available but inert, then enables the same UI and session drag in play', async () => {
    const value = await fixture(false, false)
    try {
      const panel = value.root.querySelector<HTMLElement>('nav')!
      expect(value.button('next').disabled).toBe(false)
      value.button('next').click(); value.button('collapse').click(); value.button('zoom').click()
      pointer(panel, 'pointerdown', 100, 100); pointer(panel, 'pointermove', 120, 112)
      expect(value.port.execute).not.toHaveBeenCalled()
      expect(value.port.setCollapsed).not.toHaveBeenCalled()
      expect(value.port.moveBy).not.toHaveBeenCalled()
      expect(panel.querySelector('[role="dialog"]')).toBeNull()
      value.snapshot.interactive = true; value.notify()
      value.button('next').click(); await Promise.resolve()
      expect(value.port.execute).toHaveBeenCalledWith({ type: 'step.next' })
      pointer(panel, 'pointerdown', 100, 100); pointer(panel, 'pointermove', 120, 112); pointer(panel, 'pointerup', 120, 112)
      expect(value.port.moveBy).toHaveBeenCalledExactlyOnceWith(20, 12)
      value.snapshot.interactive = false; value.notify()
      pointer(panel, 'pointerdown', 120, 112); pointer(panel, 'pointermove', 140, 124)
      expect(value.port.moveBy).toHaveBeenCalledTimes(1)
      expect(value.instance.frame).toEqual(value.frame)
    } finally { await value.dispose() }
  })
})
