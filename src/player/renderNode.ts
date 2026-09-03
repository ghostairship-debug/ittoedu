import * as Phaser from 'phaser'
import type {
  ComponentCreateContextV4,
  ComponentHostActions,
  ComponentInstanceLifecycle,
  ExportPayload,
} from '../shared/componentTypes'
import {
  componentRenderMode,
  componentSupportsScope,
} from '../shared/componentCapabilities'
import {
  createPhaserDomComponentMount,
  type PhaserDomComponentMount,
} from '../shared/phaserDomComponentHost'
import type {
  CourseEventBus,
  CourseStateStore,
  RuntimeEventDisposer,
  RuntimeEventListener,
  RuntimePresentationTransition,
  RuntimePresentationApi,
} from '../shared/runtimeTypes'
import {
  mergeComponentProps,
  resolveComponentEditorState,
} from '../shared/componentProps'
import {
  tryCreateComponentLifecycle,
} from '../shared/componentLifecycleGuard'
import type {
  ComponentLifecycleFailure,
  ComponentLifecyclePhase,
} from '../shared/componentLifecycleGuard'
import type {
  NativeNodeType,
  NativeRenderInput,
  NativeRenderableBase,
} from '../shared/contracts/native-v1/types'
import type { VideoInteractionAction } from '../shared/interactionTypes'
import type { RuntimeExecutionMode } from '../shared/runtimeTypes'
import type { AudioManager } from './AudioManager'
import type { CaptureSurfaceSnapshotter } from './PreparedCanvasSnapshots'
import { renderTeacherController } from './renderTeacherController'
import { renderVideoNode } from './renderVideoNode'
import type { ComponentRegistry } from './ComponentRegistry'
import {
  ComponentAuthoringTargetRegistry,
  type ComponentAuthoringTargetsChangedHandler,
  type ComponentHostNode,
} from './ComponentAuthoringTargetRegistry'
import { renderShapeGraphics } from '../shared/phaserShapeRenderer'
import { renderImageNodeCanvas } from '../shared/imageEffects'
import { renderFormulaNodeCanvas } from '../shared/formulaRenderer'
import { renderTextNodeCanvas } from '../shared/textLayout'

export interface ComponentEventDetail {
  scope: 'scene' | 'global'
  sceneId?: string
  componentId: string
  instanceId: string
  eventName: string
  payload?: unknown
}

export interface RenderNodeContext {
  payload: ExportPayload
  registry: ComponentRegistry
  actions: Readonly<ComponentHostActions>
  scope: 'scene' | 'global'
  parentRoot?: Phaser.GameObjects.Container
  events?: CourseEventBus
  courseState?: CourseStateStore
  presentation?: RuntimePresentationApi
  audio?: AudioManager
  mode?: RuntimeExecutionMode
  /** Unified editor host: render preview visuals while suppressing child input. */
  authoring?: boolean
  /** Present only in the isolated authoring Player. */
  onComponentAuthoringTargetsChanged?:
    ComponentAuthoringTargetsChangedHandler
  sceneId?: string
  /** Host-owned current state resolver for public, read-only action evidence. */
  currentStateId?(): string | null
  /** Lets PlayerScene defer mount-time component events until bindings exist. */
  emitComponentEvent?(detail: ComponentEventDetail): void
  /** False when the host explicitly suppresses delivery-time canvas controls. */
  canvasControlsEnabled?: boolean
  /** Delivery-only DOM plane for native keyboard and screen-reader affordances. */
  accessibilityRoot?: HTMLElement
  textureKey(assetId: string): string
}

export interface VideoNodeController {
  execute(action: VideoInteractionAction): boolean
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
      let eventSubscriptions = subscriptions.get(eventName)
      if (!eventSubscriptions) {
        eventSubscriptions = new Map()
        subscriptions.set(eventName, eventSubscriptions)
      }
      eventSubscriptions.get(stored)?.()
      const baseDisposer = base.on(eventName, stored)
      let active = true
      const disposer = () => {
        if (!active) return
        active = false
        baseDisposer()
        eventSubscriptions?.delete(stored)
        if (eventSubscriptions?.size === 0) subscriptions.delete(eventName)
      }
      eventSubscriptions.set(stored, disposer)
      return disposer
    },
    off<T = unknown>(eventName: string, listener: RuntimeEventListener<T>) {
      subscriptions
        .get(eventName)
        ?.get(listener as RuntimeEventListener<unknown>)
        ?.()
    },
    emit<T = unknown>(eventName: string, payload?: T) {
      if (!disposed) base.emit(eventName, payload)
    },
    listenerCount(eventName?: string) {
      if (eventName !== undefined) return subscriptions.get(eventName)?.size ?? 0
      let count = 0
      for (const eventSubscriptions of subscriptions.values()) {
        count += eventSubscriptions.size
      }
      return count
    },
    dispose() {
      if (disposed) return
      disposed = true
      const disposers = [...subscriptions.values()]
        .flatMap((eventSubscriptions) => [...eventSubscriptions.values()])
      subscriptions.clear()
      disposers.forEach((dispose) => dispose())
    },
  }
  return {
    events,
    dispose: () => events.dispose(),
  }
}

