import { componentPaintStack } from '../../../components/web/paintHit'
import { hasWebContentData } from '../../../components/web/sourcePreparation'
import { nanoid } from 'nanoid'
import { splitInstalledBundledFontFaceCss } from '../../../shared/fonts/installedBundledFontFaceCss'
import type { CompiledComponentModule } from '../../../core/components/compilation/types'
import type { ComponentInstance, ComponentRuntimeScope, ComponentTarget, JsonValue, ComponentRuntimeContext, ComponentAuthorSpotInput, ComponentAuthorPreviewCallbacks, ComponentAuthorGeometry, ComponentMediaCommand, ComponentMediaRegistration, ComponentMediaPort, ComponentInteractionPort, ComponentPresentationPort, ComponentMediaState, ComponentMediaRegistrationOptions, ComponentLayoutInput, ComponentLayoutPort, ComponentGeometrySnapshot } from '../../../shared/contracts/component-platform'
import type { PreparedComponentRuntime } from './ComponentRuntimeHost'
import { componentTargetSchema, jsonValueSchema, componentFrameSchema } from '../../../shared/contracts/component-platform'
import { teacherControllerActionSchema, type TeacherControllerAction, type TeacherControllerPort, type TeacherControllerSnapshot } from '../../../shared/contracts/component-platform/teacherController'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { locateHtmlSourceTarget } from '../../../shared/html/htmlSourceLocator'
import type { ComponentMotionContext, ComponentMotionOutcome, ComponentMotionProgram, ComponentMotionTask, MotionFrame, MotionKeyframe, MotionTiming } from '../../../shared/contracts/component-platform/motion'
import { componentFragmentStateKey, createComponentFragmentProjection } from '../../componentPlatform/fragments'
import type { ComponentBootstrapInput, ComponentBootstrapLease } from '../../../shared/ipcTypes'
import { interactionActionSchema, interactionTriggerSchema } from '../../../shared/contracts/interaction-v1/schema'
import { htmlDocumentKind } from '../../../shared/html/documentKind'
import { isMeasuredWebFragmentBox, measuredFragmentExtent } from '../../../components/web/measuredFragmentBox'
import { authoredDocumentBootstrap, authoredDocumentProgramsSource } from '../../../components/web/authoredDocumentBootstrap'
import { webRuntimeTargetProfile, type RuntimeTargetProfile, type WebRuntimeData } from '../../../components/web/moduleGraph'
import { refreshWebResourceReferences } from '../../../components/web/resources'
import { createWebResourceUrlLease } from '../../../components/web/resourceUrlLease'
import { installCourseNavigationReady } from '../../../components/web/courseNavigation'
import { createDomAuthoring, domAuthoringFactorySource } from '../../../components/web/authoringDom'
import { installOwnedDocumentAuthoring, installAuthoringInputArbitration, authoringCaretOffset, type OwnedDocumentBlobCarriers } from '../../../components/web/ownedDocumentAuthoring'
import { createAuthoringFrameGeometry } from '../../../components/web/authoringFrame'
import { ownedDocumentExecutionSource } from '../../../components/web/ownedDocumentIdentity'
import { domTextOverrideRealmSource, type DomTextOverrideController } from '../../lightEdit/domTextOverrides'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import { invertMatrix, multiplyMatrices, transformPoint, type AffineMatrix } from '../../../core/components/geometry'
import { componentClientMatrix } from './componentClientMatrix'
import { projectComponentGeometry } from './componentGeometry'

export interface RuntimeTargetSnapshot { reference: ComponentTarget; instanceId: string; value?: JsonValue }
export interface ComponentBootstrapTransport {
  createComponentBootstrap(input: ComponentBootstrapInput): Promise<ComponentBootstrapLease>
  releaseComponentBootstrap(input: { leaseId: string }): Promise<void>
}
export interface SandboxRuntimeSnapshots { state(): Record<string, JsonValue>; targets(profile: RuntimeTargetProfile): RuntimeTargetSnapshot[]; /** World-backed carriers send a small invalidation, then read their own profile. */ targetChanges?: boolean; instance?(value: ComponentInstance): ComponentInstance<JsonValue | WebRuntimeData> | Promise<ComponentInstance<JsonValue | WebRuntimeData>>; webInstance?(value: ComponentInstance): ComponentInstance<JsonValue | WebRuntimeData> | Promise<ComponentInstance<JsonValue | WebRuntimeData>>; teacherController?: TeacherControllerPort; htmlAuthoring?: boolean; authorHtml?(instance: ComponentInstance): string | undefined; nativeDocument?: boolean; builtinKey?: string; connectOrigins?(): readonly string[]; themeCss?(): string; resources?(): Record<string, string>; resourceBindings?: Readonly<Record<string, string>>; bootstrap?: ComponentBootstrapTransport; hostAdapter?: SandboxRuntimeHostAdapter }

export interface SandboxRuntimeHostAdapter {
  clientMatrix?(element: HTMLElement): readonly [number, number, number, number, number, number] | null
  locateTarget?: typeof locateHtmlSourceTarget
  authorHitEvent?: string
}
interface ComponentAuthorHitResult { authorKey: string | null; painted: boolean }
interface ComponentAuthorHitRequest { point: { x: number; y: number }; resolve(result: ComponentAuthorHitResult): void }

/** The browser identifies the leaf; transparent document/carrier boxes do not paint by themselves. */
export function componentAuthorPaintAtPoint(root: Element, x: number, y: number): boolean {
  return componentPaintStack(root, x, y).length > 0
}

