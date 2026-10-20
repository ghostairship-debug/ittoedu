import type { TeacherControllerPort } from '../../shared/contracts/component-platform'

/** The content-facing subset of the existing course navigation owner. */
export type WebCourseNavigation = Pick<TeacherControllerPort, 'read' | 'readLocation' | 'subscribe' | 'canExecute' | 'execute'>

/** Serialized into the content realm before authored scripts are parsed. */
export function installCourseNavigationReady(target: Window = window) {
  let resolve!: (port: WebCourseNavigation) => void, reject!: (error: Error) => void
  let settled = false
  const ready = new Promise<WebCourseNavigation>((accept, fail) => { resolve = accept; reject = fail })
  // A document without authored navigation need not consume the promise.
  void ready.catch(() => {})
  const previous = Object.getOwnPropertyDescriptor(target, 'courseNavigationReady')
  Object.defineProperty(target, 'courseNavigationReady', { configurable: true, value: ready })
  return {
    connect(port?: WebCourseNavigation) {
      if (settled) return
      settled = true
      if (!port) { reject(new Error('当前载体未接通正式课程导航')); return }
      resolve({ read: () => port.read(), readLocation: () => port.readLocation(),
        subscribe: listener => port.subscribe(listener), canExecute: action => port.canExecute(action),
        execute: (action, signal) => port.execute(action, signal) })
    },
    dispose() {
      if (!settled) { settled = true; reject(new Error('内容已关闭')) }
      if (Object.getOwnPropertyDescriptor(target, 'courseNavigationReady')?.value !== ready) return
      if (previous) Object.defineProperty(target, 'courseNavigationReady', previous)
      else Reflect.deleteProperty(target, 'courseNavigationReady')
    },
  }
}
