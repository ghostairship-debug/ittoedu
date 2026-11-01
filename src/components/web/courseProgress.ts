import type { ComponentProgressPort } from '../../shared/contracts/component-platform'

/** Explicit async persistence; it neither replaces localStorage nor writes author data. */
export function installCourseProgressReady(target: Window = window) {
  let resolve!: (port: ComponentProgressPort) => void, reject!: (error: Error) => void
  let settled = false
  const ready = new Promise<ComponentProgressPort>((accept, fail) => { resolve = accept; reject = fail })
  void ready.catch(() => {})
  const previous = Object.getOwnPropertyDescriptor(target, 'courseProgressReady')
  Object.defineProperty(target, 'courseProgressReady', { configurable: true, value: ready })
  return {
    connect(port?: ComponentProgressPort) {
      if (settled) return
      settled = true
      if (port) resolve(port)
      else reject(Object.assign(new Error('当前预览或截取环境未启用学习进度；请在正式播放中使用'), { code: 'progress-disabled' }))
    },
    dispose() {
      if (!settled) { settled = true; reject(new Error('内容已关闭')) }
      if (Object.getOwnPropertyDescriptor(target, 'courseProgressReady')?.value !== ready) return
      if (previous) Object.defineProperty(target, 'courseProgressReady', previous)
      else Reflect.deleteProperty(target, 'courseProgressReady')
    },
  }
}