export interface PlayerComponentHostNode extends ComponentHostNode {
  type: 'external-component'
  name: string
  opacity: number
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
  component: {
    packageId: string
    version: string
  }
}

export type PlayerRenderNode = NativeRenderInput | PlayerComponentHostNode

type RenderFrame = Pick<
  NativeRenderableBase,
  'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'visible'
>

export interface RenderedNodeHandle {
  readonly id: string
  readonly type: NativeNodeType | 'external-component'
  /** Authored/presentation frame. Interaction hit areas remain attached here. */
  readonly root: Phaser.GameObjects.Container
  /** Relative playback-motion layer, isolated from presentation transitions. */
  readonly motionRoot?: Phaser.GameObjects.Container
  readonly videoController?: VideoNodeController
  setHostVisible?(visible: boolean): void
  /** Browser/page visibility, composed with authored and global visibility. */
  setPageVisible?(visible: boolean): void
  /** Transient automation visibility; unlike host visibility it must not pause media. */
  setMotionVisible?(visible: boolean): void
  suspend?(): void
  resume?(): void
  prepareCapture?(snapshotSurfaces?: CaptureSurfaceSnapshotter): Promise<void>
  update(node: PlayerRenderNode, transition?: RuntimePresentationTransition): void
  destroy(): void
}

function colorNumber(color: string, fallback: number): number {
  return /^#[\da-f]{6}$/i.test(color)
    ? Number.parseInt(color.slice(1), 16)
    : fallback
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
  }
  if (
    typeof left !== 'object' || left === null ||
    typeof right !== 'object' || right === null
  ) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key) => Object.hasOwn(rightRecord, key) &&
      valuesEqual(leftRecord[key], rightRecord[key]),
  )
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 100 ? `${message.slice(0, 97)}…` : message
}

function attachToParent(
  object: Phaser.GameObjects.GameObject,
  parent?: Phaser.GameObjects.Container,
): void {
  if (parent) parent.add(object)
}

function applyNodeFrame(
  scene: Phaser.Scene,
  node: RenderFrame,
  root: Phaser.GameObjects.Container,
  visualHeight = node.height,
  transition?: RuntimePresentationTransition,
  resolveVisibility?: (authoredVisible: boolean) => boolean,
  visualWidth = node.width,
): void {
  const x = node.x + visualWidth / 2
  const y = node.y + visualHeight / 2
  root.setSize(visualWidth, visualHeight)
  const duration = Math.max(0, transition?.duration ?? 0)
  const frameVisible = resolveVisibility?.(node.visible) ?? node.visible
  scene.tweens.killTweensOf(root)
  if (duration === 0) {
    root
      .setPosition(x, y)
      .setAngle(node.rotation)
      .setAlpha(node.opacity)
      .setVisible(frameVisible)
    return
  }
  const wasVisible = root.visible
  if (frameVisible && !wasVisible) root.setAlpha(0).setVisible(true)
  scene.tweens.add({
    targets: root,
    x,
    y,
    angle: node.rotation,
    alpha: node.visible ? node.opacity : 0,
    duration,
    ease: transition?.ease ?? 'Sine.easeInOut',
    onComplete: () => {
      if (!root.active) return
      root
        .setVisible(resolveVisibility?.(node.visible) ?? node.visible)
        .setAlpha(node.opacity)
    },
  })
}

function objectHandle(
  scene: Phaser.Scene,
  initialNode: PlayerRenderNode,
  object: Phaser.GameObjects.Container,
): RenderedNodeHandle {
  return {
    id: initialNode.id,
    type: initialNode.type,
    root: object,
    update(node, transition): void {
      if (node.id !== initialNode.id || node.type !== initialNode.type) return
      applyNodeFrame(scene, node, object, node.height, transition)
    },
    destroy(): void {
      if (object.active) {
        object.destroy()
      }
    },
  }
}

