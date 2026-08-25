import type * as PhaserTypes from 'phaser'
import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'
import type {
  RuntimeDocument,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../../../shared/runtimeTypes'
import type { RuntimeHost, RuntimeMountEnvironment } from '../../RuntimeHost'
import type { RuntimeRegistry } from '../../RuntimeRegistry'
import { decodePublishedCode } from '../../publishedLesson'
import type { PublishedSurfaceRuntimeSession } from './publishedSurfaceRuntimeMount'

type PublishedCanvasRuntime = PublishedRuntimeLayerItem['runtime']
type FailurePhase = 'register' | 'create' | 'lifecycle' | 'destroy'

export interface PublishedCanvasRuntimeMountHandle {
  readonly ok: boolean
  readonly element: HTMLElement
  setVisible(visible: boolean): void
  suspend(): void
  resume(): void
  destroy(): void
}

export interface PublishedCanvasRuntimeMountOptions {
  instanceId: string
  scope?: 'scene' | 'global'
  sceneId?: string
  runtime: PublishedCanvasRuntime
  width: number
  height: number
  visible: boolean
  resolveAsset(assetId: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  fallbackText?: string
  actions?: Readonly<RuntimeHostActions>
  presentation?: RuntimePresentationApi
  reportError?(phase: FailurePhase, error: Error): void
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

let sceneSequence = 0
let runtimeModulesPromise: Promise<readonly [
  typeof import('phaser'),
  typeof import('../../RuntimeHost'),
  typeof import('../../RuntimeRegistry'),
]> | null = null

function loadRuntimeModules(): NonNullable<typeof runtimeModulesPromise> {
  runtimeModulesPromise ??= Promise.all([
    import('phaser'),
    import('../../RuntimeHost'),
    import('../../RuntimeRegistry'),
  ])
  return runtimeModulesPromise
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function reportError(
  options: PublishedCanvasRuntimeMountOptions,
  phase: FailurePhase,
  cause: unknown,
): Error {
  const error = normalizeError(cause)
  try {
    options.reportError?.(phase, error)
  } catch (reportFailure) {
    console.error('Published Canvas Runtime 诊断回调失败', reportFailure)
  }
  return error
}

function startupFailurePhase(error: Error): Extract<FailurePhase, 'register' | 'create'> {
  return error.message.includes('注册失败') ? 'register' : 'create'
}

function createFallback(
  container: HTMLElement,
  options: PublishedCanvasRuntimeMountOptions,
): HTMLElement {
  const fallback = container.ownerDocument.createElement('div')
  fallback.className = 'published-canvas-runtime-fallback'
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
    fallback.textContent = options.fallbackText ?? '[Canvas Runtime 后备]'
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

function publishedRuntimeDocument(
  runtime: PublishedCanvasRuntime,
  instanceId: string,
): RuntimeDocument {
  if (runtime.protocol !== 'canvas-runtime' || runtime.runtimeApiVersion !== 2) {
    throw new Error('Published Canvas Runtime 只支持 canvas-runtime API 2')
  }
  return {
    runtimeApiVersion: 2,
    enabled: runtime.enabled,
    renderMode: runtime.renderMode,
    source: decodePublishedCode(runtime.code, `Runtime“${instanceId}”代码`),
    content: runtime.content,
    assets: runtime.assets,
    ...(runtime.nodeBindings ? { nodeBindings: runtime.nodeBindings } : {}),
  }
}

function createDomOnlyEnvironment(
  domUnderlay: HTMLElement,
  domOverlay: HTMLElement,
  presentation: RuntimePresentationApi,
): RuntimeMountEnvironment {
  const scene = {
    children: { list: [] },
    add: {
      container() {
        throw new Error('DOM Runtime 不应创建 Phaser 容器')
      },
    },
  }
  const inertContainer = {} as PhaserTypes.GameObjects.Container
  return {
    phaser: {
      scene: scene as unknown as PhaserTypes.Scene,
      underlay: inertContainer,
      overlay: inertContainer,
    },
    dom: { underlay: domUnderlay, overlay: domOverlay },
    resolveNode: () => null,
    presentation,
  }
}

/**
 * Mounts one Published V2 canvas-runtime API 2 instance. Scene-local callers
 * own their generation; the Published course session owns global instances.
 * Capture and API 3 callers do not route through this module.
 */
export function mountPublishedCanvasRuntime(
  container: HTMLElement,
  options: PublishedCanvasRuntimeMountOptions,
): PublishedCanvasRuntimeMountHandle {
  const targetWindow = container.ownerDocument.defaultView
  if (!targetWindow) {
    const error = reportError(options, 'register', new Error('Canvas Runtime 挂载文档没有可执行 Window'))
    void error
    const fallback = createFallback(container, options)
    return {
      ok: false,
      element: fallback,
      setVisible() {},
      suspend() {},
      resume() {},
      destroy: () => fallback.remove(),
    }
  }

  let runtime: RuntimeDocument
  try {
    runtime = publishedRuntimeDocument(options.runtime, options.instanceId)
  } catch (cause) {
    reportError(options, 'register', cause)
    const fallback = createFallback(container, options)
    return {
      ok: false,
      element: fallback,
      setVisible() {},
      suspend() {},
      resume() {},
      destroy: () => fallback.remove(),
    }
  }

  const dom = container.ownerDocument
  const host = dom.createElement('div')
  host.className = 'published-canvas-runtime-mount'
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
  const domUnderlay = dom.createElement('div')
  const canvasHost = dom.createElement('div')
  const domOverlay = dom.createElement('div')
  domUnderlay.dataset.canvasRuntimeDomUnderlay = options.instanceId
  canvasHost.dataset.canvasRuntimePhaser = options.instanceId
  domOverlay.dataset.canvasRuntimeDomOverlay = options.instanceId
  for (const [element, zIndex] of [
    [domUnderlay, '0'],
    [canvasHost, '1'],
    [domOverlay, '2'],
  ] as const) {
    Object.assign(element.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex,
    })
  }
  canvasHost.style.pointerEvents = 'inherit'
  host.append(domUnderlay, canvasHost, domOverlay)
  container.appendChild(host)

  const presentation = options.presentation ?? inertPresentation
  let runtimeHost: RuntimeHost | null = null
  let registry: RuntimeRegistry | null = null
  let game: PhaserTypes.Game | null = null
  let RuntimeHostConstructor: (typeof import('../../RuntimeHost'))['RuntimeHost'] | null = null
  let fallback: HTMLElement | null = null
  let destroyed = false
  let quarantined = false
  let visible = options.visible
  let suspended = !options.visible
  let initializingPhaser = false

  const destroyGame = (): void => {
    const mountedGame = game
    game = null
    if (!mountedGame) return
    try {
      // Phaser's public destroy() only marks pendingDestroy. Complete it from
      // the public step() entry point after this stack/frame, so teardown does
      // not depend on a Runtime leaving TimeStep running, awake, or started.
      mountedGame.destroy(true)
      targetWindow.queueMicrotask(() => {
        try {
          mountedGame.step(mountedGame.getTime(), 0)
        } catch (cause) {
          reportError(options, 'destroy', cause)
        }
      })
    } catch (cause) {
      reportError(options, 'destroy', cause)
    }
  }

  const quarantine = (phase: Exclude<FailurePhase, 'destroy'>, cause: unknown): void => {
    if (destroyed || quarantined) return
    quarantined = true
    reportError(options, phase, cause)
    runtimeHost?.destroy()
    runtimeHost = null
    registry?.dispose()
    if (initializingPhaser) {
      targetWindow.queueMicrotask(destroyGame)
    } else destroyGame()
    host.remove()
    fallback = createFallback(container, options)
  }

  const checkLifecycleFailure = (): void => {
    const failure = runtimeHost?.getFailure()
    if (failure) quarantine('lifecycle', failure)
  }

  const createHost = (environment: RuntimeMountEnvironment): void => {
    if (destroyed || quarantined) return
    try {
      if (!RuntimeHostConstructor || !registry) {
        throw new Error('Canvas Runtime 宿主模块尚未就绪')
      }
      const activeRegistry = registry
      let nextHost: RuntimeHost
      try {
        nextHost = new RuntimeHostConstructor({
          registry: activeRegistry,
          runtime,
          label: options.instanceId,
          scope: options.scope ?? 'scene',
          mode: 'preview',
          sceneId: options.sceneId,
          width: options.width,
          height: options.height,
          environment,
          actions: options.actions ?? inertActions,
          events: options.session.events,
          courseState: options.session.courseState,
          assetUrl: (assetId) => {
            const url = options.resolveAsset(assetId)
            if (!url) throw new Error(`Canvas Runtime 素材“${assetId}”无法解析`)
            return url
          },
          registerNavigationGuard: () => () => undefined,
        })
      } finally {
        activeRegistry.dispose()
        if (registry === activeRegistry) registry = null
      }
      runtimeHost = nextHost
      const startupFailure = nextHost.getFailure()
      if (startupFailure) {
        quarantine(startupFailurePhase(startupFailure), startupFailure)
        return
      }
      if (!visible) nextHost.setVisible(false)
      if (suspended) nextHost.suspend()
      checkLifecycleFailure()
    } catch (cause) {
      const error = normalizeError(cause)
      quarantine(startupFailurePhase(error), error)
    }
  }

  void loadRuntimeModules().then(([Phaser, runtimeHostModule, runtimeRegistryModule]) => {
    if (destroyed || quarantined) return
    RuntimeHostConstructor = runtimeHostModule.RuntimeHost
    registry = new runtimeRegistryModule.RuntimeRegistry(targetWindow)
    if (runtime.renderMode === 'dom') {
      createHost(createDomOnlyEnvironment(domUnderlay, domOverlay, presentation))
      return
    }

    class PublishedCanvasRuntimeScene extends Phaser.Scene {
      constructor() {
        sceneSequence += 1
        super({ key: `published-canvas-runtime-${sceneSequence}` })
      }

      create(): void {
        initializingPhaser = true
        try {
          const phaserUnderlay = this.add.container(0, 0)
          const phaserOverlay = this.add.container(0, 0)
          createHost({
            phaser: {
              scene: this,
              underlay: phaserUnderlay,
              overlay: phaserOverlay,
            },
            dom: { underlay: domUnderlay, overlay: domOverlay },
            resolveNode: () => null,
            presentation,
          })
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
        width: Math.max(1, Math.ceil(options.width)),
        height: Math.max(1, Math.ceil(options.height)),
        backgroundColor: 'rgba(0,0,0,0)',
        scene: new PublishedCanvasRuntimeScene(),
        banner: false,
        audio: { noAudio: true },
        render: { antialias: true, transparent: true },
      })
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
    get element() {
      return fallback ?? host
    },
    setVisible(nextVisible: boolean) {
      if (destroyed || quarantined) return
      visible = nextVisible
      runtimeHost?.setVisible(nextVisible)
      checkLifecycleFailure()
    },
    suspend() {
      if (destroyed || quarantined) return
      suspended = true
      runtimeHost?.suspend()
      checkLifecycleFailure()
    },
    resume() {
      if (destroyed || quarantined) return
      suspended = false
      runtimeHost?.resume()
      checkLifecycleFailure()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      try {
        runtimeHost?.destroy()
      } catch (cause) {
        reportError(options, 'destroy', cause)
      }
      runtimeHost = null
      registry?.dispose()
      destroyGame()
      fallback?.remove()
      fallback = null
      host.replaceChildren()
      host.remove()
    },
  }
}
