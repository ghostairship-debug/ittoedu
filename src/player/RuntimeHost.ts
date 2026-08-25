import * as Phaser from 'phaser'
import {
  evaluateAssessment,
  type AssessmentEvaluationRequest,
} from '../shared/assessmentEvaluators'
import { runtimeDocumentSchema } from '../shared/runtimeSchema'
import type {
  CourseEventBus as CourseEventBusContract,
  CourseStateStore as CourseStateStoreContract,
  RuntimeCreateContext,
  RuntimeCreateContextBase,
  RuntimeDomRoots,
  RuntimeDocument,
  RuntimeEventDisposer,
  RuntimeEventListener,
  RuntimeActionEvidenceRequest,
  RuntimeExecutionMode,
  RuntimeHostActions,
  RuntimeInstanceLifecycle,
  RuntimeNavigationGuard,
  RuntimeNodeHandle,
  RuntimeNodeResolver,
  RuntimePhaserRoots,
  RuntimePresentationApi,
  RuntimeScope,
} from '../shared/runtimeTypes'
import { RUNTIME_EVIDENCE_ACTION_KINDS } from '../shared/runtimeTypes'
import { CourseStateStore } from './CourseStateStore'
import type { CourseEventBus } from './CourseEventBus'
import type { RuntimeRegistry } from './RuntimeRegistry'
import type { CaptureSurfaceSnapshotter } from './PreparedCanvasSnapshots'
import {
  RuntimeAuthoringTargetRegistry,
  type RuntimeAuthoringTargetsChangedHandler,
} from './RuntimeAuthoringTargetRegistry'
import type {
  RuntimeActionRecordedHandler,
  RuntimeAssessmentEvaluatedHandler,
} from './HostEvidenceRecorder'

const capturedFreeze = Object.freeze.bind(Object)
const capturedArrayIsArray = Array.isArray.bind(Array)
const capturedArraySlice = Function.prototype.call.bind(Array.prototype.slice) as (
  value: readonly unknown[],
) => unknown[]
const approvedActionKinds = new Set<string>(RUNTIME_EVIDENCE_ACTION_KINDS)
const hasApprovedActionKind = approvedActionKinds.has.bind(approvedActionKinds)
const actIdPattern = /^ACT-\d{3,}$/
const responseIdPattern = /^RESP-\d{3,}$/
const matchesActId = actIdPattern.test.bind(actIdPattern)
const matchesResponseId = responseIdPattern.test.bind(responseIdPattern)
const capturedEventComposedPath = Function.prototype.call.bind(
  Event.prototype.composedPath,
) as (event: Event) => EventTarget[]
const eventTypeGetter = Object.getOwnPropertyDescriptor(Event.prototype, 'type')?.get
const eventPhaseGetter = Object.getOwnPropertyDescriptor(
  Event.prototype,
  'eventPhase',
)?.get

if (!eventTypeGetter || !eventPhaseGetter) {
  throw new Error('当前浏览器缺少宿主动作证据所需的 Event 属性')
}

const capturedEventType = Function.prototype.call.bind(eventTypeGetter) as (
  event: Event,
) => string
const capturedEventPhase = Function.prototype.call.bind(eventPhaseGetter) as (
  event: Event,
) => number

function snapshotAssessmentRequest(
  request: AssessmentEvaluationRequest,
): Readonly<AssessmentEvaluationRequest> {
  const source = request as unknown as {
    responseId?: unknown
    evaluatorId?: unknown
    input?: unknown
    acceptedValues?: unknown
  } | null | undefined
  const responseId = source?.responseId
  const evaluatorId = source?.evaluatorId
  const input = source?.input
  const acceptedValues = source?.acceptedValues
  const acceptedValuesSnapshot = capturedArrayIsArray(acceptedValues)
    ? capturedFreeze(capturedArraySlice(acceptedValues))
    : acceptedValues
  return capturedFreeze({
    ...(responseId !== undefined ? { responseId } : {}),
    evaluatorId,
    input,
    acceptedValues: acceptedValuesSnapshot,
  }) as Readonly<AssessmentEvaluationRequest>
}