function renderErrorPlaceholder(
  scene: Phaser.Scene,
  node: PlayerRenderNode,
  depth: number,
  title: string,
  error: unknown,
  parentRoot?: Phaser.GameObjects.Container,
  captureFailure?: unknown,
): RenderedNodeHandle {
  const container = scene.add
    .container(node.x + node.width / 2, node.y + node.height / 2)
    .setName(`node:${node.id}`)
    .setDepth(depth)
    .setAngle(node.rotation)
    .setAlpha(node.opacity)
    .setVisible(node.visible)
  container.setSize(node.width, node.height)
  const content = scene.add.container(-node.width / 2, -node.height / 2)
  container.add(content)

  const background = scene.add.graphics()
  const radius = Math.min(10, node.width / 2, node.height / 2)
  background.fillStyle(0x3f141a, 0.96)
  background.fillRoundedRect(0, 0, node.width, node.height, radius)
  background.lineStyle(2, 0xef6464, 1)
  background.strokeRoundedRect(1, 1, node.width - 2, node.height - 2, radius)

  const label = scene.add.text(
    12,
    10,
    `${title}\n${node.name}\n${shortError(error)}`,
    {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      fontSize: Math.max(12, Math.min(18, node.height / 5)),
      color: '#fecaca',
      lineSpacing: 4,
      wordWrap: {
        width: Math.max(16, node.width - 24),
        useAdvancedWrap: true,
      },
    },
  )
  content.add([background, label])
  attachToParent(container, parentRoot)
  const handle = objectHandle(scene, node, container)
  if (captureFailure === undefined) return handle
  const captureError = captureFailure instanceof Error
    ? captureFailure
    : new Error(String(captureFailure))
  return {
    ...handle,
    prepareCapture: async () => {
      throw captureError
    },
  }
}

function resolveComponentPackage(
  payload: ExportPayload,
  node: PlayerComponentHostNode,
): ExportPayload['components'][string] | undefined {
  return (
    payload.components[`${node.component.packageId}@${node.component.version}`] ??
    payload.components[node.component.packageId] ??
    Object.values(payload.components).find(
      ({ manifest }) =>
        manifest.id === node.component.packageId &&
        manifest.version === node.component.version,
    )
  )
}

