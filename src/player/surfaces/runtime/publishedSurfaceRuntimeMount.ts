import type {
  SurfaceRuntimeAuthoring,
  SurfaceRuntimeCreateContext,
  SurfaceRuntimeDefinition,
  SurfaceRuntimeInstanceLifecycle,
} from '../../../shared/surfaceRuntimeTypes'
import type {
  CourseEventBus as CourseEventBusContract,
  RuntimeEventDisposer,
  RuntimeEventListener,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../../../shared/runtimeTypes'
import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'
import { CourseEventBus } from '../../CourseEventBus'
import { CourseStateStore } from '../../CourseStateStore'
import { decodePublishedCode } from '../../publishedLesson'
import { validateRuntimeSource } from '../../RuntimeRegistry'

type PublishedSurfaceRuntime = PublishedRuntimeLayerItem['runtime']

export interface PublishedSurfaceRuntimeSession {
  readonly events: CourseEventBus
  readonly courseState: CourseStateStore
  resetCourse(): void
  destroy(): void
}

export interface PublishedSurfaceRuntimeMountHandle {
  readonly ok: boolean
  readonly element: HTMLElement
  setVisible(visible: boolean): void
  suspend(): void
  resume(): void
  destroy(): void
}

export interface PublishedSurfaceRuntimeMountOptions {
  instanceId: string
  runtime: PublishedSurfaceRuntime
  width: number
  height: number
  visible: boolean
  resolveAsset(assetId: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  fallbackText?: string
  actions?: Readonly<RuntimeHostActions>
  presentation?: RuntimePresentationApi
  reportError?(phase: 'register' | 'create' | 'lifecycle' | 'destroy', error: Error): void
}

const inertActions: Readonly<RuntimeHostActions> = Object.freeze({
  goToScene: () => false,
  nextScene: () => false,
  previousScene: () => false,
  replayScene: () => false,
  restartCourse: () => false,
})

const inertPresentation: RuntimePresentationApi = Object.freeze({
  current: () => null,
  states: () => Object.freeze([]),
  setState: () => false,
  transitionTo: () => false,
})

const playbackAuthoring: SurfaceRuntimeAuthoring = Object.freeze({
  registerText: () => () => undefined,
  registerAsset: () => () => undefined,
  invalidate: () => undefined,
})

const activeRegistrationWindows = new WeakSet<object>()

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function reportError(
  options: PublishedSurfaceRuntimeMountOptions,
  phase: 'register' | 'create' | 'lifecycle' | 'destroy',
  cause: unknown,
): Error {
  const error = normalizeError(cause)
  try {
    options.reportError?.(phase, error)
  } catch (reportFailure) {
    console.error('Published Surface Runtime 诊断回调失败', reportFailure)
  }
  return error
}

function isSurfaceRuntimeDefinition(value: unknown): value is SurfaceRuntimeDefinition {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.runtimeApiVersion === 3
    && (record.protocol === undefined || record.protocol === 'surface-runtime')
    && typeof record.create === 'function'
}

function executeSurfaceRuntimeDefinition(
  targetWindow: Window,
  source: string,
  label: string,
): SurfaceRuntimeDefinition {
  validateRuntimeSource(source)
  if (activeRegistrationWindows.has(targetWindow)) {
    throw new Error('同一 Window 不能重入注册 Surface Runtime')
  }
  let definition: SurfaceRuntimeDefinition | null = null
  let loading = true
  const api = Object.freeze({
    define(candidate: unknown): void {
      if (!loading) throw new Error('当前没有正在加载的 Surface Runtime')
      if (definition) throw new Error('Surface Runtime 重复调用了 define')
      if (!isSurfaceRuntimeDefinition(candidate)) {
        throw new Error(
          'Surface Runtime 定义格式无效：只支持 surface-runtime API 3 与 create()',
        )
      }
      definition = candidate
    },
  })
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    targetWindow,
    'CoursewareRuntime',
  )
  activeRegistrationWindows.add(targetWindow)
  try {
    Object.defineProperty(targetWindow, 'CoursewareRuntime', {
      configurable: true,
      enumerable: previousDescriptor?.enumerable ?? true,
      writable: true,
      value: api,
    })
    const safeLabel = label.replace(/[\r\n]/g, '_')
    const RealmFunction = Reflect.get(targetWindow, 'Function')
    if (typeof RealmFunction !== 'function') {
      throw new Error('Surface Runtime 宿主缺少 Function 构造器')
    }
    const execute = RealmFunction(
      'window',
      'CoursewareRuntime',
      `"use strict";\n${source}\n//# sourceURL=h5course-runtime://${safeLabel}/runtime.js`,
    ) as (runtimeWindow: Window, runtimeApi: typeof api) => void
    execute(targetWindow, api)
    if (!definition) throw new Error('没有同步调用 CoursewareRuntime.define')
    return definition
  } finally {
    loading = false
    try {
      if (previousDescriptor) {
        Object.defineProperty(targetWindow, 'CoursewareRuntime', previousDescriptor)
      } else {
        Reflect.deleteProperty(targetWindow, 'CoursewareRuntime')
      }
    } finally {
      activeRegistrationWindows.delete(targetWindow)
    }
  }
}

function frozenStringRecord(values: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze({ ...values })
}

class ScopedRuntimeEvents implements CourseEventBusContract {
  readonly #disposers = new Map<
    string,
    Map<RuntimeEventListener<unknown>, RuntimeEventDisposer>
  >()
  #disposed = false

  constructor(private readonly parent: CourseEventBusContract) {}

  on<T = unknown>(eventName: string, listener: RuntimeEventListener<T>): RuntimeEventDisposer {
    if (this.#disposed) throw new Error('Surface Runtime 事件作用域已销毁')
    const stored = listener as RuntimeEventListener<unknown>
    let eventDisposers = this.#disposers.get(eventName)
    if (!eventDisposers) {
      eventDisposers = new Map()
      this.#disposers.set(eventName, eventDisposers)
    }
    eventDisposers.get(stored)?.()
    const parentDispose = this.parent.on(eventName, stored)
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      parentDispose()
      eventDisposers?.delete(stored)
      if (eventDisposers?.size === 0) this.#disposers.delete(eventName)
    }
    eventDisposers.set(stored, dispose)
    return dispose
  }

  off<T = unknown>(eventName: string, listener: RuntimeEventListener<T>): void {
    this.#disposers.get(eventName)?.get(listener as RuntimeEventListener<unknown>)?.()
  }

  emit<T = unknown>(eventName: string, payload?: T): void {
    if (!this.#disposed) this.parent.emit(eventName, payload)
  }

  listenerCount(): number {
    let count = 0
    for (const eventDisposers of this.#disposers.values()) count += eventDisposers.size
    return count
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const eventDisposers of [...this.#disposers.values()]) {
      for (const dispose of [...eventDisposers.values()]) dispose()
    }
    this.#disposers.clear()
  }
}

function createFallback(
  container: HTMLElement,
  options: PublishedSurfaceRuntimeMountOptions,
): HTMLElement {
  const fallback = container.ownerDocument.createElement('div')
  fallback.className = 'published-surface-runtime-fallback'
  fallback.dataset.runtimeInstanceId = options.instanceId
  fallback.dataset.runtimeFallback = 'true'
  Object.assign(fallback.style, {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'none',
  })
  const fallbackUrl = options.runtime.staticFallback
    ? options.resolveAsset(options.runtime.staticFallback.assetId)
    : undefined
  if (fallbackUrl) {
    const image = container.ownerDocument.createElement('img')
    image.src = fallbackUrl
    image.alt = 'runtime 后备'
    Object.assign(image.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
    })
    fallback.appendChild(image)
  } else {
    fallback.textContent = options.fallbackText ?? '[Surface Runtime 后备]'
    Object.assign(fallback.style, {
      padding: '12px 16px',
      background: '#0f766e',
      color: '#ffffff',
      font: 'bold 16px "Microsoft YaHei", sans-serif',
      textAlign: 'center',
    })
  }
  container.appendChild(fallback)
  return fallback
}

function failedHandle(element: HTMLElement): PublishedSurfaceRuntimeMountHandle {
  let destroyed = false
  return {
    ok: false,
    element,
    setVisible() {},
    suspend() {},
    resume() {},
    destroy() {
      if (destroyed) return
      destroyed = true
      element.remove()
    },
  }
}

function isLifecycle(value: unknown): value is SurfaceRuntimeInstanceLifecycle {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'destroy') === 'function'
}

export function createPublishedSurfaceRuntimeSession(): PublishedSurfaceRuntimeSession {
  const events = new CourseEventBus()
  const courseState = new CourseStateStore()
  let destroyed = false
  return {
    events,
    courseState,
    resetCourse() {
      if (!destroyed) courseState.clear()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      events.dispose()
      courseState.clear()
    },
  }
}

/** Mounts the narrow Published V2 API 3 DOM playback slice for one layer item. */
export function mountPublishedSurfaceRuntime(
  container: HTMLElement,
  options: PublishedSurfaceRuntimeMountOptions,
): PublishedSurfaceRuntimeMountHandle {
  let definition: SurfaceRuntimeDefinition
  try {
    const targetWindow = container.ownerDocument.defaultView
    if (!targetWindow) throw new Error('Surface Runtime 挂载文档没有可执行 Window')
    definition = executeSurfaceRuntimeDefinition(
      targetWindow,
      decodePublishedCode(options.runtime.code, `Runtime“${options.instanceId}”代码`),
      options.instanceId,
    )
  } catch (cause) {
    reportError(options, 'register', cause)
    return failedHandle(createFallback(container, options))
  }

  const host = container.ownerDocument.createElement('div')
  host.className = 'published-surface-runtime-mount'
  host.dataset.runtimeInstanceId = options.instanceId
  Object.assign(host.style, {
    boxSizing: 'border-box',
    display: 'block',
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'auto',
  })
  const root = container.ownerDocument.createElement('div')
  root.dataset.surfaceRuntimeRoot = options.instanceId
  Object.assign(root.style, {
    boxSizing: 'border-box',
    position: 'relative',
    width: '100%',
    height: '100%',
  })
  host.appendChild(root)
  container.appendChild(host)

  const values = frozenStringRecord(options.runtime.content.values)
  const assetBindings = Object.freeze(Object.fromEntries(
    Object.entries(options.runtime.assets).map(([key, binding]) => [
      key,
      Object.freeze({ assetId: binding.assetId }),
    ]),
  ))
  const events = new ScopedRuntimeEvents(options.session.events)
  const context: SurfaceRuntimeCreateContext = {
    runtimeApiVersion: 3,
    mode: 'playback',
    width: options.width,
    height: options.height,
    content: Object.freeze({
      get: (key: string) => {
        if (!Object.hasOwn(values, key)) {
          throw new Error(`Surface Runtime 内容键“${key}”不存在`)
        }
        return values[key]!
      },
      all: () => values,
    }),
    assets: Object.freeze({
      url: (bindingKey: string) => {
        const binding = assetBindings[bindingKey]
        if (!binding) {
          throw new Error(`Surface Runtime 素材绑定“${bindingKey}”不存在`)
        }
        const url = options.resolveAsset(binding.assetId)
        if (!url) {
          throw new Error(`Surface Runtime 素材“${binding.assetId}”无法解析`)
        }
        return url
      },
      projectUrl: (assetId: string) => {
        const url = options.resolveAsset(assetId)
        if (!url) throw new Error(`Surface Runtime 工程素材“${assetId}”无法解析`)
        return url
      },
    }),
    courseState: options.session.courseState,
    presentation: options.presentation ?? inertPresentation,
    actions: options.actions ?? inertActions,
    events,
    capture: Object.freeze({
      waitUntil(promise: Promise<unknown>) {
        void Promise.resolve(promise).catch((cause) => {
          reportError(options, 'lifecycle', cause)
        })
      },
    }),
    dom: { root },
    authoring: playbackAuthoring,
    emit(eventName: string, payload?: unknown) {
      events.emit('runtime:event', {
        scope: 'scene',
        instanceId: options.instanceId,
        eventName,
        payload,
      })
    },
  }

  let lifecycle: SurfaceRuntimeInstanceLifecycle
  let instanceDestroyed = false
  try {
    const created = definition.create(context)
    if (!isLifecycle(created)) {
      throw new Error('Surface Runtime create() 必须返回含 destroy() 的生命周期对象')
    }
    lifecycle = created
    lifecycle.setMode?.('playback')
    lifecycle.resize?.(options.width, options.height)
    lifecycle.setVisible?.(options.visible)
    if (!options.visible) lifecycle.suspend?.()
  } catch (cause) {
    reportError(options, 'create', cause)
    try {
      if (lifecycle! && !instanceDestroyed) {
        instanceDestroyed = true
        lifecycle.destroy()
      }
    } catch (destroyCause) {
      reportError(options, 'destroy', destroyCause)
    }
    events.dispose()
    host.remove()
    return failedHandle(createFallback(container, options))
  }

  let quarantined = false
  const invoke = (operation: (() => void) | undefined): void => {
    if (!operation || quarantined || instanceDestroyed) return
    try {
      operation()
    } catch (cause) {
      quarantined = true
      reportError(options, 'lifecycle', cause)
    }
  }

  return {
    ok: true,
    element: host,
    setVisible(visible: boolean) {
      invoke(lifecycle.setVisible?.bind(lifecycle, visible))
    },
    suspend() {
      invoke(lifecycle.suspend?.bind(lifecycle))
    },
    resume() {
      invoke(lifecycle.resume?.bind(lifecycle))
    },
    destroy() {
      if (instanceDestroyed) return
      instanceDestroyed = true
      try {
        lifecycle.destroy()
      } catch (cause) {
        reportError(options, 'destroy', cause)
      } finally {
        events.dispose()
        root.replaceChildren()
        host.remove()
      }
    },
  }
}
