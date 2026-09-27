import { scopeDynamicHostApi } from '../../../shared/dynamicHostApiScope'
import type {
  SurfaceRuntimeAuthoring,
  SurfaceRuntimeCreateContext,
  SurfaceRuntimeDefinition,
  SurfaceRuntimeInstanceLifecycle,
} from '../../../shared/surfaceRuntimeTypes'
import type {
  CourseEventBus as CourseEventBusContract,
  CourseStateStore as CourseStateStoreContract,
  RuntimeEventDisposer,
  RuntimeEventListener,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../../../shared/runtimeTypes'
import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'
import { CourseEventBus } from '../../CourseEventBus'
import { CourseStateStore } from '../../CourseStateStore'
import { decodePublishedCode } from '../../decodePublishedExecutableCode'
import { validateRuntimeSource } from '../../RuntimeRegistry'
import { registerPublishedDynamicUpdateProbe } from '../publishedDynamicUpdateProbe'
import { DomTextOverrides } from '../../lightEdit/domTextOverrides'
import { managedHtmlDocuments, watchManagedHtmlDocuments } from '../../lightEdit/htmlDocumentRoots'
import { observeSurfaceRuntimeContentSize, type FlowHtmlConfirmationMode, type SurfaceRuntimeContentSizeObserver, type SurfaceRuntimeContentSource } from './surfaceRuntimeContentSize'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import type { RuntimeAuthoringTargetsChangedHandler } from '../../RuntimeAuthoringTargetRegistry'
import {
  PublishedCaptureBarrier,
  registerPublishedCaptureResource,
} from '../publishedCapture'
import {
  applyPublishedRuntimeAuthoringText,
  PublishedSurfaceRuntimeAuthoringTargets,
  type PublishedRuntimeAuthoringMountOptions,
} from './publishedSurfaceRuntimeAuthoringTargets'

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
  applyAuthoringContentValue(key: string, value: string): boolean
  /** M15: apply edited text rules in place, keeping the Runtime's current state. */
  applyAuthoringTextOverrides(rules: readonly LightEditTextOverride[]): boolean
  /**
   * M15 运行现场: publish the text and pictures the host finds in this playback Runtime while its page is paused for
   * editing. Returns the stop function, or null when it cannot.
   */
  startLiveEdit?(input: { sceneId?: string; onTargetsChanged: RuntimeAuthoringTargetsChangedHandler }): (() => void) | null
  /** M15 运行现场: apply edited text rules to this playback Runtime in place. */
  applyLiveTextOverrides?(rules: readonly LightEditTextOverride[]): boolean
  waitForReady(): Promise<void>
  waitForObservationReady?(): Promise<void>
  waitForCaptureReady(): Promise<void>
  failCapture?(error: Error): void
  restoreAfterCapture(): void
  setVisible(visible: boolean): void
  updateSize(width: number, height: number): void
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
  mode?: 'playback' | 'authoring' | 'capture'
  resolveAsset(assetId: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  authoring?: PublishedRuntimeAuthoringMountOptions
  courseState?: CourseStateStoreContract
  fallbackText?: string
  onContentHeightChange?(height: number): void
  contentSizeSource?: () => SurfaceRuntimeContentSource | null
  flowHtmlConfirmationMode?: FlowHtmlConfirmationMode
  actions?: Readonly<RuntimeHostActions>
  presentation?: RuntimePresentationApi
  reportError?(phase: 'register' | 'create' | 'lifecycle' | 'destroy', error: Error): void
}

const inertActions: Readonly<RuntimeHostActions> = Object.freeze({
  goToScene: () => false,
  goToLocation: () => false,
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

function cloneIntoRuntimeRealm<T>(targetWindow: Window, value: T): T {
  const RuntimeArray = Reflect.get(targetWindow, 'Array')
  const RuntimeObject = Reflect.get(targetWindow, 'Object')
  if (typeof RuntimeArray !== 'function' || typeof RuntimeObject !== 'function') {
    throw new Error('Surface Runtime 宿主缺少 Object/Array 构造器')
  }
  const memo = new WeakMap<object, unknown>()
  const clone = (input: unknown): unknown => {
    if (typeof input !== 'object' || input === null) return input
    const cached = memo.get(input)
    if (cached !== undefined) return cached
    const output = Array.isArray(input)
      ? Reflect.construct(RuntimeArray, []) as unknown[]
      : Reflect.construct(RuntimeObject, []) as Record<string, unknown>
    memo.set(input, output)
    for (const [key, entry] of Object.entries(input)) {
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: clone(entry),
      })
    }
    return output
  }
  return clone(value) as T
}

function cloneRuntimeStateIntoHostRealm(targetWindow: Window, value: unknown): unknown {
  const RuntimeArray = Reflect.get(targetWindow, 'Array')
  const RuntimeObject = Reflect.get(targetWindow, 'Object')
  if (typeof RuntimeArray !== 'function' || typeof RuntimeObject !== 'function') {
    throw new Error('Surface Runtime 宿主缺少 Object/Array 构造器')
  }
  const runtimeArrayPrototype = Reflect.get(RuntimeArray, 'prototype')
  const runtimeObjectPrototype = Reflect.get(RuntimeObject, 'prototype')
  const active = new WeakSet<object>()
  const memo = new WeakMap<object, unknown>()
  const clone = (input: unknown): unknown => {
    if (
      input === null
      || input === undefined
      || typeof input === 'string'
      || typeof input === 'number'
      || typeof input === 'boolean'
      || typeof input === 'bigint'
    ) return input
    if (typeof input !== 'object') {
      throw new TypeError('Surface Runtime courseState 只能保存纯数据')
    }
    if (active.has(input)) {
      throw new TypeError('Surface Runtime courseState 不能包含循环引用')
    }
    const isArray = Array.isArray(input)
    const prototype = Object.getPrototypeOf(input)
    if (
      (isArray && prototype !== runtimeArrayPrototype && prototype !== Array.prototype)
      || (
        !isArray
        && prototype !== runtimeObjectPrototype
        && prototype !== Object.prototype
        && prototype !== null
      )
    ) {
      throw new TypeError('Surface Runtime courseState 不能保存类实例或平台对象')
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      throw new TypeError('Surface Runtime courseState 不能包含 Symbol 属性')
    }
    const cached = memo.get(input)
    if (cached !== undefined) return cached
    const output: unknown[] | Record<string, unknown> = isArray ? [] : {}
    memo.set(input, output)
    active.add(input)
    try {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
        if (isArray && key === 'length') continue
        if (!('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('Surface Runtime courseState 只能包含可枚举数据属性')
        }
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: clone(descriptor.value),
        })
      }
    } finally {
      active.delete(input)
    }
    return output
  }
  return clone(value)
}

