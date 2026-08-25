import type * as PhaserTypes from 'phaser'
import { tryCreateComponentLifecycle } from '../../../shared/componentLifecycleGuard'
import { mergeComponentProps, resolveComponentEditorState } from '../../../shared/componentProps'
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

let sceneSequence = 0
let phaserModulePromise: Promise<typeof import('phaser')> | null = null

function loadPhaser(): Promise<typeof import('phaser')> {
  phaserModulePromise ??= import('phaser')
  return phaserModulePromise
}

function failedHandle(
  container: HTMLElement,
  options: PublishedComponentMountOptions,
): PublishedComponentMountHandle {
  const fallback = createPublishedComponentFallbackElement(container, options)
  container.appendChild(fallback)
  let destroyed = false
  return {
    ok: false,
    instanceId: options.instanceId ?? options.componentId,
    componentId: options.componentId,
    element: fallback,
    resize() {},
    updateProps() {},
    setVisible() {},
    suspend() {},
    resume() {},
    destroy() {
      if (destroyed) return
      destroyed = true
      fallback.remove()
    },
  }
}

/**
 * Owns one scene-local Published V2 Component API 4 Phaser instance. The
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
    return failedHandle(container, options)
  }

  const registry = options.registry ?? new ComponentRegistry()
  const ownsRegistry = options.registry === undefined
  let resolved: ResolvedPublishedComponent
  try {
    resolved = resolvePublishedComponent(options, registry)
    if (
      resolved.manifest.renderMode !== 'phaser'
      || !resolved.manifest.supportedScopes.includes('scene')
    ) {
      throw new Error(`组件“${resolved.manifest.id}”未声明 Phaser 渲染面`)
    }
  } catch (cause) {
    reportPublishedComponentError(options, 'register', cause)
    if (ownsRegistry) registry.dispose()
    return failedHandle(container, options)
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
    if (mountedLifecycle) mountedLifecycle.destroy()
    resources?.dispose()
    resources = null
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
    reportPublishedComponentError(options, phase, cause)
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
              mode: 'preview',
              scope: 'scene',
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
          lifecycle.setMode?.('preview')
          lifecycle.resize?.(currentWidth, currentHeight)
          lifecycle.setVisible?.(visible)
          appliedVisibility = visible
          if (suspended) lifecycle.suspend?.()
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

  return {
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
    resize(width: number, height: number) {
      if (destroyed || quarantined) return
      currentWidth = width
      currentHeight = height
      if (game) game.scale.resize(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
      lifecycle?.resize?.(width, height)
    },
    updateProps(props: Record<string, unknown>) {
      if (destroyed || quarantined) return
      currentProps = props
      const merged = mergeComponentProps(resolved.manifest, props)
      lifecycle?.updateProps?.(merged)
      lifecycle?.setEditorState?.(resolveComponentEditorState(resolved.manifest, merged))
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
      destroyLifecycle()
      destroyGame()
      fallback?.remove()
      fallback = null
      host.replaceChildren()
      host.remove()
    },
  }
}