/** Serialized trusted bridge only. Author code arrives through its dedicated port. */
function contentRealmBridge(nonce: string, fragmentBox: { resourceFactory: typeof createWebResourceUrlLease; navigationReady: typeof installCourseNavigationReady; isMeasured: typeof isMeasuredWebFragmentBox; extent: typeof measuredFragmentExtent; refreshResources: typeof refreshWebResourceReferences; fragments: typeof createComponentFragmentProjection; authoring: typeof createDomAuthoring; paintAt: typeof componentAuthorPaintAtPoint; clientMatrix: typeof componentClientMatrix; ownedAuthoring: typeof installOwnedDocumentAuthoring; input: typeof installAuthoringInputArbitration; caret: typeof authoringCaretOffset; frameGeometry: typeof createAuthoringFrameGeometry; textOverrides(roots: readonly Node[], rules: readonly LightEditTextOverride[]): DomTextOverrideController }, authoredDocument?: { release(): void; resourceLease?: ReturnType<typeof createWebResourceUrlLease>; blobCarriers?: OwnedDocumentBlobCarriers; transportFragment?: boolean; setActivity?(value: { active: boolean; visible: boolean; playing: boolean }): void; onDiagnostic?(listener: (message: string) => void): () => void }) {
  const resourceLease = authoredDocument?.resourceLease ?? fragmentBox.resourceFactory(window)
  const navigationReady = fragmentBox.navigationReady(window)
  const runtimeInstance = (value: ComponentInstance): ComponentInstance => ({ ...value, data: JSON.parse(resourceLease.project(JSON.stringify(value.data))) })
  // This fixed loader is created only inside the content realm. Keeping import's
  // syntax in its string prevents Vite from inserting a parent lexical helper.
  const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, any>>
  const fragmentRoot = document.getElementById('component-root')!
  let fragmentDefaults = document.getElementById('component-defaults')
  const loader = document.currentScript; if (loader) document.head.append(loader)
  const courseStyle = document.createElement('style'); document.head.append(courseStyle)
  let sourceStyle: HTMLStyleElement | undefined
  const bundledFaces = [...document.querySelectorAll<HTMLStyleElement>('style[data-component-bundled-faces]')]
  type Message = { type: string; id?: number; [key: string]: unknown }
  let port: MessagePort, implementation: { document?: 'web'; mount(context: unknown): unknown }, mounted: { update(instance: unknown): unknown; updatePlacement?(frame: unknown): unknown; suspend?(): void | Promise<void>; resume?(): void | Promise<void>; dispose(): unknown } | undefined
  let controller: AbortController, instance: ComponentInstance, active = false, generation = 0
  let activity: { active: boolean; visible: boolean; playing: boolean } | undefined
  let mountedRunning = true, activityTail: Promise<void> = Promise.resolve()
  const activitySnapshot = () => activity && { ...activity }
  if (!authoredDocument) Object.defineProperty(window, '__guolingRuntimeActivity', { configurable: true, get: activitySnapshot })
  const applyMountedActivity = () => {
    activityTail = activityTail.then(async () => {
      if (!active || !mounted || !activity) return
      const running = activity.active && activity.visible && activity.playing
      if (running === mountedRunning) return
      mountedRunning = running
      if (running) await mounted.resume?.()
      else await mounted.suspend?.()
    }).catch(error => {
      if (active) send({ type: 'event.emit', name: 'component.diagnostic', value: { instanceId: instance.id,
        message: `组件局部暂停／恢复失败：${error instanceof Error ? error.message : String(error)}；原实例仍保留` } })
    })
    return activityTail
  }
  const setActivity = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const next = value as { active: boolean; visible: boolean; playing: boolean }
    if (typeof next.active !== 'boolean' || typeof next.visible !== 'boolean' || typeof next.playing !== 'boolean') return
    const becameVisible = next.visible && activity?.visible !== true
    activity = { active: next.active, visible: next.visible, playing: next.playing }
    if (!next.active || !next.visible || next.playing) { contentAuthoring?.suppressText(); ownedAuthoring?.input() }
    if (authoredDocument) authoredDocument.setActivity?.(activitySnapshot()!)
    else window.dispatchEvent(new CustomEvent('__runtime.activity', { detail: activitySnapshot() }))
    ownedAuthoring?.update()
    void applyMountedActivity()
    if (becameVisible) { refreshSourcePaint?.(); refreshInlineSlots?.() }
  }
  let updateResourceCss: (value: unknown) => void = () => {}
  let states: Record<string, JsonValue> = {}, targets: RuntimeTargetSnapshot[] = []
  const snapshotValue = <Value,>(value: Value): Value => value !== null && typeof value === 'object' ? structuredClone(value) : value
  let stateWriteSequence = 0
  const pendingStateWrites = new Map<string, { writeId: number; stateNotified: boolean; eventNotified: boolean }>()
  let resourceUrls: Record<string, string> = {}
  let resourceBindings: Readonly<Record<string, string>> = {}
  let webContent = false
  const currentBindings = () => ({ ...resourceBindings,
    ...(webContent ? (instance.data as unknown as WebRuntimeData).resourceBindings : {}), ...instance.authoring?.resourceBindings })
  const refreshCurrentResources = () => fragmentBox.refreshResources(document, resourceUrls, currentBindings())
  const explicitAuthorSpots = new Map<number, ComponentAuthorSpotInput>()
  let hitAuthor: (x: number, y: number) => string | undefined = () => undefined
  let caretAuthor: (x: number, y: number, authorKey?: string) => number | undefined = () => undefined
  let layoutInput: ComponentLayoutInput | undefined
  let sourceViewport: { left: number; top: number; right: number; bottom: number; width: number; height: number } | undefined
  let fragmentThemeCanvas = false
  let measuredTransportScope: HTMLElement | undefined
  let measuredPaintOrigin = { left: 0, top: 0 }
  let measuredPaintStyle: HTMLStyleElement | undefined
  const layoutListeners = new Set<(layout: ComponentLayoutInput) => void>()
  let refreshSourcePaint: (() => void) | undefined
  let refreshInlineSlots: (() => void) | undefined
  const applyFragmentLayout = () => {
    // A native fragment's bridge runs before the parser reaches its transport
    // stylesheet. Read that software-owned node again once mount receives layout.
    if (authoredDocument?.transportFragment) fragmentDefaults ??= document.getElementById('component-defaults')
    if (measuredTransportScope) {
      const layout = layoutInput ?? { mode: 'free-frame', inlineSize: instance.frame!.width, blockSize: instance.frame!.height }
      // The parser document is only transport for this software-normalized scope.
      // Preserve its formal layout while the iframe includes glyph ink on every side.
      if (!measuredPaintStyle) { measuredPaintStyle = document.createElement('style'); document.head.append(measuredPaintStyle) }
      measuredPaintStyle.textContent = 'html,body{overflow:hidden!important}'
      measuredTransportScope.style.setProperty('width', `${layout.inlineSize}px`, 'important')
      measuredTransportScope.style.setProperty('height', layout.mode === 'flow-content' ? 'auto' : `${layout.blockSize}px`, 'important')
      measuredTransportScope.style.setProperty('position', 'relative', 'important')
      measuredTransportScope.style.setProperty('left', `${-measuredPaintOrigin.left}px`, 'important')
      measuredTransportScope.style.setProperty('top', `${-measuredPaintOrigin.top}px`, 'important')
      refreshInlineSlots?.()
      return
    }
    if (!fragmentDefaults || authoredDocument && !authoredDocument.transportFragment) return
    // This carrier uses viewport coordinates. Keep its root out of document
    // scrolling when the host Flow places the component below the viewport.
    fragmentDefaults.textContent = sourceViewport
      ? `html,body{width:100%;height:100%;margin:0;overflow:hidden}#component-root{position:fixed!important;left:${-sourceViewport.left}px!important;top:${-sourceViewport.top}px!important;width:${sourceViewport.width}px!important;height:${layoutInput?.mode === 'flow-content' ? 'auto' : `${sourceViewport.height}px`}!important;margin:0}`
      : `html,body,#component-root{width:100%;height:${layoutInput?.mode === 'flow-content' ? 'auto' : '100%'};margin:0}`
    // This body is a synthetic fragment carrier. Keep descendant margins inside
    // its measured box so natural Flow reports the whole visible content extent.
    if (authoredDocument?.transportFragment) fragmentDefaults.textContent += 'body{display:flow-root}'
    refreshInlineSlots?.()
  }
  const writeCourseTheme = (value: unknown) => {
    // Main has projected the immutable faces into this lease's resource URLs.
    // A later course-theme event must not restore the editor document's URLs.
    courseStyle.textContent = typeof value === 'string' ? value.replace(/\/\* guoling-bundled-font-faces:start \*\/[\s\S]*?\/\* guoling-bundled-font-faces:end \*\//g, '') : ''
    if (!fragmentThemeCanvas || !courseStyle.sheet) return
    // The course canvas paints once in the formal surface/group. A framed builtin Web
    // fragment has an implicit transport document, not another authored canvas.
    // Keep inherited theme typography and descendant paint; only exclude that
    // transport html/body from the course theme's background declarations.
    const selectors = (text: string) => {
      const values: string[] = []
      let start = 0, depth = 0, quote = '', escaped = false
      for (let index = 0; index < text.length; index++) {
        const character = text[index]!
        if (escaped) { escaped = false; continue }
        if (character === '\\') { escaped = true; continue }
        if (quote) { if (character === quote) quote = ''; continue }
        if (character === '"' || character === "'") quote = character
        else if (character === '(' || character === '[') depth++
        else if (character === ')' || character === ']') depth--
        else if (character === ',' && depth === 0) { values.push(text.slice(start, index).trim()); start = index + 1 }
      }
      values.push(text.slice(start).trim())
      return values
    }
    const visit = (owner: CSSStyleSheet | CSSGroupingRule) => {
      for (let index = 0; index < owner.cssRules.length; index++) {
        const rule = owner.cssRules[index]!
        if (rule instanceof CSSStyleRule) {
          const paint = Array.from(rule.style).filter(name => name === 'background' || name.startsWith('background-'))
          if (!paint.length) continue
          const original = selectors(rule.selectorText)
          const projected = original.map(selector => {
            try {
              return document.documentElement.matches(selector) || document.body.matches(selector)
                ? `${selector}:not(:where(html,body))` : selector
            } catch { return selector }
          })
          if (projected.every((selector, index) => selector === original[index])) continue
          const style = document.createElement('span').style
          for (const name of paint) {
            style.setProperty(name, rule.style.getPropertyValue(name), rule.style.getPropertyPriority(name))
            rule.style.removeProperty(name)
          }
          owner.insertRule(`${projected.join(',')}{${style.cssText}}`, index + 1)
          index++
        } else if ('cssRules' in rule) visit(rule as CSSGroupingRule)
      }
    }
    visit(courseStyle.sheet)
  }
  const cleanups = new Set<() => void>(), listeners = new Map<string, Set<(value: unknown) => void>>()
  let authorSpotSequence = 0
  const authorPreviewCallbacks = new Map<number, ComponentAuthorPreviewCallbacks>()
  let motionSequence = 0, motionRequestSequence = 0
  const motionTasks = new Map<number, { start(reducedMotion: boolean): void; settle(outcome: ComponentMotionOutcome): void }>()
  const motionRequests = new Map<number, { taskId: number; method: string; resolve(value: unknown): void }>()
  let geometrySequence = 0
  const geometryRequests = new Map<number, (value: ComponentGeometrySnapshot | null) => void>()
  let serviceSequence = 0
  const serviceRequests = new Map<number, (value: boolean) => void>()
  const mediaCommands = new Map<number, (command: ComponentMediaCommand) => boolean | Promise<boolean>>()
  const interactionListeners = new Map<number, (value?: unknown) => boolean | void | PromiseLike<boolean | void>>()
  let interaction: { surfaceId: string | null; stateId: string | null } | undefined
  let originalHtml: string | undefined, observeHtml = false, collectHtml = () => {}
  let contentAuthoring: ReturnType<typeof createDomAuthoring> | undefined
  let ownedAuthoring: ReturnType<typeof installOwnedDocumentAuthoring> | undefined
  let mountedHtml: string | undefined
  let sourcePageText: DomTextOverrideController | undefined, refreshSourceText = () => {}
  let teacher: { snapshot: TeacherControllerSnapshot; allowed: Record<string, boolean>; viewport?: { left: number; top: number; right: number; bottom: number } } | undefined, teacherSequence = 0
  const teacherListeners = new Set<() => void>(), teacherPending = new Map<number, { resolve(value: boolean): void; reject(error: Error): void }>()
  const teacherRequest = (method: string, values: object = {}, signal?: AbortSignal) => new Promise<boolean>((resolve, reject) => {
    if (!active) { reject(new Error('导航作用域已取消')); return }
    if (signal?.aborted) { resolve(false); return }
    const requestId = ++teacherSequence
    const stop = () => { teacherPending.delete(requestId); signal?.removeEventListener('abort', abort) }
    const abort = () => { send({ type: 'teacher.cancel', requestId }); stop(); resolve(false) }
    teacherPending.set(requestId, { resolve: value => { stop(); resolve(value) }, reject: error => { stop(); reject(error) } })
    signal?.addEventListener('abort', abort, { once: true })
    send({ type: 'teacher.request', requestId, method, ...values })
  })
  const reply = (id: number | undefined, error?: unknown, value?: unknown) => port.postMessage({ type: 'reply', id, value,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) })
  const send = (message: Message) => { if (active) port.postMessage({ ...message, generation }) }
  let releaseInput = () => {}
  let selectingText: { authorKey: string; anchor: number } | undefined
  let hoveredAuthorKey: string | undefined
  const installInput = () => {
    // document.open removes listeners while Chromium may retain the same
    // Document object. Every real parser bootstrap installs a fresh owner.
    releaseInput()
    releaseInput = fragmentBox.input(document, {
      editing: () => active && observeHtml && activity?.active === true && activity.visible && !activity.playing,
      select: (point, event, word) => {
        const authorKey = hitAuthor(point.x, point.y), caretOffset = caretAuthor(point.x, point.y, authorKey)
        selectingText = typeof authorKey === 'string' && caretOffset !== undefined ? { authorKey, anchor: caretOffset } : undefined
        send({ type: event.type === 'dblclick' ? 'authoring.double-click' : 'authoring.pointer', x: point.x + measuredPaintOrigin.left, y: point.y + measuredPaintOrigin.top,
          authorKey, ...(caretOffset === undefined ? {} : { caretOffset }) })
        if ((word || event.type === 'dblclick') && selectingText) send({ type: 'authoring.selection', ...selectingText, focus: caretOffset, word: true })
      },
      extend: point => { if (selectingText) { const focus = caretAuthor(point.x, point.y, selectingText.authorKey); if (focus !== undefined) send({ type: 'authoring.selection', ...selectingText, focus }) } },
      hover: point => { const key = hitAuthor(point.x, point.y); if (key !== hoveredAuthorKey) { hoveredAuthorKey = key; send({ type: 'authoring.hover', authorKey: key }) } },
    })
  }
  installInput()
  const nativeDiagnostics: string[] = []
  const adoptDocument = (next: NonNullable<typeof authoredDocument>) => {
    authoredDocument = next
    installInput()
    document.head.append(courseStyle)
    if (sourceStyle) document.head.append(sourceStyle)
    const report = (message: string) => {
      if (active) send({ type: 'event.emit', name: 'component.diagnostic', value: { instanceId: instance.id, message } })
      else nativeDiagnostics.push(message)
    }
    const offDiagnostic = authoredDocument.onDiagnostic?.(report)
    if (offDiagnostic) cleanups.add(offDiagnostic)
    const error = (event: Event) => report(event instanceof ErrorEvent ? `HTML脚本错误：${event.message}；原源码已保留` : 'HTML文档资源加载失败；原源码和其余内容已保留')
    const rejection = (event: PromiseRejectionEvent) => report(`HTML程序错误：${String(event.reason)}；原源码已保留`)
    window.addEventListener('error', error, true); window.addEventListener('unhandledrejection', rejection)
    cleanups.add(() => { window.removeEventListener('error', error, true); window.removeEventListener('unhandledrejection', rejection) })
  }
  if (authoredDocument) adoptDocument(authoredDocument)
  const subscribe = (kind: string, name: string, listener: (value: unknown) => void) => {
    const key = `${kind}:${name}`, set = listeners.get(key) ?? new Set()
    listeners.set(key, set); set.add(listener); send({ type: 'subscribe', kind, name })
    const off = () => { set.delete(listener); if (!set.size) send({ type: 'unsubscribe', kind, name }) }
    cleanups.add(off)
    if (kind === 'event' && name === '__runtime.activity' && activity) listener(activitySnapshot())
    return () => { cleanups.delete(off); off() }
  }
  const cancel = () => {
    if (!active) return
    active = false; controller.abort()
    releaseInput()
    for (const cleanup of cleanups) { try { cleanup() } catch {} }
    cleanups.clear(); listeners.clear(); layoutListeners.clear(); pendingStateWrites.clear()
    for (const pending of teacherPending.values()) pending.reject(new Error('导航作用域已取消'))
    teacherPending.clear(); teacherListeners.clear()
    for (const task of [...motionTasks.values()]) task.settle({ status: 'cancelled' })
    motionTasks.clear()
    for (const pending of motionRequests.values()) pending.resolve(pending.method === 'nextFrame' ? null : false)
    motionRequests.clear()
    for (const resolve of geometryRequests.values()) resolve(null)
    geometryRequests.clear()
    for (const resolve of serviceRequests.values()) resolve(false)
    serviceRequests.clear(); mediaCommands.clear(); interactionListeners.clear()
    authorPreviewCallbacks.clear()
    resourceLease.release(); navigationReady.dispose()
    authoredDocument?.release()
    if (!authoredDocument && Object.getOwnPropertyDescriptor(window, '__guolingRuntimeActivity')?.get === activitySnapshot)
      Reflect.deleteProperty(window, '__guolingRuntimeActivity')
  }
  const motion = (reference: ComponentTarget) => ({ replace: (channel: string, program: ComponentMotionProgram): ComponentMotionTask => {
    if (!active) return { finished: Promise.resolve({ status: 'cancelled' }), cancel() {} }
    const taskId = ++motionSequence, abort = new AbortController(), cleanup = new Set<() => void>()
    let ended = false, resolveFinished!: (outcome: ComponentMotionOutcome) => void
    const finished = new Promise<ComponentMotionOutcome>(resolve => { resolveFinished = resolve })
    const settle = (outcome: ComponentMotionOutcome) => {
      if (ended) return
      ended = true; abort.abort(); motionTasks.delete(taskId)
      for (const [id, request] of motionRequests) if (request.taskId === taskId) { request.resolve(request.method === 'nextFrame' ? null : false); motionRequests.delete(id) }
      for (const callback of cleanup) { try { callback() } catch {} }
      cleanup.clear(); resolveFinished(outcome)
    }
    const request = (method: string, values: object = {}) => new Promise<unknown>(resolve => {
      if (ended || !active) { resolve(method === 'nextFrame' ? null : false); return }
      const requestId = ++motionRequestSequence; motionRequests.set(requestId, { taskId, method, resolve })
      send({ type: 'motion.request', taskId, requestId, method, ...values })
    })
    motionTasks.set(taskId, { settle, start: reducedMotion => {
      const context: ComponentMotionContext = { signal: abort.signal, reducedMotion,
        write: frame => request('write', { frame }) as Promise<boolean>,
        nextFrame: () => request('nextFrame') as Promise<{ elapsed: number } | null>,
        animate: (frames, timing) => request('animate', { frames, timing }) as Promise<boolean>,
        onCleanup: callback => { if (ended) callback(); else cleanup.add(callback) } }
      void Promise.resolve().then(() => { if (!ended) return program(context) }).then(() => {
        if (!ended) send({ type: 'motion.finish', taskId })
      }, error => { if (!ended) send({ type: 'motion.finish', taskId, error: error instanceof Error ? error.message : String(error) }) })
    } })
    const cancelTask = () => { if (!ended) { send({ type: 'motion.cancel', taskId }); settle({ status: 'cancelled' }) } }
    cleanups.add(cancelTask)
    void finished.then(() => cleanups.delete(cancelTask))
    send({ type: 'motion.start', taskId, reference, channel })
    return { finished, cancel: cancelTask }
  } })
  const serviceRequest = (type: string, values: object = {}, signal?: AbortSignal): Promise<boolean> => new Promise(resolve => {
    if (!active || signal?.aborted) { resolve(false); return }
    const requestId = ++serviceSequence
    const settle = (value: boolean) => { serviceRequests.delete(requestId); signal?.removeEventListener('abort', abort); resolve(value) }
    const abort = () => { send({ type: 'interaction.cancel', requestId }); settle(false) }
    serviceRequests.set(requestId, settle); signal?.addEventListener('abort', abort, { once: true })
    send({ type, requestId, ...values })
  })
  const presentation = (reference: ComponentTarget): ComponentPresentationPort => {
    const create = (kind: 'feedback' | 'visibility', value: string | boolean) => {
      const presentationId = ++serviceSequence
      let closed = false
      send({ type: 'presentation.create', presentationId, reference, kind, value })
      const dispose = () => { if (closed) return; closed = true; send({ type: 'presentation.dispose', presentationId }); cleanups.delete(dispose) }
      cleanups.add(dispose)
      return { write: (next: string | boolean) => closed ? Promise.resolve(false) : serviceRequest('presentation.write', { presentationId, value: next }), dispose }
    }
    return {
      feedback: (text = '') => { const handle = create('feedback', text); return { setText: handle.write, dispose: handle.dispose } },
      visibility: (visible = true) => { const handle = create('visibility', visible); return { setVisible: handle.write, dispose: handle.dispose } },
    }
  }
  const media: ComponentMediaPort = {
    register: (options, onCommand) => {
      if (!active) return { update() {}, report() {}, dispose() {} }
      const mediaId = ++serviceSequence
      let closed = false
      mediaCommands.set(mediaId, onCommand); send({ type: 'media.register', mediaId, options })
      const dispose = () => { if (closed) return; closed = true; mediaCommands.delete(mediaId); send({ type: 'media.dispose', mediaId }); cleanups.delete(dispose) }
      cleanups.add(dispose)
      return { update: patch => { if (!closed) send({ type: 'media.update', mediaId, patch }) },
        report: (state, event) => { if (!closed) send({ type: 'media.report', mediaId, state, event }) }, dispose }
    },
    interruptBackground: mode => {
      if (!active) return { release() {} }
      const interruptionId = ++serviceSequence
      send({ type: 'media.interrupt', interruptionId, mode })
      let closed = false
      const release = () => { if (closed) return; closed = true; send({ type: 'media.release', interruptionId }); cleanups.delete(release) }
      cleanups.add(release); return { release }
    },
  }
  const receive = async (message: Message) => {
    try {
      if (message.type === 'prepare') {
        resourceUrls = resourceLease.update(message.resources as Record<string, string> ?? {})
        const artifact = message.artifact as CompiledComponentModule
        sourceStyle = document.createElement('style'); sourceStyle.textContent = resourceLease.project(artifact.css); document.head.append(sourceStyle)
        const url = URL.createObjectURL(new Blob([artifact.code], { type: 'text/javascript' }))
        try {
          const module = await importModule(url)
          implementation = module.default ?? module.implementation ?? module
          if (typeof implementation?.mount !== 'function') throw new Error('组件模块需要导出 mount(context) 或 default { mount(context) }')
        } finally { URL.revokeObjectURL(url) }
        reply(message.id, undefined, { document: implementation.document === 'web' ? 'web' : undefined, fontFaceCss: bundledFaces.map(face => face.textContent ?? '').join('\n') }); return
      } else if (message.type === 'document') {
        // The actual module selected this lifecycle. Preserve its namespace and port;
        // neither module top-level effects nor mount are replayed for parser setup.
        if (implementation.document !== 'web' || typeof message.html !== 'string') throw new Error('Source 未声明 Web 文档准备')
        const property = `__guoling_adopt_${nonce.replace(/-/g, '_')}`
        Object.defineProperty(window, property, { configurable: true, value: adoptDocument })
        try {
          // document.close() can expose complete before its deferred modules and
          // DOMContentLoaded in Chromium. Observe this parser's event before writing.
          document.open()
          const parsed = new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
          document.write(message.html); document.close(); await parsed
          if (!authoredDocument) throw new Error('Web 文档桥尚未连接；原源码已保留')
          if (sourceStyle) document.head.append(sourceStyle)
        } finally { Reflect.deleteProperty(window, property) }
      } else if (message.type === 'mount') {
        if (authoredDocument && document.readyState === 'loading') await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
        document.querySelector('style[data-component-initial-theme]')?.remove()
        resourceUrls = resourceLease.update(message.resources as Record<string, string> ?? {})
        resourceBindings = message.resourceBindings as Record<string, string> ?? {}
        layoutInput = message.layout as ComponentLayoutInput | undefined
        sourceViewport = message.sourceViewport as typeof sourceViewport
        instance = runtimeInstance(message.instance as ComponentInstance)
        applyFragmentLayout()
        webContent = ['guoling.web', 'guoling.html-program'].includes(String(message.builtinKey))
        fragmentThemeCanvas = Boolean(message.visual && message.documentKind === 'fragment' && message.builtinKey === 'guoling.web' && instance.frame)
        writeCourseTheme(message.themeCss)
        originalHtml = typeof message.authorHtml === 'string' ? message.authorHtml : undefined
        observeHtml = message.htmlAuthoring === true
        generation = message.generation as number
        pendingStateWrites.clear()
        states = message.state as Record<string, JsonValue>; targets = message.targets as RuntimeTargetSnapshot[]
        controller = new AbortController(); active = true
        setActivity(message.activity)
        for (const message of nativeDiagnostics.splice(0)) send({ type: 'event.emit', name: 'component.diagnostic', value: { instanceId: instance.id, message } })
        teacher = message.teacher as typeof teacher
        interaction = message.interaction as typeof interaction
        const scope = {
          runScopeId: message.runScopeId, instanceId: instance.id, generation, signal: controller.signal,
          isActive: () => active,
          cleanup: (cleanup: () => void) => { if (active) cleanups.add(cleanup); else cleanup() },
          ...(message.measure ? { measure: (references: readonly ComponentTarget[]): Promise<ComponentGeometrySnapshot | null> => {
            if (!active) return Promise.resolve(null)
            const requestId = ++geometrySequence
            return new Promise(resolve => {
              geometryRequests.set(requestId, resolve)
              send({ type: 'geometry.measure', requestId, references })
            })
          } } : {}),
          // These are explicitly the latest observed snapshots, never synchronous RPC.
          target: (reference: ComponentTarget) => {
            if (!active) return null
            const target = targets.find(value => JSON.stringify(value.reference) === JSON.stringify(reference))
            return target ? { instanceId: target.instanceId, read: () => targets.find(value => JSON.stringify(value.reference) === JSON.stringify(reference))?.value ?? null,
              emit: (name: string, value: JsonValue) => send({ type: 'target.emit', reference, name, value }),
              ...(reference.kind === 'instance' ? { motion: motion(reference), presentation: presentation(reference) } : {}) } : null
          },
          state: { get: (name: string) => snapshotValue(states[name]), set: (name: string, value: JsonValue) => {
            if (!active) return
            const writeId = ++stateWriteSequence
            const previous = pendingStateWrites.get(name)
            pendingStateWrites.set(name, { writeId, stateNotified: previous?.stateNotified ?? false, eventNotified: previous?.eventNotified ?? false })
            const submitted = snapshotValue(value)
            states[name] = submitted; send({ type: 'state.set', name, value: submitted, writeId })
          }, subscribe: (name: string, listener: (value: unknown) => void) => subscribe('state', name, listener) },
          events: { emit: (name: string, value: JsonValue) => send({ type: 'event.emit', name, value }),
            subscribe: (name: string, listener: (value: unknown) => void) => subscribe('event', name, listener) },
        }
        const documentRoot = message.visual && message.documentKind === 'document'
        const root = message.visual ? documentRoot ? document.body : fragmentRoot : undefined
        if (documentRoot) {
          fragmentRoot?.remove()
          if (!authoredDocument?.transportFragment) fragmentDefaults?.remove()
          if (!authoredDocument && originalHtml && new DOMParser().parseFromString(originalHtml, 'text/html').compatMode !== document.compatMode)
            scope.events.emit('component.diagnostic', { instanceId: instance.id, message: '原 HTML 使用兼容排版模式；当前内容环境使用标准模式，原源码已保留' })
        }
        if (root) {
          const clicked = () => send({ type: 'interaction.clicked' })
          const clickRoot = sourceViewport ? document : root
          clickRoot.addEventListener('click', clicked, true); cleanups.add(() => clickRoot.removeEventListener('click', clicked, true))
          const ownedClick = (event: MessageEvent) => {
            const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]'), ...(authoredDocument?.blobCarriers?.frames() ?? [])]
              .find(frame => frame.contentWindow === event.source)
            const channel = frame && authoredDocument?.blobCarriers?.channel(frame)
            if (event.data?.type === 'guoling.owned-document.click' && event.data.token === `__guoling_parser_${nonce.replace(/-/g, '_')}`
              && frame && (!channel || event.data.channel === channel)) clicked()
          }
          window.addEventListener('message', ownedClick); cleanups.add(() => window.removeEventListener('message', ownedClick))
          const doubleClicked = (event: MouseEvent) => send({ type: 'authoring.double-click', x: event.clientX + measuredPaintOrigin.left, y: event.clientY + measuredPaintOrigin.top,
            authorKey: hitAuthor(event.clientX, event.clientY) })
          root.addEventListener('dblclick', doubleClicked, true); cleanups.add(() => root.removeEventListener('dblclick', doubleClicked, true))
        }
        const teacherController = teacher ? {
          read: () => teacher!.snapshot,
          readLocation: () => teacher!.snapshot.locationId,
          viewportBounds: () => teacher?.viewport,
          subscribe: (listener: () => void) => { teacherListeners.add(listener); return () => { teacherListeners.delete(listener) } },
          canExecute: (action: TeacherControllerAction) => Boolean(teacher?.allowed[action.type]) && (action.type !== 'scene.go'
            || teacher!.snapshot.scenes.some(scene => scene.id === action.sceneId)),
          execute: (action: TeacherControllerAction, signal?: AbortSignal) => teacherRequest('execute', { action }, signal),
          setCollapsed: (value: boolean) => { void teacherRequest('setCollapsed', { value }).catch(() => {}) },
          moveBy: (dx: number, dy: number) => { void teacherRequest('moveBy', { dx, dy }).catch(() => {}) },
          movePointer: (phase: 'start' | 'move' | 'end', x: number, y: number) => { void teacherRequest('movePointer', { phase, x, y }).catch(() => {}) },
          setZoom: (value: number) => { void teacherRequest('setZoom', { value }).catch(() => {}) },
          resetView: () => { void teacherRequest('resetView').catch(() => {}) },
        } : undefined
        navigationReady.connect(teacherController)
        hitAuthor = (x, y) => {
          const top = contentAuthoring?.paintedElementAt(x, y)
          if (!root || !top || !root.contains(top)) return undefined
          const observed = contentAuthoring?.hit(x, y)
          const rootOrigin = documentRoot ? { x: 0, y: 0 } : root.getBoundingClientRect()
          const origin = { x: rootOrigin.x - measuredPaintOrigin.left, y: rootOrigin.y - measuredPaintOrigin.top }
          const px = x - origin.x, py = y - origin.y
          for (const spot of [...explicitAuthorSpots.values()].reverse()) {
            const [a, b, c, d, e, f] = spot.localBounds.transform, determinant = a * d - b * c
            if (!determinant) continue
            const sx = (d * (px - e) - c * (py - f)) / determinant
            const sy = (-b * (px - e) + a * (py - f)) / determinant
            if (sx < 0 || sy < 0 || sx > spot.localBounds.width || sy > spot.localBounds.height) continue
            // The current painted node must be the registered content. A rectangle
            // alone never promotes a spot above a foreground element.
            if (observed && observed.record.kind === spot.kind && observed.initialValue === spot.initialValue) {
              const matching = (contentAuthoring?.scan() ?? []).filter(value => {
                if (value.record.kind !== spot.kind || value.initialValue !== spot.initialValue) return false
                const node = value.node
                const rect = node.nodeType === Node.TEXT_NODE ? (() => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() })() : (node as Element).getBoundingClientRect()
                return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
              })
              if (matching.length === 1 && matching[0].node === observed.node) return spot.authorKey
            } else if (top.localName === 'canvas' && top.getAttribute('data-cw-author-key') === spot.authorKey) return spot.authorKey
          }
          return observed?.authorKey
        }
        caretAuthor = (x, y, authorKey) => {
          const observed = contentAuthoring?.hit(x, y)
          if (!authorKey || observed?.record.kind !== 'text') return undefined
          const sameField = observed.authorKey === authorKey || [...explicitAuthorSpots.values()].some(spot =>
            spot.authorKey === authorKey && spot.kind === 'text' && spot.initialValue === observed.initialValue)
          return sameField ? fragmentBox.caret(document, observed.node, x, y) : undefined
        }
        const authoring = { register: (input: ComponentAuthorSpotInput, callbacks?: ComponentAuthorPreviewCallbacks) => {
          const spotId = ++authorSpotSequence
          const spot = { ...input, authorKey: input.authorKey ?? `spot:${spotId}` }
          explicitAuthorSpots.set(spotId, spot)
          if (callbacks) authorPreviewCallbacks.set(spotId, callbacks)
          send({ type: 'authoring.register', spotId, spot, preview: Boolean(callbacks) })
          const off = () => { explicitAuthorSpots.delete(spotId); authorPreviewCallbacks.delete(spotId); send({ type: 'authoring.unregister', spotId }) }
          cleanups.add(off)
          return () => { cleanups.delete(off); off() }
        } }
        const interactions: ComponentInteractionPort = {
          currentSurfaceId: () => interaction?.surfaceId ?? null, currentStateId: () => interaction?.stateId ?? null,
          courseState: { get: name => scope.state.get(name), set: (name, value) => scope.state.set(name, value as JsonValue) },
          subscribeTrigger: (trigger, listener) => {
            if (!active) return () => {}
            const subscriptionId = ++serviceSequence
            interactionListeners.set(subscriptionId, listener); send({ type: 'interaction.subscribe', subscriptionId, trigger })
            const off = () => { interactionListeners.delete(subscriptionId); send({ type: 'interaction.unsubscribe', subscriptionId }); cleanups.delete(off) }
            cleanups.add(off); return off
          },
          executeAction: (action, context) => serviceRequest('interaction.action', { action, context: {
            ruleId: context.ruleId, stepId: context.stepId, restartFromBeginning: context.restartFromBeginning,
          } }, context.signal),
          report: message => scope.events.emit('component.diagnostic', { message }),
        }
        const layout = layoutInput ? {
          read: () => layoutInput!,
          subscribe: (listener: (layout: ComponentLayoutInput) => void) => { layoutListeners.add(listener); return () => layoutListeners.delete(listener) },
          reportSize: (report: { inlineSize: number; blockSize: number }) => send({ type: 'layout.size', report }),
        } : undefined
        const inline = message.inline === true ? (() => {
          let sequence = 0, queued = 0
          type InlineSlot = { id: number; childId: string; element: HTMLElement; signature?: string; release?(): void }
          const slots = new Map<number, InlineSlot>()
          const measure = (slot: InlineSlot) => {
            const element = slot.element, matrix = element.isConnected ? fragmentBox.clientMatrix(element) : null
            const width = element.offsetWidth, height = element.offsetHeight
            const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
            let visible = Boolean(matrix && width > 0 && height > 0)
            for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
              const css = getComputedStyle(ancestor)
              if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) visible = false
              if (ancestor !== element && (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowX) || /^(?:auto|scroll|hidden|clip)$/.test(css.overflowY))) {
                const box = ancestor.getBoundingClientRect()
                if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right) }
                if (/^(?:auto|scroll|hidden|clip)$/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom) }
              }
            }
            const placement = { matrix, width, height, clip, visible: visible && clip.right > clip.left && clip.bottom > clip.top }
            const signature = JSON.stringify(placement)
            if (signature !== slot.signature) {
              send({ type: slot.signature === undefined ? 'inline.mount' : 'inline.layout', slotId: slot.id, childId: slot.childId, placement })
              slot.signature = signature
            }
          }
          const measureAll = () => {
            queued = 0
            if (!active || !slots.size) return
            for (const slot of slots.values()) measure(slot)
            // Only active content animations need frame-by-frame slot geometry.
            if (document.getAnimations().some(animation => !['finished', 'idle'].includes(animation.playState))) enqueue()
          }
          const enqueue = () => { if (!queued && active && slots.size) queued = requestAnimationFrame(measureAll) }
          const refresh = () => {
            for (const slot of [...slots.values()]) if (!instance.childIds?.includes(slot.childId)) slot.release?.()
            enqueue()
          }
          const resize = new ResizeObserver(enqueue), mutation = new MutationObserver(enqueue)
          mutation.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true })
          window.addEventListener('resize', enqueue); window.addEventListener('scroll', enqueue, true)
          const events = ['animationstart', 'transitionrun', 'click']
          for (const name of events) document.addEventListener(name, enqueue, true)
          refreshInlineSlots = refresh
          cleanups.add(() => {
            if (queued) cancelAnimationFrame(queued)
            resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', enqueue); window.removeEventListener('scroll', enqueue, true)
            for (const name of events) document.removeEventListener(name, enqueue, true)
            if (refreshInlineSlots === refresh) refreshInlineSlots = undefined
            slots.clear()
          })
          return { mount: (childId: string, element: HTMLElement) => {
            if (!active || typeof childId !== 'string' || !(element instanceof HTMLElement) || element.ownerDocument !== document || !instance.childIds?.includes(childId)) return () => {}
            const slot: InlineSlot = { id: ++sequence, childId, element }
            slots.set(slot.id, slot); resize.observe(element); measure(slot); enqueue()
            let released = false
            const release = () => {
              if (released) return
              released = true; slots.delete(slot.id); cleanups.delete(release)
              if (![...slots.values()].some(value => value.element === element)) resize.unobserve(element)
              send({ type: 'inline.release', slotId: slot.id })
            }
            slot.release = release
            cleanups.add(release)
            return release
          } }
        })() : undefined
        const runtimeContext = { instance, scope, root, teacherController, authoring, layout, authoredDocument: Boolean(authoredDocument), builtinKey: message.builtinKey, resourceCss: typeof message.resourceCss === 'string' ? resourceLease.project(message.resourceCss) : message.resourceCss, resources: { url: (name: string) => resourceUrls[currentBindings()[name] ?? name] },
          media: message.media === true ? media : undefined, interactions: interaction ? interactions : undefined, inline }
        updateResourceCss = value => { runtimeContext.resourceCss = typeof value === 'string' ? resourceLease.project(value) : value }
        mounted = await implementation.mount(runtimeContext) as typeof mounted
        mountedHtml = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && typeof instance.data.html === 'string' ? instance.data.html : undefined
        if (!active) { await mounted?.dispose(); mounted = undefined; return }
        // The workbench fragment carrier creates author DOM during mount; the
        // native transport already has it. Select the normalized scope only now.
        measuredTransportScope = message.measuredWebFragment === true && message.visual
          && fragmentBox.isMeasured(instance, 'fragment', undefined, { implementation: { kind: 'builtin', key: String(message.builtinKey) } })
          ? root?.querySelector<HTMLElement>('[data-guoling-source-scope],[data-guoling-measured-root]') ?? undefined : undefined
        applyFragmentLayout()
        mountedRunning = true
        await applyMountedActivity()
        if (!mounted || typeof mounted.update !== 'function' || typeof mounted.dispose !== 'function') throw new Error('mount 必须返回 update/dispose 生命周期')
        const ownsNativeSlots = Boolean(instance.container || instance.childIds?.length)
        if ((sourceViewport || webContent && message.visual && instance.frame || ownsNativeSlots) && root) {
          let queued = false, previous = ''
          const followedAnimations = new WeakSet<Animation>()
          const measurePaint = () => {
            if (!active || !root.isConnected || activity?.visible === false) return
            const viewport = sourceViewport ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }
            // A hidden surface can temporarily have no layout; that is not empty author content.
            if (innerWidth <= 0 || innerHeight <= 0 || viewport.right <= viewport.left
              || viewport.bottom <= viewport.top || viewport.width <= 0
              || (root.offsetWidth <= 0 && getComputedStyle(root).display !== 'none')) return
            const rects: DOMRect[] = []
            const paintsOutsideBox = (element: Element, css: CSSStyleDeclaration) =>
              css.boxShadow !== 'none' || css.textShadow !== 'none'
              || ['filter', 'backdrop-filter', 'mask-image', 'border-image-source'].some(name => {
                const value = css.getPropertyValue(name); return value !== '' && value !== 'none'
              }) || ['::before', '::after'].some(pseudo => {
                const content = getComputedStyle(element, pseudo).content
                return content !== '' && content !== 'none' && content !== 'normal'
              })
            // An authored document canvas paints the viewport through html/body.
            // Transparent carrier boxes themselves must not intercept scene input.
            const paintsCanvas = [document.documentElement, document.body].some(element => {
              const css = getComputedStyle(element)
              return css.backgroundImage !== 'none' || !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(css.backgroundColor)
                || paintsOutsideBox(element, css)
            })
            if ((webContent || ownsNativeSlots) && paintsCanvas) rects.push(new DOMRect(0, 0, innerWidth, innerHeight))
            // CSS animation can move paint without a DOM mutation. Keep its
            // canvas intact until the browser reports the final geometry.
            if (webContent || ownsNativeSlots) {
              const animations = document.getAnimations()
              for (const animation of animations) if (!followedAnimations.has(animation) && !['finished', 'idle'].includes(animation.playState)) {
                followedAnimations.add(animation)
                const finished = () => { followedAnimations.delete(animation); enqueue() }
                void animation.finished.then(finished, finished)
              }
              if (animations.some(animation => !['finished', 'idle'].includes(animation.playState)))
                rects.push(new DOMRect(0, 0, innerWidth, innerHeight))
            }
            for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
              if (['style', 'script', 'template'].includes(element.localName)) continue
              const css = getComputedStyle(element)
              if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || Number(css.opacity) === 0) continue
              if ((webContent || ownsNativeSlots) && paintsOutsideBox(element, css)) { rects.push(new DOMRect(0, 0, innerWidth, innerHeight)); continue }
              const painted = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
                || /^(?:button|input|select|textarea|img|video|canvas|iframe|svg|summary)$/.test(element.localName)
                || css.backgroundImage !== 'none' || !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(css.backgroundColor)
                || ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && css.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none')
              if (painted) for (const rect of element.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push(rect)
            }
            const bounds = rects.length ? { left: Math.min(...rects.map(rect => rect.left)), top: Math.min(...rects.map(rect => rect.top)), right: Math.max(...rects.map(rect => rect.right)), bottom: Math.max(...rects.map(rect => rect.bottom)) } : null
            const paintedRects = ownsNativeSlots ? rects.map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })) : undefined
            const signature = JSON.stringify(paintedRects ?? bounds)
            if (signature !== previous) { previous = signature; send({ type: 'source.paint', bounds, ...(paintedRects ? { rects: paintedRects } : {}) }) }
          }
          const enqueue = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; measurePaint() }) } }
          // Native WAAPI has no CSS animation events. Notify the same paint
          // owner at its real start/finish instead of sampling every frame.
          const originalAnimate = Element.prototype.animate
          const trackedAnimate = function(this: Element, ...args: Parameters<Element['animate']>) {
            const animation = originalAnimate.apply(this, args); enqueue(); refreshInlineSlots?.(); return animation
          }
          if (webContent || ownsNativeSlots) Element.prototype.animate = trackedAnimate
          const observer = new MutationObserver(enqueue); observer.observe(document.body, { childList: true, attributes: true, characterData: true, subtree: true })
          const resize = new ResizeObserver(enqueue); resize.observe(root)
          window.addEventListener('resize', enqueue); root.addEventListener('load', enqueue, true)
          const paintEvents = ['animationstart', 'animationend', 'animationcancel', 'transitionrun', 'transitionend', 'transitioncancel']
          for (const name of paintEvents) root.addEventListener(name, enqueue, true)
          refreshSourcePaint = enqueue
          cleanups.add(() => { observer.disconnect(); resize.disconnect(); window.removeEventListener('resize', enqueue); root.removeEventListener('load', enqueue, true)
            if ((webContent || ownsNativeSlots) && Element.prototype.animate === trackedAnimate) Element.prototype.animate = originalAnimate
            for (const name of paintEvents) root.removeEventListener(name, enqueue, true)
            if (refreshSourcePaint === enqueue) refreshSourcePaint = undefined })
          measurePaint()
        }
        if (documentRoot && !authoredDocument) cleanups.add(() => { if (fragmentDefaults) document.head.prepend(fragmentDefaults); document.body.append(fragmentRoot) })
        if (root && !webContent) {
          refreshSourceText = () => {
            if (originalHtml === undefined) { sourcePageText?.setRules([]); return }
            const rules = (instance.data as unknown as WebRuntimeData).textOverrides ?? []
            if (sourcePageText) sourcePageText.setRules(rules)
            else { sourcePageText = fragmentBox.textOverrides([root], rules); sourcePageText.applyAll() }
          }
          refreshSourceText()
          cleanups.add(() => { sourcePageText?.destroy(); sourcePageText = undefined })
        }
        // Content application is always active, including Published/read-only
        // consumers. Editor target observation below is a separate concern.
        if (root) {
          ownedAuthoring = fragmentBox.ownedAuthoring(`__guoling_parser_${nonce.replace(/-/g, '_')}`, '', fragmentBox.authoring, {
            paintedElementAt: (x, y) => contentAuthoring?.paintedElementAt(x, y),
            records: () => instance.authoring?.records ?? {}, resources: () => resourceLease.sources, bindings: currentBindings,
            runtimeResources: () => resourceUrls,
            resolveResource: (reference, bindings) => resourceLease.resolve(reference, bindings),
            matchesResource: (reference, liveUrl, bindings) => resourceLease.matches(reference, liveUrl, bindings),
            resourceReference: (url, bindings) => resourceLease.reverse(url, bindings),
            activity: () => authoredDocument ? undefined : activitySnapshot(),
            blobCarriers: () => authoredDocument?.blobCarriers,
            observe: observeHtml, onChange: () => collectHtml(),
            report: (authorKey, status) => {
              if (status === 'unresolved') scope.events.emit('component.diagnostic', { instanceId: instance.id, authorKey,
                message: '内部作者对象当前无法唯一重绑定；原内容与作者修改已保留，尚未应用' })
            },
            onDoubleClick: point => send({ type: 'authoring.double-click', ...point,
              x: point.x + measuredPaintOrigin.left, y: point.y + measuredPaintOrigin.top }),
            onPointer: point => send({ type: 'authoring.pointer', ...point,
              x: point.x + measuredPaintOrigin.left, y: point.y + measuredPaintOrigin.top }),
            onSelection: selection => send({ type: 'authoring.selection', ...selection }),
            onHover: authorKey => send({ type: 'authoring.hover', authorKey }),
          }, fragmentBox.frameGeometry)
          cleanups.add(() => { ownedAuthoring?.dispose(); ownedAuthoring = undefined })
          contentAuthoring = fragmentBox.authoring(documentRoot ? document.documentElement : root, {
            records: () => Object.fromEntries(Object.entries(instance.authoring?.records ?? {}).filter(([, record]) => !record.scope?.['document:path'])),
            originalText: node => (sourcePageText ?? (window as Window & { __cwPageTextOverrides?: DomTextOverrideController }).__cwPageTextOverrides)?.originalText(node),
            claimText: (node, text) => (sourcePageText ?? (window as Window & { __cwPageTextOverrides?: DomTextOverrideController }).__cwPageTextOverrides)?.setLocalText(node, text),
            resolveResource: reference => resourceLease.resolve(reference, currentBindings()) ?? reference,
            matchesResource: (reference, liveUrl) => resourceLease.matches(reference, liveUrl, currentBindings()),
            resourceReference: url => resourceLease.reverse(url, currentBindings()),
            report: (authorKey, status) => {
              if (status === 'unresolved') scope.events.emit('component.diagnostic', { instanceId: instance.id, authorKey,
                message: '内部作者对象当前无法唯一重绑定；原内容与作者修改已保留，尚未应用' })
            },
          })
          cleanups.add(() => { contentAuthoring?.dispose(); contentAuthoring = undefined })
        }
        if (root && webContent) {
          const fragmentKey = String(message.fragmentStateKey)
          const fragments = fragmentBox.fragments(root, () => states[fragmentKey], () => layoutInput?.mode === 'flow-content')
          subscribe('state', fragmentKey, fragments.apply)
          layoutListeners.add(fragments.apply)
          cleanups.add(() => { layoutListeners.delete(fragments.apply); fragments.dispose() })
        }
        if (root && (observeHtml || measuredTransportScope)) {
          const handles = new WeakMap<Node, string>(); let sequence = 0, queued = false
          const pathFor = (element: Element) => {
            const path: { name: string; index: number }[] = []
            for (let current: Element | null = element; current; current = current.parentElement) path.unshift({ name: current.localName,
              index: current.parentElement ? Array.from(current.parentElement.children).indexOf(current) : 0 })
            return path
          }
          const sectionOrder = (element: Element) => {
            for (let current: Element | null = element; current; current = current.parentElement) {
              if (current.localName !== 'section') continue
              const parent = current.parentElement
              if (parent?.localName === 'body' || parent?.localName === 'main' && parent.parentElement?.localName === 'body')
                return Array.from(parent.children).filter(child => child.localName === 'section').indexOf(current)
            }
            return null
          }
          const measuredTransportExtent = () => {
            if (!measuredTransportScope || !instance.frame) return null
            const extent = fragmentBox.extent(measuredTransportScope, layoutInput ? { width: layoutInput.inlineSize,
              height: layoutInput.mode === 'flow-content' ? 0 : layoutInput.blockSize } : instance.frame, layoutInput?.mode, true)
            if (extent.left !== measuredPaintOrigin.left || extent.top !== measuredPaintOrigin.top) {
              measuredPaintOrigin = { left: extent.left ?? 0, top: extent.top ?? 0 }
              applyFragmentLayout()
            }
            return extent
          }
          collectHtml = () => {
            if (!active) return
            if (!observeHtml) { send({ type: 'authoring.observe', reports: [], contentExtent: measuredTransportExtent() }); return }
            const source = originalHtml === undefined ? undefined : new DOMParser().parseFromString(originalHtml, 'text/html')
            const projected = new DOMParser().parseFromString(String(originalHtml !== undefined && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data.html ?? '' : ''), 'text/html')
            const reports: unknown[] = []
            const reported = new Set<Node>()
            const pageText = sourcePageText ?? (window as Window & { __cwPageTextOverrides?: { samples(): readonly { node: Text; raw: string }[] } }).__cwPageTextOverrides
            const originalText = new Map(pageText?.samples().map(sample => [sample.node, sample.raw]) ?? [])
            const rootOrigin = documentRoot ? { x: 0, y: 0 } : root.getBoundingClientRect()
            const origin = { x: rootOrigin.x - measuredPaintOrigin.left, y: rootOrigin.y - measuredPaintOrigin.top }
            const walk = (live: Element, original: Element, bound: Element) => {
              if (live.localName !== original.localName && live !== root || original.localName !== bound.localName) return
              if (live !== root && ['id', 'data-cw-author-key'].some(name => bound.hasAttribute(name) && live.getAttribute(name) !== bound.getAttribute(name))) return
              const style = getComputedStyle(live), visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none'
              const liveTexts = [...live.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
              const boundTexts = [...bound.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
              for (const node of live.childNodes) {
                if (!visible || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim() || live.closest('script,style,noscript,template,textarea,title,option,[contenteditable]')) continue
                const rawText = originalText.get(node as Text) ?? node.textContent
                if (boundTexts[liveTexts.indexOf(node)]?.textContent !== rawText) continue
                const range = document.createRange(); range.selectNodeContents(node)
                const rect = range.getBoundingClientRect()
                let handle = handles.get(node); if (!handle) { handle = `html:${++sequence}`; handles.set(node, handle) }
                reported.add(node)
                reports.push({ handle, kind: 'text', domPath: pathFor(original), sectionOrder: sectionOrder(original), rawText,
                  attributeName: null, scriptCreated: false, rect: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height } })
              }
              if (visible && live.localName === 'img' && live.getAttribute('src') === bound.getAttribute('src')) {
                const rect = live.getBoundingClientRect()
                let handle = handles.get(live); if (!handle) { handle = `html:${++sequence}`; handles.set(live, handle) }
                reported.add(live)
                reports.push({ handle, kind: 'image', domPath: pathFor(original), sectionOrder: sectionOrder(original), rawText: original.getAttribute('src') ?? '',
                  attributeName: 'src', scriptCreated: false, rect: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height } })
              }
              const originals = Array.from(original.children).filter(element => element.localName !== 'script')
              const bindings = Array.from(bound.children).filter(element => element.localName !== 'script')
              Array.from(live.children).filter(element => element.localName !== 'script').forEach((child, index) => { if (originals[index] && bindings[index]) walk(child, originals[index], bindings[index]) })
            }
            if (source) walk(root, source.body, projected.body)
            for (const observed of contentAuthoring?.scan() ?? []) {
              const { node, authorKey, record, initialValue, geometry: observedGeometry, bindingStatus, textStyle } = observed
              const geometry = observedGeometry && measuredTransportScope ? { ...observedGeometry, parentToInstance: [
                observedGeometry.parentToInstance[0], observedGeometry.parentToInstance[1], observedGeometry.parentToInstance[2], observedGeometry.parentToInstance[3],
                observedGeometry.parentToInstance[4] + measuredPaintOrigin.left, observedGeometry.parentToInstance[5] + measuredPaintOrigin.top,
              ] as typeof observedGeometry.parentToInstance } : observedGeometry
              // Once an object has a formal override that is its effective
              // owner, even if it also happens to have a static source span.
              if (reported.has(node) && instance.authoring?.records?.[authorKey]?.overrides[record.kind === 'text' ? 'text' : 'src'] === undefined) {
                const report = reports.find(report => (report as { handle: string }).handle === handles.get(node)) as Record<string, unknown> | undefined
                if (report) { report.authoring = { authorKey, record }; report.bindingStatus = bindingStatus; if (geometry) report.geometry = geometry; if (textStyle) report.textStyle = textStyle }
                continue
              }
              const element = node.nodeType === Node.TEXT_NODE ? node.parentElement! : node as HTMLImageElement
              const rect = node.nodeType === Node.TEXT_NODE ? (() => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() })() : element.getBoundingClientRect()
              if (!rect.width || !rect.height) continue
              let handle = handles.get(node); if (!handle) { handle = `html:${++sequence}`; handles.set(node, handle) }
              if (reported.has(node)) {
                const index = reports.findIndex(report => (report as { handle: string }).handle === handle)
                if (index !== -1) reports.splice(index, 1)
              }
              reports.push({ handle, kind: record.kind, domPath: pathFor(element), sectionOrder: sectionOrder(element), rawText: initialValue,
                attributeName: record.kind === 'image' ? 'src' : null, scriptCreated: !reported.has(node),
                authoring: { authorKey, record }, bindingStatus, ...(geometry ? { geometry } : {}), ...(textStyle ? { textStyle } : {}), rect: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height } })
            }
            for (const report of ownedAuthoring?.reports() ?? []) reports.push({ ...report,
              rect: { ...report.rect, x: report.rect.x - origin.x, y: report.rect.y - origin.y },
              ...(report.geometry ? { geometry: { ...report.geometry, parentToInstance: [
                ...report.geometry.parentToInstance.slice(0, 4), report.geometry.parentToInstance[4] - origin.x,
                report.geometry.parentToInstance[5] - origin.y,
              ] } } : {}) })
            const sourceElement = source?.body.firstElementChild as HTMLElement | SVGElement | null
            const liveElement = root.firstElementChild as HTMLElement | SVGElement | null
            const sourceStyle = sourceElement?.style ? Object.fromEntries(Array.from({ length: sourceElement.style.length }, (_unused, index) => {
              const key = sourceElement.style.item(index)
              return [key, sourceElement.style.getPropertyValue(key)]
            })) : undefined
            const contentExtent = measuredTransportScope && instance.frame
              ? measuredTransportExtent()
              : webContent && liveElement && sourceStyle && instance.frame
              && fragmentBox.isMeasured(instance, documentRoot ? 'document' : 'fragment', sourceStyle,
                typeof message.builtinKey === 'string' ? { implementation: { kind: 'builtin', key: message.builtinKey } } : undefined)
              && liveElement.style.margin === '0px' && liveElement.style.boxSizing === 'border-box'
              ? fragmentBox.extent(liveElement, layoutInput ? { width: layoutInput.inlineSize,
                height: layoutInput.mode === 'flow-content' ? 0 : layoutInput.blockSize } : instance.frame, layoutInput?.mode) : null
            send({ type: 'authoring.observe', reports, contentExtent })
          }
          const enqueue = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; collectHtml() }) } }
          const observer = new MutationObserver(enqueue); observer.observe(documentRoot ? document.documentElement : root, { childList: true, characterData: true, attributes: true, subtree: true })
          const resize = new ResizeObserver(enqueue); resize.observe(root)
          // Font completion can change text ink without resizing a fixed root.
          document.fonts.addEventListener('loadingdone', enqueue)
          if (documentRoot) {
            resize.observe(document.documentElement)
            window.addEventListener('scroll', enqueue, true); window.addEventListener('resize', enqueue)
          }
          cleanups.add(() => {
            observer.disconnect(); resize.disconnect()
            document.fonts.removeEventListener('loadingdone', enqueue)
            if (documentRoot) { window.removeEventListener('scroll', enqueue, true); window.removeEventListener('resize', enqueue) }
          })
          collectHtml()
        }
      } else if (message.type === 'authoring.hit-test') {
        const x = Number(message.x) - measuredPaintOrigin.left, y = Number(message.y) - measuredPaintOrigin.top
        const authorKey = await ownedAuthoring?.hit(x, y) ?? hitAuthor(x, y)
        send({ type: 'authoring.hit-result', requestId: message.requestId, authorKey: authorKey ?? null,
          painted: Boolean(authorKey) || fragmentBox.paintAt(document.documentElement, x, y) })
      } else if (message.type === 'update') {
        if (!active) return
        writeCourseTheme(message.themeCss)
        resourceUrls = resourceLease.update(message.resources as Record<string, string> ?? {})
        instance = runtimeInstance(message.instance as ComponentInstance)
        refreshInlineSlots?.()
        updateResourceCss(message.resourceCss)
        originalHtml = typeof message.authorHtml === 'string' ? message.authorHtml : undefined
        targets = message.targets as RuntimeTargetSnapshot[]
        const nextStates = message.state as Record<string, JsonValue>
        for (const name of pendingStateWrites.keys()) nextStates[name] = states[name]
        states = nextStates
        interaction = message.interaction as typeof interaction
        const renderInstance = message.preserveHtml === true && mountedHtml !== undefined && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)
          ? { ...instance, data: { ...instance.data, html: mountedHtml } } : instance
        await mounted?.update(renderInstance)
        if (message.preserveHtml !== true) mountedHtml = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && typeof instance.data.html === 'string' ? instance.data.html : undefined
        refreshSourceText()
        refreshCurrentResources()
        contentAuthoring?.refresh()
        ownedAuthoring?.update()
        collectHtml()
      } else if (message.type === 'authoring.input') {
        if (!active || message.generation !== generation) return
        const authorKey = typeof message.authorKey === 'string' && message.active === true ? message.authorKey : undefined
        contentAuthoring?.suppressText(authorKey); ownedAuthoring?.input(authorKey)
        return
      } else if (message.type === 'authoring.preview') {
        if (!active || message.generation !== generation) return
        const geometry = message.geometry as ComponentAuthorGeometry | null
        if (typeof message.authorKey === 'string') contentAuthoring?.previewGeometry(message.authorKey, geometry)
        if (typeof message.authorKey === 'string') ownedAuthoring?.preview(message.authorKey, geometry)
        else if (typeof message.spotId === 'number') authorPreviewCallbacks.get(message.spotId)?.previewGeometry(geometry)
        if (geometry === null) collectHtml()
        return
      } else if (message.type === 'placement') {
        if (!active) return
        instance = { ...instance, frame: message.frame as ComponentInstance['frame'] }
        await mounted?.updatePlacement?.(message.frame)
      } else if (message.type === 'layout.input') {
        if (!active || message.generation !== generation) return
        layoutInput = message.layout as ComponentLayoutInput
        applyFragmentLayout()
        for (const listener of layoutListeners) listener(layoutInput)
        collectHtml()
        return
      } else if (message.type === 'source.viewport') {
        if (!active || !sourceViewport) return
        sourceViewport = message.viewport as typeof sourceViewport
        applyFragmentLayout()
        // Moving the root changes only the defaults in <head>, so neither the
        // body mutation observer nor a size-only observer sees this new origin.
        refreshSourcePaint?.()
        if (teacher) teacher.viewport = { left: 0, top: 0, right: sourceViewport!.right - sourceViewport!.left, bottom: sourceViewport!.bottom - sourceViewport!.top }
        return
      } else if (message.type === 'state.applied') {
        if (!active || message.generation !== generation || typeof message.name !== 'string') return
        const pending = pendingStateWrites.get(message.name)
        if (!pending || pending.writeId !== message.writeId) return
        // Older host echoes cannot undo a newer local write. Only its own ACK
        // settles the optimistic value, including a host-rejected/normalized set.
        pendingStateWrites.delete(message.name)
        const corrected = !Object.is(states[message.name], message.value)
        states[message.name] = snapshotValue(message.value as JsonValue)
        // An unchanged set still needs an ACK, but must not manufacture a state
        // change. Each channel only replays its own suppressed notification: a
        // state listener may have set the same value before its event mirror.
        if (pending.stateNotified || corrected)
          for (const listener of listeners.get(`state:${message.name}`) ?? []) listener(snapshotValue(message.value))
        if (pending.eventNotified || corrected)
          for (const listener of listeners.get('event:__runtime.state') ?? []) listener({ name: message.name, value: snapshotValue(message.value) })
        return
      } else if (message.type === 'notification') {
        if (!active) return
        const kind = message.kind as string, name = message.name as string
        if (kind === 'event' && name === '__runtime.activity') setActivity(message.value)
        if (kind === 'event' && name === '__runtime.theme') writeCourseTheme(message.value)
        if (kind === 'event' && name === '__runtime.resources') {
          resourceUrls = resourceLease.update(message.value as Record<string, string> ?? {})
          refreshCurrentResources()
          contentAuthoring?.refresh()
          ownedAuthoring?.update()
          for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')) frame.contentWindow?.postMessage({
            type: 'guoling.resources.refresh', token: `__guoling_parser_${nonce.replace(/-/g, '_')}`, resources: message.value,
          }, '*')
        }
        if (kind === 'event' && name === '__runtime.state') {
          const update = message.value as { name: string; value: JsonValue }
          const pending = typeof update?.name === 'string' ? pendingStateWrites.get(update.name) : undefined
          if (pending) { pending.eventNotified = true; return }
          if (typeof update?.name === 'string') states[update.name] = snapshotValue(update.value)
        }
        if (kind === 'state') {
          const pending = pendingStateWrites.get(name)
          if (pending) { pending.stateNotified = true; return }
          states[name] = snapshotValue(message.value as JsonValue)
        }
        for (const listener of listeners.get(`${kind}:${name}`) ?? []) listener(snapshotValue(message.value))
        return
      } else if (message.type === 'targets.snapshot') {
        if (active && Array.isArray(message.targets)) targets = message.targets as RuntimeTargetSnapshot[]
        return
      } else if (message.type === 'teacher.snapshot') {
        if (!active) return
        teacher = message.teacher as typeof teacher
        interaction = message.interaction as typeof interaction
        for (const listener of teacherListeners) listener()
        return
      } else if (message.type === 'teacher.reply') {
        const pending = teacherPending.get(message.requestId as number)
        if (!pending) return
        teacherPending.delete(message.requestId as number)
        if (message.error) pending.reject(new Error(String(message.error)))
        else pending.resolve(message.result === true)
        return
      } else if (message.type === 'geometry.measured') {
        if (!active || message.generation !== generation) return
        const resolve = geometryRequests.get(message.requestId as number)
        if (resolve) { geometryRequests.delete(message.requestId as number); resolve(message.snapshot as ComponentGeometrySnapshot | null) }
        return
      } else if (message.type === 'motion.started') {
        if (active && message.generation === generation) motionTasks.get(message.taskId as number)?.start(message.reducedMotion === true)
        return
      } else if (message.type === 'motion.reply') {
        const pending = motionRequests.get(message.requestId as number)
        if (pending) { motionRequests.delete(message.requestId as number); pending.resolve(message.value) }
        return
      } else if (message.type === 'motion.finished') {
        const outcome = message.error ? { status: 'failed' as const, error: new Error(String(message.error)) } : { status: message.status === 'completed' ? 'completed' as const : 'cancelled' as const }
        motionTasks.get(message.taskId as number)?.settle(outcome)
        return
      } else if (message.type === 'service.reply') {
        serviceRequests.get(message.requestId as number)?.(message.result === true); return
      } else if (message.type === 'interaction.trigger') {
        const listener = active && message.generation === generation ? interactionListeners.get(message.subscriptionId as number) : undefined
        try {
          const result = listener ? await listener(message.value) : false
          send({ type: 'interaction.trigger.reply', requestId: message.requestId, result: Boolean(listener) && active && result !== false })
        } catch (error) {
          send({ type: 'interaction.trigger.reply', requestId: message.requestId, error: String(error) })
        }
        return
      } else if (message.type === 'media.command') {
        const callback = mediaCommands.get(message.mediaId as number), command = message.command as ComponentMediaCommand
        let result = false
        try { if (active && message.generation === generation && callback) result = await callback(command) === true }
        catch (error) { send({ type: 'event.emit', name: 'component.diagnostic', value: { message: `媒体命令失败：${String(error)}` } }) }
        send({ type: 'media.reply', requestId: message.requestId, mediaId: message.mediaId, result: result && mediaCommands.get(message.mediaId as number) === callback })
        return
      } else if (message.type === 'cancel' || message.type === 'dispose') {
        cancel(); await mounted?.dispose(); mounted = undefined
      } else return
      reply(message.id)
    } catch (error) { reply(message.id, error) }
  }
  const connect = (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== 'component.connect' || event.data?.nonce !== nonce || !event.ports[0]) return
    window.removeEventListener('message', connect)
    port = event.ports[0]; port.onmessage = event => { void receive(event.data) }; port.start()
    port.postMessage({ type: 'connected' })
  }
  window.addEventListener('message', connect)
  parent.postMessage({ type: 'component.ready', nonce }, '*')
}