function validateAndSnapshotAction(
  request: RuntimeActionEvidenceRequest,
  scope: RuntimeScope,
  sceneId?: string,
): Readonly<import('./HostEvidenceRecorder').RuntimeActionRecordedEvidence> {
  const source = request as unknown as {
    actId?: unknown
    responseId?: unknown
    actionKind?: unknown
    event?: unknown
  } | null | undefined
  const actId = source?.actId
  const responseId = source?.responseId
  const actionKind = source?.actionKind
  const event = source?.event

  try {
    capturedEventComposedPath(event as Event)
  } catch {
    throw new TypeError('动作证据必须绑定真实的浏览器 Event')
  }
  if ((event as Event).isTrusted !== true || capturedEventPhase(event as Event) === 0) {
    throw new TypeError('动作证据只接受当前正在分发且 Event.isTrusted=true 的用户事件')
  }
  if (typeof actId !== 'string' || !matchesActId(actId)) {
    throw new TypeError('actId 必须是 ACT-* 稳定 ID')
  }
  if (responseId !== undefined &&
      (typeof responseId !== 'string' || !matchesResponseId(responseId))) {
    throw new TypeError('responseId 必须是 RESP-* 稳定 ID')
  }
  if (typeof actionKind !== 'string' || !hasApprovedActionKind(actionKind)) {
    throw new TypeError(`未批准的动作类型：${String(actionKind)}`)
  }
  const eventType = capturedEventType(event as Event)
  if (!eventType) throw new TypeError('动作证据事件类型不得为空')
  return capturedFreeze({
    scope,
    ...(sceneId !== undefined ? { sceneId } : {}),
    actId,
    ...(responseId !== undefined ? { responseId } : {}),
    actionKind,
    eventType,
  }) as Readonly<import('./HostEvidenceRecorder').RuntimeActionRecordedEvidence>
}

export interface RuntimeLayerTargets<T> {
  underlay: T
  overlay: T
}

export interface RuntimeMountEnvironment {
  phaser: RuntimeLayerTargets<Phaser.GameObjects.Container> & {
    scene: Phaser.Scene
  }
  dom: RuntimeLayerTargets<HTMLElement>
  resolveNode(nodeId: string): RuntimeNodeHandle | null
  presentation: RuntimePresentationApi
}

export interface RuntimeHostOptions {
  registry: RuntimeRegistry
  runtime: RuntimeDocument
  label: string
  scope: RuntimeScope
  mode: RuntimeExecutionMode
  sceneId?: string
  width: number
  height: number
  environment: RuntimeMountEnvironment
  actions: Readonly<RuntimeHostActions>
  events: CourseEventBus
  courseState: CourseStateStoreContract
  assetUrl(assetId: string): string
  registerNavigationGuard(guard: RuntimeNavigationGuard): RuntimeEventDisposer
  /** Trusted host-only receipt sink. It is never exposed on Runtime context. */
  onAssessmentEvaluated?: RuntimeAssessmentEvaluatedHandler
  /** Trusted host-only action receipt sink. It is never exposed to Runtime. */
  onActionRecorded?: RuntimeActionRecordedHandler
  /** Optional isolated-player authoring sink. Ordinary preview/capture omits it. */
  authoring?: RuntimeAuthoringHostOptions
}

export interface RuntimeAuthoringHostOptions {
  onTargetsChanged: RuntimeAuthoringTargetsChangedHandler
}

class ScopedEventBus implements CourseEventBusContract {
  private readonly subscriptions = new Map<
    string,
    Map<RuntimeEventListener<unknown>, RuntimeEventDisposer>
  >()
  private disposed = false

  constructor(private readonly events: CourseEventBusContract) {}

