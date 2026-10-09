import type { ComponentRuntimeContext, ComponentInstance } from '../../shared/contracts/component-platform'
import type { WebRuntimeData } from './moduleGraph'
import { isMeasuredWebFragmentBox, measuredFragmentBoxStyle, measuredFragmentExtent } from './measuredFragmentBox'
import { webResourceReferenceMarker } from './resources'
import { DomTextOverrides, domTextOverrideRealmSource, type DomTextOverrideController } from '../../player/lightEdit/domTextOverrides'
import type { LightEditTextOverride } from '../../shared/contracts/runtime/lightEdit'

/** Serialized builtin runs in the content realm, including the author's scripts. */
export async function mountWebContent(context: ComponentRuntimeContext<WebRuntimeData> & { builtinKey?: string; resourceCss?: string }, fragmentBox = {
  isMeasured: isMeasuredWebFragmentBox, style: measuredFragmentBoxStyle, extent: measuredFragmentExtent,
  resourceMarker: webResourceReferenceMarker,
}, authoredDocument = false, textOverridesFactory: (roots: readonly Node[], rules: readonly LightEditTextOverride[]) => DomTextOverrideController =
  (roots, rules) => new DomTextOverrides(roots, rules)) {
  const { root, scope } = context
  if (!root) throw new Error('Web 内容需要视觉内容根')
  const textWindow = window as Window & { __cwPageTextOverrides?: DomTextOverrideController }
  const pageText = authoredDocument && textWindow.__cwPageTextOverrides
    ? textWindow.__cwPageTextOverrides : textOverridesFactory([root], context.instance.data.textOverrides ?? [])
  Object.defineProperty(textWindow, '__cwPageTextOverrides', { configurable: true, value: pageText })
  const documentRoot = root === document.body
  const containerStyle = root.style.cssText
  const attributes = (element: Element) => [...element.attributes].map(({ name, value, namespaceURI }) => ({ name, value, namespaceURI }))
  const replaceAttributes = (element: Element, values: ReturnType<typeof attributes>) => {
    for (const attribute of [...element.attributes]) element.removeAttributeNode(attribute)
    for (const attribute of values) {
      if (attribute.namespaceURI) element.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
      else element.setAttribute(attribute.name, attribute.value)
    }
  }
  const documentAttributes = documentRoot ? [document.documentElement, document.head, document.body].map(element => ({ element, values: attributes(element) })) : []
  let signature: string | undefined, instance = context.instance, disposed = false, rootStyle = authoredDocument ? root.style.cssText : '', renderRevision = 0, measuredContainer = false
  let releaseLayout = () => {}
  const urls = new Set<string>(), style = document.createElement('style'), headNodes: Node[] = [], cancelScripts = new Set<() => void>()
  document.head.append(style)
  const report = (message: string) => scope.events.emit('component.diagnostic', { instanceId: instance.id, message })
  const releaseUrls = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
  const clearHeadNodes = () => {
    for (const cancel of [...cancelScripts]) cancel()
    for (const node of headNodes) node.parentNode?.removeChild(node)
    headNodes.length = 0
  }
  const blob = (source: string) => { const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); urls.add(url); return url }
  const resolveResources = (source: string) => source.replace(/cw-resource:[a-zA-Z0-9_.-]+/g,
    reference => context.resources?.url(instance.data.resourceBindings?.[reference] ?? reference) ?? reference)
  const writeStyle = () => {
    style.textContent = resolveResources(context.resourceCss ?? instance.data.css ?? '')
    const marker = fragmentBox.resourceMarker({ $text: context.resourceCss ?? instance.data.css ?? '' }, instance.data.resourceBindings ?? {}, id => context.resources?.url(id))
    if (marker) style.setAttribute('data-component-resource-bindings', marker)
    else style.removeAttribute('data-component-resource-bindings')
    const restoreContainer = () => {
      if (measuredContainer) { root.style.cssText = containerStyle; measuredContainer = false }
    }
    const element = documentRoot ? root : root.firstElementChild as HTMLElement | null
    if (!element) { restoreContainer(); return }
    const rootMarker = element.getAttribute('data-component-resource-bindings')
    let authoredRootStyle = rootStyle
    if (rootMarker) {
      const marker = JSON.parse(rootMarker), template = marker.templates?.style
      if (typeof template === 'string') {
        const declared = document.createElement('span').style, previous = document.createElement('span').style, projected = document.createElement('span').style
        declared.cssText = template; previous.cssText = marker.values.style; projected.cssText = resolveResources(template)
        for (const property of Array.from(declared)) if (declared.getPropertyValue(property).includes('cw-resource:')
          && (element.style.getPropertyValue(property) !== previous.getPropertyValue(property) || element.style.getPropertyPriority(property) !== previous.getPropertyPriority(property)))
          projected.setProperty(property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property))
        authoredRootStyle = projected.cssText
      }
    }
    element.style.cssText = authoredRootStyle
    for (const [key, value] of Object.entries(instance.style ?? {})) {
      if (['transform', 'transformOrigin', 'position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'zIndex'].includes(key)) continue
      if (typeof value !== 'number' && typeof value !== 'string') continue
      const property = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
      element.style.setProperty(property, typeof value === 'number' && /^(font-size|letter-spacing|border.*width|border-radius|padding.*|margin.*|gap)$/.test(property) ? `${value}px` : String(value))
    }
    // The parser document and fragment carrier have distinct outer owners.
    const effectiveStyle = Object.fromEntries(Array.from({ length: element.style.length }, (_unused, index) => {
      const key = element.style.item(index)
      return [key, element.style.getPropertyValue(key)]
    }))
    if (fragmentBox.isMeasured(instance, documentRoot ? 'document' : 'fragment', effectiveStyle,
      context.builtinKey ? { implementation: { kind: 'builtin', key: context.builtinKey } } : undefined)) {
      element.style.cssText = ''
      const layout = context.layout?.read() ?? { mode: 'free-frame' as const, inlineSize: instance.frame!.width, blockSize: instance.frame!.height }
      for (const [key, value] of Object.entries(fragmentBox.style(effectiveStyle, layout, instance.style ?? {}))) element.style.setProperty(key, String(value))
      // Absolute retained decorations use the formal border-box origin, not the painted root's padding edge.
      measuredContainer = true
      root.style.position = 'relative'
      root.style.width = `${layout.inlineSize}px`
      root.style.height = layout.mode === 'flow-content' ? 'auto' : `${layout.blockSize}px`
    } else restoreContainer()
  }
  const render = async () => {
    if (disposed || !scope.isActive()) return
    pageText.setRules(instance.data.textOverrides ?? [])
    writeStyle()
    const nextSignature = JSON.stringify([instance.data.html, instance.data.modules, instance.data.moduleGraph])
    if (signature === nextSignature) return
    signature = nextSignature
    // This root belongs to the browser's authored document parser. Source changes
    // are new RuntimeHost generations; incremental style/data updates adopt it.
    if (authoredDocument) return
    const revision = ++renderRevision, current = () => !disposed && scope.isActive() && revision === renderRevision
    releaseUrls(); clearHeadNodes()
    const parsed = new DOMParser().parseFromString(instance.data.html, 'text/html')
    const scripts = [...parsed.querySelectorAll('script')].flatMap((script, index) => {
      const declared = script.getAttribute('type'), language = script.getAttribute('language')
      const type = (declared === null ? language ? `text/${language}` : 'text/javascript' : declared === '' ? 'text/javascript' : declared.trim()).toLowerCase()
      const module = type === 'module'
      // Follow the browser's script types; JSON and other data blocks remain readable DOM.
      const classic = /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type)
      if (!module && (!classic || script.noModule)) return []
      script.remove()
      return [{ source: script.textContent ?? '', url: script.getAttribute('src'), module, index,
        async: script.hasAttribute('async') && (module || script.hasAttribute('src') || script.hasAttribute('data-cw-async')),
        deferred: module || script.hasAttribute('data-cw-defer') || script.hasAttribute('src') && script.hasAttribute('defer') }]
    })
    const sourcePrograms = [...scripts.map(script => script.source), ...Object.values(instance.data.modules ?? {})]
    if (sourcePrograms.some(source => /\b(?:document|window)\s*\.\s*addEventListener\s*\(\s*['"](?:DOMContentLoaded|load)['"]|\bdocument\s*\.\s*(?:readyState|onreadystatechange)\b|\bwindow\s*\.\s*onload\b/.test(source)))
      report('HTML 初始加载事件已在内容装载前发生；DOMContentLoaded/load 等初始时序尚未等价运行，相关源码已保留')
    if (documentRoot) {
      replaceAttributes(document.documentElement, attributes(parsed.documentElement))
      replaceAttributes(document.head, attributes(parsed.head))
      replaceAttributes(document.body, attributes(parsed.body))
    }
    // Append only authored nodes; bridge styles and its loader retain their ownership.
    const authoredHead = documentRoot ? parsed.head.childNodes : parsed.head.querySelectorAll('script, style, link[rel~="stylesheet"]')
    for (const source of [...authoredHead]) {
      const node = document.importNode(source, true)
      headNodes.push(node); document.head.append(node)
    }
    document.head.append(style)
    root.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)))
    rootStyle = (documentRoot ? root : root.firstElementChild as HTMLElement | null)?.style.cssText ?? ''
    writeStyle()

    // One native graph per render. A module URL is shared by all of its importers,
    // while a source edit receives fresh specifiers instead of rebinding an old import map.
    const graph = instance.data.moduleGraph, moduleUrls = new Map<string, string>()
    if (graph) {
      const prefix = `guoling-module:${encodeURIComponent(instance.id)}/${revision}/`, imports: Record<string, string> = {}
      for (const [path, module] of Object.entries(graph.modules)) {
        let source = module.code
        for (const reference of [...module.imports].sort((a, b) => b.start - a.start)) {
          source = source.slice(0, reference.start) + JSON.stringify(prefix + reference.path) + source.slice(reference.end)
        }
        const url = blob(resolveResources(source))
        moduleUrls.set(path, url); imports[prefix + path] = url
      }
      const map = document.createElement('script')
      map.type = 'importmap'; map.textContent = JSON.stringify({ imports })
      headNodes.push(map); document.head.append(map)
    }
    const eventElements = documentRoot ? [document.documentElement, document.head, root, ...root.querySelectorAll<HTMLElement>('*')] : [...root.querySelectorAll<HTMLElement>('*')]
    for (const element of eventElements) for (const attribute of [...element.attributes]) {
      if (!/^on[a-z]+$/i.test(attribute.name)) continue
      const eventName = attribute.name.slice(2).toLowerCase()
      // Body's Window aliases have different targets/calling conventions. Do not
      // disguise them as ordinary element listeners or replay global ready events.
      if (documentRoot && [document.documentElement, document.head, root].includes(element) && ['load', 'readystatechange'].includes(eventName) || element === document.body
        && /^(?:afterprint|beforeprint|beforeunload|blur|error|focus|hashchange|languagechange|message|messageerror|offline|online|pagehide|pagereveal|pageshow|pageswap|popstate|rejectionhandled|resize|scroll|storage|unhandledrejection|unload)$/.test(eventName)) {
        element.removeAttribute(attribute.name)
        report(`${element.localName}.${attribute.name} 的窗口或初始加载语义尚未等价运行；原源码已保留`)
        continue
      }
      // Native attributes include the element and form environments in their
      // scope (for example `value` or a named form control). A module function
      // cannot reproduce that lookup. Rebind in the active content document.
      element.setAttribute(attribute.name, attribute.value)
    }
    const run = async (script: typeof scripts[number]) => {
      if (!current()) return
      const entry = graph?.entries[String(script.index)]
      const url = entry ? moduleUrls.get(entry) : script.url
      if (entry && !url) { report(`本地模块尚不可用：${entry}；原源码和其他内容已保留`); return }
      if (url && !/^(blob:|data:)/i.test(url)) { report(`程序脚本资源尚未闭合：${url}；其余内容继续运行`); return }
      const element = document.createElement('script')
      if (script.module) element.type = 'module'
      element.async = script.async
      element.src = url ?? blob(resolveResources(script.source))
      try { await new Promise<void>((resolve, reject) => {
        const abort = () => { finish(); reject(new Error('HTML 程序运行已取消')) }
        const scriptError = (event: ErrorEvent) => { if (event.filename === element.src) report(`HTML脚本错误：${event.message}；原源码已保留`) }
        const finish = () => { cancelScripts.delete(abort); scope.signal.removeEventListener('abort', abort); window.removeEventListener('error', scriptError); element.remove() }
        cancelScripts.add(abort)
        window.addEventListener('error', scriptError)
        scope.signal.addEventListener('abort', abort, { once: true })
        element.onload = () => { finish(); resolve() }
        element.onerror = () => { finish(); reject(new Error('HTML 程序脚本运行失败，原源码已保留')) }
        document.head.append(element)
      }) } catch (error) { if (current()) report(String(error)) }
    }
    const delayed: Array<typeof scripts[number]> = [], running: Promise<void>[] = []
    for (const script of scripts) {
      if (!current()) return
      if (script.async) running.push(run(script))
      else if (script.deferred) delayed.push(script)
      else await run(script)
    }
    // Queue ordered modules together. Native evaluation handles shared dependencies
    // and top-level await; awaiting each entry here would incorrectly serialize TLA.
    for (const script of delayed) running.push(run(script))
    await Promise.all(running)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true; renderRevision++; releaseLayout(); releaseUrls(); clearHeadNodes(); pageText.destroy(); style.remove(); root.replaceChildren()
    if (textWindow.__cwPageTextOverrides === pageText) Reflect.deleteProperty(textWindow, '__cwPageTextOverrides')
    if (measuredContainer) { root.style.cssText = containerStyle; measuredContainer = false }
    for (const { element, values } of documentAttributes) replaceAttributes(element, values)
  }
  scope.cleanup(dispose)
  await render()
  if (context.layout) {
    let queued = false
    const reportSize = () => {
      if (disposed || !scope.isActive()) return
      const layout = context.layout!.read()
      if (layout.mode !== 'flow-content') return
      const extent = fragmentBox.extent(root, { width: layout.inlineSize, height: 0 }, 'flow-content')
      context.layout!.reportSize({ inlineSize: layout.inlineSize, blockSize: extent.height })
    }
    const enqueue = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => { queued = false; reportSize() })
    }
    const off = context.layout.subscribe(() => {
      // Native documents react to their browser viewport. Replaying the initial
      // body style on resize would overwrite live authored program state.
      if (!authoredDocument) writeStyle()
      enqueue()
    })
    const observer = new MutationObserver(enqueue)
    observer.observe(root, { childList: true, attributes: true, characterData: true, subtree: true })
    const resize = new ResizeObserver(enqueue); resize.observe(root)
    root.addEventListener('load', enqueue, true); root.addEventListener('toggle', enqueue, true)
    releaseLayout = () => { off(); observer.disconnect(); resize.disconnect(); root.removeEventListener('load', enqueue, true); root.removeEventListener('toggle', enqueue, true) }
    scope.cleanup(releaseLayout)
    void document.fonts?.ready.then(enqueue)
    reportSize()
  }
  pageText.applyAll()
  scope.cleanup(() => pageText.destroy())
  return { async update(next: ComponentInstance<WebRuntimeData>) { instance = next; await render(); pageText.applyAll() },
    updatePlacement(frame: ComponentInstance['frame']) { instance = { ...instance, frame }; if (!authoredDocument) writeStyle() }, dispose }
}

/** A single content-realm source owner keeps imported box rules available after serialization/minification. */
export function webContentRealmSource(): string {
  return `${domTextOverrideRealmSource()}const fragmentBox={isMeasured:(${isMeasuredWebFragmentBox.toString()}),style:(${measuredFragmentBoxStyle.toString()}),extent:(${measuredFragmentExtent.toString()}),resourceMarker:(${webResourceReferenceMarker.toString()})};
const mount=(${mountWebContent.toString()});export default {mount(context){return mount(context,fragmentBox,context.authoredDocument===true,createPageTextOverrides)}}`
}