function renderExternalComponent(
  scene: Phaser.Scene,
  node: PlayerComponentHostNode,
  depth: number,
  context: RenderNodeContext,
): RenderedNodeHandle {
  const componentPackage = resolveComponentPackage(context.payload, node)
  if (!componentPackage) {
    const error = new Error('工程中找不到对应的组件包')
    return renderErrorPlaceholder(
      scene,
      node,
      depth,
      '组件加载失败',
      error,
      context.parentRoot,
      error,
    )
  }

  const manifest = componentPackage.manifest
  if (!componentSupportsScope(manifest, context.scope)) {
    const error = new Error(
      `该组件未声明支持${context.scope === 'global' ? '全局层' : '场景层'}`,
    )
    return renderErrorPlaceholder(
      scene,
      node,
      depth,
      '组件作用域无效',
      error,
      context.parentRoot,
      error,
    )
  }

  const registrationError = context.registry.getLoadError(
    componentPackage.manifest.id,
  )
  const definition = context.registry.get(componentPackage.manifest.id)
  if (!definition || registrationError) {
    const error = registrationError ?? new Error('组件没有完成注册')
    return renderErrorPlaceholder(
      scene,
      node,
      depth,
      '组件加载失败',
      error,
      context.parentRoot,
      error,
    )
  }

  const root = scene.add
    .container(node.x + node.width / 2, node.y + node.height / 2)
    .setName(`node:${node.id}`)
    .setDepth(depth)
    .setAngle(node.rotation)
    .setAlpha(node.opacity)
    .setVisible(node.visible)
  root.setSize(node.width, node.height)
  const contentRoot = scene.add.container(-node.width / 2, -node.height / 2)
  const errorRoot = scene.add
    .container(-node.width / 2, -node.height / 2)
    .setVisible(false)
  const errorBackground = scene.add.graphics()
  const errorLabel = scene.add.text(12, 10, '', {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 16,
    color: '#fecaca',
    lineSpacing: 4,
    wordWrap: {
      width: Math.max(16, node.width - 24),
      useAdvancedWrap: true,
    },
  })
  errorRoot.add([errorBackground, errorLabel])
  root.add([contentRoot, errorRoot])
  attachToParent(root, context.parentRoot)
  let currentNode = node
  let hostVisible = true
  let pageVisible = true
  let motionVisible = true
  let domMount: PhaserDomComponentMount | null = null
  let removeDomActivation: (() => void) | null = null
  let componentAuthoringTargets: ComponentAuthoringTargetRegistry | null = null
  const disposeComponentAuthoringTargets = (): void => {
    componentAuthoringTargets?.destroy()
    componentAuthoringTargets = null
  }
  const disposeDomMount = (): void => {
    componentAuthoringTargets?.setDomRoot(undefined)
    removeDomActivation?.()
    removeDomActivation = null
    domMount?.destroy()
    domMount = null
  }
  const effectiveVisibility = (authoredVisible = currentNode.visible): boolean =>
    pageVisible && hostVisible && motionVisible && authoredVisible
  let visibleFailure: ComponentLifecycleFailure | null = null
  const redrawFailure = (): void => {
    if (!visibleFailure) return
    const width = currentNode.width
    const height = currentNode.height
    const radius = Math.max(0, Math.min(10, width / 2, height / 2))
    errorRoot.setPosition(-width / 2, -height / 2)
    errorBackground.clear()
    errorBackground.fillStyle(0x3f141a, 0.96)
    errorBackground.fillRoundedRect(0, 0, width, height, radius)
    errorBackground.lineStyle(2, 0xef6464, 1)
    errorBackground.strokeRoundedRect(
      1,
      1,
      Math.max(0, width - 2),
      Math.max(0, height - 2),
      radius,
    )
    errorLabel
      .setText(
        `组件运行失败 (${visibleFailure.phase})\n${currentNode.name}\n${shortError(visibleFailure.error)}`,
      )
      .setWordWrapWidth(Math.max(16, width - 24), true)
  }
  const showLifecycleFailure = (failure: ComponentLifecycleFailure): void => {
    console.error(
      `组件“${componentPackage.manifest.name}”${failure.phase}失败`,
      failure.error,
    )
    if (failure.phase === 'destroy') return
    visibleFailure = failure
    contentRoot.setVisible(false)
    disposeComponentAuthoringTargets()
    // Phaser's DOM bridge mirrors frameRoot visibility on every POST_UPDATE.
    // Destroy the failed DOM surface so that sync cannot resurrect it on the
    // next frame while the Phaser error placeholder remains available.
    disposeDomMount()
    errorRoot.setVisible(true)
    redrawFailure()
  }
  const showHostFailure = (
    phase: Exclude<ComponentLifecyclePhase, 'create' | 'destroy'>,
    error: unknown,
  ): void => showLifecycleFailure({
    phase,
    error: error instanceof Error ? error : new Error(String(error)),
    message: error instanceof Error ? error.message : String(error),
    componentId: componentPackage.manifest.id,
    instanceId: node.id,
  })
  const displayListBeforeCreate = new Set(scene.children.list)
  const componentEvents = scopedComponentEvents(context.events)
  const captureTasks = new Set<Promise<unknown>>()
  let captureFailure: Error | null = null
  const pendingMountEvents: ComponentEventDetail[] = []
  let componentEventState: 'mounting' | 'active' | 'disposed' = 'mounting'
  const publishComponentEvent = (detail: ComponentEventDetail): void => {
    if (context.emitComponentEvent) {
      context.emitComponentEvent(detail)
    } else {
      context.events?.emit('component:event', detail)
    }
    window.dispatchEvent(
      new CustomEvent('courseware-component-event', {
        detail,
      }),
    )
  }
  const emitComponentEvent = (detail: ComponentEventDetail): void => {
    if (componentEventState === 'disposed') return
    if (componentEventState === 'mounting') {
      pendingMountEvents.push(detail)
      return
    }
    publishComponentEvent(detail)
  }

  try {
    const props = mergeComponentProps(componentPackage.manifest, node.props)
    const assetUrl = (assetKey: string): string => {
      const asset = componentPackage.assets[assetKey]
      if (!asset) throw new Error(`组件素材“${assetKey}”不存在`)
      return asset.dataUrl
    }
    const projectAssetUrl = (assetId: string): string => {
      const asset = context.payload.assets[assetId]
      if (!asset) throw new Error(`工程图片素材“${assetId}”不存在`)
      return asset.dataUrl
    }
    const emit = (eventName: string, payload?: unknown): void => {
      const detail: ComponentEventDetail = {
        scope: context.scope,
        ...(context.scope === 'scene' && context.sceneId
          ? { sceneId: context.sceneId }
          : {}),
        componentId: componentPackage.manifest.id,
        instanceId: node.id,
        eventName,
        payload,
      }
      emitComponentEvent(detail)
    }
    const registerCaptureTask = (promise: Promise<unknown>): void => {
      const task = Promise.resolve(promise)
      captureTasks.add(task)
      // Keep an early rejection from becoming an unhandled rejection before
      // the export pipeline reaches its deterministic capture barrier.
      void task.catch(() => undefined)
    }

    const renderMode = componentRenderMode(componentPackage.manifest)
    if (renderMode === 'dom' || renderMode === 'hybrid') {
      domMount = createPhaserDomComponentMount(scene, root, {
        className: `lesson-component-mount--${context.scope}`,
        interactive: context.mode !== 'capture' && context.authoring !== true,
        instanceId: node.id,
        width: node.width,
        height: node.height,
      })
      const forwardActivation = (): void => {
        if (
          context.mode !== 'capture' &&
          context.authoring !== true &&
          root.active &&
          root.visible
        ) {
          root.emit('pointerup')
        }
      }
      domMount.host.addEventListener('pointerup', forwardActivation)
      removeDomActivation = () => {
        domMount?.host.removeEventListener('pointerup', forwardActivation)
      }
    }

    if (
      context.authoring === true &&
      context.onComponentAuthoringTargetsChanged
    ) {
      componentAuthoringTargets = new ComponentAuthoringTargetRegistry({
        manifest: componentPackage.manifest,
        node,
        scope: context.scope,
        ...(context.sceneId ? { sceneId: context.sceneId } : {}),
        ...(domMount ? { domRoot: domMount.root } : {}),
        onTargetsChanged: context.onComponentAuthoringTargetsChanged,
      })
    }

    const editorState = resolveComponentEditorState(
      componentPackage.manifest,
      props,
    )
    const commonContext = {
      instanceId: node.id,
      width: node.width,
      height: node.height,
      props,
      editorState,
      ...(componentAuthoringTargets
        ? { editor: componentAuthoringTargets }
        : {}),
      actions: context.actions,
      scope: context.scope,
      events: componentEvents.events,
      courseState: context.courseState,
      presentation: context.presentation,
      assetUrl,
      projectAssetUrl,
      emit,
    }

    const componentMode: ComponentCreateContextV4['mode'] =
      context.authoring === true
        ? 'edit'
        : context.mode === 'capture'
          ? 'capture'
          : 'preview'
    const base = {
      ...commonContext,
      runtimeApiVersion: 4 as const,
      renderMode,
      mode: componentMode,
      capture: { waitUntil: registerCaptureTask },
    }
    let createContext: ComponentCreateContextV4
    if (renderMode === 'phaser') {
      createContext = {
        ...base,
        renderMode: 'phaser',
        phaser: { Phaser, scene, root: contentRoot },
      }
    } else if (renderMode === 'dom') {
      if (!domMount) throw new Error('DOM 组件挂载点创建失败')
      createContext = {
        ...base,
        renderMode: 'dom',
        dom: { root: domMount.root },
      }
    } else {
      if (!domMount) throw new Error('Hybrid 组件 DOM 挂载点创建失败')
      createContext = {
        ...base,
        renderMode: 'hybrid',
        phaser: { Phaser, scene, root: contentRoot },
        dom: { root: domMount.root },
      }
    }

    const creation = tryCreateComponentLifecycle(
      () => definition.create(createContext),
      {
        componentId: componentPackage.manifest.id,
        instanceId: node.id,
        onError: showLifecycleFailure,
      },
    )
    if (!creation.ok) throw creation.failure.error
    const lifecycle = creation.lifecycle
    lifecycle.setMode?.(componentMode)
    lifecycle.resize?.(node.width, node.height)
    lifecycle.setVisible?.(effectiveVisibility())
    componentEventState = 'active'
    for (const detail of pendingMountEvents.splice(0)) {
      publishComponentEvent(detail)
    }
    let currentWidth = node.width
    let currentHeight = node.height
    let currentProps = structuredClone(props)
    let currentEditorState = structuredClone(editorState)
    let reportedVisible = effectiveVisibility()
    const updateLifecycleVisibility = (): void => {
      const visible = effectiveVisibility()
      if (visible === reportedVisible) return
      lifecycle.setVisible?.(visible)
      reportedVisible = visible
    }
    const applyEffectiveRootVisibility = (): void => {
      root.setVisible(effectiveVisibility())
      updateLifecycleVisibility()
      domMount?.sync()
    }
    const waitForCaptureTasks = async (
      snapshotSurfaces?: CaptureSurfaceSnapshotter,
    ): Promise<void> => {
      if (captureFailure) throw captureFailure
      const drainCaptureTasks = async (): Promise<void> => {
        while (captureTasks.size > 0) {
          const batch = [...captureTasks]
          try {
            await Promise.all(batch)
          } finally {
            batch.forEach((task) => captureTasks.delete(task))
          }
        }
      }
      try {
        // Let create/update-time resources settle before the final authored
        // draw, then wait for any finite work registered by the hook itself.
        await drainCaptureTasks()
        await lifecycle.prepareCapture?.()
        await drainCaptureTasks()
        domMount?.sync()
        if (domMount) snapshotSurfaces?.([domMount.host])
      } catch (error) {
        const normalized = error instanceof Error
          ? error
          : new Error(String(error))
        const firstCaptureFailure = captureFailure === null
        captureFailure ??= normalized
        if (firstCaptureFailure && !lifecycle.getFailure()) {
          showHostFailure('prepareCapture', captureFailure)
        }
        throw captureFailure
      }
    }

    const looseObjects = scene.children.list.filter(
      (object) =>
        !displayListBeforeCreate.has(object) &&
        object !== root &&
        object !== contentRoot &&
        object !== domMount?.gameObject,
    )

    return {
      id: node.id,
      type: node.type,
      root,
      setHostVisible(visible): void {
        hostVisible = visible
        applyEffectiveRootVisibility()
      },
      setPageVisible(visible): void {
        pageVisible = visible
        applyEffectiveRootVisibility()
      },
      setMotionVisible(visible): void {
        motionVisible = visible
        applyEffectiveRootVisibility()
      },
      suspend(): void {
        lifecycle.suspend?.()
      },
      resume(): void {
        lifecycle.resume?.()
      },
      prepareCapture: waitForCaptureTasks,
      update(nextNode, transition): void {
        if (nextNode.type !== 'external-component' || nextNode.id !== node.id) return
        currentNode = nextNode
        contentRoot.setPosition(-nextNode.width / 2, -nextNode.height / 2)
        if (nextNode.width !== currentWidth || nextNode.height !== currentHeight) {
          try {
            lifecycle.resize?.(nextNode.width, nextNode.height)
          } catch (error) {
            showHostFailure('resize', error)
          }
          currentWidth = nextNode.width
          currentHeight = nextNode.height
          domMount?.resize(nextNode.width, nextNode.height)
        }
        try {
          const nextProps = mergeComponentProps(
            componentPackage.manifest,
            nextNode.props,
          )
          if (!valuesEqual(currentProps, nextProps)) {
            lifecycle.updateProps?.(nextProps)
            const nextEditorState = resolveComponentEditorState(
              componentPackage.manifest,
              nextProps,
            )
            if (!valuesEqual(currentEditorState, nextEditorState)) {
              lifecycle.setEditorState?.(nextEditorState)
              currentEditorState = structuredClone(nextEditorState)
            }
            currentProps = structuredClone(nextProps)
          }
        } catch (error) {
          showHostFailure('updateProps', error)
        }
        if (visibleFailure) redrawFailure()
        applyNodeFrame(
          scene,
          nextNode,
          root,
          nextNode.height,
          transition,
          effectiveVisibility,
        )
        updateLifecycleVisibility()
        domMount?.sync()
        componentAuthoringTargets?.update(nextNode)
      },
      destroy(): void {
        componentEventState = 'disposed'
        pendingMountEvents.length = 0
        captureTasks.clear()
        lifecycle.destroy()
        disposeComponentAuthoringTargets()
        componentEvents.dispose()
        disposeDomMount()

        for (const object of looseObjects) {
          if (object.active) {
            object.destroy()
          }
        }
        if (root.active) {
          root.destroy()
        }
      },
    }
  } catch (error) {
    componentEventState = 'disposed'
    pendingMountEvents.length = 0
    componentEvents.dispose()
    captureTasks.clear()
    disposeComponentAuthoringTargets()
    disposeDomMount()
    console.error(`组件“${componentPackage.manifest.name}”运行失败`, error)
    for (const object of scene.children.list.slice()) {
      if (
        !displayListBeforeCreate.has(object) &&
        object !== root &&
        object !== contentRoot &&
        object.active
      ) {
        object.destroy()
      }
    }
    if (root.active) {
      root.destroy()
    }

    return renderErrorPlaceholder(
      scene,
      node,
      depth,
      '组件加载失败',
      error,
      context.parentRoot,
      error,
    )
  }
}

