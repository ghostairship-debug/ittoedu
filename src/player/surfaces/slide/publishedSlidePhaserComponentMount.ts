import type * as PhaserTypes from 'phaser'
import { tryCreateComponentLifecycle } from '../../../shared/componentLifecycleGuard'
import { mergeComponentProps, resolveComponentEditorState } from '../../../shared/componentProps'
import type { ExternalComponentNode } from '../../../shared/projectTypes'
import { ComponentRegistry } from '../../ComponentRegistry'
import {
  createPublishedComponentContextResources,
  createPublishedComponentFallbackElement,
  reportPublishedComponentError,
  resolvePublishedComponent,
  type PublishedComponentContextResources,
  type PublishedComponentMountHandle,
  type PublishedComponentMountOptions,
  type ResolvedPublishedComponent,
} from '../publishedComponentMount'
import { registerPublishedCaptureResource } from '../publishedCapture'

let sceneSequence = 0
let phaserModulePromise: Promise<typeof import('phaser')> | null = null

function loadPhaser(): Promise<typeof import('phaser')> {
  phaserModulePromise ??= import('phaser')
  return phaserModulePromise
}

function failedHandle(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
  cause: unknown = new Error(`Phaser 组件“${options.componentId}”未能启动`),
): PublishedComponentMountHandle {
  const fallback = createPublishedComponentFallbackElement(container, options)
  container.appendChild(fallback)
  let destroyed = false
  const failure = cause instanceof Error ? cause : new Error(String(cause))
  const handle: PublishedComponentMountHandle = {
    ok: false,
    instanceId: options.instanceId ?? options.componentId,
    componentId: options.componentId,
    element: fallback,
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
      fallback.remove()
    },
  }
  const unregisterCapture = registerPublishedCaptureResource(container, handle)
  return handle
}

/**
 * Owns one Published V2 Component API 4 Phaser instance on a Slide layer. The
 * authored Slide wrapper remains authoritative for frame, rotation, opacity,
 * order and hit routing; this host owns only the component-local renderer.
 */
