import type * as PhaserTypes from 'phaser'
import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeDocument,
  RuntimeHostActions,
  RuntimePresentationApi,
} from '../../../shared/runtimeTypes'
import type { RuntimeHost, RuntimeMountEnvironment } from '../../RuntimeHost'
import type { RuntimeRegistry } from '../../RuntimeRegistry'
import { decodePublishedCode } from '../../publishedLesson'
import type {
  PublishedRuntimeAuthoringMountOptions,
} from './publishedSurfaceRuntimeAuthoringTargets'
import { applyPublishedRuntimeAuthoringText } from './publishedSurfaceRuntimeAuthoringTargets'
import type { PublishedSurfaceRuntimeSession } from './publishedSurfaceRuntimeMount'
import { registerPublishedCaptureResource } from '../publishedCapture'

type PublishedCanvasRuntime = PublishedRuntimeLayerItem['runtime']
type FailurePhase = 'register' | 'create' | 'lifecycle' | 'destroy'

export interface PublishedCanvasRuntimeMountHandle {
  readonly ok: boolean
  readonly element: HTMLElement
  applyAuthoringContentValue(key: string, value: string): boolean
  waitForReady(): Promise<void>
  waitForCaptureReady(): Promise<void>
  restoreAfterCapture(): void
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
  mode?: 'playback' | 'authoring' | 'capture'
  resolveAsset(assetId: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  authoring?: PublishedRuntimeAuthoringMountOptions
  courseState?: CourseStateStoreContract
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

function failedHandle(
  owner: HTMLElement,
  element: HTMLElement,
  cause: unknown,
): PublishedCanvasRuntimeMountHandle {
  let destroyed = false
  const failure = normalizeError(cause)
  const handle: PublishedCanvasRuntimeMountHandle = {
    ok: false,
    element,
    applyAuthoringContentValue: () => false,
    waitForReady: () => Promise.reject(failure),
    waitForCaptureReady: () => Promise.reject(failure),
    restoreAfterCapture() {},
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
  const unregisterCapture = registerPublishedCaptureResource(owner, handle)
  return handle
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
 * API 3 callers do not route through this module. Capture callers await the
 * same API 2 RuntimeHost lifecycle before reading its Canvas/DOM layers.
 */
export function mountPublishedCanvasRuntime(
  container: HTMLElement,
  options: PublishedCanvasRuntimeMountOptions,
): PublishedCanvasRuntimeMountHandle {
  const targetWindow = container.ownerDocument.defaultView
  if (!targetWindow) {
    const error = reportError(options, 'register', new Error('Canvas Runtime 挂载文档没有可执行 Window'))
    const fallback = createFallback(container, options)
    return failedHandle(container, fallback, error)
  }

  let runtime: RuntimeDocument
  try {
    runtime = publishedRuntimeDocument(options.runtime, options.instanceId)
  } catch (cause) {
    const error = reportError(options, 'register', cause)
    const fallback = createFallback(container, options)
    return failedHandle(container, fallback, error)
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
    const error = normalizeError(cause)
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
      // Phaser's public destroy() only marks pendingDestroy. Complete it from
      // the public step() entry point after this stack/frame, so teardown does
      // not depend on a Runtime leaving TimeStep running, awake, or started.
      mountedGame.destroy(true)
    } catch (cause) {
      reportError(options, 'destroy', cause)
    } finally {
      targetWindow.queueMicrotask(() => {
        try {
          mountedGame.step(mountedGame.getTime(), 0)
        } catch (cause) {
          reportError(options, 'destroy', cause)
        }
      })
    }
  }

  const destroyRuntimeHost = (): void => {
    const mountedHost = runtimeHost
    runtimeHost = null
    if (!mountedHost) return
    try {
      mountedHost.destroy()
    } catch (cause) {
      reportError(options, 'destroy', cause)
    }
  }

  const disposeRegistry = (): void => {
    const activeRegistry = registry
    registry = null
    if (!activeRegistry) return
    try {
      activeRegistry.dispose()
    } catch (cause) {
      reportError(options, 'destroy', cause)
    }
  }

  const quarantine = (phase: Exclude<FailurePhase, 'destroy'>, cause: unknown): void => {
    if (destroyed || quarantined) return
    quarantined = true
    reportError(options, phase, settleBootFailure(cause))
    destroyRuntimeHost()
    disposeRegistry()
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
      let nextHost: RuntimeHost | null = null
      let constructionFailure: unknown
      try {
        const authoring = options.mode === 'authoring' ? options.authoring : undefined
        nextHost = new RuntimeHostConstructor({
          registry: activeRegistry,
          runtime,
          label: options.instanceId,
          scope: authoring?.scope ?? options.scope ?? 'scene',
          mode: options.mode === 'authoring' || options.mode === 'capture'
            ? 'capture'
            : 'preview',
          sceneId: authoring?.sceneId ?? options.sceneId,
          width: options.width,
          height: options.height,
          environment,
          actions: options.actions ?? inertActions,
          events: options.session.events,
          courseState: options.courseState ?? options.session.courseState,
          assetUrl: (assetId) => {
            const url = options.resolveAsset(assetId)
            if (!url) throw new Error(`Canvas Runtime 素材“${assetId}”无法解析`)
            return url
          },
          registerNavigationGuard: () => () => undefined,
          ...(authoring
            ? { authoring: { onTargetsChanged: authoring.onTargetsChanged } }
            : {}),
        })
      } catch (cause) {
        constructionFailure = cause
      }
      if (registry === activeRegistry) registry = null
      let disposalFailure: unknown
      try {
        activeRegistry.dispose()
      } catch (cause) {
        disposalFailure = cause
      }
      if (nextHost) runtimeHost = nextHost
      if (constructionFailure !== undefined) throw constructionFailure
      if (disposalFailure !== undefined) throw disposalFailure
      if (!nextHost) throw new Error('Canvas Runtime 宿主创建未返回实例')
      const startupFailure = nextHost.getFailure()
      if (startupFailure) {
        quarantine(startupFailurePhase(startupFailure), startupFailure)
        return
      }
      if (!visible) nextHost.setVisible(false)
      if (suspended) nextHost.suspend()
      checkLifecycleFailure()
      if (!quarantined) settleBootReady()
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

  let unregisterCapture: () => void = () => undefined
  const handle: PublishedCanvasRuntimeMountHandle = {
    get ok() {
      return !quarantined
    },
    get element() {
      return fallback ?? host
    },
    applyAuthoringContentValue(key: string, value: string) {
      if (
        options.mode !== 'authoring'
        || destroyed
        || quarantined
        || !Object.prototype.hasOwnProperty.call(options.runtime.content.values, key)
      ) return false
      options.runtime.content.values[key] = value
      runtime.content.values[key] = value
      return applyPublishedRuntimeAuthoringText(host, key, value)
    },
    async waitForReady() {
      if (captureFailure) throw captureFailure
      if (destroyed) throw new Error(`Canvas Runtime“${options.instanceId}”已销毁`)
      await bootReady
      if (captureFailure) throw captureFailure
      if (!runtimeHost || quarantined) {
        throw captureFailure ?? new Error(`Canvas Runtime“${options.instanceId}”未完成启动`)
      }
    },
    async waitForCaptureReady() {
      if (captureFailure) throw captureFailure
      if (destroyed) throw new Error(`Canvas Runtime“${options.instanceId}”已销毁`)
      await bootReady
      if (captureFailure) throw captureFailure
      const mountedHost = runtimeHost
      if (!mountedHost || quarantined) {
        throw captureFailure ?? new Error(`Canvas Runtime“${options.instanceId}”未完成启动`)
      }
      if (capturePrepared) return
      capturePrepared = true
      try {
        if (!suspended) mountedHost.suspend()
        await mountedHost.waitForCaptureReady()
        const failure = mountedHost.getFailure()
        if (failure) throw failure
      } catch (cause) {
        captureFailure = normalizeError(cause)
        reportError(options, 'lifecycle', captureFailure)
        if (!suspended) {
          try {
            mountedHost.resume()
            checkLifecycleFailure()
          } catch (restoreCause) {
            quarantine('lifecycle', restoreCause)
          }
        }
        capturePrepared = false
        throw captureFailure
      }
    },
    restoreAfterCapture() {
      if (!capturePrepared || destroyed || quarantined) return
      capturePrepared = false
      if (!suspended) {
        try {
          runtimeHost?.resume()
          checkLifecycleFailure()
        } catch (cause) {
          quarantine('lifecycle', cause)
        }
      }
    },
    setVisible(nextVisible: boolean) {
      if (destroyed || quarantined) return
      visible = nextVisible
      try {
        runtimeHost?.setVisible(nextVisible)
        checkLifecycleFailure()
      } catch (cause) {
        quarantine('lifecycle', cause)
      }
    },
    suspend() {
      if (destroyed || quarantined) return
      suspended = true
      try {
        runtimeHost?.suspend()
        checkLifecycleFailure()
      } catch (cause) {
        quarantine('lifecycle', cause)
      }
    },
    resume() {
      if (destroyed || quarantined) return
      suspended = false
      try {
        runtimeHost?.resume()
        checkLifecycleFailure()
      } catch (cause) {
        quarantine('lifecycle', cause)
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      settleBootFailure(new Error(`Canvas Runtime“${options.instanceId}”在捕获就绪前已销毁`))
      unregisterCapture()
      destroyRuntimeHost()
      disposeRegistry()
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
