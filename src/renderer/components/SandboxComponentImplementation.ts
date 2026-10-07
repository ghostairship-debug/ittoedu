import type { CompiledComponentModule } from '../../core/components/compilation/types'
import type { ComponentInstance, ComponentRuntimeScope, ComponentTarget, JsonValue, ComponentRuntimeContext, ComponentAuthorSpotInput, ComponentMediaCommand, ComponentMediaRegistration, ComponentMediaPort, ComponentInteractionPort, ComponentPresentationPort, ComponentMediaState, ComponentMediaRegistrationOptions, ComponentLayoutInput, ComponentLayoutPort } from '../../shared/contracts/component-platform'
import type { PreparedComponentRuntime } from '../../player/components/runtime/ComponentRuntimeHost'
import { componentTargetSchema, jsonValueSchema, componentFrameSchema } from '../../shared/contracts/component-platform'
import { teacherControllerActionSchema, type TeacherControllerAction, type TeacherControllerPort, type TeacherControllerSnapshot } from '../../shared/contracts/component-platform/teacherController'
import { htmlPreviewTargetReportSchema } from '../../shared/workbench/htmlPreview'
import { locateHtmlSourceTarget } from '../../main/workbench/htmlPreview/htmlSourceLocator'
import type { ComponentMotionContext, ComponentMotionOutcome, ComponentMotionProgram, ComponentMotionTask, MotionFrame, MotionKeyframe, MotionTiming } from '../../shared/contracts/component-platform/motion'
import { componentFragmentStateKey } from '../../player/componentPlatform/fragments'
import type { ComponentBootstrapInput, ComponentBootstrapLease } from '../../shared/ipcTypes'
import { interactionActionSchema, interactionTriggerSchema } from '../../shared/contracts/interaction-v1/schema'
import { htmlDocumentKind } from '../../shared/html/documentKind'
import { isMeasuredWebFragmentBox, measuredFragmentExtent } from '../../components/web/measuredFragmentBox'
import { authoredDocumentBootstrap, installAuthoredDocumentPrograms } from '../../components/web/authoredDocumentBootstrap'
import { webRuntimeTargetProfile, type RuntimeTargetProfile, type WebRuntimeData } from '../../components/web/moduleGraph'
import { refreshWebResourceReferences } from '../../components/web/resources'

export interface RuntimeTargetSnapshot { reference: ComponentTarget; instanceId: string; value?: JsonValue }
export interface ComponentBootstrapTransport {
  createComponentBootstrap(input: ComponentBootstrapInput): Promise<ComponentBootstrapLease>
  releaseComponentBootstrap(input: { leaseId: string }): Promise<void>
}
interface SnapshotPorts { state(): Record<string, JsonValue>; targets(profile: RuntimeTargetProfile): RuntimeTargetSnapshot[]; instance?(value: ComponentInstance): ComponentInstance<JsonValue | WebRuntimeData> | Promise<ComponentInstance<JsonValue | WebRuntimeData>>; teacherController?: TeacherControllerPort; htmlAuthoring?: boolean; builtinKey?: string; connectOrigins?(): readonly string[]; themeCss?(): string; resources?(): Record<string, string>; resourceBindings?: Readonly<Record<string, string>>; bootstrap?: ComponentBootstrapTransport }