/** One source lease/generation. No author module is imported by the workbench realm. */
export async function preparePublishedNativeComponent(artifact: CompiledComponentModule, signal: AbortSignal, snapshots: SandboxRuntimeSnapshots): Promise<PreparedComponentRuntime> {
  const leaseId = `component-${nanoid()}`
  const bootstrapApi = snapshots.bootstrap
  const clientMatrix = snapshots.hostAdapter?.clientMatrix ?? componentClientMatrix
  const authorHitEvent = snapshots.hostAdapter?.authorHitEvent ?? 'component-author-hit-test'
  if (signal.aborted) throw new Error('组件源码准备已取消')
  const nonce = nanoid(), iframe = document.createElement('iframe')
  iframe.name = leaseId
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', '组件内容')
  Object.assign(iframe.style, { border: '0', width: '100%', height: '100%' })
  // Main's existing preview protocol supplies the desktop document, without its
  // parent's CSP or Blob storage key. Standalone HTML owns this inline document.
  // The author module still arrives over a dedicated port and is loaded by the child.
  const realmClientMatrix = `(function(){const ${multiplyMatrices.name}=(${multiplyMatrices.toString()});const ${transformPoint.name}=(${transformPoint.toString()});return (${componentClientMatrix.toString()});})()`
  const bridge = (programs?: import('../../../components/web/authoredDocumentBootstrap').AuthoredDocumentPrograms) =>
    `(function(){${programs ? `const authored=${authoredDocumentProgramsSource(programs)};` : ''}(${contentRealmBridge.toString()})(${JSON.stringify(nonce)}, {resourceFactory:(${createWebResourceUrlLease.toString()}),navigationReady:(${installCourseNavigationReady.toString()}),isMeasured:(${isMeasuredWebFragmentBox.toString()}),extent:(${measuredFragmentExtent.toString()}),fragments:(${createComponentFragmentProjection.toString()}),refreshResources:(${refreshWebResourceReferences.toString()}),authoring:${domAuthoringFactorySource()},paintAt:(root,x,y)=>(${componentPaintStack.toString()})(root,x,y).length>0,clientMatrix:${realmClientMatrix},ownedAuthoring:(${installOwnedDocumentAuthoring.toString()}),input:(${installAuthoringInputArbitration.toString()}),caret:(${authoringCaretOffset.toString()}),frameGeometry:(${createAuthoringFrameGeometry.toString()}),textOverrides:(roots,rules)=>{${domTextOverrideRealmSource()}return createPageTextOverrides(roots,rules)}}${programs ? ',authored' : ''})})()`
  let runtimeBuiltinKey = snapshots.builtinKey, sourceWebDocument = false
  const pendingDocumentKeys: Record<string, string> = {}
  const readAuthorHtml = (instance: ComponentInstance | undefined): string | undefined => {
    if (!instance) return undefined
    // A professional Source may retain the Web HTML field without inheriting
    // Web execution. The editor identifies that owner; live/source matching
    // below still decides whether any particular span is actually editable.
    const sourceHtml = snapshots.authorHtml?.(instance)
    if (sourceHtml !== undefined) return sourceHtml
    if (!snapshots.htmlAuthoring || !['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? '')) return undefined
    const data = instance.data
    return data && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' ? data.html : undefined
  }
  const projectInstance = async (instance: ComponentInstance) => {
    const project = snapshots.instance ?? (['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? '') ? snapshots.webInstance : undefined)
    const projected = await project?.(instance) ?? instance
    const data = projected.data as WebRuntimeData
    if (!['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? '')
      || !data || typeof data.html !== 'string' || htmlDocumentKind(data.html) === 'document' || snapshots.nativeDocument) return projected
    return { ...projected, data: { ...data, html: authoredDocumentBootstrap(data, {
      nonce, instanceId: instance.id, nestedOnly: true, pendingDocumentKeys, resources: snapshots.resources?.() ?? {}, authoring: snapshots.htmlAuthoring === true,
      bridge: authoredDocumentProgramsSource,
    }) } }
  }
  let lease: ComponentBootstrapLease | undefined, htmlUrl: string | undefined
  const channel = new MessageChannel(), port = channel.port1
  let scope: ComponentRuntimeScope | undefined, authoring: ComponentRuntimeContext['authoring'], layoutPort: ComponentLayoutPort | undefined, disposed = false, sequence = 0
  let activity: { active: boolean; visible: boolean; playing: boolean } | undefined
  let runtimeTeacherController = snapshots.teacherController
  let teacherPointer: { x: number; y: number; matrix: readonly number[] } | undefined
  let sourceViewport: { left: number; top: number; right: number; bottom: number; width: number; height: number } | undefined
  let authorInstance: ComponentInstance | undefined
  let authorRoot: HTMLElement | undefined
  let inlinePort: ComponentRuntimeContext['inline'], inlineOverlay: HTMLElement | undefined
  type InlinePlacement = { matrix: AffineMatrix | null; width: number; height: number; visible: boolean; clip: { left: number; top: number; right: number; bottom: number } }
  const inlineSlots = new Map<number, { childId: string; element: HTMLElement; clipElement: HTMLElement; placement: InlinePlacement; release(): void }>()
  const placeInlineSlot = (slot: { clipElement: HTMLElement; placement: InlinePlacement }) => {
    const placement = slot.placement, rootMatrix = authorRoot && clientMatrix(authorRoot), iframeMatrix = clientMatrix(iframe)
    slot.clipElement.hidden = !placement.visible || !placement.matrix || !rootMatrix || !iframeMatrix
    if (slot.clipElement.hidden || !placement.matrix || !rootMatrix || !iframeMatrix) return
    const matrix = multiplyMatrices(invertMatrix(rootMatrix), multiplyMatrices(iframeMatrix, placement.matrix))
    // The host retains the iframe's real allocation even if author code alters a report.
    const clip = { left: Math.max(0, placement.clip.left), top: Math.max(0, placement.clip.top),
      right: Math.min(iframe.clientWidth, placement.clip.right), bottom: Math.min(iframe.clientHeight, placement.clip.bottom) }
    if (clip.right <= clip.left || clip.bottom <= clip.top) { slot.clipElement.hidden = true; return }
    const inverse = invertMatrix(placement.matrix)
    const polygon = [{ x: clip.left, y: clip.top }, { x: clip.right, y: clip.top }, { x: clip.right, y: clip.bottom }, { x: clip.left, y: clip.bottom }]
      .map(point => transformPoint(inverse, point)).map(point => `${point.x}px ${point.y}px`).join(',')
    Object.assign(slot.clipElement.style, { width: `${placement.width}px`, height: `${placement.height}px`, transform: `matrix(${matrix.join(',')})`, clipPath: `polygon(${polygon})` })
  }
  const refreshInlinePlacements = () => { for (const slot of inlineSlots.values()) placeInlineSlot(slot) }
  const releaseInlineSlot = (id: number) => {
    const slot = inlineSlots.get(id)
    if (!slot) return
    inlineSlots.delete(id); slot.release(); slot.clipElement.remove()
  }
  const inlinePlacement = (value: unknown): InlinePlacement | undefined => {
    if (!value || typeof value !== 'object') return
    const placement = value as InlinePlacement
    if (typeof placement.visible !== 'boolean' || !Number.isFinite(placement.width) || !Number.isFinite(placement.height)
      || placement.width < 0 || placement.height < 0 || !placement.clip || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(placement.clip[key as keyof typeof placement.clip]))) return
    if (placement.matrix !== null && (!Array.isArray(placement.matrix) || placement.matrix.length !== 6 || !placement.matrix.every(Number.isFinite)
      || Math.abs(placement.matrix[0] * placement.matrix[3] - placement.matrix[1] * placement.matrix[2]) < 1e-12)) return
    return placement
  }
  // A full realm can retain author-created handlers/timers across content updates.
  // Only its existing retirement lifecycle may reset this transport choice.
  let targetProfile: RuntimeTargetProfile | undefined
  const targetsFor = (instance: ComponentInstance<JsonValue | WebRuntimeData>) => {
    if (targetProfile !== 'full') targetProfile = webRuntimeTargetProfile(runtimeBuiltinKey, instance.data)
    return snapshots.targets(targetProfile)
  }
  let readyResolve!: () => void, readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  // Preparation can be cancelled before mount starts waiting for the handshake.
  void ready.catch(() => undefined)
  const pending = new Map<number, { resolve(value?: { document?: 'web'; fontFaceCss?: string }): void; reject(error: Error): void }>()
  const subscriptions = new Map<string, () => void>()
  const authorSpots = new Map<number, () => void>()
  const observedSpots = new Map<string, { signature: string; off(): void }>()
  const authorPreviews = new Set<string>()
  const authorHits = new Map<number, (result: ComponentAuthorHitResult) => void>()
  const authorInput = (event: Event) => {
    const value = (event as CustomEvent<{ instanceId: string; authorKey: string; active: boolean }>).detail
    if (!scope?.isActive() || !authoring || !authorRoot || value?.instanceId !== scope.instanceId
      || !(event.target instanceof Element) || !event.target.contains(authorRoot)) return
    port.postMessage({ type: 'authoring.input', generation: scope.generation, authorKey: value.authorKey, active: value.active === true })
  }
  let authorHitSequence = 0
  const authorHit = (event: Event) => {
    const request = (event as CustomEvent<ComponentAuthorHitRequest>).detail
    if (!request || disposed || !scope?.isActive()) return
    event.preventDefault()
    const requestId = ++authorHitSequence
    authorHits.set(requestId, request.resolve)
    port.postMessage({ type: 'authoring.hit-test', generation: scope.generation, requestId, x: request.point.x - (sourceViewport?.left ?? 0), y: request.point.y - (sourceViewport?.top ?? 0) })
  }
  const remoteMotions = new Map<number, { context?: ComponentMotionContext; task: ComponentMotionTask; finish(error?: string): void }>()
  let mediaPort: ComponentMediaPort | undefined, interactionPort: ComponentInteractionPort | undefined, mediaRequestSequence = 0
  const remoteMedia = new Map<number, ComponentMediaRegistration>()
  const mediaPending = new Map<number, { mediaId: number; resolve(value: boolean): void }>()
  const interruptions = new Map<number, { release(): void }>()
  const presentations = new Map<number, { write(value: unknown): Promise<boolean>; dispose(): void }>()
  const interactionSubscriptions = new Map<number, () => void>()
  let triggerSequence = 0
  const triggerPending = new Map<number, { subscriptionId: number; resolve(value: boolean): void; reject(error: Error): void }>()
  const teacherActions = new Map<number, { controller: AbortController; committed: boolean }>()
  const interactionActions = new Map<number, { controller: AbortController; committed: boolean }>()
  const mediaStateValue = (value: unknown): value is ComponentMediaState => {
    if (!value || typeof value !== 'object') return false
    const state = value as ComponentMediaState
    return typeof state.paused === 'boolean' && typeof state.loop === 'boolean' && Number.isFinite(state.currentTime)
  }
  const interactionSnapshot = () => interactionPort && { surfaceId: interactionPort.currentSurfaceId(), stateId: interactionPort.currentStateId() }
  const frameValue = (value: unknown): value is MotionFrame => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const frame = value as Record<string, unknown>
    return Object.keys(frame).every(key => ['transform', 'opacity', 'offset', 'easing'].includes(key))
      && (frame.transform === undefined || typeof frame.transform === 'string')
      && (frame.opacity === undefined || typeof frame.opacity === 'number' && Number.isFinite(frame.opacity))
      && (frame.offset === undefined || typeof frame.offset === 'number' && Number.isFinite(frame.offset))
      && (frame.easing === undefined || typeof frame.easing === 'string')
  }
  const timingValue = (value: unknown): value is MotionTiming => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const timing = value as Record<string, unknown>
    return Object.entries(timing).every(([key, item]) => ['delay', 'direction', 'duration', 'easing', 'endDelay', 'fill', 'iterationStart', 'iterations'].includes(key)
      && (typeof item === 'number' && Number.isFinite(item) || typeof item === 'string'))
  }
  const teacherSnapshot = () => {
    const teacher = runtimeTeacherController
    if (!teacher) return undefined
    const snapshot = teacher.read()
    const types = ['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.replay', 'course.restart', 'scene.open-picker', 'audio.toggle-mute', 'player.fullscreen.toggle'] as const
    const matrix = clientMatrix(iframe), bounds = teacher.viewportBounds?.()
    const corners = matrix && bounds ? [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom }].map(point => transformPoint(invertMatrix(matrix), point)) : undefined
    return { snapshot, ...(corners ? { viewport: { left: Math.min(...corners.map(point => point.x)), top: Math.min(...corners.map(point => point.y)), right: Math.max(...corners.map(point => point.x)), bottom: Math.max(...corners.map(point => point.y)) } } : {}), allowed: { ...Object.fromEntries(types.map(type => [type, teacher.canExecute({ type })])),
      'camera.present': Boolean(snapshot.camera),
      'scene.go': snapshot.scenes.some(scene => teacher.canExecute({ type: 'scene.go', sceneId: scene.id })) } }
  }
  const refreshSourceViewport = (notify = true) => {
    if (!sourceViewport || !authorRoot) { refreshInlinePlacements(); return }
    const matrix = clientMatrix(authorRoot)
    if (!matrix) return
    const view = authorRoot.ownerDocument.documentElement, bounds = runtimeTeacherController?.viewportBounds?.() ?? { left: 0, top: 0, right: view.clientWidth, bottom: view.clientHeight }
    const inverse = invertMatrix(matrix), corners = [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.left, y: bounds.bottom }, { x: bounds.right, y: bounds.bottom }].map(point => transformPoint(inverse, point))
    const previous = sourceViewport
    sourceViewport = { left: Math.min(...corners.map(point => point.x)), top: Math.min(...corners.map(point => point.y)), right: Math.max(...corners.map(point => point.x)), bottom: Math.max(...corners.map(point => point.y)),
      width: authorRoot.clientWidth || authorInstance?.frame?.width || 300, height: authorRoot.clientHeight || authorInstance?.frame?.height || 150 }
    Object.assign(iframe.style, { position: 'absolute', left: `${sourceViewport.left}px`, top: `${sourceViewport.top}px`, width: `${sourceViewport.right - sourceViewport.left}px`, height: `${sourceViewport.bottom - sourceViewport.top}px` })
    // Mount sends the initial viewport. A pointer start with unchanged geometry
    // must not rebuild subscribed controls between pointerdown and click.
    const changed = sourceViewport.left !== previous.left || sourceViewport.top !== previous.top
      || sourceViewport.right !== previous.right || sourceViewport.bottom !== previous.bottom
      || sourceViewport.width !== previous.width || sourceViewport.height !== previous.height
    if (notify && changed && scope?.isActive()) port.postMessage({ type: 'source.viewport', viewport: sourceViewport })
    refreshInlinePlacements()
  }
  const release = () => {
    if (disposed) return
    if (scope) port.postMessage({ type: 'cancel', generation: scope.generation })
    disposed = true
    const error = new Error('组件运行已取消')
    for (const id of [...inlineSlots.keys()]) releaseInlineSlot(id)
    inlineOverlay?.remove(); inlineOverlay = undefined; inlinePort = undefined
    readyReject(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    for (const off of subscriptions.values()) off()
    subscriptions.clear(); window.removeEventListener('message', handshake)
    for (const off of authorSpots.values()) off()
    authorSpots.clear()
    for (const value of observedSpots.values()) value.off()
    observedSpots.clear()
    authorPreviews.clear()
    authorRoot?.removeEventListener(authorHitEvent, authorHit)
    authorRoot?.ownerDocument.removeEventListener('component-author-input-state', authorInput, true)
    for (const resolve of authorHits.values()) resolve({ authorKey: null, painted: true })
    authorHits.clear()
    for (const value of remoteMotions.values()) { value.task.cancel(); value.finish() }
    remoteMotions.clear()
    // A navigation already committed its destination belongs to the host, not the departing realm.
    for (const request of teacherActions.values()) if (!request.committed) request.controller.abort()
    teacherActions.clear()
    for (const request of interactionActions.values()) if (!request.committed) request.controller.abort()
    interactionActions.clear()
    for (const off of interactionSubscriptions.values()) off()
    interactionSubscriptions.clear()
    for (const pending of triggerPending.values()) pending.resolve(false)
    triggerPending.clear()
    for (const handle of presentations.values()) handle.dispose()
    presentations.clear()
    for (const handle of remoteMedia.values()) handle.dispose()
    remoteMedia.clear()
    for (const handle of interruptions.values()) handle.release()
    interruptions.clear()
    for (const pending of mediaPending.values()) pending.resolve(false)
    mediaPending.clear()
    signal.removeEventListener('abort', release); scope?.signal.removeEventListener('abort', release)
    port.close(); channel.port2.close(); iframe.remove()
    if (lease) void bootstrapApi!.releaseComponentBootstrap!({ leaseId }).catch(() => undefined)
    else if (htmlUrl) URL.revokeObjectURL(htmlUrl)
  }
  const handshake = (event: MessageEvent) => {
    if (disposed || event.source !== iframe.contentWindow || event.data?.type !== 'component.ready' || event.data?.nonce !== nonce) return
    window.removeEventListener('message', handshake)
    iframe.contentWindow!.postMessage({ type: 'component.connect', nonce }, '*', [channel.port2])
  }
  port.onmessage = event => {
    const message = event.data
    if (disposed) return
    if (message?.type === 'connected') { readyResolve(); return }
    if (message?.type === 'reply') {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(String(message.error)))
      else request.resolve(message.value)
      return
    }
    if (!scope?.isActive() || message?.generation !== scope.generation) return
    if (message.type === 'geometry.measure' && Number.isInteger(message.requestId)) {
      const references: ReturnType<typeof componentTargetSchema.safeParse>[] | null = Array.isArray(message.references)
        ? message.references.map((value: unknown) => componentTargetSchema.safeParse(value)) : null
      const currentScope = scope
      // Capture the requesting realm transform alongside the host's synchronous
      // layout batch, before any promise turn can move the iframe.
      const matrix = authorRoot ? clientMatrix(iframe) : [1, 0, 0, 1, 0, 0] as AffineMatrix
      const hostToViewport = matrix ? invertMatrix(matrix) : null
      const measured = currentScope.measure && references?.every(value => value.success) && hostToViewport
        ? currentScope.measure(references.map(value => value.data!)) : Promise.resolve(null)
      void measured.then(snapshot => {
        if (!disposed && currentScope.isActive()) port.postMessage({ type: 'geometry.measured', requestId: message.requestId,
          generation: currentScope.generation, snapshot: snapshot && hostToViewport ? projectComponentGeometry(snapshot, hostToViewport) : null })
      }).catch(() => {
        if (!disposed && currentScope.isActive()) port.postMessage({ type: 'geometry.measured', requestId: message.requestId,
          generation: currentScope.generation, snapshot: null })
      })
      return
    }
    if (message.type === 'inline.release' && Number.isInteger(message.slotId)) { releaseInlineSlot(message.slotId); return }
    if ((message.type === 'inline.mount' || message.type === 'inline.layout') && Number.isInteger(message.slotId)) {
      const placement = inlinePlacement(message.placement)
      if (!placement || !inlinePort || !authorRoot) return
      let slot = inlineSlots.get(message.slotId)
      if (message.type === 'inline.mount') {
        if (slot || typeof message.childId !== 'string' || !authorInstance?.childIds?.includes(message.childId)) return
        for (const [id, previous] of inlineSlots) if (previous.childId === message.childId) releaseInlineSlot(id)
        if (!inlineOverlay) {
          if (getComputedStyle(authorRoot).position === 'static') {
            const root = authorRoot, position = root.style.position
            root.style.position = 'relative'; scope.cleanup(() => { root.style.position = position })
          }
          inlineOverlay = authorRoot.ownerDocument.createElement('div')
          inlineOverlay.dataset.componentInlineOverlay = scope.instanceId
          Object.assign(inlineOverlay.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1' })
          authorRoot.append(inlineOverlay)
        }
        const element = authorRoot.ownerDocument.createElement('div')
        element.dataset.componentInlineSlot = message.childId
        Object.assign(element.style, { width: '100%', height: '100%', pointerEvents: 'auto' })
        const clipElement = authorRoot.ownerDocument.createElement('div')
        clipElement.dataset.componentInlinePlacement = message.childId
        Object.assign(clipElement.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' })
        clipElement.append(element); inlineOverlay.append(clipElement)
        slot = { childId: message.childId, element, clipElement, placement, release: () => {} }
        inlineSlots.set(message.slotId, slot); placeInlineSlot(slot)
        try { slot.release = inlinePort.mount(message.childId, element) }
        catch (error) { releaseInlineSlot(message.slotId); scope.events.emit('component.diagnostic', { message: `子组件槽位未挂载：${String(error)}` }); return }
      } else if (slot) { slot.placement = placement; placeInlineSlot(slot) }
      return
    }
    if (message.type === 'source.paint' && (sourceViewport || authorRoot && (authorInstance?.container || authorInstance?.childIds?.length
      || authorInstance?.frame && ['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? '')))) {
      const bounds = message.bounds
      if (bounds === null) iframe.style.clipPath = 'polygon(0 0,0 0,0 0)'
      else if ((authorInstance?.container || authorInstance?.childIds?.length) && Array.isArray(message.rects)) {
        const rects = message.rects.filter((box: Record<string, number>) => box && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(box[key]))
          && box.right > box.left && box.bottom > box.top)
        iframe.style.clipPath = rects.length ? `path("${rects.map((box: Record<string, number>) => `M ${box.left} ${box.top} H ${box.right} V ${box.bottom} H ${box.left} Z`).join(' ')}")` : 'polygon(0 0,0 0,0 0)'
      }
      else if (bounds && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(bounds[key]))
        && bounds.right > bounds.left && bounds.bottom > bounds.top)
        iframe.style.clipPath = `polygon(${bounds.left}px ${bounds.top}px,${bounds.right}px ${bounds.top}px,${bounds.right}px ${bounds.bottom}px,${bounds.left}px ${bounds.bottom}px)`
      return
    }
    if (message.type === 'interaction.trigger.reply') {
      const pending = triggerPending.get(message.requestId)
      if (!pending) return
      triggerPending.delete(message.requestId)
      if (message.error) pending.reject(new Error(String(message.error)))
      else pending.resolve(message.result === true)
      return
    }
    if (message.type === 'layout.size' && layoutPort) {
      const report = message.report
      if (report && Number.isFinite(report.inlineSize) && Number.isFinite(report.blockSize) && report.inlineSize > 0 && report.blockSize >= 0)
        layoutPort.reportSize({ inlineSize: report.inlineSize, blockSize: report.blockSize })
      return
    }
    if (message.type === 'media.reply') {
      const pending = mediaPending.get(message.requestId)
      if (pending && pending.mediaId === message.mediaId) { mediaPending.delete(message.requestId); pending.resolve(message.result === true) }
      return
    }
    if (message.type === 'media.register' && mediaPort && Number.isInteger(message.mediaId)) {
      const value = message.options as ComponentMediaRegistrationOptions
      if (!value || !['audio', 'video'].includes(value.kind) || !['music', 'narration', 'sfx', 'ui', 'video'].includes(value.channel)
        || !Number.isFinite(value.volume) || typeof value.muted !== 'boolean' || !mediaStateValue(value.initial)) return
      const mediaId = message.mediaId, currentScope = scope
      remoteMedia.get(mediaId)?.dispose()
      try {
        const handle = mediaPort.register(value, command => new Promise<boolean>(resolve => {
          if (disposed || !currentScope.isActive()) { resolve(false); return }
          const requestId = ++mediaRequestSequence; mediaPending.set(requestId, { mediaId, resolve })
          port.postMessage({ type: 'media.command', generation: currentScope.generation, mediaId, requestId, command })
        }))
        remoteMedia.set(mediaId, handle)
      } catch (error) { interactionPort?.report(`${scope.instanceId} 媒体登记失败：${String(error)}`) }
      return
    }
    if (message.type === 'media.dispose') {
      remoteMedia.get(message.mediaId)?.dispose(); remoteMedia.delete(message.mediaId)
      for (const [id, pending] of mediaPending) if (pending.mediaId === message.mediaId) { pending.resolve(false); mediaPending.delete(id) }
      return
    }
    if (message.type === 'media.update') {
      const patch = message.patch
      if (!patch || typeof patch !== 'object') return
      const options: Partial<Pick<ComponentMediaRegistrationOptions, 'channel' | 'volume' | 'muted'>> = {}
      if (['music', 'narration', 'sfx', 'ui', 'video'].includes(patch.channel)) options.channel = patch.channel
      if (Number.isFinite(patch.volume)) options.volume = patch.volume
      if (typeof patch.muted === 'boolean') options.muted = patch.muted
      remoteMedia.get(message.mediaId)?.update(options); return
    }
    if (message.type === 'media.report') {
      if (mediaStateValue(message.state) && (message.event === undefined || ['play', 'pause', 'ended'].includes(message.event))) remoteMedia.get(message.mediaId)?.report(message.state, message.event)
      return
    }
    if (message.type === 'media.interrupt' && mediaPort && Number.isInteger(message.interruptionId) && ['none', 'duck', 'pause', 'stop'].includes(message.mode)) {
      interruptions.get(message.interruptionId)?.release(); interruptions.set(message.interruptionId, mediaPort.interruptBackground(message.mode)); return
    }
    if (message.type === 'media.release') { interruptions.get(message.interruptionId)?.release(); interruptions.delete(message.interruptionId); return }
    if (message.type === 'presentation.create' && Number.isInteger(message.presentationId)) {
      const reference = componentTargetSchema.safeParse(message.reference)
      const target = reference.success && reference.data.kind === 'instance' ? scope.target(reference.data)?.presentation : undefined
      presentations.get(message.presentationId)?.dispose(); presentations.delete(message.presentationId)
      if (target && message.kind === 'feedback' && typeof message.value === 'string') {
        const handle = target.feedback(message.value)
        presentations.set(message.presentationId, { write: value => typeof value === 'string' ? handle.setText(value) : Promise.resolve(false), dispose: handle.dispose })
      } else if (target && message.kind === 'visibility' && typeof message.value === 'boolean') {
        const handle = target.visibility(message.value)
        presentations.set(message.presentationId, { write: value => typeof value === 'boolean' ? handle.setVisible(value) : Promise.resolve(false), dispose: handle.dispose })
      } else interactionPort?.report(`${scope.instanceId}：目标没有可用的${message.kind === 'feedback' ? '反馈' : '显示'}内容容器`)
      return
    }
    if (message.type === 'presentation.dispose') { presentations.get(message.presentationId)?.dispose(); presentations.delete(message.presentationId); return }
    if (message.type === 'presentation.write' && Number.isInteger(message.requestId)) {
      const currentScope = scope
      void (presentations.get(message.presentationId)?.write(message.value) ?? Promise.resolve(false)).then(result => {
        if (!disposed) port.postMessage({ type: 'service.reply', requestId: message.requestId, generation: currentScope.generation, result: result && currentScope.isActive() })
      }); return
    }
    if (message.type === 'interaction.clicked') { scope.events.emit('__runtime.node-click', { instanceId: scope.instanceId }); return }
    if (message.type === 'authoring.hit-result') {
      const resolve = authorHits.get(message.requestId)
      authorHits.delete(message.requestId)
      resolve?.({ authorKey: typeof message.authorKey === 'string' ? message.authorKey : null, painted: message.painted !== false })
      return
    }
    if ((message.type === 'authoring.pointer' || message.type === 'authoring.double-click') && authoring && authorRoot?.isConnected
      && (authorSpots.size || observedSpots.size) && Number.isFinite(message.x) && Number.isFinite(message.y)) {
      authorRoot.dispatchEvent(new CustomEvent(message.type === 'authoring.pointer' ? 'component-author-pointer' : 'component-author-double-click', { bubbles: true, detail: {
        instanceId: scope.instanceId, mountGeneration: scope.generation, localPoint: { x: message.x + (sourceViewport?.left ?? 0), y: message.y + (sourceViewport?.top ?? 0) }, authorKey: message.authorKey,
        ...(Number.isSafeInteger(message.caretOffset) && message.caretOffset >= 0 ? { caretOffset: message.caretOffset } : {}),
      } })); return
    }
    if (message.type === 'authoring.hover' && authoring && authorRoot?.isConnected) {
      authorRoot.dispatchEvent(new CustomEvent('component-author-hover', { bubbles: true, detail: { instanceId: scope.instanceId, authorKey: message.authorKey } })); return
    }
    if (message.type === 'authoring.selection' && authoring && authorRoot?.isConnected && typeof message.authorKey === 'string'
      && Number.isSafeInteger(message.anchor) && message.anchor >= 0 && Number.isSafeInteger(message.focus) && message.focus >= 0) {
      authorRoot.dispatchEvent(new CustomEvent('component-author-selection', { bubbles: true, detail: {
        instanceId: scope.instanceId, mountGeneration: scope.generation, authorKey: message.authorKey,
        anchor: message.anchor, focus: message.focus, ...(message.word === true ? { word: true } : {}),
      } })); return
    }
    if (message.type === 'interaction.unsubscribe') {
      interactionSubscriptions.get(message.subscriptionId)?.(); interactionSubscriptions.delete(message.subscriptionId)
      for (const [id, pending] of triggerPending) if (pending.subscriptionId === message.subscriptionId) { pending.resolve(false); triggerPending.delete(id) }
      return
    }
    if (message.type === 'interaction.subscribe' && interactionPort && Number.isInteger(message.subscriptionId)) {
      const trigger = interactionTriggerSchema.safeParse(message.trigger), currentScope = scope
      if (!trigger.success) { interactionPort.report('源码互动触发条件无法解析'); return }
      interactionSubscriptions.get(message.subscriptionId)?.()
      interactionSubscriptions.set(message.subscriptionId, interactionPort.subscribeTrigger(trigger.data, value => {
        if (disposed || !currentScope.isActive()) return false
        const requestId = ++triggerSequence
        return new Promise<boolean>((resolve, reject) => {
          triggerPending.set(requestId, { subscriptionId: message.subscriptionId, resolve, reject })
          port.postMessage({ type: 'interaction.trigger', requestId, subscriptionId: message.subscriptionId, generation: currentScope.generation, value })
        })
      })); return
    }
    if (message.type === 'interaction.cancel') { interactionActions.get(message.requestId)?.controller.abort(); interactionActions.delete(message.requestId); return }
    if (message.type === 'interaction.action' && interactionPort && Number.isInteger(message.requestId)) {
      const action = interactionActionSchema.safeParse(message.action), currentScope = scope, currentPort = interactionPort
      const controller = new AbortController(), context = message.context
      const request = { controller, committed: false }; interactionActions.set(message.requestId, request)
      void (async () => {
        let result = false
        if (action.success && context && typeof context.ruleId === 'string' && typeof context.stepId === 'string') {
          const outcome = await currentPort.executeAction(action.data, { signal: controller.signal, ruleId: context.ruleId, stepId: context.stepId, restartFromBeginning: context.restartFromBeginning === true, onNavigationCommit: () => { request.committed = true } })
          result = outcome !== false && !controller.signal.aborted && currentScope.isActive()
        } else currentPort.report('源码互动动作无法解析')
        return result
      })().catch(error => { if (!controller.signal.aborted && currentScope.isActive()) currentPort.report(String(error)); return false }).then(result => {
        if (interactionActions.get(message.requestId) === request) interactionActions.delete(message.requestId)
        if (!disposed) port.postMessage({ type: 'service.reply', requestId: message.requestId, generation: currentScope.generation, result })
      }); return
    }
    if (message.type === 'motion.start' && Number.isInteger(message.taskId) && typeof message.channel === 'string') {
      const reference = componentTargetSchema.safeParse(message.reference)
      const target = reference.success && reference.data.kind === 'instance' ? scope.target(reference.data) : null
      const generation = scope.generation, taskId = message.taskId as number
      if (!target?.motion) { port.postMessage({ type: 'motion.finished', taskId, generation, status: 'failed', error: '该目标没有可运行动效的视觉内容' }); return }
      remoteMotions.get(taskId)?.task.cancel()
      let finish!: (error?: string) => void, context: ComponentMotionContext | undefined
      const programFinished = new Promise<void>((resolve, reject) => { finish = error => error === undefined ? resolve() : reject(new Error(error)) })
      const task = target.motion.replace(message.channel, current => {
        context = current
        port.postMessage({ type: 'motion.started', taskId, generation, reducedMotion: current.reducedMotion })
        return programFinished
      })
      const record = { task, finish, get context() { return context } }
      remoteMotions.set(taskId, record)
      void task.finished.then(outcome => {
        finish()
        if (remoteMotions.get(taskId) === record) remoteMotions.delete(taskId)
        if (!disposed) port.postMessage({ type: 'motion.finished', taskId, generation, status: outcome.status,
          ...(outcome.status === 'failed' ? { error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) } : {}) })
      })
      return
    }
    if (message.type === 'motion.cancel' || message.type === 'motion.finish') {
      const record = remoteMotions.get(message.taskId)
      if (message.type === 'motion.cancel') { record?.task.cancel(); record?.finish() }
      else record?.finish(typeof message.error === 'string' ? message.error : undefined)
      return
    }
    if (message.type === 'motion.request' && Number.isInteger(message.requestId)) {
      const record = remoteMotions.get(message.taskId), currentScope = scope
      void (async () => {
        const context = record?.context
        let value: unknown = message.method === 'nextFrame' ? null : false
        if (context && !context.signal.aborted && currentScope.isActive()) {
          if (message.method === 'write' && frameValue(message.frame)) value = await context.write(message.frame)
          else if (message.method === 'nextFrame') value = await context.nextFrame()
          else if (message.method === 'animate' && Array.isArray(message.frames) && message.frames.every(frameValue) && timingValue(message.timing))
            value = await context.animate(message.frames as MotionKeyframe[], message.timing)
        }
        if (!disposed) port.postMessage({ type: 'motion.reply', requestId: message.requestId, generation: currentScope.generation, value })
      })().catch(error => { record?.task.cancel(); record?.finish(String(error)); if (!disposed) port.postMessage({ type: 'motion.reply', requestId: message.requestId, generation: currentScope.generation, value: false }) })
      return
    }
    if (message.type === 'authoring.observe') {
      // The formal frame and the fragment's layout root retain their authored
      // dimensions. Only the iframe's paint viewport includes visible overflow.
      const extent = message.contentExtent
      if (!sourceViewport) {
        iframe.style.width = extent && Number.isFinite(extent.width) && extent.width > 0 ? `${extent.width}px` : '100%'
        iframe.style.height = extent && Number.isFinite(extent.height) && extent.height > 0 ? `${extent.height}px` : '100%'
        if (extent && Number.isFinite(extent.left) && Number.isFinite(extent.top)) {
          iframe.style.position = 'relative'; iframe.style.left = `${extent.left}px`; iframe.style.top = `${extent.top}px`
        }
      }
      if (!snapshots.htmlAuthoring || !authoring || !Array.isArray(message.reports)) return
      const html = readAuthorHtml(authorInstance)
      const present = new Set<string>()
      for (const report of message.reports) {
        const parsed = htmlPreviewTargetReportSchema.safeParse(report)
        if (!parsed.success) continue
        const resolved = typeof html === 'string' ? snapshots.hostAdapter?.locateTarget?.(html, parsed.data, { documentId: scope.runScopeId, epoch: String(scope.generation), revision: 0, bindingVersion: 0 }) : undefined
        const { handle, kind, rawText, rect } = parsed.data
        const observed = parsed.data.authoring
        const record = observed?.record
        const stored = observed && authorInstance?.authoring?.records?.[observed.authorKey]?.overrides[kind === 'text' ? 'text' : 'src']
        const source = stored === undefined && resolved?.status === 'editable' && resolved.locator.valueSpan ? resolved.locator.valueSpan : undefined
        if (!source && (!observed || !record || record.kind !== kind || record.binding?.kind !== 'dom')) continue
        const input: ComponentAuthorSpotInput = { kind, initialValue: rawText,
          ...(parsed.data.textStyle ? { textStyle: parsed.data.textStyle } : {}),
          ...(observed && record ? { authorKey: observed.authorKey, scope: record.scope, binding: record.binding, bindingStatus: parsed.data.bindingStatus ?? 'bound' as const } : {}),
          ...(parsed.data.geometry ? { geometry: parsed.data.geometry } : {}),
          ...(source ? { sourceRegion: { kind: 'data' as const, path: ['html'], ...source, encoding: kind === 'text' ? 'html-text' as const : 'html-attribute' as const } }
            : { fieldScope: 'authoring' as const, dataPath: ['records', observed!.authorKey, 'overrides', kind === 'text' ? 'text' : 'src'] }),
          localBounds: { width: Math.max(1, rect.width), height: Math.max(1, rect.height), transform: [1, 0, 0, 1, rect.x, rect.y] } }
        const signature = JSON.stringify(input), previous = observedSpots.get(handle)
        present.add(handle)
        if (previous?.signature === signature || previous && input.authorKey && authorPreviews.has(input.authorKey)) continue
        previous?.off(); observedSpots.set(handle, { signature, off: authoring.register(input, input.authorKey ? {
          previewGeometry: geometry => {
            if (!scope?.isActive() || disposed) return
            if (geometry === null) authorPreviews.delete(input.authorKey!)
            else authorPreviews.add(input.authorKey!)
            port.postMessage({ type: 'authoring.preview', generation: scope.generation, authorKey: input.authorKey, geometry })
          },
        } : undefined) })
      }
      for (const [handle, value] of observedSpots) if (!present.has(handle)) { value.off(); observedSpots.delete(handle) }
      return
    }
    if (message.type === 'authoring.unregister' && Number.isInteger(message.spotId)) { authorSpots.get(message.spotId)?.(); authorSpots.delete(message.spotId); return }
    if (message.type === 'authoring.register' && Number.isInteger(message.spotId) && authoring) {
      const spot = message.spot as ComponentAuthorSpotInput | undefined
      if (!spot || !['text', 'image'].includes(spot.kind) || !componentFrameSchema.safeParse(spot.localBounds).success
        || !jsonValueSchema.safeParse(spot.initialValue).success
        || spot.dataPath && (!Array.isArray(spot.dataPath) || !spot.dataPath.every(value => typeof value === 'string'))
        || spot.sourceRegion && (!['implementation', 'data'].includes(spot.sourceRegion.kind) || !Number.isInteger(spot.sourceRegion.start)
          || !Number.isInteger(spot.sourceRegion.end) || spot.sourceRegion.start < 0 || spot.sourceRegion.end < spot.sourceRegion.start)) return
      authorSpots.get(message.spotId)?.()
      authorSpots.set(message.spotId, authoring.register(spot, message.preview === true ? {
        previewGeometry: geometry => { if (scope?.isActive() && !disposed) port.postMessage({ type: 'authoring.preview', generation: scope.generation, spotId: message.spotId, geometry }) },
      } : undefined)); return
    }
    if (message.type === 'teacher.cancel') { teacherActions.get(message.requestId)?.controller.abort(); return }
    if (message.type === 'teacher.request' && runtimeTeacherController) {
      const currentScope = scope, teacher = runtimeTeacherController
      if (activity && (!activity.active || !activity.playing)) {
        teacherPointer = undefined
        port.postMessage({ type: 'teacher.reply', requestId: message.requestId, result: false })
        return
      }
      const request = { controller: new AbortController(), committed: false }; teacherActions.set(message.requestId, request)
      void (async () => {
        let result = false
        if (message.method === 'execute') {
          const action = teacherControllerActionSchema.safeParse(message.action)
          if (action.success && currentScope.isActive() && teacher.canExecute(action.data)) result = await teacher.execute(action.data, request.controller.signal, () => { request.committed = true })
        } else if (message.method === 'setCollapsed' && typeof message.value === 'boolean') { teacher.setCollapsed(message.value); result = true }
        else if (message.method === 'movePointer' && typeof message.phase === 'string' && ['start', 'move', 'end'].includes(message.phase) && Number.isFinite(message.x) && Number.isFinite(message.y)) {
          const matrix = teacherPointer?.matrix ?? clientMatrix(iframe)
          if (message.phase === 'end') teacherPointer = undefined
          else if (matrix) {
            // Pointer coordinates belong to the source viewport at gesture start.
            // Translation caused by this drag must not feed back into its next delta.
            if (message.phase === 'move' && teacherPointer) {
              const dx = message.x - teacherPointer.x, dy = message.y - teacherPointer.y
              teacher.moveBy(matrix[0] * dx + matrix[2] * dy, matrix[1] * dx + matrix[3] * dy)
            }
            teacherPointer = { x: message.x, y: message.y, matrix }
            refreshSourceViewport()
          }
          result = Boolean(matrix)
        }
        else if (message.method === 'moveBy' && Number.isFinite(message.dx) && Number.isFinite(message.dy)) {
          const matrix = clientMatrix(iframe)
          if (matrix) { teacher.moveBy(matrix[0] * message.dx + matrix[2] * message.dy, matrix[1] * message.dx + matrix[3] * message.dy); result = true }
        }
        else if (message.method === 'setZoom' && Number.isFinite(message.value) && message.value > 0) { teacher.setZoom(message.value); result = true }
        else if (message.method === 'resetView') { teacher.resetView(); result = true }
        if (!disposed && currentScope.isActive()) port.postMessage({ type: 'teacher.reply', requestId: message.requestId, result })
      })().catch(error => { if (!disposed && currentScope.isActive()) port.postMessage({ type: 'teacher.reply', requestId: message.requestId, error: String(error) }) })
        .finally(() => { if (teacherActions.get(message.requestId) === request) teacherActions.delete(message.requestId) })
      return
    }
    const value = jsonValueSchema.safeParse(message.value)
    if (message.type === 'event.emit' && typeof message.name === 'string' && value.success) scope.events.emit(message.name, value.data)
    else if (message.type === 'state.set' && typeof message.name === 'string' && value.success) {
      const currentScope = scope
      currentScope.state.set(message.name, value.data)
      if (!disposed && currentScope.isActive()) port.postMessage({ type: 'state.applied', generation: currentScope.generation,
        name: message.name, writeId: message.writeId, value: currentScope.state.get(message.name) })
    }
    else if (message.type === 'target.emit' && typeof message.name === 'string' && value.success) {
      const reference = componentTargetSchema.safeParse(message.reference)
      if (reference.success) scope.target(reference.data)?.emit(message.name, value.data)
    }
    else if ((message.type === 'subscribe' || message.type === 'unsubscribe') && typeof message.name === 'string' && ['state', 'event'].includes(message.kind)) {
      // This instance fact already has one permanent bridge subscription; the child owns listener replay.
      if (message.kind === 'event' && message.name === '__runtime.activity') return
      const key = `${message.kind}:${message.name}`
      if (message.type === 'unsubscribe') { subscriptions.get(key)?.(); subscriptions.delete(key); return }
      if (subscriptions.has(key)) return
      const currentScope = scope
      const listener = (value: JsonValue | undefined) => { if (currentScope.isActive() && !disposed) port.postMessage({ type: 'notification', kind: message.kind, name: message.name, value }) }
      subscriptions.set(key, message.kind === 'state' ? currentScope.state.subscribe(message.name, listener) : currentScope.events.subscribe(message.name, listener))
    }
  }
  port.start(); window.addEventListener('message', handshake)
  signal.addEventListener('abort', release, { once: true })
  const request = (type: string, values: object = {}) => new Promise<{ document?: 'web'; fontFaceCss?: string } | undefined>((resolve, reject) => {
    if (disposed) { reject(new Error('组件运行已取消')); return }
    const id = ++sequence; pending.set(id, { resolve, reject }); port.postMessage({ type, id, ...values })
  })
  try {
    if (signal.aborted) release()
    return { release, isWebDocument: () => sourceWebDocument || ['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? ''), artifactIdentity: JSON.stringify([
      artifact.format, artifact.code, artifact.css,
      Object.entries(artifact.modules ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ]), implementation: {
      async mount(context) {
        scope = context.scope
        // World replays the current instance fact synchronously. Cache it before any asynchronous preparation.
        subscriptions.set('runtime-activity', scope.events.subscribe('__runtime.activity', value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return
          const next = value as { active: boolean; visible: boolean; playing: boolean }
          if (typeof next.active !== 'boolean' || typeof next.visible !== 'boolean' || typeof next.playing !== 'boolean') return
          activity = { active: next.active, visible: next.visible, playing: next.playing }
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'notification', kind: 'event', name: '__runtime.activity', value: activity })
        }))
        runtimeTeacherController = context.teacherController ?? snapshots.teacherController
        mediaPort = context.media; interactionPort = context.interactions; inlinePort = context.inline
        authoring = context.authoring
        authorRoot = context.root
        authorRoot?.addEventListener(authorHitEvent, authorHit)
        authorRoot?.ownerDocument.addEventListener('component-author-input-state', authorInput, true)
        layoutPort = context.layout
        authorInstance = context.instance
        scope.signal.addEventListener('abort', release, { once: true }); scope.cleanup(release)
        if (layoutPort) {
          const currentScope = scope
          subscriptions.set('layout', layoutPort.subscribe(layout => {
            if (currentScope.isActive() && !disposed) port.postMessage({ type: 'layout.input', generation: currentScope.generation, layout })
            refreshInlinePlacements()
          }))
        }
        if (inlinePort && authorRoot) {
          const resize = new ResizeObserver(refreshInlinePlacements), refresh = () => refreshInlinePlacements()
          resize.observe(authorRoot); resize.observe(iframe)
          window.addEventListener('resize', refresh); window.addEventListener('scroll', refresh, true)
          scope.cleanup(() => { resize.disconnect(); window.removeEventListener('resize', refresh); window.removeEventListener('scroll', refresh, true) })
        }
        subscriptions.set('course-theme', scope.events.subscribe('__runtime.theme', value => {
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'notification', kind: 'event', name: '__runtime.theme', value })
        }))
        subscriptions.set('course-resources', scope.events.subscribe('__runtime.resources', value => {
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'notification', kind: 'event', name: '__runtime.resources', value })
        }))
        subscriptions.set('course-state', scope.events.subscribe('__runtime.state', value => {
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'notification', kind: 'event', name: '__runtime.state', value })
        }))
        subscriptions.set('course-targets', scope.events.subscribe(snapshots.targetChanges ? '__runtime.targets.changed' : '__runtime.targets', value => {
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'targets.snapshot',
            targets: snapshots.targetChanges && authorInstance ? targetsFor(authorInstance) : value })
        }))
        if (runtimeTeacherController) subscriptions.set('teacher', runtimeTeacherController.subscribe(() => {
          refreshSourceViewport()
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'teacher.snapshot', teacher: teacherSnapshot(), interaction: interactionSnapshot() })
        }))
        let authorHtml = readAuthorHtml(context.instance)
        // Classify author syntax independently of editor target observation.
        const data = context.instance.data && typeof context.instance.data === 'object' && !Array.isArray(context.instance.data) ? context.instance.data : undefined
        let web = ['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? '')
        const updateFramePointer = (instance: ComponentInstance) => {
          iframe.style.pointerEvents = (instance.style?.pointerEvents ?? instance.style?.['pointer-events']) === 'none' ? 'none' : 'auto'
        }
        updateFramePointer(context.instance)
        let authorDocumentKind = web && typeof data?.html === 'string' ? htmlDocumentKind(data.html) : undefined
        let documentKind = snapshots.nativeDocument && authorDocumentKind ? 'document' : authorDocumentKind
        let projected = await projectInstance(context.instance)
        if (signal.aborted || !scope.isActive()) throw new Error('组件挂载已取消')
        const resources = snapshots.resources?.() ?? {}
        const faces = splitInstalledBundledFontFaceCss(snapshots.themeCss?.() ?? '').faces
        const transportFragment = snapshots.nativeDocument && authorDocumentKind === 'fragment'
        const nativeData = projected.data as WebRuntimeData
        const parserData = transportFragment ? { ...nativeData, html: `<!doctype html><html><head><style id="component-defaults">html,body{width:100%;height:100%;margin:0}</style></head><body>${nativeData.html}</body></html>` } : nativeData
        const html = documentKind === 'document' && context.root
          ? authoredDocumentBootstrap(parserData, { nonce, instanceId: context.instance.id, bridge, resources, pendingDocumentKeys, authoring: snapshots.htmlAuthoring === true, themeCss: snapshots.themeCss?.(), transportFragment, resourceCss: typeof data?.css === 'string' ? data.css : undefined })
          : `<!doctype html><meta charset="utf-8">${faces ? `<style data-component-bundled-faces>${faces.replace(/<\/style/gi, '<\\/style')}</style>` : ''}<style id="component-defaults">html,body,#component-root{width:100%;height:100%;margin:0}</style><div id="component-root"></div><script>${bridge().replace(/<\/script/gi, '<\\/script')}</script>`
        lease = bootstrapApi ? await bootstrapApi.createComponentBootstrap!({ leaseId, html, connectOrigins: [...(snapshots.connectOrigins?.() ?? [])],
          resourceSources: hasWebContentData(data) && Array.isArray(data?.resourceSources) ? data.resourceSources as unknown as ComponentBootstrapInput['resourceSources'] : undefined,
          remoteAssetUrls: Object.values(resources).filter(url => /^https?:/i.test(url)) }) : undefined
        if (signal.aborted || !scope.isActive()) {
          if (lease) await bootstrapApi!.releaseComponentBootstrap!({ leaseId })
          lease = undefined; throw new Error('组件挂载已取消')
        }
        htmlUrl = lease?.url ?? URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        if (context.root) {
          if (!context.root.isConnected || context.root.ownerDocument !== iframe.ownerDocument) throw new Error('组件内容根尚未连接')
          // The destination supplies the real viewport before parser scripts run.
          // No loaded realm is detached and reinserted during initial mounting.
          context.root.append(iframe); iframe.hidden = false
        } else { iframe.hidden = true; document.body.append(iframe) }
        iframe.src = htmlUrl
        await ready
        const prepared = await request('prepare', { artifact, resources: snapshots.resources?.() })
        sourceWebDocument = prepared?.document === 'web'
        if (signal.aborted || !scope.isActive()) throw new Error('组件挂载已取消')
        if (!web && prepared?.document === 'web' && hasWebContentData(data)) {
          // A professional identity is never an execution directive. Only the
          // actually imported Source may request the mature Web document path.
          runtimeBuiltinKey = 'guoling.web'; web = true
          authorDocumentKind = htmlDocumentKind(data.html); documentKind = authorDocumentKind
          projected = await projectInstance(context.instance)
          authorHtml = readAuthorHtml(context.instance)
          if (signal.aborted || !scope.isActive()) throw new Error('组件挂载已取消')
          if (documentKind === 'document' && context.root) await request('document', { html: authoredDocumentBootstrap(projected.data as WebRuntimeData, {
            nonce, instanceId: context.instance.id, resources, pendingDocumentKeys, authoring: snapshots.htmlAuthoring === true, resourceCss: typeof data.css === 'string' ? data.css : undefined,
            themeCss: `${prepared.fontFaceCss ?? ''}\n${splitInstalledBundledFontFaceCss(snapshots.themeCss?.() ?? '').theme}`,
            bridge: programs => `window[${JSON.stringify(`__guoling_adopt_${nonce.replace(/-/g, '_')}`)}](${authoredDocumentProgramsSource(programs)})`,
          }) })
        }
        if (!web && context.root && context.instance.frame) {
          sourceViewport = { left: 0, top: 0, right: context.instance.frame.width, bottom: context.instance.frame.height, width: context.instance.frame.width, height: context.instance.frame.height }
          if (getComputedStyle(context.root).position === 'static') { const position = context.root.style.position; context.root.style.position = 'relative'; scope.cleanup(() => { context.root!.style.position = position }) }
          refreshSourceViewport(false)
          const resize = new ResizeObserver(() => refreshSourceViewport()); resize.observe(context.root)
          const refresh = () => refreshSourceViewport()
          window.addEventListener('resize', refresh); window.addEventListener('scroll', refresh, true)
          scope.cleanup(() => { resize.disconnect(); window.removeEventListener('resize', refresh); window.removeEventListener('scroll', refresh, true) })
        }
        if (signal.aborted || !scope.isActive()) throw new Error('组件挂载已取消')
        await request('mount', { instance: projected, generation: scope.generation, runScopeId: scope.runScopeId,
          activity,
          visual: Boolean(context.root), state: snapshots.state(), targets: targetsFor(projected), teacher: teacherSnapshot(), htmlAuthoring: snapshots.htmlAuthoring,
          media: Boolean(mediaPort), interaction: interactionSnapshot(),
          inline: Boolean(inlinePort && context.root),
          measure: Boolean(scope.measure),
          layout: layoutPort?.read(),
          sourceViewport,
          fragmentStateKey: componentFragmentStateKey(context.instance.id), themeCss: snapshots.themeCss?.(), resources: snapshots.resources?.(), resourceBindings: snapshots.resourceBindings,
          authorHtml, documentKind, builtinKey: runtimeBuiltinKey,
          measuredWebFragment: snapshots.builtinKey === 'guoling.web' && authorDocumentKind === 'fragment',
          resourceCss: typeof data?.css === 'string' ? data.css : undefined })
        if (!scope.isActive()) throw new Error('组件挂载已取消')
        return { update: async instance => {
          const previousData = authorInstance?.data, nextData = instance.data
          const preserveHtml = (sourceWebDocument || ['guoling.web', 'guoling.html-program'].includes(runtimeBuiltinKey ?? ''))
            && hasWebContentData(previousData) && hasWebContentData(nextData)
            && ownedDocumentExecutionSource(previousData.html) === ownedDocumentExecutionSource(nextData.html)
          authorInstance = instance
          for (const [id, slot] of inlineSlots) if (!instance.childIds?.includes(slot.childId)) releaseInlineSlot(id)
          updateFramePointer(instance); const projected = await projectInstance(instance); return request('update', { instance: projected, preserveHtml, state: snapshots.state(), targets: targetsFor(projected), themeCss: snapshots.themeCss?.(), resources: snapshots.resources?.(), interaction: interactionSnapshot(),
            resourceCss: instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && typeof instance.data.css === 'string' ? instance.data.css : undefined,
            authorHtml: readAuthorHtml(instance) }).then(() => undefined) },
          updatePlacement: frame => {
            if (authorInstance) authorInstance = { ...authorInstance, frame }
            refreshSourceViewport()
            if (scope?.isActive()) void request('placement', { frame }).catch(() => {})
          },
          async dispose() { if (!disposed) { try { await request('dispose') } finally { release() } } },
        }
      },
    } }
  } catch (error) { release(); throw error }
}