  on<T = unknown>(
    eventName: string,
    listener: RuntimeEventListener<T>,
  ): RuntimeEventDisposer {
    if (this.disposed) throw new Error('运行时事件作用域已销毁')
    const stored = listener as RuntimeEventListener<unknown>
    let eventSubscriptions = this.subscriptions.get(eventName)
    if (!eventSubscriptions) {
      eventSubscriptions = new Map()
      this.subscriptions.set(eventName, eventSubscriptions)
    }
    eventSubscriptions.get(stored)?.()
    const baseDisposer = this.events.on(eventName, stored)
    let active = true
    const disposer = () => {
      if (!active) return
      active = false
      baseDisposer()
      eventSubscriptions?.delete(stored)
      if (eventSubscriptions?.size === 0) this.subscriptions.delete(eventName)
    }
    eventSubscriptions.set(stored, disposer)
    return disposer
  }

  off<T = unknown>(eventName: string, listener: RuntimeEventListener<T>): void {
    this.subscriptions
      .get(eventName)
      ?.get(listener as RuntimeEventListener<unknown>)
      ?.()
  }

  emit<T = unknown>(eventName: string, payload?: T): void {
    if (!this.disposed) this.events.emit(eventName, payload)
  }

  listenerCount(eventName?: string): number {
    if (eventName !== undefined) return this.subscriptions.get(eventName)?.size ?? 0
    let count = 0
    for (const subscriptions of this.subscriptions.values()) {
      count += subscriptions.size
    }
    return count
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const disposers = [...this.subscriptions.values()]
      .flatMap((subscriptions) => [...subscriptions.values()])
    this.subscriptions.clear()
    disposers.forEach((dispose) => dispose())
  }
}

interface IsolatedDomMount {
  host: HTMLDivElement
  root: HTMLDivElement
}

