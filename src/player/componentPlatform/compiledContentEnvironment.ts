import type { ComponentRuntimeContext } from '../../shared/contracts/component-platform'
import { webResourceReferenceMarker } from '../../components/web/resources'
import { compiledLocalParentProperty, compiledNativeChildDiagnosticProperty, unsupportedJavascriptSubmitAttribute, type CompiledWebInitialization, type CompiledWebModuleActivation, type CompiledWebModuleProgram } from '../../core/publish/componentPlatform/compiledContract'
import { compiledPreparedImportOptionsProperty, compiledScopeActiveProperty, createPreparedJavaScriptImportOptionsValidator, createPreparedJavaScriptNativeImport } from '../../shared/browser/validatePreparedJavaScriptImportOptions'

export interface CompiledContentEnvironment {
  root: HTMLElement
  globals: Record<string, unknown>
  initialize(factories: readonly ((globals: Record<string, unknown>) => unknown)[], web?: CompiledWebInitialization): Promise<void>
  dispose(): void
}

type ClassicLexicalEntry = readonly [name: string, get: () => unknown, set: (value: unknown) => unknown]
type ClassicGlobalDescriptor = { configurable?: boolean; data?: boolean; writable?: boolean; enumerable?: boolean }
type ContentTimer =
  | { kind: 'timeout' | 'interval'; callback: () => void; delay: number; remaining: number; due: number; nativeId?: number; nativeKind?: 'timeout' | 'interval' }
  | { kind: 'raf'; callback: FrameRequestCallback; nativeId?: number }
  | { kind: 'task'; nativeId?: number }

/** Script declarations activate separately; actual JavaScript closures retain their lexical bindings. */
export function createCompiledClassicGlobals(base: Record<string, unknown>): Record<string, unknown> {
  const window = base.window as Record<string, unknown>, lexical = new Map<string, ClassicLexicalEntry>(), variables = new Set<string>()
  const descriptor = (name: string): ClassicGlobalDescriptor | undefined => {
    const native = (base.__classicGlobalDescriptor as ((name: string) => ClassicGlobalDescriptor | undefined) | undefined)?.(name)
    if (native) return native
    const own = Object.getOwnPropertyDescriptor(window, name)
    return own && { configurable: own.configurable, data: 'value' in own, writable: own.writable, enumerable: own.enumerable }
  }
  const helpers: Record<string, unknown> = {
    __classicWindow: window,
    __classicTypeof: (name: string) => lexical.has(name) ? typeof lexical.get(name)![1]() : typeof Reflect.get(base, name),
    __classicDelete: (name: string) => {
      if (lexical.has(name)) return false
      const deleted = Reflect.deleteProperty(window, name)
      if (deleted) variables.delete(name)
      return deleted
    },
    __setClassicFunction: (name: string, value: unknown) => {
      const own = Object.getOwnPropertyDescriptor(window, name)
      Object.defineProperty(window, name, !own || own.configurable
        ? { value, writable: true, enumerable: true, configurable: false } : { value })
    },
    __activateClassicDeclarations: (names: readonly string[], entries: readonly ClassicLexicalEntry[], functions: readonly string[], annexNames: readonly string[] = []) => {
      for (const name of names) {
        if (lexical.has(name)) throw new SyntaxError(`Identifier '${name}' has already been declared`)
        descriptor(name)
      }
      for (const [name] of entries)
        if (lexical.has(name) || variables.has(name) || descriptor(name)?.configurable === false)
          throw new SyntaxError(`Identifier '${name}' has already been declared`)
      for (const name of functions) {
        const own = descriptor(name)
        if (own && !own.configurable && (!own.data || !own.writable || !own.enumerable))
          throw new SyntaxError(`Identifier '${name}' cannot be declared as a global function`)
      }
      const aliases = new Set(annexNames.filter(name => !lexical.has(name) && !entries.some(entry => entry[0] === name)))
      for (const name of [...names, ...aliases]) {
        variables.add(name)
        descriptor(name)
        if (!Object.hasOwn(window, name)) Object.defineProperty(window, name, { value: undefined, writable: true, enumerable: true, configurable: false })
      }
      for (const entry of entries) lexical.set(entry[0], entry)
      return aliases
    },
  }
  return new Proxy(Object.create(null), {
    get(_target, name) {
      if (typeof name === 'string' && Object.hasOwn(helpers, name)) return helpers[name]
      if (typeof name === 'string' && lexical.has(name)) return lexical.get(name)![1]()
      const value = Reflect.get(base, name)
      if (value !== undefined || Reflect.has(base, name) || typeof name !== 'string') return value
      throw new ReferenceError(`${name} is not defined`)
    },
    set(_target, name, value) {
      if (typeof name === 'string' && lexical.has(name)) { lexical.get(name)![2](value); return true }
      return Reflect.set(base, name, value)
    },
  })
}

