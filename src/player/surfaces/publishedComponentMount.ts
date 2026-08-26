import type {
  ComponentCreateContextV4,
  ComponentCreateContextV4Phaser,
  ComponentDefinitionV4,
  ComponentHostActions,
  ComponentManifest,
  ComponentPackageData,
} from '../../shared/componentTypes'
import type {
  CourseEventBus,
  RuntimeEventDisposer,
  RuntimeEventListener,
} from '../../shared/runtimeTypes'
import type {
  PublishedCourseAsset,
  PublishedCourseComponent,
  PublishedCourseExecutableCode,
} from '../../shared/publishedCourseTypes'
import {
  tryCreateComponentLifecycle,
  type GuardedComponentInstanceLifecycle,
} from '../../shared/componentLifecycleGuard'
import {
  mergeComponentProps,
  resolveComponentEditorState,
} from '../../shared/componentProps'
import type { ExternalComponentNode } from '../../shared/projectTypes'
import { ComponentRegistry } from '../ComponentRegistry'
import {
  ComponentAuthoringTargetRegistry,
  type ComponentAuthoringTargetsChangedHandler,
} from '../ComponentAuthoringTargetRegistry'
import { createPlayerComponentHostActions } from '../componentHostActions'
import { decodePublishedCode } from '../publishedLesson'
import {
  PublishedCaptureBarrier,
  registerPublishedCaptureResource,
} from './publishedCapture'

export type PublishedComponentPackageSource =
  | PublishedCourseComponent
  | ComponentPackageData

export interface PublishedComponentMountOptions {
  container: HTMLElement
  componentId: string
  version?: string
  instanceId?: string
  width: number
  height: number
  props?: Record<string, unknown>
  staticFallbackAssetId?: string
  components?: Readonly<Record<string, PublishedComponentPackageSource>>
  resolveAsset?: (assetId: string) => string | undefined
  registry?: ComponentRegistry
  mode?: 'preview' | 'edit' | 'capture'
  scope?: 'scene' | 'global'
  sceneId?: string
  interactive?: boolean
  actions?: Readonly<ComponentHostActions>
  events?: ComponentCreateContextV4['events']
  courseState?: ComponentCreateContextV4['courseState']
  presentation?: ComponentCreateContextV4['presentation']
  emit?: (eventName: string, payload?: unknown) => void
  authoring?: {
    node: ExternalComponentNode
    onTargetsChanged: ComponentAuthoringTargetsChangedHandler
  }
  reportError?: (
    phase: 'register' | 'create' | 'lifecycle' | 'destroy',
    error: Error,
  ) => void
}

export interface PublishedComponentMountHandle {
  readonly ok: boolean
  readonly instanceId: string
  readonly componentId: string
  readonly lifecycle?: GuardedComponentInstanceLifecycle
  readonly element: HTMLElement
  waitForReady(): Promise<void>
  waitForCaptureReady(): Promise<void>
  restoreAfterCapture(): void
  resize(width: number, height: number): void
  updateProps(props: Record<string, unknown>): void
  updateAuthoringNode(node: ExternalComponentNode): void
  setVisible(visible: boolean): void
  suspend(): void
  resume(): void
  destroy(): void
}

export interface ResolvedPublishedComponent {
  readonly source: PublishedComponentPackageSource
  readonly manifest: ComponentManifest
  readonly definition: ComponentDefinitionV4
}

export type PublishedComponentContextBase = Omit<
  ComponentCreateContextV4Phaser,
  'renderMode' | 'phaser'
>

export interface PublishedComponentContextResources {
  readonly context: PublishedComponentContextBase
  waitForCaptureReady(prepareCapture?: () => void | Promise<void>): Promise<void>
  updateAuthoringNode(node: ExternalComponentNode): void
  updateAuthoringSize(width: number, height: number): void
  updateAuthoringProps(props: Record<string, unknown>): void
  invalidateAuthoringTargets(): void
  destroyAuthoringTargets(): void
  destroyCapture(): void
  dispose(): void
}

const sharedComponentRegistry = new ComponentRegistry()

export function getSharedComponentRegistry(): ComponentRegistry {
  return sharedComponentRegistry
}