export function mountPublishedSlidePhaserComponent(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
): PublishedComponentMountHandle {
  const targetWindow = container.ownerDocument.defaultView
  if (!targetWindow) {
    reportPublishedComponentError(
      options,
      'register',
      new Error('Published Phaser Component 挂载文档没有可执行 Window'),
    )
    return failedHandle(
      container,
      options,
      new Error('Published Phaser Component 挂载文档没有可执行 Window'),
    )
  }

  const registry = options.registry ?? new ComponentRegistry()
  const ownsRegistry = options.registry === undefined
  const scope = options.scope ?? 'scene'
  let resolved: ResolvedPublishedComponent
  try {
    resolved = resolvePublishedComponent(options, registry)
    if (
      resolved.manifest.renderMode !== 'phaser'
      || !resolved.manifest.supportedScopes.includes(scope)
    ) {
      throw new Error(`组件“${resolved.manifest.id}”未声明 ${scope} Phaser 渲染面`)
    }
  } catch (cause) {
    reportPublishedComponentError(options, 'register', cause)
    if (ownsRegistry) registry.dispose()
    return failedHandle(container, options, cause)
  }
  if (ownsRegistry) registry.dispose()

  const dom = container.ownerDocument
  const host = dom.createElement('div')
  host.className = 'published-slide-phaser-component-mount'
  host.dataset.componentInstanceId = options.instanceId ?? options.componentId
  host.dataset.componentPackageId = resolved.manifest.id
  Object.assign(host.style, {
    boxSizing: 'border-box',
    display: 'block',
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: options.interactive === false ? 'none' : 'auto',
  })
  const canvasHost = dom.createElement('div')
  canvasHost.dataset.publishedPhaserComponentCanvas = options.instanceId ?? options.componentId
  Object.assign(canvasHost.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'inherit',
  })
  host.appendChild(canvasHost)
  container.appendChild(host)

  const instanceId = options.instanceId ?? options.componentId
  let game: PhaserTypes.Game | null = null
  let lifecycle: PublishedComponentMountHandle['lifecycle'] = undefined
  let resources: PublishedComponentContextResources | null = null
  let fallback: HTMLElement | null = null
  let destroyed = false
  let quarantined = false
  let initializingPhaser = false
  let visible = true
  let appliedVisibility: boolean | undefined
  let suspended = false
  let currentWidth = options.width
  let currentHeight = options.height
  let currentProps = options.props ?? {}
  let currentAuthoringNode = options.authoring?.node
  let capturePrepared = false
  let captureFailure: Error | null = null
  let bootSettled = false
  let resolveBoot!: () => void
  let rejectBoot!: (error: Error) => void
  const bootReady = new Promise<void>((resolve, reject) => {
    resolveBoot = resolve
    rejectBoot = reject
  })
  void bootReady.catch(() => undefined)
  const settleBootReady = (): void => {
    if (bootSettled) return
    bootSettled = true
    resolveBoot()
  }
  const settleBootFailure = (cause: unknown): Error => {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    captureFailure ??= error
    if (!bootSettled) {
      bootSettled = true
      rejectBoot(error)
    }
    return error
  }

  const destroyGame = (): void => {
    const mountedGame = game
    game = null
    if (!mountedGame) return
    try {
      // Phaser marks pendingDestroy here. The public step() below completes
      // Core teardown even when authored suspend() already stopped TimeStep.
      mountedGame.destroy(true)
    } catch (cause) {
      reportPublishedComponentError(options, 'destroy', cause)
    } finally {
      targetWindow.queueMicrotask(() => {
        try {
          mountedGame.step(mountedGame.getTime(), 0)
        } catch (cause) {
          reportPublishedComponentError(options, 'destroy', cause)
        }
      })
    }
  }

  const destroyLifecycle = (): void => {
    const mountedLifecycle = lifecycle
    lifecycle = undefined
    const mountedResources = resources
    resources = null
    // Revoke editor targets before authored teardown can retain or mutate them.
    mountedResources?.destroyAuthoringTargets()
    // Close the host event scope before authored teardown so a destroy hook
    // cannot emit or retain subscriptions beyond its owning generation.
    mountedResources?.dispose()
    if (mountedLifecycle) mountedLifecycle.destroy()
  }

  const showFallbackOnce = (): void => {
    if (fallback) return
    fallback = createPublishedComponentFallbackElement(container, options)
    container.appendChild(fallback)
  }

  const quarantine = (
    phase: 'create' | 'lifecycle',
    cause: unknown,
  ): void => {
    if (destroyed || quarantined) return
    quarantined = true
    const error = settleBootFailure(cause)
    reportPublishedComponentError(options, phase, error)
    destroyLifecycle()
    if (initializingPhaser) targetWindow.queueMicrotask(destroyGame)
    else destroyGame()
    host.replaceChildren()
    host.remove()
    showFallbackOnce()
  }

  void loadPhaser().then((Phaser) => {
    if (destroyed || quarantined) return

    class PublishedSlidePhaserComponentScene extends Phaser.Scene {
      constructor() {
        sceneSequence += 1
        super({ key: `published-slide-phaser-component-${sceneSequence}` })
      }

      create(): void {
        // Phaser may finish booting after its owning Slide generation was
        // replaced. Never let that stale Scene construct authored lifecycle.
        if (destroyed || quarantined) return
        initializingPhaser = true
        try {
          const root = this.add.container(0, 0)
          resources = createPublishedComponentContextResources(
            container,
            {
              ...options,
              width: currentWidth,
              height: currentHeight,
              props: currentProps,
              mode: options.mode ?? 'preview',
              scope,
              sceneId: scope === 'scene' ? options.sceneId : undefined,
              ...(options.authoring && currentAuthoringNode
                ? {
                    authoring: {
                      ...options.authoring,
                      node: currentAuthoringNode,
                    },
                  }
                : {}),
            },
            resolved,
          )
          let createFailure: Error | null = null
          const creation = tryCreateComponentLifecycle(
            () => resolved.definition.create({
              ...resources!.context,
              renderMode: 'phaser',
              phaser: { Phaser, scene: this, root },
            }),
            {
              componentId: resolved.manifest.id,
              instanceId,
              onError: (failure) => {
                if (failure.phase === 'create') {
                  createFailure = failure.error
                } else if (failure.phase === 'destroy') {
                  reportPublishedComponentError(options, 'destroy', failure.error)
                } else {
                  quarantine('lifecycle', failure.error)
                }
              },
            },
          )
          if (!creation.ok) {
            quarantine('create', createFailure ?? creation.failure.error)
            return
          }
          lifecycle = creation.lifecycle
          lifecycle.setMode?.(options.mode ?? 'preview')
          lifecycle.resize?.(currentWidth, currentHeight)
          resources.updateAuthoringSize(currentWidth, currentHeight)
          lifecycle.setVisible?.(visible)
          appliedVisibility = visible
          if (suspended) lifecycle.suspend?.()
          settleBootReady()
        } catch (cause) {
          quarantine('create', cause)
        } finally {
          initializingPhaser = false
        }
      }
    }

    try {
      game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent: canvasHost,
        width: Math.max(1, Math.ceil(currentWidth)),
        height: Math.max(1, Math.ceil(currentHeight)),
        backgroundColor: 'rgba(0,0,0,0)',
        scene: new PublishedSlidePhaserComponentScene(),
        banner: false,
        audio: { noAudio: true },
        render: { antialias: true, transparent: true },
      })
      game.canvas.dataset.publishedPhaserComponent = instanceId
      Object.assign(game.canvas.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'inherit',
      })
    } catch (cause) {
      quarantine('create', cause)
    }
  }).catch((cause) => {
    quarantine('create', cause)
  })

  let unregisterCapture: () => void = () => undefined
  const handle: PublishedComponentMountHandle = {
    get ok() {
      return !quarantined
    },
    instanceId,
    componentId: resolved.manifest.id,
    get lifecycle() {
      return lifecycle
    },
    get element() {
      return fallback ?? host
    },
    async waitForReady() {
      if (captureFailure) throw captureFailure
      if (destroyed) throw new Error(`Phaser 组件“${instanceId}”已销毁`)
      await bootReady
      if (captureFailure) throw captureFailure
      if (!lifecycle || !resources || quarantined) {
        throw captureFailure ?? new Error(`Phaser 组件“${instanceId}”未完成启动`)
      }
    },
    async waitForCaptureReady() {
      if (captureFailure) throw captureFailure
      if (destroyed) throw new Error(`Phaser 组件“${instanceId}”已销毁`)
      await bootReady
      if (captureFailure) throw captureFailure
      if (!lifecycle || !resources) {
        throw new Error(`Phaser 组件“${instanceId}”未完成启动`)
      }
      if (capturePrepared) return
      capturePrepared = true
      if (!suspended) lifecycle.suspend?.()
      lifecycle.setMode?.('capture')
      try {
        await resources.waitForCaptureReady(() => lifecycle?.prepareCapture?.())
      } catch (cause) {
        captureFailure = cause instanceof Error ? cause : new Error(String(cause))
        lifecycle?.setMode?.(options.mode ?? 'preview')
        if (!suspended) lifecycle?.resume?.()
        capturePrepared = false
        throw captureFailure
      }
    },
    restoreAfterCapture() {
      if (!capturePrepared || !lifecycle) return
      capturePrepared = false
      lifecycle.setMode?.(options.mode ?? 'preview')
      if (!suspended) lifecycle.resume?.()
    },
    resize(width: number, height: number) {
      if (destroyed || quarantined) return
      currentWidth = width
      currentHeight = height
      if (currentAuthoringNode) {
        currentAuthoringNode = { ...currentAuthoringNode, width, height }
      }
      if (game) game.scale.resize(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
      lifecycle?.resize?.(width, height)
      resources?.updateAuthoringSize(width, height)
      resources?.invalidateAuthoringTargets()
    },
    updateProps(props: Record<string, unknown>) {
      if (destroyed || quarantined) return
      currentProps = props
      if (currentAuthoringNode) {
        currentAuthoringNode = { ...currentAuthoringNode, props }
      }
      const merged = mergeComponentProps(resolved.manifest, props)
      lifecycle?.updateProps?.(merged)
      lifecycle?.setEditorState?.(resolveComponentEditorState(resolved.manifest, merged))
      resources?.updateAuthoringProps(props)
      resources?.invalidateAuthoringTargets()
    },
    updateAuthoringNode(node: ExternalComponentNode) {
      if (destroyed || quarantined) return
      currentAuthoringNode = node
      resources?.updateAuthoringNode(node)
    },
    setVisible(nextVisible: boolean) {
      if (destroyed || quarantined) return
      visible = nextVisible
      if (appliedVisibility === nextVisible) return
      lifecycle?.setVisible?.(nextVisible)
      if (lifecycle) appliedVisibility = nextVisible
    },
    suspend() {
      if (destroyed || quarantined || suspended) return
      suspended = true
      lifecycle?.suspend?.()
    },
    resume() {
      if (destroyed || quarantined || !suspended) return
      suspended = false
      lifecycle?.resume?.()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      settleBootFailure(new Error(`Phaser 组件“${instanceId}”在捕获就绪前已销毁`))
      unregisterCapture()
      destroyLifecycle()
      destroyGame()
      fallback?.remove()
      fallback = null
      host.replaceChildren()
      host.remove()
    },
  }
  unregisterCapture = registerPublishedCaptureResource(container, handle)
  return handle
}