/** Change only the document-root pseudo class; native Shadow DOM owns all identifier/CSS isolation. */
function localRootSelectors(css: string): string {
  let result = '', quote = '', comment = false, bracket = 0
  for (let index = 0; index < css.length; index++) {
    const char = css[index], next = css[index + 1]
    if (comment) { result += char; if (char === '*' && next === '/') { result += next; index++; comment = false } continue }
    if (quote) { result += char; if (char === '\\' && next) { result += next; index++ } else if (char === quote) quote = ''; continue }
    if (char === '/' && next === '*') { result += char + next; index++; comment = true; continue }
    if (char === '"' || char === "'") { quote = char; result += char; continue }
    if (char === '[') bracket++
    if (char === ']') bracket--
    if (!bracket && css.slice(index, index + 5).toLowerCase() === ':root' && !/[\w-]/.test(css[index + 5] ?? '')) { result += 'html'; index += 4 }
    else result += char
  }
  return result
}

/** A local root adapter over real DOM nodes, not a new browser or a privileged workbench realm. */
export function createCompiledContentEnvironment(context: ComponentRuntimeContext, content?: { html: string; css: string; cssResourceBindings?: Readonly<Record<string, string>> }): CompiledContentEnvironment {
  const ownerDocument = context.root?.ownerDocument ?? document, browser = ownerDocument.defaultView!
  const host = ownerDocument.createElement('div')
  host.style.cssText = 'width:100%;height:100%;position:relative;isolation:isolate'
  context.root?.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const parsed = new browser.DOMParser().parseFromString(content?.html ?? '<html><head></head><body></body></html>', 'text/html')
  const html = ownerDocument.importNode(parsed.documentElement, true), head = html.querySelector('head')!, body = html.querySelector('body')!
  const baseStyle = ownerDocument.createElement('style')
  head.prepend(baseStyle)
  const style = ownerDocument.createElement('style'); style.textContent = content?.css ?? ''; head.append(style)
  for (const authoredStyle of html.querySelectorAll('style')) authoredStyle.textContent = localRootSelectors(authoredStyle.textContent ?? '')
  if (content?.cssResourceBindings) {
    const marker = webResourceReferenceMarker({ $text: style.textContent ?? '' }, content.cssResourceBindings, id => context.resources?.url(id))
    if (marker) {
      style.setAttribute('data-component-resource-bindings', marker)
      style.textContent = JSON.parse(marker).values.$text
    }
  }
  let disposed = false, initialized = false, readyState: DocumentReadyState = 'loading'
  let currentScript: HTMLScriptElement | null = null
  const classicScripts = new Map([...html.querySelectorAll<HTMLScriptElement>('script[data-guoling-compiled-script]')].map(script => [Number(script.dataset.guolingCompiledScript), script]))
  let finishInitializationTurn: (() => void) | undefined
  const pendingInitializationTasks = new Set<() => void>()
  const active = () => !disposed && context.scope.isActive()
  const preparedOptions = createPreparedJavaScriptImportOptionsValidator(browser, active, createPreparedJavaScriptNativeImport(browser.Function))
  const nativeResolutionIntrinsics = {URL:browser.URL,decodeURI}
  const projectLayout = (mode: ReturnType<NonNullable<ComponentRuntimeContext['layout']>['read']>['mode'] | undefined): void => {
    const natural = mode === 'flow-content'
    host.style.height = natural ? 'auto' : '100%'
    // Defaults come before authored styles; the existing layout port supplies the viewport/natural-height semantics.
    baseStyle.textContent = `html{width:100%;height:${natural ? 'auto' : '100%'};box-sizing:border-box}body{margin:0;height:${natural ? 'auto' : '100%'};min-height:${natural ? '0' : '100%'};box-sizing:border-box}`
  }
  projectLayout(context.layout?.read().mode)
  const releaseLayout = context.layout?.subscribe(layout => { if (active()) projectLayout(layout.mode) })
  const timers = new Map<number, ContentTimer>(), observers = new Set<{ disconnect(): void }>()
  let nextTimerId = 0, activityRunning = true
  const listeners: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; capture: boolean; wrapped: EventListener }> = []
  const properties = new Map<object, Map<string, { original: unknown; wrapped: unknown }>>()
  const documentEvents = new browser.EventTarget(), windowEvents = new browser.EventTarget()
  const values: Record<string, unknown> = Object.create(null), intrinsicNames = new Set<string>()
  let documentView: Record<string, unknown>, windowView: Record<string, unknown>
  const listen = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean, receiver?: unknown): void => {
    if (!active() || !listener) return
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    if (listeners.some(entry => entry.target === target && entry.type === type && entry.listener === listener && entry.capture === capture)) return
    const wrapped: EventListener = event => {
      if (!active()) return
      if (typeof options === 'object' && options.once) remove(target, type, listener, options)
      if (typeof listener === 'function') listener.call(receiver ?? target, event)
      else listener.handleEvent(event)
    }
    listeners.push({ target, type, listener, capture, wrapped }); target.addEventListener(type, wrapped, options)
  }
  const remove = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void => {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
    for (let index = listeners.length - 1; index >= 0; index--) {
      const entry = listeners[index]
      if (entry.target === target && entry.type === type && entry.listener === listener && entry.capture === capture) {
        entry.target.removeEventListener(entry.type, entry.wrapped, entry.capture); listeners.splice(index, 1)
      }
    }
  }
  const documentTarget = (type: string): EventTarget => ['DOMContentLoaded', 'readystatechange'].includes(type) ? documentEvents : shadow
  const windowTarget = (type: string): EventTarget => ['load', 'beforeunload', 'unload', 'pagehide', 'pageshow'].includes(type) ? windowEvents
    : ['resize', 'orientationchange'].includes(type) ? browser : shadow
  const eventProperty = (target: any, name: string, listener: unknown): unknown => {
    if (!target) return listener
    let entries = properties.get(target)
    if (!entries) { entries = new Map(); properties.set(target, entries) }
    const previous = entries.get(name)
    const wrapped = typeof listener === 'function' ? function(this: unknown, ...args: unknown[]) { if (active()) return Reflect.apply(listener, this, args) } : listener
    const original = previous ? previous.original : target[name]
    target[name] = wrapped; entries.set(name, { original, wrapped }); return listener
  }
  const eventMethod = (target: any, method: 'addEventListener' | 'removeEventListener') => {
    if (target === documentView || target === windowView) return (target[method] as Function).bind(target)
    if (!(target instanceof browser.EventTarget)) return target[method].bind(target)
    return (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) =>
      method === 'addEventListener' ? listen(target, type, listener, options) : remove(target, type, listener, options)
  }
  const guardedSubmit = (event: Event): void => {
    const form = event.target, submitter = (event as SubmitEvent).submitter
    if (form instanceof browser.HTMLFormElement && (submitter?.hasAttribute(unsupportedJavascriptSubmitAttribute)
      || form.hasAttribute(unsupportedJavascriptSubmitAttribute) && !submitter?.hasAttribute('formaction'))) event.preventDefault()
  }
  listen(shadow, 'submit', guardedSubmit, true)
  for (const form of html.querySelectorAll<HTMLFormElement>(`form[${unsupportedJavascriptSubmitAttribute}]`)) {
    const original = form.submit
    if (typeof original === 'function') Object.defineProperty(form, 'submit', { configurable: true, value() {
      if (active() && !form.hasAttribute(unsupportedJavascriptSubmitAttribute)) return original.call(form)
    } })
  }
  const cancelNativeTimer = (timer: ContentTimer): void => {
    if (timer.nativeId === undefined) return
    if (timer.kind === 'raf') browser.cancelAnimationFrame(timer.nativeId)
    else if (timer.kind !== 'task' && timer.nativeKind === 'interval') browser.clearInterval(timer.nativeId)
    else browser.clearTimeout(timer.nativeId)
    timer.nativeId = undefined
  }
  const clear = (id: number): void => {
    const timer = timers.get(id)
    if (timer) cancelNativeTimer(timer)
    timers.delete(id)
  }
  const arm = (id: number, timer: Exclude<ContentTimer, { kind: 'task' }>): void => {
    if (!activityRunning || !active()) return
    if (timer.kind === 'raf') {
      timer.nativeId = browser.requestAnimationFrame(time => {
        timer.nativeId = undefined; timers.delete(id)
        if (activityRunning && active()) Reflect.apply(timer.callback, undefined, [time])
      })
      return
    }
    timer.due = browser.performance.now() + timer.remaining
    timer.nativeKind = 'timeout'
    timer.nativeId = browser.setTimeout(() => {
      timer.nativeId = undefined
      if (!activityRunning || !active()) return
      if (timer.kind === 'timeout') timers.delete(id)
      else {
        const nextPeriod = (): void => {
          timer.remaining = timer.delay; timer.due = browser.performance.now() + timer.delay
        }
        nextPeriod()
        timer.nativeKind = 'interval'
        timer.nativeId = browser.setInterval(() => {
          nextPeriod()
          if (activityRunning && active()) timer.callback()
        }, timer.delay)
      }
      timer.callback()
    }, timer.remaining)
  }
  const functionTimer = (kind: 'timeout' | 'interval', handler: TimerHandler, delay?: number, ...args: unknown[]): number => {
    if (!active()) return 0
    if (typeof handler !== 'function') throw new TypeError('同文档程序的计时器需要函数回调')
    const id = ++nextTimerId, milliseconds = Math.max(0, Number(delay ?? 0) | 0)
    const timer: ContentTimer = { kind, callback: () => Reflect.apply(handler, windowView, args), delay: milliseconds, remaining: milliseconds, due: browser.performance.now() + milliseconds }
    timers.set(id, timer); arm(id, timer); return id
  }
  const timeout = (handler: TimerHandler, delay?: number, ...args: unknown[]): number => functionTimer('timeout', handler, delay, ...args)
  const interval = (handler: TimerHandler, delay?: number, ...args: unknown[]): number => functionTimer('interval', handler, delay, ...args)
  const raf = (handler: FrameRequestCallback): number => {
    if (!active()) return 0
    const id = ++nextTimerId, timer: ContentTimer = { kind: 'raf', callback: handler }
    timers.set(id, timer); arm(id, timer); return id
  }
  const releaseActivity = context.scope.events.subscribe?.('__runtime.activity', value => {
    if (!active() || !value || typeof value !== 'object' || Array.isArray(value)) return
    const running = value.active === true && value.visible === true && value.playing === true
    if (running === activityRunning) return
    activityRunning = running
    const now = browser.performance.now()
    for (const [id, timer] of timers) {
      if (timer.kind === 'task') continue
      if (running) arm(id, timer)
      else {
        if (timer.kind !== 'raf' && timer.nativeId !== undefined) timer.remaining = Math.max(0, timer.due - now)
        cancelNativeTimer(timer)
      }
    }
  })
  // Parser/defer startup owns these turns independently of playback activity.
  const ownedInitializationTask = (callback: () => void): void => {
    const id = ++nextTimerId, timer: ContentTimer = { kind: 'task' }
    timer.nativeId = browser.setTimeout(() => { timers.delete(id); callback() }, 0)
    timers.set(id, timer)
  }
  const initializationTurn = (): Promise<void> => new Promise(resolve => {
    finishInitializationTurn = resolve
    ownedInitializationTask(() => { finishInitializationTurn = undefined; resolve() })
  })
  const all = (selector: string) => shadow.querySelectorAll(localRootSelectors(selector))
  const byName = (tag: string) => html.getElementsByTagName(tag)
  const documentMethods: Record<string, unknown> = {
    querySelector: (selector: string) => shadow.querySelector(localRootSelectors(selector)), querySelectorAll: all,
    elementFromPoint: (x: number, y: number) => { const element = shadow.elementFromPoint(x, y); return element && shadow.contains(element) ? element : null },
    elementsFromPoint: (x: number, y: number) => shadow.elementsFromPoint(x, y).filter(element => shadow.contains(element)),
    getElementById: (id: string) => [...all('[id]')].find(element => element.id === id) ?? null,
    getElementsByClassName: (name: string) => html.getElementsByClassName(name), getElementsByTagName: byName,
    getElementsByName: (name: string) => [...all('[name]')].filter(element => element.getAttribute('name') === name),
    createElement: ownerDocument.createElement.bind(ownerDocument), createElementNS: ownerDocument.createElementNS.bind(ownerDocument),
    createTextNode: ownerDocument.createTextNode.bind(ownerDocument), createComment: ownerDocument.createComment.bind(ownerDocument),
    createDocumentFragment: ownerDocument.createDocumentFragment.bind(ownerDocument), createRange: ownerDocument.createRange.bind(ownerDocument),
    importNode: ownerDocument.importNode.bind(ownerDocument), adoptNode: ownerDocument.adoptNode.bind(ownerDocument),
    createEvent: ownerDocument.createEvent.bind(ownerDocument), createTreeWalker: ownerDocument.createTreeWalker.bind(ownerDocument),
    createNodeIterator: ownerDocument.createNodeIterator.bind(ownerDocument),
    hasFocus: () => ownerDocument.hasFocus() && Boolean(shadow.activeElement), getSelection: () => browser.getSelection(),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => listen(documentTarget(type), type, listener, options, documentView),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) => remove(documentTarget(type), type, listener, options),
    dispatchEvent: (event: Event) => documentTarget(event.type).dispatchEvent(event),
  }
  for (const name of ['write', 'writeln', 'open', 'close']) documentMethods[name] = () => { throw new Error(`同文档发布尚不能保真 document.${name}() 的解析器行为；源码已保留`) }
  documentView = new Proxy(documentMethods, {
    get(target, name) {
      if (name === 'documentElement') return html
      if (name === 'body') return body
      if (name === 'head') return head
      if (name === 'defaultView') return windowView
      if (name === 'readyState') return readyState
      if (name === 'currentScript') return currentScript
      if (name === 'activeElement') return shadow.activeElement ?? body
      if (name === 'forms') return byName('form')
      if (name === 'images') return byName('img')
      if (name === 'scripts') return byName('script')
      if (name === 'links') return all('a[href],area[href]')
      if (name === 'styleSheets') return [...all('style,link')].map(element => (element as HTMLStyleElement).sheet).filter(Boolean)
      if (name === 'title') return head.querySelector('title')?.textContent ?? ''
      if (name === 'URL' || name === 'documentURI' || name === 'baseURI') return ownerDocument.baseURI
      if (name === 'characterSet' || name === 'charset') return ownerDocument.characterSet
      if (name === 'compatMode') return 'CSS1Compat'
      if (name === 'nodeType') return 9
      if (name === 'nodeName') return '#document'
      if (typeof name === 'string' && /^on[a-z]+$/.test(name)) return values[`document:${name}`]
      return Reflect.get(target, name)
    },
    set(target, name, value) {
      if (typeof name === 'string' && /^on[a-z]+$/.test(name)) {
        const key = `document:${name}`, previous = values[key] as EventListener | undefined
        if (previous) remove(documentTarget(name.slice(2)), name.slice(2), previous)
        values[key] = value
        if (typeof value === 'function') listen(documentTarget(name.slice(2)), name.slice(2), value as EventListener, undefined, documentView)
        return true
      }
      if (name === 'title') { let title = head.querySelector('title'); if (!title) { title = ownerDocument.createElement('title'); head.append(title) } title.textContent = String(value); return true }
      return Reflect.set(target, name, value)
    },
  })
  // Supported language/DOM constructors retain browser semantics. No Electron, Node, login, or file port is projected.
  const standardNames = ('Object Array String Number Boolean BigInt Symbol Date RegExp Math JSON Promise Reflect Proxy Map Set WeakMap WeakSet WeakRef FinalizationRegistry Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array Atomics Intl URL URLSearchParams Blob File FileReader FormData Headers Request Response AbortController AbortSignal Event CustomEvent MouseEvent KeyboardEvent PointerEvent FocusEvent InputEvent SubmitEvent WheelEvent EventTarget Node Element HTMLElement HTMLInputElement HTMLButtonElement HTMLFormElement HTMLCanvasElement SVGElement SVGSVGElement Document DocumentFragment DOMParser XMLSerializer NodeFilter DOMException CSS CSSStyleSheet CSSStyleDeclaration DOMRect DOMPoint DOMMatrix Image Audio TextEncoder TextDecoder ReadableStream WritableStream TransformStream CompressionStream DecompressionStream MessageChannel MessagePort BroadcastChannel crypto performance console navigator location screen').split(' ')
  for (const name of standardNames) if (name in browser) values[name] = (browser as unknown as Record<string, unknown>)[name]
  const unsupportedDynamicProgram = (name: string) => function(): never {
    const message = `组件 ${context.instance.id} 的 ${name} 动态程序尚未完成同文档投影；原源码保留`
    if (active()) context.scope.events.emit('component.diagnostic', { message })
    throw new TypeError(message)
  }
  Object.assign(values, { document: documentView, undefined, NaN, Infinity, parseInt, parseFloat, isNaN, isFinite,
    [compiledPreparedImportOptionsProperty]: preparedOptions, [compiledScopeActiveProperty]: active,
    Function: unsupportedDynamicProgram('Function'), eval: unsupportedDynamicProgram('eval'),
    Worker: unsupportedDynamicProgram('Worker'), SharedWorker: unsupportedDynamicProgram('SharedWorker'),
    __unsupportedDynamicImport: (..._evaluatedArguments: unknown[]) => {
      const message = `组件 ${context.instance.id} 的动态 import() 运行时请求尚未闭合；原源码保留`
      if (active()) context.scope.events.emit('component.diagnostic', { message })
      return Promise.reject(new TypeError(message))
    },
    encodeURI, decodeURI, encodeURIComponent, decodeURIComponent, escape, unescape,
    setTimeout: timeout, clearTimeout: clear, setInterval: interval, clearInterval: clear,
    requestAnimationFrame: raf, cancelAnimationFrame: clear,
    getComputedStyle: browser.getComputedStyle.bind(browser), matchMedia: browser.matchMedia?.bind(browser),
    atob: browser.atob.bind(browser), btoa: browser.btoa.bind(browser), structuredClone: browser.structuredClone?.bind(browser),
    queueMicrotask: (callback: VoidFunction) => browser.queueMicrotask(() => { if (active()) callback() }),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => browser.fetch(input, { ...init, signal: init?.signal ?? context.scope.signal }),
    __eventMethod: eventMethod, __eventProperty: eventProperty,
    __classicNormalizeThis: (receiver: unknown) => receiver === browser ? windowView : receiver,
    __classicGlobalDescriptor: (name: string): ClassicGlobalDescriptor | undefined => {
      // Browser flags apply only to globals already projected by this environment, never the course shell's variables.
      if (!intrinsicNames.has(name)) return undefined
      const native = Object.getOwnPropertyDescriptor(browser, name)
      if (!native) return undefined
      const readOnly = 'value' in native ? !native.writable : typeof native.set !== 'function'
      const current = Object.getOwnPropertyDescriptor(values, name), localValue = Reflect.get(windowView, name)
      if (!native.configurable && readOnly && current?.configurable !== false)
        Object.defineProperty(values, name, { get: () => localValue, enumerable: native.enumerable, configurable: false })
      return { configurable: native.configurable, data: 'value' in native, writable: native.writable, enumerable: native.enumerable }
    },
    __submitMethod: (target: any, optionalAccess: boolean, optionalCall: boolean) => {
      if (optionalAccess && target == null) return undefined
      const method = target.submit
      if (optionalCall && method == null) return undefined
      return (...args: unknown[]) => {
        if (target instanceof browser.HTMLFormElement && target.hasAttribute(unsupportedJavascriptSubmitAttribute)) return undefined
        return Reflect.apply(method, target, args)
      }
    },
    __ownerDocument: (node: Node) => node?.ownerDocument === ownerDocument ? documentView : node?.ownerDocument,
    __nativeChild: (target: any) => {
      if (target instanceof browser.HTMLIFrameElement && target.getRootNode() === shadow && target.srcdoc.includes('data-guoling-native-parent-bridge')) {
        const child = target.contentWindow
        // The parent's synchronous factory can read the initial about:blank Window before the srcdoc parser starts.
        if (child && child.parent === browser) Object.defineProperty(child, 'parent', { value: windowView, writable: true, configurable: true })
      }
      return target
    },
  })
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver'] as const) {
    const Constructor = (browser as any)[name]
    if (Constructor) values[name] = class extends Constructor {
      constructor(callback: (...args: any[]) => void, options?: unknown) {
        super((...args: any[]) => { if (active()) callback(...args) }, options); observers.add(this as unknown as { disconnect(): void })
      }
    }
  }
  windowView = new Proxy(values, {
    get(target, name) {
      if (name === 'window' || name === 'self' || name === 'globalThis' || name === 'parent' || name === 'top') return windowView
      if (name === 'document') return documentView
      if (name === 'innerWidth' || name === 'outerWidth') return host.clientWidth
      if (name === 'innerHeight' || name === 'outerHeight') return host.clientHeight
      if (name === 'devicePixelRatio') return browser.devicePixelRatio
      if (name === 'closed') return disposed
      if (name === 'addEventListener') return (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => listen(windowTarget(type), type, listener, options, windowView)
      if (name === 'removeEventListener') return (type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) => remove(windowTarget(type), type, listener, options)
      if (name === 'dispatchEvent') return (event: Event) => windowTarget(event.type).dispatchEvent(event)
      if (Reflect.has(target, name)) return Reflect.get(target, name)
      if (typeof name === 'string') return (documentMethods.getElementById as (id: string) => Element | null)(name) ?? undefined
      return undefined
    },
    set(target, name, value) {
      if (typeof name === 'string' && /^on[a-z]+$/.test(name)) {
        const previous = Reflect.get(target, name)
        if (typeof previous === 'function') remove(windowTarget(name.slice(2)), name.slice(2), previous as EventListener)
        Reflect.set(target, name, value)
        if (typeof value === 'function') listen(windowTarget(name.slice(2)), name.slice(2), value as EventListener, undefined, windowView)
        return true
      }
      return Reflect.set(target, name, value)
    },
  })
  values.window = windowView; values.self = windowView; values.globalThis = windowView
  for (const name of [...Object.keys(values), 'parent', 'top', 'innerWidth', 'outerWidth', 'innerHeight', 'outerHeight', 'devicePixelRatio', 'closed']) intrinsicNames.add(name)
  // Authored srcdoc keeps its native child document; its parser prefix reads the same owning local parent.
  Object.defineProperty(host, compiledLocalParentProperty, { value: windowView })
  Object.defineProperty(host, compiledNativeChildDiagnosticProperty, { value: (documentPath: string, error: unknown) => {
    if (active()) context.scope.events.emit('component.diagnostic', { message: `组件 ${context.instance.id} 的 child[${documentPath}]：${String(error)}` })
  } })
  shadow.append(html)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    preparedOptions.dispose()
    finishInitializationTurn?.(); finishInitializationTurn = undefined
    for (const finish of pendingInitializationTasks) finish()
    pendingInitializationTasks.clear()
    releaseLayout?.()
    releaseActivity?.()
    for (const id of [...timers.keys()]) clear(id)
    for (const entry of listeners.splice(0)) entry.target.removeEventListener(entry.type, entry.wrapped, entry.capture)
    for (const [target, entries] of properties) for (const [name, entry] of entries)
      if ((target as any)[name] === entry.wrapped) (target as any)[name] = entry.original
    properties.clear()
    for (const observer of observers) observer.disconnect()
    observers.clear()
    for (const animation of html.getAnimations?.({ subtree: true }) ?? []) animation.cancel()
    host.remove()
  }
  const initializeEvent = (name: string, receiver: Record<string, unknown>): Event => {
    const event = new browser.Event(name)
    Object.defineProperties(event, { target: { value: receiver }, currentTarget: { value: receiver } })
    return event
  }
  return { root: body, globals: windowView,
    async initialize(factories, web) {
      if (initialized || !active()) return
      initialized = true
      try {
        const globals = web ? createCompiledClassicGlobals(windowView) : windowView
        const diagnose = (error: unknown, index?: number): void => {
          if (active()) context.scope.events.emit('component.diagnostic', { message: `组件 ${context.instance.id}${index === undefined ? '' : ` 的 script[${index}]`}：${String(error)}` })
        }
        const supervise = (result: unknown): void => {
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(diagnose)
        }
        const runClassic = (program: NonNullable<typeof web>['classicPrograms'][number]): void => {
          if (!active()) return
          const previousScript = currentScript
          currentScript = classicScripts.get(program.index) ?? null
          try { supervise(program.activate(globals)) } catch (error) { diagnose(error, program.index) }
          finally { currentScript = previousScript }
        }
        const modules: CompiledWebModuleActivation[] = []
        const runModule = (program: CompiledWebModuleActivation): Promise<void> => {
          if (!active()) return Promise.resolve()
          return new Promise(resolve => {
            const finish = (): void => { pendingInitializationTasks.delete(finish); resolve() }
            pendingInitializationTasks.add(finish)
            try { Promise.resolve(program.start(active).started).then(finish, error => { diagnose(error, program.index); finish() }) }
            catch (error) { diagnose(error, program.index); finish() }
          })
        }
        for (const handler of web?.handlerFactories ?? []) {
          if (!active()) return
          try { supervise(handler(globals)) } catch (error) { diagnose(error) }
        }
        for (const program of web?.classicPrograms ?? []) if (program.kind === 'blocking') runClassic(program)
        for (const factory of factories) {
          if (!active()) return
          if (web) {
            try {
              const program = factory(globals) as CompiledWebModuleProgram | undefined
              if (program?.entries) {
                program.configureRuntimeImport?.({assertActive:preparedOptions.assertActive,validate:preparedOptions.validate,
                  reject:values.__unsupportedDynamicImport as (specifier:unknown,options?:unknown)=>Promise<never>,native:nativeResolutionIntrinsics})
                modules.push(...program.entries); supervise(program.ready)
              }
              else supervise(program)
            } catch (error) { diagnose(error) }
          }
          else supervise(factory(globals))
        }
        if (!active()) return
        const classicPhase = Boolean(web)
        if (classicPhase) {
          readyState = 'interactive'; documentEvents.dispatchEvent(initializeEvent('readystatechange', documentView))
          const ordered = [
            ...web!.classicPrograms.filter(program => program.kind === 'defer').map(program => ({index:program.index,classic:program})),
            ...modules.filter(program => program.kind === 'defer').map(program => ({index:program.index,module:program})),
          ].sort((a,b) => a.index-b.index)
          for (const program of ordered) {
            if (!active()) return
            if ('classic' in program) runClassic(program.classic)
            else await runModule(program.module)
          }
        }
        if (!active()) return
        const asyncJobs = [
          ...(web?.classicPrograms ?? []).filter(program => program.kind === 'async').map(program => () => { runClassic(program); return Promise.resolve() }),
          ...modules.filter(program => program.kind === 'async').map(program => () => runModule(program)),
        ]
        const asyncTasks = asyncJobs.map(run => new Promise<void>(resolve => {
          const finish = (): void => { pendingInitializationTasks.delete(finish); resolve() }
          pendingInitializationTasks.add(finish)
          ownedInitializationTask(() => { void run().then(finish, error => { diagnose(error); finish() }) })
        }))
        // Entry startup is acknowledged separately; TLA completion stays independently supervised.
        await initializationTurn()
        if (!active()) return
        if (!classicPhase) { readyState = 'interactive'; documentEvents.dispatchEvent(initializeEvent('readystatechange', documentView)) }
        documentEvents.dispatchEvent(initializeEvent('DOMContentLoaded', documentView))
        // Only prepared software jobs delay load; author-created promises and module TLA remain independently supervised.
        await Promise.all(asyncTasks)
        await initializationTurn()
        if (!active()) return
        readyState = 'complete'; documentEvents.dispatchEvent(initializeEvent('readystatechange', documentView))
        windowEvents.dispatchEvent(initializeEvent('load', windowView))
      } catch (error) { dispose(); throw error }
    }, dispose }
}