export function findComponentPackageSource(
  components: Readonly<Record<string, PublishedComponentPackageSource>> | undefined,
  componentId: string,
  version?: string,
): PublishedComponentPackageSource | undefined {
  if (!components) return undefined
  if (version) {
    const keyed = components[`${componentId}@${version}`]
    if (keyed) return keyed
  }
  const direct = components[componentId]
  if (direct) {
    const directVersion = 'manifest' in direct ? direct.manifest.version : direct.version
    if (!version || directVersion === version) return direct
  }
  return Object.values(components).find((candidate) => {
    const id = 'manifest' in candidate ? candidate.manifest.id : candidate.id
    const candidateVersion = 'manifest' in candidate ? candidate.manifest.version : candidate.version
    return id === componentId && (!version || candidateVersion === version)
  })
}

export function extractPublishedComponentManifest(
  source: PublishedComponentPackageSource,
): ComponentManifest {
  if ('manifest' in source && source.manifest) {
    return source.manifest
  }
  const published = source as PublishedCourseComponent
  return {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: published.id,
    name: published.name ?? published.id,
    version: published.version ?? '1.0.0',
    entry: '',
    defaultSize: { width: 400, height: 300 },
    minSize: { width: 100, height: 100 },
    preserveAspectRatio: false,
    supportedScopes: published.scopes ?? ['scene', 'global'],
    renderMode: published.renderMode ?? 'dom',
    assets: {},
    defaultProps: {},
  }
}

export function extractPublishedComponentRuntimeSource(
  source: PublishedComponentPackageSource,
): string {
  if ('runtimeSource' in source && typeof source.runtimeSource === 'string') {
    return source.runtimeSource
  }
  if ('code' in source && source.code) {
    return decodePublishedCode(source.code as PublishedCourseExecutableCode)
  }
  return ''
}

export function createPublishedComponentFallbackElement(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
): HTMLElement {
  const dom = container.ownerDocument
  const fallbackEl = dom.createElement('div')
  fallbackEl.className = 'published-component-fallback'
  fallbackEl.dataset.componentInstanceId = options.instanceId ?? options.componentId
  fallbackEl.dataset.componentPackageId = options.componentId
  Object.assign(fallbackEl.style, {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  })

  const fallbackUrl = options.staticFallbackAssetId
    ? options.resolveAsset?.(options.staticFallbackAssetId)
    : undefined

  if (fallbackUrl) {
    const img = dom.createElement('img')
    img.src = fallbackUrl
    img.alt = `${options.componentId} 后备`
    img.dataset.staticFallbackAssetId = options.staticFallbackAssetId
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'block',
    })
    fallbackEl.appendChild(img)
  } else {
    const text = dom.createElement('div')
    text.className = 'published-component-fallback-label'
    text.textContent = `[组件后备：${options.componentId}${options.version ? `@${options.version}` : ''}]`
    Object.assign(text.style, {
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      padding: '12px 16px',
      background: '#0f766e',
      color: '#ffffff',
      font: 'bold 16px "Microsoft YaHei", sans-serif',
      textAlign: 'center',
    })
    fallbackEl.appendChild(text)
  }

  return fallbackEl
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function reportPublishedComponentError(
  options: PublishedComponentMountOptions,
  phase: 'register' | 'create' | 'lifecycle' | 'destroy',
  cause: unknown,
): Error {
  const error = normalizeError(cause)
  try {
    options.reportError?.(phase, error)
  } catch (reportFailure) {
    console.error('Published Component 诊断回调失败', reportFailure)
  }
  return error
}

export function resolvePublishedComponent(
  options: PublishedComponentMountOptions,
  registry: ComponentRegistry,
): ResolvedPublishedComponent {
  const source = findComponentPackageSource(
    options.components,
    options.componentId,
    options.version,
  )
  if (!source) {
    throw new Error(`组件包“${options.componentId}${options.version ? `@${options.version}` : ''}”不存在`)
  }
  const manifest = extractPublishedComponentManifest(source)
  let definition = registry.get(manifest.id)
  if (!definition) {
    const runtimeSource = extractPublishedComponentRuntimeSource(source)
    if (!runtimeSource) throw new Error(`组件“${manifest.id}”的 runtime.js 为空`)
    definition = registry.executeRuntime(manifest, runtimeSource)
  }
  return { source, manifest, definition }
}