function createRealmCourseStateStore(
  targetWindow: Window,
  store: CourseStateStoreContract,
): CourseStateStoreContract {
  return Object.freeze({
    get<T>(key: string): T | undefined {
      return cloneIntoRuntimeRealm(targetWindow, store.get<T>(key))
    },
    set(key: string, value: unknown): void {
      store.set(key, cloneRuntimeStateIntoHostRealm(targetWindow, value))
    },
    delete(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
    snapshot(): Record<string, unknown> {
      return cloneIntoRuntimeRealm(targetWindow, store.snapshot())
    },
  })
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
    this.#disposers.get(eventName)?.get(stored)?.()
    let eventDisposers = this.#disposers.get(eventName)
    if (!eventDisposers) {
      eventDisposers = new Map()
      this.#disposers.set(eventName, eventDisposers)
    }
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

  listenerCount(eventName?: string): number {
    if (eventName !== undefined) return this.#disposers.get(eventName)?.size ?? 0
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

function failedHandle(
  element: HTMLElement,
  owner: HTMLElement,
  cause: unknown,
): PublishedSurfaceRuntimeMountHandle {
  let destroyed = false
  const failure = cause instanceof Error ? cause : new Error(String(cause))
  const handle: PublishedSurfaceRuntimeMountHandle = {
    ok: false,
    element,
    applyAuthoringContentValue: () => false,
    applyAuthoringTextOverrides: () => false,
    waitForReady: () => Promise.reject(failure),
    waitForCaptureReady: () => Promise.reject(failure),
    restoreAfterCapture() {},
    setVisible() {},
    updateSize() {},
    suspend() {},
    resume() {},
    destroy() {
      if (destroyed) return
      destroyed = true
      unregisterCapture()
      element.remove()
    },
  }
  const unregisterCapture = registerPublishedCaptureResource(owner, handle)
  return handle
}

function isLifecycle(value: unknown): value is SurfaceRuntimeInstanceLifecycle {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'destroy') === 'function'
}

export function createPublishedSurfaceRuntimeSession(
  sharedCourseState?: CourseStateStore,
): PublishedSurfaceRuntimeSession {
  const events = new CourseEventBus()
  const courseState = sharedCourseState ?? new CourseStateStore()
  const ownsCourseState = sharedCourseState === undefined
  let destroyed = false
  return {
    events,
    courseState,
    resetCourse() {
      if (!destroyed && ownsCourseState) courseState.clear()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      events.dispose()
      if (ownsCourseState) courseState.clear()
    },
  }
}

/** Mounts the narrow Published V2 API 3 DOM playback slice for one layer item. */
export function mountPublishedSurfaceRuntime(
  container: HTMLElement,
  options: PublishedSurfaceRuntimeMountOptions,
): PublishedSurfaceRuntimeMountHandle {
  let definition: SurfaceRuntimeDefinition
  let targetWindow: Window
  try {
    const runtimeWindow = container.ownerDocument.defaultView
    if (!runtimeWindow) throw new Error('Surface Runtime 挂载文档没有可执行 Window')
    targetWindow = runtimeWindow
    definition = executeSurfaceRuntimeDefinition(
      targetWindow,
      decodePublishedCode(options.runtime.code, `Runtime“${options.instanceId}”代码`),
      options.instanceId,
    )
  } catch (cause) {
    reportError(options, 'register', cause)
    return failedHandle(createFallback(container, options), container, cause)
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
    pointerEvents: 'inherit',
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
  const courseState = createRealmCourseStateStore(
    targetWindow,
    options.courseState ?? options.session.courseState,
  )
  const publishedMode = options.mode ?? 'playback'
  const surfaceMode = publishedMode === 'authoring' ? 'inspect' : publishedMode
  // M15: the Runtime's own text follows its rules in every mode; light editing never fails the Runtime.
  let authoringTargets: PublishedSurfaceRuntimeAuthoringTargets | null = null
  let domText: DomTextOverrides | null = null
  try { domText = new DomTextOverrides([root], options.runtime.content.overrides ?? [], () => authoringTargets?.invalidate()) }
  catch (error) { console.warn(`Surface Runtime“${options.instanceId}”的文字修改暂不可用`, error) }
  const assetKeyByUrl = new Map<string, string>()
  for (const [key, binding] of Object.entries(options.runtime.assets)) {
    const url = options.resolveAsset(binding.assetId)
    if (url) assetKeyByUrl.set(url, key)
  }
  authoringTargets = publishedMode === 'authoring' && options.authoring
    ? new PublishedSurfaceRuntimeAuthoringTargets({
        root,
        width: options.width,
        height: options.height,
        content: options.runtime.content,
        assets: options.runtime.assets,
        authoring: options.authoring,
        lightEdit: { ...(domText ? { dom: domText } : {}), assetKeyForUrl: url => assetKeyByUrl.get(url) },
      })
    : null
  const captureBarrier = new PublishedCaptureBarrier()
  const context: SurfaceRuntimeCreateContext = {
    runtimeApiVersion: 3,
    mode: surfaceMode,
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
    courseState: scopeDynamicHostApi(courseState, () => !instanceDestroyed),
    presentation: scopeDynamicHostApi(publishedMode === 'authoring' ? inertPresentation : options.presentation ?? inertPresentation, () => !instanceDestroyed),
    actions: scopeDynamicHostApi(publishedMode === 'authoring' ? inertActions : options.actions ?? inertActions, () => !instanceDestroyed),
    events,
    capture: Object.freeze({
      waitUntil(promise: Promise<unknown>) {
        captureBarrier.waitUntil(promise)
        void Promise.resolve(promise).catch((cause) => {
          reportError(options, 'lifecycle', cause)
        })
      },
    }),
    dom: { root },
    authoring: authoringTargets ?? playbackAuthoring,
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
    if (options.onContentHeightChange) {
      for (const iframe of root.querySelectorAll<HTMLIFrameElement>('iframe[data-html-document-runtime="true"]')) {
        iframe.setAttribute('scrolling', 'no')
      }
    }
    try { domText?.applyAll() } catch (error) { console.warn(`Surface Runtime“${options.instanceId}”的文字修改暂不可用`, error) }
    lifecycle.setMode?.(surfaceMode)
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
    authoringTargets?.destroy()
    domText?.destroy()
    captureBarrier.destroy()
    events.dispose()
    host.remove()
    return failedHandle(createFallback(container, options), container, cause)
  }

  let contentSizeObserver: SurfaceRuntimeContentSizeObserver | null = null
  let stopWatchingManagedHeight: (() => void) | null = null
  if (options.onContentHeightChange) {
    const source = options.contentSizeSource ?? (() : SurfaceRuntimeContentSource | null => {
      const iframe = root.querySelector<HTMLIFrameElement>('iframe[data-html-document-runtime="true"]')
      if (!iframe) return { kind: 'viewport', origin: root, viewportElements: new Set([root]) }
      if (iframe.dataset.htmlDocumentReady !== 'true') return null
      if (iframe.clientWidth <= 0 || iframe.clientHeight <= 0) return null
      const managed = managedHtmlDocuments(root).find(item => item.iframe === iframe)
      return managed ? { kind: 'managed-document', iframe, origin: managed.root, minimumHeight: 1 } : null
    })
    contentSizeObserver = observeSurfaceRuntimeContentSize({
      root,
      source,
      flowHtmlConfirmationMode: options.flowHtmlConfirmationMode,
      onHeightChange: options.onContentHeightChange,
      onError: error => quarantine(error),
    })
    if (!options.contentSizeSource) stopWatchingManagedHeight = watchManagedHtmlDocuments(root, () => contentSizeObserver?.refresh())
  }
  let quarantined = false
  let capturePrepared = false
  let captureFailure: Error | null = null
  let suspended = !options.visible
  let visibleElement: HTMLElement = host
  const quarantine = (cause: unknown): void => {
    if (quarantined || instanceDestroyed) return
    quarantined = true
    captureFailure = reportError(options, 'lifecycle', cause)
    captureBarrier.fail(captureFailure)
    authoringTargets?.destroy()
    domText?.destroy()
    events.dispose()
    stopWatchingManagedHeight?.()
    contentSizeObserver?.destroy()
    instanceDestroyed = true
    try { lifecycle.destroy() } catch (error) { reportError(options, 'destroy', error) }
    captureBarrier.destroy()
    root.replaceChildren()
    host.remove()
    visibleElement = createFallback(container, options)
  }
  const invoke = (operation: () => void): void => {
    if (quarantined || instanceDestroyed) return
    try {
      operation()
    } catch (cause) {
      quarantine(cause)
    }
  }

  let unregisterCapture: () => void = () => undefined
  let unregisterUpdateProbe: () => void = () => undefined
  const handle: PublishedSurfaceRuntimeMountHandle = {
    get ok() { return !quarantined },
    get element() { return visibleElement },
    failCapture: quarantine,
    applyAuthoringContentValue(key: string, value: string) {
      if (
        options.mode !== 'authoring'
        || instanceDestroyed
        || !Object.prototype.hasOwnProperty.call(options.runtime.content.values, key)
      ) return false
      options.runtime.content.values[key] = value
      const updated = applyPublishedRuntimeAuthoringText(host, key, value)
      authoringTargets?.invalidate()
      return updated
    },
    applyAuthoringTextOverrides(rules: readonly LightEditTextOverride[]) {
      if (instanceDestroyed || quarantined || !domText) return false
      try { domText.setRules(rules) } catch (error) { console.warn(`Surface Runtime“${options.instanceId}”的文字修改暂不可用`, error); return false }
      authoringTargets?.invalidate()
      return true
    },
    startLiveEdit(input) {
      if (publishedMode !== 'playback' || instanceDestroyed || quarantined || authoringTargets) return null
      authoringTargets = new PublishedSurfaceRuntimeAuthoringTargets({
        root,
        width: options.width,
        height: options.height,
        content: options.runtime.content,
        assets: options.runtime.assets,
        authoring: { scope: 'scene', ...(input.sceneId ? { sceneId: input.sceneId } : {}), onTargetsChanged: input.onTargetsChanged },
        lightEdit: { ...(domText ? { dom: domText } : {}), assetKeyForUrl: url => assetKeyByUrl.get(url) },
      })
      return () => {
        authoringTargets?.destroy()
        authoringTargets = null
      }
    },
    applyLiveTextOverrides(rules: readonly LightEditTextOverride[]) {
      if (publishedMode !== 'playback') return false
      options.runtime.content.overrides = rules.map(rule => ({ ...rule }))
      return handle.applyAuthoringTextOverrides(rules)
    },
    async waitForReady() {
      if (captureFailure) throw captureFailure
      if (instanceDestroyed) throw new Error(`Surface Runtime“${options.instanceId}”已销毁`)
      if (quarantined) {
        throw captureFailure ?? new Error(`Surface Runtime“${options.instanceId}”未完成启动`)
      }
    },
    async waitForObservationReady() {
      await handle.waitForReady()
      await captureBarrier.waitForReady()
      await contentSizeObserver?.waitForReady()
      await handle.waitForReady()
    },
    async waitForCaptureReady() {
      if (captureFailure) throw captureFailure
      if (instanceDestroyed) throw new Error(`Surface Runtime“${options.instanceId}”已销毁`)
      if (capturePrepared) return
      capturePrepared = true
      try {
        if (!suspended) lifecycle.suspend?.()
        lifecycle.setMode?.('capture')
        await captureBarrier.waitForReady(() => lifecycle.prepareCapture?.())
        await contentSizeObserver?.waitForReady()
      } catch (cause) {
        quarantine(cause)
        capturePrepared = false
        throw captureFailure
      }
    },
    restoreAfterCapture() {
      if (!capturePrepared || instanceDestroyed) return
      capturePrepared = false
      invoke(() => lifecycle.setMode?.(surfaceMode))
      if (!suspended) invoke(() => lifecycle.resume?.())
    },
    setVisible(visible: boolean) {
      invoke(() => lifecycle.setVisible?.(visible))
      contentSizeObserver?.refresh()
    },
    updateSize(width: number, height: number) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      if (options.width === width && options.height === height) { contentSizeObserver?.refresh(); return }
      options.width = width
      options.height = height
      invoke(() => lifecycle.resize?.(width, height))
      authoringTargets?.resize(width, height)
      contentSizeObserver?.refresh()
    },
    suspend() {
      suspended = true
      invoke(() => lifecycle.suspend?.())
    },
    resume() {
      suspended = false
      invoke(() => lifecycle.resume?.())
    },
    destroy() {
      unregisterUpdateProbe()
      if (quarantined) { unregisterCapture(); visibleElement.remove(); return }
      if (instanceDestroyed) return
      instanceDestroyed = true
      unregisterCapture()
      stopWatchingManagedHeight?.()
      contentSizeObserver?.destroy()
      captureBarrier.destroy()
      try {
        lifecycle.destroy()
      } catch (cause) {
        reportError(options, 'destroy', cause)
      } finally {
        authoringTargets?.destroy()
        domText?.destroy()
        events.dispose()
        root.replaceChildren()
        host.remove()
      }
    },
  }
  unregisterCapture = registerPublishedCaptureResource(container, handle)
  unregisterUpdateProbe = registerPublishedDynamicUpdateProbe(container, async () => {
    invoke(() => lifecycle.updateContent?.(structuredClone(options.runtime.content.values)))
    await handle.waitForReady()
    invoke(() => lifecycle.updateAssets?.(structuredClone(options.runtime.assets)))
    await handle.waitForReady()
    invoke(() => lifecycle.resize?.(Math.max(1, options.width * 0.9), Math.max(1, options.height * 0.9)))
    await handle.waitForReady()
    invoke(() => lifecycle.resize?.(options.width, options.height))
    await handle.waitForReady()
  }, { suspend: () => handle.suspend(), resume: () => handle.resume() })
  return handle
}