function renderNodeContent(
  scene: Phaser.Scene,
  node: PlayerRenderNode,
  depth: number,
  context: RenderNodeContext,
): RenderedNodeHandle {
  switch (node.type) {
    case 'text': {
      const rendered = renderTextNodeCanvas(node, node.width)
      let revision = 0
      let renderedKey = `rendered-text-${node.id}-${depth}-${revision}`
      if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
      scene.textures.addCanvas(renderedKey, rendered.canvas)
      const root = scene.add
        .container(
          node.x + rendered.width / 2,
          node.y + rendered.height / 2,
        )
        .setName(`node:${node.id}`)
        .setDepth(depth)
        .setAngle(node.rotation)
        .setAlpha(node.opacity)
        .setVisible(node.visible)
      root.setSize(rendered.width, rendered.height)
      attachToParent(root, context.parentRoot)
      const text = scene.add
        .image(-rendered.width / 2, -rendered.height / 2, renderedKey)
        .setOrigin(0)
        .setDisplaySize(rendered.width, rendered.height)
      root.add(text)
      return {
        id: node.id,
        type: node.type,
        root,
        update(nextNode, transition): void {
          if (nextNode.type !== 'text' || nextNode.id !== node.id) return
          const nextRendered = renderTextNodeCanvas(nextNode, nextNode.width)
          const nextKey = `rendered-text-${node.id}-${depth}-${++revision}`
          if (scene.textures.exists(nextKey)) scene.textures.remove(nextKey)
          scene.textures.addCanvas(nextKey, nextRendered.canvas)
          text
            .setTexture(nextKey)
            .setPosition(
              -nextRendered.width / 2,
              -nextRendered.height / 2,
            )
            .setDisplaySize(nextRendered.width, nextRendered.height)
          const previousKey = renderedKey
          renderedKey = nextKey
          if (scene.textures.exists(previousKey)) scene.textures.remove(previousKey)
          applyNodeFrame(
            scene,
            nextNode,
            root,
            nextRendered.height,
            transition,
            undefined,
            nextRendered.width,
          )
        },
        destroy(): void {
          if (root.active) root.destroy()
          if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
        },
      }
    }

    case 'formula': {
      const rendered = renderFormulaNodeCanvas(node)
      let revision = 0
      let renderedKey = `rendered-formula-${node.id}-${depth}-${revision}`
      if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
      scene.textures.addCanvas(renderedKey, rendered.canvas)
      const root = scene.add
        .container(node.x + node.width / 2, node.y + node.height / 2)
        .setName(`node:${node.id}`)
        .setDepth(depth)
        .setAngle(node.rotation)
        .setAlpha(node.opacity)
        .setVisible(node.visible)
      root.setSize(node.width, node.height)
      attachToParent(root, context.parentRoot)
      const formula = scene.add
        .image(-node.width / 2, -node.height / 2, renderedKey)
        .setOrigin(0)
        .setDisplaySize(node.width, node.height)
      root.add(formula)
      return {
        id: node.id,
        type: node.type,
        root,
        update(nextNode, transition): void {
          if (nextNode.type !== 'formula' || nextNode.id !== node.id) return
          const nextRendered = renderFormulaNodeCanvas(nextNode)
          const nextKey = `rendered-formula-${node.id}-${depth}-${++revision}`
          if (scene.textures.exists(nextKey)) scene.textures.remove(nextKey)
          scene.textures.addCanvas(nextKey, nextRendered.canvas)
          formula
            .setTexture(nextKey)
            .setPosition(-nextNode.width / 2, -nextNode.height / 2)
            .setDisplaySize(nextNode.width, nextNode.height)
          const previousKey = renderedKey
          renderedKey = nextKey
          if (scene.textures.exists(previousKey)) scene.textures.remove(previousKey)
          applyNodeFrame(scene, nextNode, root, nextNode.height, transition)
        },
        destroy(): void {
          if (root.active) root.destroy()
          if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
        },
      }
    }

    case 'image': {
      const textureKey = context.textureKey(node.assetId)
      if (!scene.textures.exists(textureKey)) {
        return renderErrorPlaceholder(
          scene,
          node,
          depth,
          '图片加载失败',
          `素材“${node.assetId}”不存在或格式不受支持`,
          context.parentRoot,
        )
      }

      const sourceTexture = scene.textures.get(textureKey)
      const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource
      const frame = sourceTexture.get()
      const renderedCanvas = renderImageNodeCanvas(
        sourceImage,
        frame.realWidth,
        frame.realHeight,
        node,
      )
      let revision = 0
      let renderedKey = `rendered-${node.id}-${depth}-${revision}`
      if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
      scene.textures.addCanvas(renderedKey, renderedCanvas)
      const root = scene.add
        .container(node.x + node.width / 2, node.y + node.height / 2)
        .setName(`node:${node.id}`)
        .setDepth(depth)
        .setAngle(node.rotation)
        .setAlpha(node.opacity)
        .setVisible(node.visible)
      root.setSize(node.width, node.height)
      attachToParent(root, context.parentRoot)
      const image = scene.add
        .image(-node.width / 2, -node.height / 2, renderedKey)
        .setOrigin(0)
        .setDisplaySize(node.width, node.height)
      root.add(image)
      return {
        id: node.id,
        type: node.type,
        root,
        update(nextNode, transition): void {
          if (nextNode.type !== 'image' || nextNode.id !== node.id) return
          const nextTextureKey = context.textureKey(nextNode.assetId)
          if (!scene.textures.exists(nextTextureKey)) {
            console.error(`状态切换缺少图片素材“${nextNode.assetId}”`)
            return
          }
          const nextSourceTexture = scene.textures.get(nextTextureKey)
          const nextSourceImage = nextSourceTexture.getSourceImage() as CanvasImageSource
          const nextFrame = nextSourceTexture.get()
          const nextCanvas = renderImageNodeCanvas(
            nextSourceImage,
            nextFrame.realWidth,
            nextFrame.realHeight,
            nextNode,
          )
          const nextKey = `rendered-${node.id}-${depth}-${++revision}`
          if (scene.textures.exists(nextKey)) scene.textures.remove(nextKey)
          scene.textures.addCanvas(nextKey, nextCanvas)
          image
            .setTexture(nextKey)
            .setPosition(-nextNode.width / 2, -nextNode.height / 2)
            .setDisplaySize(nextNode.width, nextNode.height)
          const previousKey = renderedKey
          renderedKey = nextKey
          if (scene.textures.exists(previousKey)) scene.textures.remove(previousKey)
          applyNodeFrame(scene, nextNode, root, nextNode.height, transition)
        },
        destroy(): void {
          if (root.active) root.destroy()
          if (scene.textures.exists(renderedKey)) scene.textures.remove(renderedKey)
        },
      }
    }

    case 'video':
      return renderVideoNode(scene, node, depth, context)

    case 'shape': {
      const root = scene.add
        .container(node.x + node.width / 2, node.y + node.height / 2)
        .setName(`node:${node.id}`)
        .setDepth(depth)
        .setAngle(node.rotation)
        .setAlpha(node.opacity)
        .setVisible(node.visible)
      root.setSize(node.width, node.height)
      const graphics = scene.add
        .graphics({ x: -node.width / 2, y: -node.height / 2 })
      renderShapeGraphics(graphics, node)
      root.add(graphics)
      attachToParent(root, context.parentRoot)
      return {
        id: node.id,
        type: node.type,
        root,
        update(nextNode, transition): void {
          if (nextNode.type !== 'shape' || nextNode.id !== node.id) return
          graphics
            .clear()
            .setPosition(-nextNode.width / 2, -nextNode.height / 2)
          renderShapeGraphics(graphics, nextNode)
          applyNodeFrame(scene, nextNode, root, nextNode.height, transition)
        },
        destroy(): void {
          if (root.active) root.destroy()
        },
      }
    }

    case 'teacher-controller':
      return renderTeacherController(scene, node, depth, context)

    case 'external-component':
      return renderExternalComponent(scene, node, depth, context)
  }
}

/**
 * Presentation transitions own the authored root while automation motion owns a
 * zero-origin parent. Keeping those transform channels separate prevents a
 * node.enter/node.exit tween from cancelling or corrupting a state transition.
 */
export function renderNode(
  scene: Phaser.Scene,
  node: PlayerRenderNode,
  depth: number,
  context: RenderNodeContext,
): RenderedNodeHandle {
  const handle = renderNodeContent(scene, node, depth, context)
  const content = [...handle.root.list]
  const motionRoot = scene.add
    .container(0, 0)
    .setName(`motion:${node.id}`)
  handle.root.add(motionRoot)
  if (content.length > 0) motionRoot.add(content)

  return {
    ...handle,
    motionRoot,
  }
}

export type { ComponentInstanceLifecycle }