function scopedComponentEvents(base: CourseEventBus | undefined): {
  events: CourseEventBus | undefined
  dispose(): void
} {
  if (!base) return { events: undefined, dispose() {} }
  const subscriptions = new Map<
    string,
    Map<RuntimeEventListener<unknown>, RuntimeEventDisposer>
  >()
  let disposed = false
  const events: CourseEventBus = {
    on<T = unknown>(eventName: string, listener: RuntimeEventListener<T>) {
      if (disposed) throw new Error('组件事件作用域已销毁')
      const stored = listener as RuntimeEventListener<unknown>
      let bucket = subscriptions.get(eventName)
      if (!bucket) {
        bucket = new Map()
        subscriptions.set(eventName, bucket)
      }
      bucket.get(stored)?.()
      const baseDisposer = base.on(eventName, stored)
      let active = true
      const dispose = () => {
        if (!active) return
        active = false
        baseDisposer()
        bucket?.delete(stored)
        if (bucket?.size === 0) subscriptions.delete(eventName)
      }
      bucket.set(stored, dispose)
      return dispose
    },
    off<T = unknown>(eventName: string, listener: RuntimeEventListener<T>) {
      subscriptions.get(eventName)?.get(listener as RuntimeEventListener<unknown>)?.()
    },
    emit<T = unknown>(eventName: string, payload?: T) {
      if (!disposed) base.emit(eventName, payload)
    },
    listenerCount(eventName?: string) {
      if (eventName !== undefined) return subscriptions.get(eventName)?.size ?? 0
      let count = 0
      for (const bucket of subscriptions.values()) count += bucket.size
      return count
    },
    dispose() {
      if (disposed) return
      disposed = true
      const disposers = [...subscriptions.values()]
        .flatMap((bucket) => [...bucket.values()])
      subscriptions.clear()
      disposers.forEach((dispose) => dispose())
    },
  }
  return { events, dispose: () => events.dispose() }
}

export function createPublishedComponentContextResources(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
  resolved: Pick<ResolvedPublishedComponent, 'source' | 'manifest'>,
  domRoot?: HTMLElement,
): PublishedComponentContextResources {
  const { source, manifest } = resolved
  const instanceId = options.instanceId ?? options.componentId
  const targetWindow = container.ownerDocument.defaultView
  if (!targetWindow) throw new Error('Published Component 挂载文档没有可执行 Window')
  const mergedProps = mergeComponentProps(manifest, options.props ?? {})
  const editorState = resolveComponentEditorState(manifest, mergedProps)
  const mode = options.mode ?? 'preview'
  const actions = options.actions ?? createPlayerComponentHostActions({
    goToSceneById: () => false,
    nextScene: () => false,
    previousScene: () => false,
    replayScene: () => false,
    restartCourse: () => false,
  })
  const eventScope = scopedComponentEvents(options.events)
  const captureBarrier = new PublishedCaptureBarrier()
  let authoringNode = options.authoring?.node
  const authoringTargets = authoringNode && options.authoring
    ? new ComponentAuthoringTargetRegistry({
        manifest,
        node: authoringNode,
        scope: options.scope ?? 'scene',
        ...(options.sceneId ? { sceneId: options.sceneId } : {}),
        ...(domRoot ? { domRoot } : {}),
        onTargetsChanged: options.authoring.onTargetsChanged,
      })
    : null
  let disposed = false

  const assetUrl = (assetKey: string): string => {
    if ('assets' in source && source.assets) {
      const asset = source.assets[assetKey] as PublishedCourseAsset | { dataUrl?: string } | undefined
      if (asset) {
        if ('url' in asset && typeof asset.url === 'string') return asset.url
        if ('dataUrl' in asset && typeof asset.dataUrl === 'string') return asset.dataUrl
      }
    }
    return ''
  }
  const projectAssetUrl = (assetId: string): string => options.resolveAsset?.(assetId) ?? ''
  const emit = (eventName: string, payload?: unknown): void => {
    if (disposed) return
    if (options.emit) {
      options.emit(eventName, payload)
      return
    }
    const detail = {
      scope: options.scope ?? 'scene',
      sceneId: options.sceneId,
      componentId: manifest.id,
      instanceId,
      eventName,
      payload,
    }
    targetWindow.dispatchEvent(new targetWindow.CustomEvent(
      'courseware-component-event',
      { detail },
    ))
  }

  return {
    context: {
      runtimeApiVersion: 4,
      instanceId,
      width: options.width,
      height: options.height,
      props: mergedProps,
      editorState,
      mode,
      actions,
      scope: options.scope ?? 'scene',
      events: eventScope.events,
      courseState: options.courseState,
      presentation: options.presentation,
      assetUrl,
      projectAssetUrl,
      emit,
      capture: { waitUntil: (promise) => captureBarrier.waitUntil(promise) },
      ...(authoringTargets ? { editor: authoringTargets } : {}),
    },
    waitForCaptureReady: (prepareCapture) => captureBarrier.waitForReady(prepareCapture),
    updateAuthoringNode(node: ExternalComponentNode) {
      if (!authoringTargets) return
      authoringTargets.update(node)
      authoringNode = node
    },
    updateAuthoringSize(width: number, height: number) {
      if (!authoringNode || !authoringTargets) return
      const nextNode = { ...authoringNode, width, height }
      authoringTargets.update(nextNode)
      authoringNode = nextNode
    },
    updateAuthoringProps(props: Record<string, unknown>) {
      if (!authoringNode || !authoringTargets) return
      const nextNode = { ...authoringNode, props }
      authoringTargets.update(nextNode)
      authoringNode = nextNode
    },
    invalidateAuthoringTargets() {
      authoringTargets?.invalidate()
    },
    destroyAuthoringTargets() {
      authoringTargets?.destroy()
    },
    destroyCapture() {
      captureBarrier.destroy()
    },
    dispose() {
      if (disposed) return
      disposed = true
      captureBarrier.destroy()
      eventScope.dispose()
    },
  }
}