/** Serialized trusted bridge only. Author code arrives through its dedicated port. */
function contentRealmBridge(nonce: string, fragmentBox: { isMeasured: typeof isMeasuredWebFragmentBox; extent: typeof measuredFragmentExtent; refreshResources: typeof refreshWebResourceReferences }, authoredDocument?: { release(): void }) {
  // This fixed loader is created only inside the content realm. Keeping import's
  // syntax in its string prevents Vite from inserting a parent lexical helper.
  const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, any>>
  const fragmentRoot = document.getElementById('component-root')!, fragmentDefaults = document.getElementById('component-defaults')!
  const loader = document.currentScript; if (loader) document.head.append(loader)
  const courseStyle = document.createElement('style'); document.head.append(courseStyle)
  type Message = { type: string; id?: number; [key: string]: unknown }
  let port: MessagePort, implementation: { mount(context: unknown): unknown }, mounted: { update(instance: unknown): unknown; updatePlacement?(frame: unknown): unknown; dispose(): unknown } | undefined
  let controller: AbortController, instance: ComponentInstance, active = false, generation = 0
  let updateResourceCss: (value: unknown) => void = () => {}
  let states: Record<string, JsonValue> = {}, targets: RuntimeTargetSnapshot[] = []
  let resourceUrls: Record<string, string> = {}
  let resourceBindings: Readonly<Record<string, string>> = {}
  let layoutInput: ComponentLayoutInput | undefined
  let fragmentThemeCanvas = false
  const layoutListeners = new Set<(layout: ComponentLayoutInput) => void>()
  const applyFragmentLayout = () => {
    if (!fragmentDefaults || authoredDocument) return
    fragmentDefaults.textContent = `html,body,#component-root{width:100%;height:${layoutInput?.mode === 'flow-content' ? 'auto' : '100%'};margin:0}`
  }
  const writeCourseTheme = (value: unknown) => {
    courseStyle.textContent = typeof value === 'string' ? value : ''
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
  let motionSequence = 0, motionRequestSequence = 0
  const motionTasks = new Map<number, { start(reducedMotion: boolean): void; settle(outcome: ComponentMotionOutcome): void }>()
  const motionRequests = new Map<number, { taskId: number; method: string; resolve(value: unknown): void }>()
  let serviceSequence = 0
  const serviceRequests = new Map<number, (value: boolean) => void>()
  const mediaCommands = new Map<number, (command: ComponentMediaCommand) => boolean | Promise<boolean>>()
  const interactionListeners = new Map<number, (value?: unknown) => void>()
  let interaction: { surfaceId: string | null; stateId: string | null } | undefined
  let originalHtml: string | undefined, observeHtml = false, collectHtml = () => {}
  let teacher: { snapshot: TeacherControllerSnapshot; allowed: Record<string, boolean> } | undefined, teacherSequence = 0
  const teacherListeners = new Set<() => void>(), teacherPending = new Map<number, { resolve(value: boolean): void; reject(error: Error): void }>()
  const teacherRequest = (method: string, values: object = {}) => new Promise<boolean>((resolve, reject) => {
    if (!active) { reject(new Error('导航作用域已取消')); return }
    const requestId = ++teacherSequence; teacherPending.set(requestId, { resolve, reject })
    send({ type: 'teacher.request', requestId, method, ...values })
  })
  const reply = (id: number | undefined, error?: unknown) => port.postMessage({ type: 'reply', id,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) })
  const send = (message: Message) => { if (active) port.postMessage({ ...message, generation }) }
  const nativeDiagnostics: string[] = []
  if (authoredDocument) {
    const report = (message: string) => {
      if (active) send({ type: 'event.emit', name: 'component.diagnostic', value: { instanceId: instance.id, message } })
      else nativeDiagnostics.push(message)
    }
    const error = (event: Event) => report(event instanceof ErrorEvent ? `HTML脚本错误：${event.message}；原源码已保留` : 'HTML文档资源加载失败；原源码和其余内容已保留')
    const rejection = (event: PromiseRejectionEvent) => report(`HTML程序错误：${String(event.reason)}；原源码已保留`)
    window.addEventListener('error', error, true); window.addEventListener('unhandledrejection', rejection)
    cleanups.add(() => { window.removeEventListener('error', error, true); window.removeEventListener('unhandledrejection', rejection) })
  }
  const subscribe = (kind: string, name: string, listener: (value: unknown) => void) => {
    const key = `${kind}:${name}`, set = listeners.get(key) ?? new Set()
    listeners.set(key, set); set.add(listener); send({ type: 'subscribe', kind, name })
    const off = () => { set.delete(listener); if (!set.size) send({ type: 'unsubscribe', kind, name }) }
    cleanups.add(off); return () => { cleanups.delete(off); off() }
  }
  const cancel = () => {
    if (!active) return
    active = false; controller.abort()
    for (const cleanup of cleanups) { try { cleanup() } catch {} }
    cleanups.clear(); listeners.clear(); layoutListeners.clear()
    for (const pending of teacherPending.values()) pending.reject(new Error('导航作用域已取消'))
    teacherPending.clear(); teacherListeners.clear()
    for (const task of [...motionTasks.values()]) task.settle({ status: 'cancelled' })
    motionTasks.clear()
    for (const pending of motionRequests.values()) pending.resolve(pending.method === 'nextFrame' ? null : false)
    motionRequests.clear()
    for (const resolve of serviceRequests.values()) resolve(false)
    serviceRequests.clear(); mediaCommands.clear(); interactionListeners.clear()
    authoredDocument?.release()
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
        const artifact = message.artifact as CompiledComponentModule
        const style = document.createElement('style'); style.textContent = artifact.css; document.head.append(style)
        const url = URL.createObjectURL(new Blob([artifact.code], { type: 'text/javascript' }))
        try {
          const module = await importModule(url)
          implementation = module.default ?? module.implementation ?? module
          if (typeof implementation?.mount !== 'function') throw new Error('组件模块需要导出 mount(context) 或 default { mount(context) }')
        } finally { URL.revokeObjectURL(url) }
      } else if (message.type === 'mount') {
        if (authoredDocument && document.readyState === 'loading') await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }))
        document.querySelector('style[data-component-initial-theme]')?.remove()
        resourceUrls = message.resources as Record<string, string> ?? {}
        resourceBindings = message.resourceBindings as Record<string, string> ?? {}
        layoutInput = message.layout as ComponentLayoutInput | undefined
        applyFragmentLayout()
        instance = message.instance as ComponentInstance
        fragmentThemeCanvas = Boolean(message.visual && message.documentKind === 'fragment' && message.builtinKey === 'guoling.web' && instance.frame)
        writeCourseTheme(message.themeCss)
        originalHtml = typeof message.authorHtml === 'string' ? message.authorHtml : undefined
        observeHtml = message.htmlAuthoring === true
        generation = message.generation as number
        states = message.state as Record<string, JsonValue>; targets = message.targets as RuntimeTargetSnapshot[]
        controller = new AbortController(); active = true
        for (const message of nativeDiagnostics.splice(0)) send({ type: 'event.emit', name: 'component.diagnostic', value: { instanceId: instance.id, message } })
        teacher = message.teacher as typeof teacher
        interaction = message.interaction as typeof interaction
        const scope = {
          runScopeId: message.runScopeId, instanceId: instance.id, generation, signal: controller.signal,
          isActive: () => active,
          cleanup: (cleanup: () => void) => { if (active) cleanups.add(cleanup); else cleanup() },
          // These are explicitly the latest observed snapshots, never synchronous RPC.
          target: (reference: ComponentTarget) => {
            if (!active) return null
            const target = targets.find(value => JSON.stringify(value.reference) === JSON.stringify(reference))
            return target ? { instanceId: target.instanceId, read: () => targets.find(value => JSON.stringify(value.reference) === JSON.stringify(reference))?.value ?? null,
              emit: (name: string, value: JsonValue) => send({ type: 'target.emit', reference, name, value }),
              ...(reference.kind === 'instance' ? { motion: motion(reference), presentation: presentation(reference) } : {}) } : null
          },
          state: { get: (name: string) => states[name], set: (name: string, value: JsonValue) => {
            if (!active) return
            states[name] = value; send({ type: 'state.set', name, value })
          }, subscribe: (name: string, listener: (value: unknown) => void) => subscribe('state', name, listener) },
          events: { emit: (name: string, value: JsonValue) => send({ type: 'event.emit', name, value }),
            subscribe: (name: string, listener: (value: unknown) => void) => subscribe('event', name, listener) },
        }
        const documentRoot = message.visual && message.documentKind === 'document'
        const root = message.visual ? documentRoot ? document.body : fragmentRoot : undefined
        if (documentRoot) {
          fragmentRoot?.remove(); fragmentDefaults?.remove()
          if (!authoredDocument && originalHtml && new DOMParser().parseFromString(originalHtml, 'text/html').compatMode !== document.compatMode)
            scope.events.emit('component.diagnostic', { instanceId: instance.id, message: '原 HTML 使用兼容排版模式；当前内容环境使用标准模式，原源码已保留' })
        }
        if (root) {
          const clicked = () => send({ type: 'interaction.clicked' })
          root.addEventListener('click', clicked); cleanups.add(() => root.removeEventListener('click', clicked))
        }
        const teacherController = teacher ? {
          read: () => teacher!.snapshot,
          subscribe: (listener: () => void) => { teacherListeners.add(listener); return () => { teacherListeners.delete(listener) } },
          canExecute: (action: TeacherControllerAction) => Boolean(teacher?.allowed[action.type]) && (action.type !== 'scene.go'
            || !action.targetStateId && teacher!.snapshot.scenes.some(scene => scene.id === action.sceneId)),
          execute: (action: TeacherControllerAction) => teacherRequest('execute', { action }),
          setCollapsed: (value: boolean) => { void teacherRequest('setCollapsed', { value }).catch(() => {}) },
          moveBy: (dx: number, dy: number) => { void teacherRequest('moveBy', { dx, dy }).catch(() => {}) },
          setZoom: (value: number) => { void teacherRequest('setZoom', { value }).catch(() => {}) },
          resetView: () => { void teacherRequest('resetView').catch(() => {}) },
        } : undefined
        const authoring = { register: (spot: ComponentAuthorSpotInput) => {
          const spotId = ++authorSpotSequence
          send({ type: 'authoring.register', spotId, spot })
          const off = () => send({ type: 'authoring.unregister', spotId })
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
        const runtimeContext = { instance, scope, root, teacherController, authoring, layout, authoredDocument: Boolean(authoredDocument), builtinKey: message.builtinKey, resourceCss: message.resourceCss, resources: { url: (name: string) => resourceUrls[Object.hasOwn(resourceBindings, name) ? resourceBindings[name] : name] },
          media: message.media === true ? media : undefined, interactions: interaction ? interactions : undefined }
        updateResourceCss = value => { runtimeContext.resourceCss = value }
        mounted = await implementation.mount(runtimeContext) as typeof mounted
        if (!active) { await mounted?.dispose(); mounted = undefined; return }
        if (!mounted || typeof mounted.update !== 'function' || typeof mounted.dispose !== 'function') throw new Error('mount 必须返回 update/dispose 生命周期')
        if (documentRoot && !authoredDocument) cleanups.add(() => { document.head.prepend(fragmentDefaults); document.body.append(fragmentRoot) })
        if (root && observeHtml && originalHtml !== undefined) {
          const fragmentKey = String(message.fragmentStateKey), hiddenStyles = new WeakMap<HTMLElement, { value: string; priority: string }>()
          const applyFragments = () => {
            const progress = states[fragmentKey], fragments = [...root.querySelectorAll<HTMLElement>('.fragment')]
            const count = typeof progress === 'number' ? progress : fragments.length
            fragments.forEach((element, index) => {
              const previous = hiddenStyles.get(element)
              if (index < count) {
                if (previous) { if (previous.value) element.style.setProperty('display', previous.value, previous.priority); else element.style.removeProperty('display'); hiddenStyles.delete(element) }
              } else if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') {
                hiddenStyles.set(element, { value: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') })
                element.style.setProperty('display', 'none', 'important')
              }
            })
          }
          subscribe('state', fragmentKey, applyFragments)
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
          collectHtml = () => {
            if (!active || originalHtml === undefined) return
            applyFragments()
            const source = new DOMParser().parseFromString(originalHtml, 'text/html')
            const projected = new DOMParser().parseFromString(String((instance.data as Record<string, JsonValue>).html ?? ''), 'text/html')
            const reports: unknown[] = []
            const origin = documentRoot ? { x: 0, y: 0 } : root.getBoundingClientRect()
            const walk = (live: Element, original: Element, bound: Element) => {
              if (live.localName !== original.localName && live !== root || original.localName !== bound.localName) return
              for (const node of live.childNodes) {
                if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim() || live.closest('script,style,noscript,template,textarea,title,option,[contenteditable]')) continue
                const range = document.createRange(); range.selectNodeContents(node)
                const rect = range.getBoundingClientRect()
                let handle = handles.get(node); if (!handle) { handle = `html:${++sequence}`; handles.set(node, handle) }
                reports.push({ handle, kind: 'text', domPath: pathFor(original), sectionOrder: sectionOrder(original), rawText: node.textContent,
                  attributeName: null, scriptCreated: false, rect: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height } })
              }
              if (live.localName === 'img' && live.getAttribute('src') === bound.getAttribute('src')) {
                const rect = live.getBoundingClientRect()
                let handle = handles.get(live); if (!handle) { handle = `html:${++sequence}`; handles.set(live, handle) }
                reports.push({ handle, kind: 'image', domPath: pathFor(original), sectionOrder: sectionOrder(original), rawText: original.getAttribute('src') ?? '',
                  attributeName: 'src', scriptCreated: false, rect: { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height } })
              }
              const originals = Array.from(original.children).filter(element => element.localName !== 'script')
              const bindings = Array.from(bound.children).filter(element => element.localName !== 'script')
              Array.from(live.children).filter(element => element.localName !== 'script').forEach((child, index) => { if (originals[index] && bindings[index]) walk(child, originals[index], bindings[index]) })
            }
            walk(root, source.body, projected.body)
            const sourceElement = source.body.firstElementChild as HTMLElement | SVGElement | null
            const liveElement = root.firstElementChild as HTMLElement | SVGElement | null
            const sourceStyle = sourceElement?.style ? Object.fromEntries(Array.from({ length: sourceElement.style.length }, (_unused, index) => {
              const key = sourceElement.style.item(index)
              return [key, sourceElement.style.getPropertyValue(key)]
            })) : undefined
            const contentExtent = liveElement && sourceStyle && instance.frame
              && fragmentBox.isMeasured(instance, documentRoot ? 'document' : 'fragment', sourceStyle,
                typeof message.builtinKey === 'string' ? { implementation: { kind: 'builtin', key: message.builtinKey } } : undefined)
              && liveElement.style.margin === '0px' && liveElement.style.boxSizing === 'border-box'
              ? fragmentBox.extent(liveElement, instance.frame) : null
            send({ type: 'authoring.observe', reports, contentExtent })
          }
          const enqueue = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; collectHtml() }) } }
          const observer = new MutationObserver(enqueue); observer.observe(documentRoot ? document.documentElement : root, { childList: true, characterData: true, attributes: true, subtree: true })
          const resize = new ResizeObserver(enqueue); resize.observe(root)
          if (documentRoot) {
            resize.observe(document.documentElement)
            window.addEventListener('scroll', enqueue, true); window.addEventListener('resize', enqueue)
          }
          cleanups.add(() => {
            observer.disconnect(); resize.disconnect()
            if (documentRoot) { window.removeEventListener('scroll', enqueue, true); window.removeEventListener('resize', enqueue) }
          })
          collectHtml()
        }
      } else if (message.type === 'update') {
        if (!active) return
        writeCourseTheme(message.themeCss)
        resourceUrls = message.resources as Record<string, string> ?? {}
        instance = message.instance as ComponentInstance
        updateResourceCss(message.resourceCss)
        originalHtml = typeof message.authorHtml === 'string' ? message.authorHtml : undefined
        targets = message.targets as RuntimeTargetSnapshot[]
        states = message.state as Record<string, JsonValue>
        interaction = message.interaction as typeof interaction
        await mounted?.update(instance)
        collectHtml()
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
      } else if (message.type === 'notification') {
        if (!active) return
        const kind = message.kind as string, name = message.name as string
        if (kind === 'event' && name === '__runtime.theme') writeCourseTheme(message.value)
        if (kind === 'event' && name === '__runtime.resources') {
          resourceUrls = message.value as Record<string, string> ?? {}
          fragmentBox.refreshResources(document, resourceUrls)
        }
        if (kind === 'event' && name === '__runtime.state') {
          const update = message.value as { name: string; value: JsonValue }
          if (typeof update?.name === 'string') states[update.name] = update.value
        }
        if (kind === 'state') states[name] = message.value as JsonValue
        for (const listener of listeners.get(`${kind}:${name}`) ?? []) listener(message.value)
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
        if (active && message.generation === generation) interactionListeners.get(message.subscriptionId as number)?.(message.value)
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
export async function prepareSandboxComponent(artifact: CompiledComponentModule, signal: AbortSignal, snapshots: SnapshotPorts): Promise<PreparedComponentRuntime> {
  const leaseId = `component-${crypto.randomUUID()}`
  const bootstrapApi = snapshots.bootstrap ?? (typeof window.desktopAPI?.createComponentBootstrap === 'function' && typeof window.desktopAPI?.releaseComponentBootstrap === 'function' ? window.desktopAPI : undefined)
  if (signal.aborted) throw new Error('组件源码准备已取消')
  const nonce = crypto.randomUUID(), iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', '组件内容')
  Object.assign(iframe.style, { border: '0', width: '100%', height: '100%' })
  // Main's existing preview protocol supplies the desktop document, without its
  // parent's CSP or Blob storage key. Standalone HTML owns this inline document.
  // The author module still arrives over a dedicated port and is loaded by the child.
  const bridge = (programs?: import('../../components/web/authoredDocumentBootstrap').AuthoredDocumentPrograms) =>
    `(function(){${programs ? `const authored=(${installAuthoredDocumentPrograms.toString()})(${JSON.stringify(programs)});` : ''}(${contentRealmBridge.toString()})(${JSON.stringify(nonce)}, {isMeasured:(${isMeasuredWebFragmentBox.toString()}),extent:(${measuredFragmentExtent.toString()}),refreshResources:(${refreshWebResourceReferences.toString()})}${programs ? ',authored' : ''})})()`
  let lease: ComponentBootstrapLease | undefined, htmlUrl: string | undefined
  const channel = new MessageChannel(), port = channel.port1
  let scope: ComponentRuntimeScope | undefined, authoring: ComponentRuntimeContext['authoring'], layoutPort: ComponentLayoutPort | undefined, disposed = false, sequence = 0
  let authorInstance: ComponentInstance | undefined
  // A full realm can retain author-created handlers/timers across content updates.
  // Only its existing retirement lifecycle may reset this transport choice.
  let targetProfile: RuntimeTargetProfile | undefined
  const targetsFor = (instance: ComponentInstance<JsonValue | WebRuntimeData>) => {
    if (targetProfile !== 'full') targetProfile = webRuntimeTargetProfile(snapshots.builtinKey, instance.data)
    return snapshots.targets(targetProfile)
  }
  let readyResolve!: () => void, readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  // Preparation can be cancelled before mount starts waiting for the handshake.
  void ready.catch(() => undefined)
  const pending = new Map<number, { resolve(): void; reject(error: Error): void }>()
  const subscriptions = new Map<string, () => void>()
  const authorSpots = new Map<number, () => void>()
  const observedSpots = new Map<string, { signature: string; off(): void }>()
  const remoteMotions = new Map<number, { context?: ComponentMotionContext; task: ComponentMotionTask; finish(error?: string): void }>()
  let mediaPort: ComponentMediaPort | undefined, interactionPort: ComponentInteractionPort | undefined, mediaRequestSequence = 0
  const remoteMedia = new Map<number, ComponentMediaRegistration>()
  const mediaPending = new Map<number, { mediaId: number; resolve(value: boolean): void }>()
  const interruptions = new Map<number, { release(): void }>()
  const presentations = new Map<number, { write(value: unknown): Promise<boolean>; dispose(): void }>()
  const interactionSubscriptions = new Map<number, () => void>()
  const interactionActions = new Map<number, AbortController>()
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
    const teacher = snapshots.teacherController
    if (!teacher) return undefined
    const snapshot = teacher.read()
    const types = ['step.previous', 'step.next', 'scene.previous', 'scene.next', 'scene.replay', 'course.restart', 'scene.open-picker', 'audio.toggle-mute', 'player.fullscreen.toggle'] as const
    return { snapshot, allowed: { ...Object.fromEntries(types.map(type => [type, teacher.canExecute({ type })])),
      'scene.go': snapshot.scenes.some(scene => teacher.canExecute({ type: 'scene.go', sceneId: scene.id })) } }
  }
  const release = () => {
    if (disposed) return
    if (scope) port.postMessage({ type: 'cancel', generation: scope.generation })
    disposed = true
    const error = new Error('组件运行已取消')
    readyReject(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    for (const off of subscriptions.values()) off()
    subscriptions.clear(); window.removeEventListener('message', handshake)
    for (const off of authorSpots.values()) off()
    authorSpots.clear()
    for (const value of observedSpots.values()) value.off()
    observedSpots.clear()
    for (const value of remoteMotions.values()) { value.task.cancel(); value.finish() }
    remoteMotions.clear()
    for (const controller of interactionActions.values()) controller.abort()
    interactionActions.clear()
    for (const off of interactionSubscriptions.values()) off()
    interactionSubscriptions.clear()
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
      else request.resolve()
      return
    }
    if (!scope?.isActive() || message?.generation !== scope.generation) return
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
    if (message.type === 'interaction.unsubscribe') { interactionSubscriptions.get(message.subscriptionId)?.(); interactionSubscriptions.delete(message.subscriptionId); return }
    if (message.type === 'interaction.subscribe' && interactionPort && Number.isInteger(message.subscriptionId)) {
      const trigger = interactionTriggerSchema.safeParse(message.trigger), currentScope = scope
      if (!trigger.success) { interactionPort.report('源码互动触发条件无法解析'); return }
      interactionSubscriptions.get(message.subscriptionId)?.()
      interactionSubscriptions.set(message.subscriptionId, interactionPort.subscribeTrigger(trigger.data, value => {
        if (!disposed && currentScope.isActive()) port.postMessage({ type: 'interaction.trigger', subscriptionId: message.subscriptionId, generation: currentScope.generation, value })
      })); return
    }
    if (message.type === 'interaction.cancel') { interactionActions.get(message.requestId)?.abort(); interactionActions.delete(message.requestId); return }
    if (message.type === 'interaction.action' && interactionPort && Number.isInteger(message.requestId)) {
      const action = interactionActionSchema.safeParse(message.action), currentScope = scope, currentPort = interactionPort
      const controller = new AbortController(), context = message.context
      interactionActions.set(message.requestId, controller)
      void (async () => {
        let result = false
        if (action.success && context && typeof context.ruleId === 'string' && typeof context.stepId === 'string') {
          const outcome = await currentPort.executeAction(action.data, { signal: controller.signal, ruleId: context.ruleId, stepId: context.stepId, restartFromBeginning: context.restartFromBeginning === true })
          result = outcome !== false && !controller.signal.aborted && currentScope.isActive()
        } else currentPort.report('源码互动动作无法解析')
        return result
      })().catch(error => { if (!controller.signal.aborted && currentScope.isActive()) currentPort.report(String(error)); return false }).then(result => {
        if (interactionActions.get(message.requestId) === controller) interactionActions.delete(message.requestId)
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
    if (message.type === 'authoring.observe' && snapshots.htmlAuthoring && authoring && Array.isArray(message.reports)) {
      const data = authorInstance?.data, html = data && typeof data === 'object' && !Array.isArray(data) ? data.html : undefined
      if (typeof html !== 'string') return
      const present = new Set<string>()
      for (const report of message.reports) {
        const parsed = htmlPreviewTargetReportSchema.safeParse(report)
        if (!parsed.success) continue
        const resolved = locateHtmlSourceTarget(html, parsed.data, { documentId: scope.runScopeId, epoch: String(scope.generation), revision: 0, bindingVersion: 0 })
        if (resolved.status !== 'editable' || !resolved.locator.valueSpan) continue
        const { handle, kind, rawText, rect } = parsed.data
        const input: ComponentAuthorSpotInput = { kind, initialValue: rawText,
          sourceRegion: { kind: 'data', path: ['html'], ...resolved.locator.valueSpan, encoding: kind === 'text' ? 'html-text' : 'html-attribute' },
          localBounds: { width: Math.max(1, rect.width), height: Math.max(1, rect.height), transform: [1, 0, 0, 1, rect.x, rect.y] } }
        const signature = JSON.stringify(input), previous = observedSpots.get(handle)
        present.add(handle)
        if (previous?.signature === signature) continue
        previous?.off(); observedSpots.set(handle, { signature, off: authoring.register(input) })
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
      authorSpots.set(message.spotId, authoring.register(spot)); return
    }
    if (message.type === 'teacher.request' && snapshots.teacherController) {
      const currentScope = scope, teacher = snapshots.teacherController
      void (async () => {
        let result = false
        if (message.method === 'execute') {
          const action = teacherControllerActionSchema.safeParse(message.action)
          if (action.success && currentScope.isActive() && teacher.canExecute(action.data)) result = await teacher.execute(action.data)
        } else if (message.method === 'setCollapsed' && typeof message.value === 'boolean') { teacher.setCollapsed(message.value); result = true }
        else if (message.method === 'moveBy' && Number.isFinite(message.dx) && Number.isFinite(message.dy)) { teacher.moveBy(message.dx, message.dy); result = true }
        else if (message.method === 'setZoom' && Number.isFinite(message.value) && message.value > 0) { teacher.setZoom(message.value); result = true }
        else if (message.method === 'resetView') { teacher.resetView(); result = true }
        if (!disposed && currentScope.isActive()) port.postMessage({ type: 'teacher.reply', requestId: message.requestId, result })
      })().catch(error => { if (!disposed && currentScope.isActive()) port.postMessage({ type: 'teacher.reply', requestId: message.requestId, error: String(error) }) })
      return
    }
    const value = jsonValueSchema.safeParse(message.value)
    if (message.type === 'event.emit' && typeof message.name === 'string' && value.success) scope.events.emit(message.name, value.data)
    else if (message.type === 'state.set' && typeof message.name === 'string' && value.success) scope.state.set(message.name, value.data)
    else if (message.type === 'target.emit' && typeof message.name === 'string' && value.success) {
      const reference = componentTargetSchema.safeParse(message.reference)
      if (reference.success) scope.target(reference.data)?.emit(message.name, value.data)
    }
    else if ((message.type === 'subscribe' || message.type === 'unsubscribe') && typeof message.name === 'string' && ['state', 'event'].includes(message.kind)) {
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
  const request = (type: string, values: object = {}) => new Promise<void>((resolve, reject) => {
    if (disposed) { reject(new Error('组件运行已取消')); return }
    const id = ++sequence; pending.set(id, { resolve, reject }); port.postMessage({ type, id, ...values })
  })
  try {
    if (signal.aborted) release()
    return { release, artifactIdentity: JSON.stringify([
      artifact.format, artifact.code, artifact.css,
      Object.entries(artifact.modules ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ]), implementation: {
      async mount(context) {
        scope = context.scope
        mediaPort = context.media; interactionPort = context.interactions
        authoring = context.authoring
        layoutPort = context.layout
        authorInstance = context.instance
        scope.signal.addEventListener('abort', release, { once: true }); scope.cleanup(release)
        if (layoutPort) {
          const currentScope = scope
          subscriptions.set('layout', layoutPort.subscribe(layout => {
            if (currentScope.isActive() && !disposed) port.postMessage({ type: 'layout.input', generation: currentScope.generation, layout })
          }))
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
        if (snapshots.teacherController) subscriptions.set('teacher', snapshots.teacherController.subscribe(() => {
          if (scope?.isActive() && !disposed) port.postMessage({ type: 'teacher.snapshot', teacher: teacherSnapshot(), interaction: interactionSnapshot() })
        }))
        const authorHtml = snapshots.htmlAuthoring && context.instance.data && typeof context.instance.data === 'object' && !Array.isArray(context.instance.data) ? context.instance.data.html : undefined
        // Classify author syntax independently of editor target observation.
        const data = context.instance.data && typeof context.instance.data === 'object' && !Array.isArray(context.instance.data) ? context.instance.data : undefined
        const web = ['guoling.web', 'guoling.html-program'].includes(snapshots.builtinKey ?? '')
        const documentKind = web && typeof data?.html === 'string' ? htmlDocumentKind(data.html) : undefined
        const projected = await snapshots.instance?.(context.instance) ?? context.instance
        if (signal.aborted || !scope.isActive()) throw new Error('组件挂载已取消')
        const resources = snapshots.resources?.() ?? {}
        const html = documentKind === 'document' && context.root
          ? authoredDocumentBootstrap(projected.data as WebRuntimeData, { nonce, instanceId: context.instance.id, bridge, resources, themeCss: snapshots.themeCss?.(), resourceCss: typeof data?.css === 'string' ? data.css : undefined })
          : `<!doctype html><meta charset="utf-8"><style id="component-defaults">html,body,#component-root{width:100%;height:100%;margin:0}</style><div id="component-root"></div><script>${bridge().replace(/<\/script/gi, '<\\/script')}</script>`
        lease = bootstrapApi ? await bootstrapApi.createComponentBootstrap!({ leaseId, html, connectOrigins: [...(snapshots.connectOrigins?.() ?? [])],
          resourceSources: web && Array.isArray(data?.resourceSources) ? data.resourceSources as ComponentBootstrapInput['resourceSources'] : undefined,
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
        await ready; await request('prepare', { artifact })
        await request('mount', { instance: projected, generation: scope.generation, runScopeId: scope.runScopeId,
          visual: Boolean(context.root), state: snapshots.state(), targets: targetsFor(projected), teacher: teacherSnapshot(), htmlAuthoring: snapshots.htmlAuthoring,
          media: Boolean(mediaPort), interaction: interactionSnapshot(),
          layout: layoutPort?.read(),
          fragmentStateKey: componentFragmentStateKey(context.instance.id), themeCss: snapshots.themeCss?.(), resources: snapshots.resources?.(), resourceBindings: snapshots.resourceBindings,
          authorHtml, documentKind, builtinKey: snapshots.builtinKey, resourceCss: typeof data?.css === 'string' ? data.css : undefined })
        if (!scope.isActive()) throw new Error('组件挂载已取消')
        return { update: async instance => { authorInstance = instance; const projected = await snapshots.instance?.(instance) ?? instance; return request('update', { instance: projected, state: snapshots.state(), targets: targetsFor(projected), themeCss: snapshots.themeCss?.(), resources: snapshots.resources?.(), interaction: interactionSnapshot(),
            resourceCss: instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && typeof instance.data.css === 'string' ? instance.data.css : undefined,
            authorHtml: snapshots.htmlAuthoring && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data.html : undefined }) },
          updatePlacement: frame => {
            if (authorInstance) authorInstance = { ...authorInstance, frame }
            if (scope?.isActive()) void request('placement', { frame }).catch(() => {})
          },
          async dispose() { if (!disposed) { try { await request('dispose') } finally { release() } } },
        }
      },
    } }
  } catch (error) { release(); throw error }
}