function createIsolatedDomMount(
  parent: HTMLElement,
  label: string,
): IsolatedDomMount {
  const dom = parent.ownerDocument
  const host = dom.createElement('div')
  host.className = 'lesson-runtime-mount'
  host.dataset.runtimeLabel = label
  Object.assign(host.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'visible',
    pointerEvents: 'none',
  })
  const shadow = host.attachShadow({ mode: 'open' })
  const style = dom.createElement('style')
  style.textContent = `
    :host { position: absolute; inset: 0; display: block; pointer-events: none; }
    *, *::before, *::after { box-sizing: border-box; }
    .courseware-runtime-root {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
      font-family: Inter, "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    .courseware-runtime-error {
      position: absolute;
      left: 16px;
      top: 16px;
      max-width: min(520px, calc(100% - 32px));
      padding: 10px 14px;
      border: 1px solid #ef6464;
      border-radius: 8px;
      color: #fecaca;
      background: rgba(63, 20, 26, .94);
      font: 14px/1.5 Inter, "Microsoft YaHei", sans-serif;
      pointer-events: none;
    }
  `
  const root = dom.createElement('div')
  root.className = 'courseware-runtime-root'
  shadow.append(style, root)
  parent.append(host)
  return { host, root }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export class RuntimeHost {
  private readonly options: Omit<
    RuntimeHostOptions,
    'onAssessmentEvaluated' | 'onActionRecorded'
  >
  private readonly localState: CourseStateStore
  private readonly scopedEvents: ScopedEventBus
  private underlayMount: Phaser.GameObjects.Container | null = null
  private overlayMount: Phaser.GameObjects.Container | null = null
  private underlayDom: IsolatedDomMount | null = null
  private overlayDom: IsolatedDomMount | null = null
  private readonly looseObjects: Phaser.GameObjects.GameObject[] = []
  private readonly guardDisposers = new Set<RuntimeEventDisposer>()
  private readonly capturePromises = new Set<Promise<unknown>>()
  private authoringRegistry: RuntimeAuthoringTargetRegistry | null = null
  private lifecycle: RuntimeInstanceLifecycle | null = null
  private failure: Error | null = null
  private destroyed = false

  constructor(options: RuntimeHostOptions) {
    const {
      onAssessmentEvaluated,
      onActionRecorded,
      ...storedOptions
    } = options
    this.options = storedOptions
    const runtime = runtimeDocumentSchema.parse(options.runtime)
    this.scopedEvents = new ScopedEventBus(options.events)
    this.localState = new CourseStateStore((change) => {
      options.events.emit('state:change', {
        scope: options.scope,
        sceneId: options.sceneId,
        ...change,
      })
    })

    if (!runtime.enabled) return
    const exposesPhaser = runtime.renderMode !== 'dom'
    const exposesDom = runtime.renderMode !== 'phaser'
    if (exposesPhaser) this.createPhaserMounts()
    if (exposesDom) this.createDomMounts()

    const { scene } = options.environment.phaser
    const displayListBeforeCreate = new Set(scene.children.list)
    try {
      const definition = options.registry.executeRuntime(
        runtime.source,
        options.label,
        runtime.runtimeApiVersion,
      )
      if (definition.authoringApiVersion === 1 && options.authoring) {
        this.authoringRegistry = new RuntimeAuthoringTargetRegistry({
          scope: options.scope,
          sceneId: options.sceneId,
          width: options.width,
          height: options.height,
          content: runtime.content,
          assets: runtime.assets,
          ...(exposesDom ? { domRoots: this.domRoots() } : {}),
          onTargetsChanged: options.authoring.onTargetsChanged,
        })
      }
      const contentValues = Object.freeze({ ...runtime.content.values })
      const commonContext: RuntimeCreateContextBase = {
        scope: options.scope,
        mode: options.mode,
        sceneId: options.sceneId,
        width: options.width,
        height: options.height,
        content: {
          get(key: string): string {
            if (!Object.prototype.hasOwnProperty.call(contentValues, key)) {
              throw new Error(`运行时文字“${key}”不存在`)
            }
            return contentValues[key] ?? ''
          },
          all(): Readonly<Record<string, string>> {
            return contentValues
          },
        },
        assets: {
          url(bindingKey: string): string {
            const binding = runtime.assets[bindingKey]
            if (!binding) throw new Error(`运行时素材绑定“${bindingKey}”不存在`)
            return options.assetUrl(binding.assetId)
          },
          projectUrl(assetId: string): string {
            return options.assetUrl(assetId)
          },
        },
        presentation: options.environment.presentation,
        actions: options.actions,
        events: this.scopedEvents,
        localState: this.localState,
        courseState: options.courseState,
        capture: {
          waitUntil: (promise: Promise<unknown>) => {
            const tracked = Promise.resolve(promise)
            this.capturePromises.add(tracked)
            // Capture may be requested well after create(). Observe early
            // rejections now while preserving the rejected promise so the
            // eventual export barrier still fails deterministically.
            void tracked.catch(() => undefined)
          },
        },
        navigation: {
          guard: (guard) => {
            const baseDisposer = options.registerNavigationGuard(guard)
            let active = true
            const disposer = () => {
              if (!active) return
              active = false
              this.guardDisposers.delete(disposer)
              baseDisposer()
            }
            this.guardDisposers.add(disposer)
            return disposer
          },
        },
        assessment: Object.freeze({
          evaluate: (request: AssessmentEvaluationRequest) => {
            const requestSnapshot = snapshotAssessmentRequest(request)
            const result = evaluateAssessment(requestSnapshot)
            onAssessmentEvaluated?.({
              scope: options.scope,
              ...(options.sceneId !== undefined
                ? { sceneId: options.sceneId }
                : {}),
              request: requestSnapshot,
              result: capturedFreeze({
                evaluatorId: result.evaluatorId,
                normalizedInput: result.normalizedInput,
                status: result.status,
              }),
            })
            return result
          },
        }),
        evidence: capturedFreeze({
          recordAction: (request: RuntimeActionEvidenceRequest) => {
            const snapshot = validateAndSnapshotAction(
              request,
              options.scope,
              options.sceneId,
            )
            onActionRecorded?.(snapshot)
          },
        }),
        ...(this.authoringRegistry
          ? { authoring: this.authoringRegistry }
          : {}),
        emit: (eventName, payload) => {
          options.events.emit('runtime:event', {
            scope: options.scope,
            sceneId: options.sceneId,
            eventName,
            payload,
          })
        },
      }
      const nodes: RuntimeNodeResolver = {
        get: (bindingOrNodeId: string) => options.environment.resolveNode(
          runtime.nodeBindings?.[bindingOrNodeId] ?? bindingOrNodeId,
        ),
      }

      let context: RuntimeCreateContext
      if (runtime.renderMode === 'phaser') {
        context = {
          ...commonContext,
          runtimeApiVersion: 2,
          renderMode: 'phaser',
          Phaser,
          phaser: this.phaserRoots(),
          nodes,
        }
      } else if (runtime.renderMode === 'dom') {
        const dom = this.domRoots()
        context = {
          ...commonContext,
          runtimeApiVersion: 2,
          renderMode: 'dom',
          domRoot: dom.root,
          dom,
        }
      } else {
        const dom = this.domRoots()
        context = {
          ...commonContext,
          runtimeApiVersion: 2,
          renderMode: 'hybrid',
          Phaser,
          phaser: this.phaserRoots(),
          domRoot: dom.root,
          dom,
          nodes,
        }
      }
      const lifecycle: RuntimeInstanceLifecycle = definition.create(context)
      if (!lifecycle || typeof lifecycle.destroy !== 'function') {
        throw new Error('运行时 create() 必须返回含 destroy() 的生命周期对象')
      }
      this.lifecycle = lifecycle
      this.looseObjects.push(
        ...scene.children.list.filter(
          (object) => !displayListBeforeCreate.has(object),
        ),
      )
    } catch (error) {
      this.recordFailure(error)
      console.error(`运行时“${options.label}”启动失败`, error)
      for (const dispose of [...this.guardDisposers]) dispose()
      this.guardDisposers.clear()
      this.scopedEvents.dispose()
      this.authoringRegistry?.destroy()
      this.authoringRegistry = null
      this.underlayMount?.removeAll(true)
      this.overlayMount?.removeAll(true)
      for (const object of scene.children.list.slice()) {
        if (!displayListBeforeCreate.has(object) && object.active) {
          object.destroy()
        }
      }
      const message = options.environment.dom.overlay.ownerDocument.createElement('div')
      message.className = 'courseware-runtime-error'
      message.textContent = `互动运行时加载失败：${messageOf(error)}`
      this.ensureOverlayDom().root.append(message)
    }
  }

  async waitForCaptureReady(
    snapshotSurfaces?: CaptureSurfaceSnapshotter,
  ): Promise<void> {
    if (this.destroyed) return
    if (this.failure) {
      throw new Error(
        `运行时“${this.options.label}”此前执行失败，不能生成可靠快照：${this.failure.message}`,
        { cause: this.failure },
      )
    }
    try {
      // Resource promises registered during create/update must settle before
      // prepareCapture performs the final WebGL/Canvas draw. Otherwise a slow
      // task can outlive a preserveDrawingBuffer=false frame.
      await this.drainCapturePromises()
      await this.lifecycle?.prepareCapture?.()
      // A hook may synchronously register additional finite work. Such a task
      // must resolve only after it has committed any asynchronous final draw.
      await this.drainCapturePromises()
      const roots = [this.underlayDom?.root, this.overlayDom?.root]
        .filter((root): root is HTMLDivElement => Boolean(root))
      if (roots.length > 0) snapshotSurfaces?.(roots)
    } catch (error) {
      throw this.recordFailure(error)
    }
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return
    this.authoringRegistry?.resize(width, height)
    if (typeof this.lifecycle?.resize !== 'function') return
    try {
      this.lifecycle.resize(width, height)
    } catch (error) {
      this.recordFailure(error)
      console.error(`运行时“${this.options.label}”调整尺寸失败`, error)
    }
  }

  setVisible(visible: boolean): void {
    if (this.destroyed) return
    this.underlayMount?.setVisible(visible)
    this.overlayMount?.setVisible(visible)
    if (this.underlayDom) {
      this.underlayDom.host.style.visibility = visible ? '' : 'hidden'
    }
    if (this.overlayDom) {
      this.overlayDom.host.style.visibility = visible ? '' : 'hidden'
    }
    if (typeof this.lifecycle?.setVisible !== 'function') return
    try {
      this.lifecycle.setVisible(visible)
    } catch (error) {
      this.recordFailure(error)
      console.error(`运行时“${this.options.label}”切换可见性失败`, error)
    }
  }

  suspend(): void {
    if (this.destroyed || typeof this.lifecycle?.suspend !== 'function') return
    try {
      this.lifecycle.suspend()
    } catch (error) {
      this.recordFailure(error)
      console.error(`运行时“${this.options.label}”暂停失败`, error)
    }
  }

  resume(): void {
    if (this.destroyed || typeof this.lifecycle?.resume !== 'function') return
    try {
      this.lifecycle.resume()
    } catch (error) {
      this.recordFailure(error)
      console.error(`运行时“${this.options.label}”恢复失败`, error)
    }
  }

  getFailure(): Error | null {
    return this.failure
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    try {
      this.lifecycle?.destroy()
    } catch (error) {
      console.error(`运行时“${this.options.label}”销毁失败`, error)
    }
    this.lifecycle = null
    this.authoringRegistry?.destroy()
    this.authoringRegistry = null
    for (const dispose of [...this.guardDisposers]) dispose()
    this.guardDisposers.clear()
    this.scopedEvents.dispose()
    this.localState.clear()
    for (const object of this.looseObjects) {
      if (object.active) object.destroy()
    }
    this.looseObjects.length = 0
    if (this.underlayMount?.active) this.underlayMount.destroy(true)
    if (this.overlayMount?.active) this.overlayMount.destroy(true)
    this.underlayMount = null
    this.overlayMount = null
    this.underlayDom?.host.remove()
    this.overlayDom?.host.remove()
    this.underlayDom = null
    this.overlayDom = null
    this.capturePromises.clear()
  }

  private recordFailure(error: unknown): Error {
    const normalized = errorOf(error)
    this.failure ??= normalized
    return this.failure
  }

  private async drainCapturePromises(): Promise<void> {
    while (this.capturePromises.size > 0) {
      const pending = [...this.capturePromises]
      try {
        await Promise.all(pending)
      } finally {
        pending.forEach((promise) => this.capturePromises.delete(promise))
      }
    }
  }

  private createPhaserMounts(): void {
    if (this.underlayMount && this.overlayMount) return
    const { scene, underlay, overlay } = this.options.environment.phaser
    this.underlayMount = scene.add
      .container(0, 0)
      .setName(`${this.options.label}:phaser-underlay`)
    this.overlayMount = scene.add
      .container(0, 0)
      .setName(`${this.options.label}:phaser-overlay`)
    underlay.add(this.underlayMount)
    overlay.add(this.overlayMount)
  }

  private createDomMounts(): void {
    if (this.underlayDom && this.overlayDom) return
    this.underlayDom = createIsolatedDomMount(
      this.options.environment.dom.underlay,
      `${this.options.label}:dom-underlay`,
    )
    this.overlayDom = createIsolatedDomMount(
      this.options.environment.dom.overlay,
      `${this.options.label}:dom-overlay`,
    )
  }

  private ensureOverlayDom(): IsolatedDomMount {
    if (!this.overlayDom) {
      this.overlayDom = createIsolatedDomMount(
        this.options.environment.dom.overlay,
        `${this.options.label}:dom-overlay`,
      )
    }
    return this.overlayDom
  }

  private phaserRoots(): RuntimePhaserRoots {
    if (!this.underlayMount || !this.overlayMount) {
      throw new Error('运行时未声明 Phaser 渲染能力')
    }
    return {
      scene: this.options.environment.phaser.scene,
      root: this.overlayMount,
      underlay: this.underlayMount,
      overlay: this.overlayMount,
    }
  }

  private domRoots(): RuntimeDomRoots {
    if (!this.underlayDom || !this.overlayDom) {
      throw new Error('运行时未声明 DOM 渲染能力')
    }
    return {
      root: this.overlayDom.root,
      underlay: this.underlayDom.root,
      overlay: this.overlayDom.root,
    }
  }
}