function failedHandle(
  element: HTMLElement,
  options: PublishedComponentMountOptions,
  cause: unknown = new Error(`组件“${options.componentId}”未能启动`),
): PublishedComponentMountHandle {
  let destroyed = false
  const failure = cause instanceof Error ? cause : new Error(String(cause))
  const handle: PublishedComponentMountHandle = {
    ok: false,
    instanceId: options.instanceId ?? options.componentId,
    componentId: options.componentId,
    element,
    waitForReady: () => Promise.reject(failure),
    waitForCaptureReady: () => Promise.reject(failure),
    restoreAfterCapture() {},
    resize() {},
    updateProps() {},
    updateAuthoringNode() {},
    setVisible() {},
    suspend() {},
    resume() {},
    destroy() {
      if (destroyed) return
      destroyed = true
      unregisterCapture()
      element.remove()
    },
  }
  const unregisterCapture = registerPublishedCaptureResource(options.container, handle)
  return handle
}

export function mountPublishedComponent(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
): PublishedComponentMountHandle {
  const instanceId = options.instanceId ?? options.componentId
  const pkg = findComponentPackageSource(options.components, options.componentId, options.version)
  if (!pkg) {
    const fallbackEl = createPublishedComponentFallbackElement(container, options)
    container.appendChild(fallbackEl)
    return failedHandle(
      fallbackEl,
      options,
      new Error(`组件“${options.componentId}”的 Published 包不存在`),
    )
  }

  const manifest = extractPublishedComponentManifest(pkg)
  if (manifest.renderMode === 'phaser') {
    const fallbackEl = createPublishedComponentFallbackElement(container, options)
    container.appendChild(fallbackEl)
    return failedHandle(
      fallbackEl,
      options,
      new Error(`组件“${manifest.id}”不能在 DOM Published 宿主中捕获`),
    )
  }

  const registry = options.registry ?? sharedComponentRegistry
  let definition = registry.get(manifest.id)
  if (!definition) {
    const runtimeSource = extractPublishedComponentRuntimeSource(pkg)
    if (runtimeSource) {
      try {
        definition = registry.executeRuntime(manifest.id, runtimeSource)
      } catch (cause) {
        reportPublishedComponentError(options, 'register', cause)
        console.error(`组件“${manifest.id}”注册失败`, cause)
      }
    }
  }

  if (!definition) {
    const fallbackEl = createPublishedComponentFallbackElement(container, options)
    container.appendChild(fallbackEl)
    return failedHandle(
      fallbackEl,
      options,
      new Error(`组件“${manifest.id}”没有可执行的 Published 定义`),
    )
  }

  const dom = container.ownerDocument
  const host = dom.createElement('div')
  host.className = 'published-component-mount'
  host.dataset.componentInstanceId = instanceId
  host.dataset.componentPackageId = manifest.id
  Object.assign(host.style, {
    boxSizing: 'border-box',
    display: 'block',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: options.interactive ? 'auto' : 'none',
  })

  const shadow = host.attachShadow({ mode: 'open' })
  const reset = dom.createElement('style')
  reset.textContent = `
    :host { display: block; box-sizing: border-box; width: 100%; height: 100%; contain: layout style; }
    *, *::before, *::after { box-sizing: border-box; }
    [data-component-surface] { width: 100%; height: 100%; position: relative; }
  `
  const root = dom.createElement('div')
  root.setAttribute('data-component-surface', '')
  shadow.append(reset, root)
  container.appendChild(host)

  const resources = createPublishedComponentContextResources(
    container,
    options,
    { source: pkg, manifest },
    root,
  )
  const mode = options.mode ?? 'preview'

  const createContext: ComponentCreateContextV4 = {
    ...resources.context,
    renderMode: 'dom',
    dom: { root },
  }

  const creation = tryCreateComponentLifecycle(
    () => definition!.create(createContext),
    { componentId: manifest.id, instanceId },
  )

  if (!creation.ok) {
    reportPublishedComponentError(options, 'create', creation.failure.error)
    resources.destroyAuthoringTargets()
    resources.dispose()
    host.remove()
    const fallbackEl = createPublishedComponentFallbackElement(container, options)
    container.appendChild(fallbackEl)
    return failedHandle(fallbackEl, options, creation.failure.error)
  }

  const lifecycle = creation.lifecycle
  lifecycle.setMode?.(mode)
  lifecycle.resize?.(options.width, options.height)
  resources.updateAuthoringSize(options.width, options.height)
  lifecycle.setVisible?.(true)

  let suspended = false
  let capturePrepared = false
  let destroyed = false
  let unregisterCapture: () => void = () => undefined
  const handle: PublishedComponentMountHandle = {
    ok: true,
    instanceId,
    componentId: manifest.id,
    lifecycle,
    element: host,
    async waitForReady() {
      if (destroyed) throw new Error(`组件“${instanceId}”已销毁`)
    },
    async waitForCaptureReady() {
      if (capturePrepared) return
      capturePrepared = true
      if (!suspended) lifecycle.suspend?.()
      lifecycle.setMode?.('capture')
      try {
        await resources.waitForCaptureReady(() => lifecycle.prepareCapture?.())
      } catch (cause) {
        lifecycle.setMode?.(mode)
        if (!suspended) lifecycle.resume?.()
        capturePrepared = false
        throw cause
      }
    },
    restoreAfterCapture() {
      if (!capturePrepared) return
      capturePrepared = false
      lifecycle.setMode?.(mode)
      if (!suspended) lifecycle.resume?.()
    },
    resize(w: number, h: number) {
      lifecycle.resize?.(w, h)
      resources.updateAuthoringSize(w, h)
      resources.invalidateAuthoringTargets()
    },
    updateProps(nextProps: Record<string, unknown>) {
      const merged = mergeComponentProps(manifest, nextProps)
      lifecycle.updateProps?.(merged)
      const nextState = resolveComponentEditorState(manifest, merged)
      lifecycle.setEditorState?.(nextState)
      resources.updateAuthoringProps(nextProps)
      resources.invalidateAuthoringTargets()
    },
    updateAuthoringNode(node: ExternalComponentNode) {
      resources.updateAuthoringNode(node)
    },
    setVisible(visible: boolean) {
      lifecycle.setVisible?.(visible)
    },
    suspend() {
      suspended = true
      lifecycle.suspend?.()
    },
    resume() {
      suspended = false
      lifecycle.resume?.()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      resources.destroyAuthoringTargets()
      unregisterCapture()
      resources.destroyCapture()
      lifecycle.destroy()
      resources.dispose()
      host.remove()
    },
  }
  unregisterCapture = registerPublishedCaptureResource(container, handle)
  return handle
}
