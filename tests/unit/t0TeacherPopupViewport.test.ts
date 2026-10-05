import { describe, expect, it } from 'vitest'
import { mount } from '../../src/components/teacher-controller/defaultController'
import { createTeacherControllerData, createTeacherControllerFrame } from '../../src/components/teacher-controller/data'
import type { ComponentRuntimeScope, TeacherControllerPort } from '../../src/shared/contracts/component-platform'

async function fixture(viewportBounds?: TeacherControllerPort['viewportBounds']) {
  const root = document.createElement('div')
  document.body.append(root)
  Object.defineProperty(root, 'offsetWidth', { value: 880 })
  root.getBoundingClientRect = () => new DOMRect(600, 160, 880, 64)
  const abort = new AbortController(), cleanups: (() => void)[] = []
  const scope: ComponentRuntimeScope = {
    runScopeId: 't0-popup', instanceId: 'teacher', generation: 1, signal: abort.signal,
    isActive: () => !abort.signal.aborted, cleanup: dispose => { cleanups.push(dispose) }, target: () => null,
    events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} },
  }
  const port: TeacherControllerPort = {
    read: () => ({ locationId: 'page', scenes: [{ id: 'page', name: '当前页' }], progress: null, collapsed: false, zoom: 1, muted: false, fullscreen: false }),
    subscribe: () => () => {}, viewportBounds, canExecute: () => true, execute: async () => true,
    setCollapsed() {}, moveBy() {}, setZoom() {}, resetView() {},
  }
  const instance = { id: 'teacher', definitionId: 'guoling.navigation', data: createTeacherControllerData(), frame: createTeacherControllerFrame() }
  const savedFrame = structuredClone(instance.frame)
  const mounted = mount({ root, scope, instance, teacherController: port })
  const panel = root.querySelector<HTMLElement>('nav')!
  panel.getBoundingClientRect = () => new DOMRect(600, 160, 880, 64)
  const originalBounds = HTMLElement.prototype.getBoundingClientRect
  // The popup starts aligned with the saved frame's right edge, beyond the live region.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('popover') ? new DOMRect(1160, 0, 320, 400) : originalBounds.call(this)
  }
  try { root.querySelector<HTMLButtonElement>('[data-control="directory"]')!.click() }
  finally { HTMLElement.prototype.getBoundingClientRect = originalBounds }
  return { popup: panel.querySelector<HTMLElement>('.popover')!, instance, savedFrame,
    dispose: () => { abort.abort(); cleanups.forEach(dispose => dispose()); mounted.dispose(); root.remove() } }
}

describe('T0 teacher popup uses the live playback viewport', () => {
  it('fits the directory into the actual region and chooses vertical space relative to its top', async () => {
    const value = await fixture(() => ({ left: 400, top: 100, right: 1200, bottom: 740 }))
    try {
      expect(value.popup.style.maxWidth).toBe('776px')
      expect(value.popup.style.right).toBe('292px')
      expect(value.popup.style.top).toBe('calc(100% + 12px)')
      expect(value.popup.style.bottom).toBe('auto')
      expect(value.popup.querySelector<HTMLElement>('.scene-list')!.style.maxHeight).toBe('300px')
      expect(value.instance.frame).toEqual(value.savedFrame)
    } finally { value.dispose() }
  })

  it('retains the document viewport fallback when the host has no bounds', async () => {
    const width = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth')
    const height = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight')
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 700 })
    const value = await fixture()
    try {
      expect(value.popup.style.maxWidth).toBe('976px')
      expect(value.popup.style.right).toBe('492px')
      expect(value.instance.frame).toEqual(value.savedFrame)
    } finally {
      value.dispose()
      if (width) Object.defineProperty(document.documentElement, 'clientWidth', width)
      else Reflect.deleteProperty(document.documentElement, 'clientWidth')
      if (height) Object.defineProperty(document.documentElement, 'clientHeight', height)
      else Reflect.deleteProperty(document.documentElement, 'clientHeight')
    }
  })
})
