import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { WebModuleGraph, WebRuntimeData } from './moduleGraph'
import { webModuleGraphForDocument, publishedWebInitializationBinding, publishedWebInitializationExport, publishedWebImportOptionsOperation, publishedWebRuntimeImportPreparation, webModuleResolverSource, type WebModuleResolutionContext } from './moduleGraph'
import { webResourceReferenceMarker, resolveWebJavaScriptResources, projectWebModuleUrls, refreshWebResourceReferences } from './resources'
import { domTextOverrideRealmSource, type DomTextOverrideController } from '../../player/lightEdit/domTextOverrides'
import type { LightEditTextOverride } from '../../shared/contracts/runtime/lightEdit'
import { splitInstalledBundledFontFaceCss } from '../../shared/fonts/installedBundledFontFaceCss'
import { createPreparedJavaScriptImportOptionsValidator, preparedJavaScriptNativeImportBody } from '../../shared/browser/validatePreparedJavaScriptImportOptions'
import { projectPublishedNativeImportOptions } from '../../core/publish/componentPlatform/compiledScript'
import { createDomAuthoring } from './authoringDom'
import { installOwnedDocumentAuthoring } from './ownedDocumentAuthoring'
import { ownedDocumentKeyAttribute } from './ownedDocumentIdentity'
import { createBrowserUuid } from '../../shared/browser/createBrowserUuid'
import { createWebResourceUrlLease, webRuntimeResourceAddress } from './resourceUrlLease'
import { createLocalStageLayout } from './localStageLayout'

export interface AuthoredDocumentPrograms {
  graph?: WebModuleGraph
  prefix: string
  property: string
  moduleProperty?: string
  classic: Record<string, string>
  resources: Record<string, string>
  resourceBindings?: Readonly<Record<string, string>>
  textOverrides?: readonly LightEditTextOverride[]
  published?: { code: string; helper: string; contexts?: Readonly<Record<string, WebModuleResolutionContext>> }
  transportFragment?: boolean
}

/** Explicit function inputs keep the serialized parser bootstrap self-contained. */
export function authoredDocumentProgramsSource(input: AuthoredDocumentPrograms): string {
  return `(${installAuthoredDocumentPrograms.toString()})(${JSON.stringify(input)},${input.published ? `{options:(${createPreparedJavaScriptImportOptionsValidator.toString()}),resolver:(${webModuleResolverSource()}),nativeImport:function(url,options){${preparedJavaScriptNativeImportBody}}}` : 'undefined'},${createWebResourceUrlLease.toString()},${createLocalStageLayout.toString()})`
}

/** Runs synchronously in the child's parser, before any authored script. */
export function installAuthoredDocumentPrograms(input: AuthoredDocumentPrograms, ports?: {
  options: typeof createPreparedJavaScriptImportOptionsValidator
  resolver: (native: { URL: typeof URL; decodeURI: typeof decodeURI }) => (specifier: string, importer: string, dynamic?: boolean, context?: WebModuleResolutionContext) => string | undefined
  nativeImport(url: string, options: unknown): Promise<unknown>
}, resourceFactory = createWebResourceUrlLease, layoutFactory = createLocalStageLayout) {
  const native = window, originalDocument = document, NativePromise = native.Promise, NativeTypeError = native.TypeError
  const resourceLease = resourceFactory(native)
  resourceLease.update(input.resources)
  const createUrl = native.URL.createObjectURL.bind(native.URL), revokeUrl = native.URL.revokeObjectURL.bind(native.URL), NativeBlob = native.Blob
  const urls: string[] = []
  let stageLayout: ReturnType<typeof createLocalStageLayout> | undefined
  const installLayout = () => {
    if (!ended && native.document === originalDocument && originalDocument.body)
      stageLayout = layoutFactory(originalDocument.body, { active: () => !ended && native.document === originalDocument })
  }
  originalDocument.addEventListener('DOMContentLoaded', installLayout, { once: true })
  const blob = (source: string) => {
    const url = createUrl(new NativeBlob([source], { type: 'text/javascript' }))
    urls.push(url); return url
  }
  const imports: Record<string, string> = {}
  for (const [path, module] of Object.entries(input.graph?.modules ?? {})) {
    let source = module.code
    for (const reference of [...module.imports].sort((a, b) => b.start - a.start))
      source = source.slice(0, reference.start) + JSON.stringify(input.prefix + reference.path) + source.slice(reference.end)
    imports[input.prefix + path] = blob(resourceLease.project(source))
  }
  const classic = Object.fromEntries(Object.entries(input.classic).map(([index, source]) => [index, blob(resourceLease.project(source))]))
  const moduleUrls = Object.fromEntries(Object.keys(input.graph?.modules ?? {}).map(path => [path, imports[input.prefix + path]]))
  let ended = false, diagnostic: ((message: string) => void) | undefined
  const pendingDiagnostics: string[] = []
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (diagnostic) diagnostic(message); else pendingDiagnostics.push(message)
  }
  let validator: ReturnType<typeof createPreparedJavaScriptImportOptionsValidator> | undefined, publishedUrl: string | undefined
  if (input.published && ports) {
    validator = ports.options(native, () => !ended && native.document === originalDocument, ports.nativeImport)
    const resolver = ports.resolver({ URL: native.URL, decodeURI: native.decodeURI })
    const runtime = { ...validator, report, resolve: (specifier: string, key: string) => {
      const context = input.published!.contexts?.[key]
      return context ? resolver(specifier, context.importer, false, context) : undefined
    }, reject: () => {
      const error = new NativeTypeError('动态 import() 运行时请求尚未闭合；原源码保留')
      report(error); return NativePromise.reject(error)
    } }
    Object.defineProperty(native, input.published.helper, { configurable: true, value: runtime })
    publishedUrl = blob(resourceLease.project(input.published.code))
    imports[input.prefix + '__published__'] = publishedUrl
  }
  // Chrome 94 accepts one import map per document. The graph and its published
  // initialization entry share that map before any module is requested.
  if (Object.keys(imports).length) {
    const map = document.createElement('script'); map.type = 'importmap'
    map.textContent = JSON.stringify({ imports }); document.head.append(map)
  }
  if (input.moduleProperty) Object.defineProperty(window, input.moduleProperty, { configurable: true, value: moduleUrls })
  Object.defineProperty(window, input.property, { configurable: true, value: { ...classic, moduleUrls, publishedUrl, project: resourceLease.project, resourceLease } })
  const release = () => {
    ended = true; validator?.dispose()
    stageLayout?.dispose(); originalDocument.removeEventListener('DOMContentLoaded', installLayout)
    resourceLease.release()
    for (const url of urls.splice(0)) revokeUrl(url)
    if (input.published) Reflect.deleteProperty(native, input.published.helper)
    if (input.moduleProperty && (window as unknown as Record<string, unknown>)[input.moduleProperty] === moduleUrls) Reflect.deleteProperty(window, input.moduleProperty)
    Reflect.deleteProperty(window, input.property); window.removeEventListener('pagehide', release)
  }
  window.addEventListener('pagehide', release, { once: true })
  return { release, resourceLease, transportFragment: input.transportFragment,
    setActivity(value: { active: boolean; visible: boolean; playing: boolean }) {
      if (!ended) window.dispatchEvent(new CustomEvent('__runtime.activity', { detail: { ...value } }))
    }, onDiagnostic(listener: (message: string) => void) {
    diagnostic = listener
    for (const message of pendingDiagnostics.splice(0)) listener(message)
    return () => { if (diagnostic === listener) diagnostic = undefined }
  } }
}

/** Source edits only wrap existing programs. The browser still parses and loads the document. */
export function authoredDocumentBootstrap(data: WebRuntimeData, options: {
  nonce: string
  instanceId: string
  bridge(programs: AuthoredDocumentPrograms): string
  resources: Record<string, string>
  themeCss?: string
  resourceCss?: string
  /** Internal projection of child documents inside a fragment carrier. */
  nestedOnly?: boolean
  documentPath?: string
  /** Author identity is independent from positional module-compilation paths. */
  authoringPath?: string
  authoringPendingPath?: string
  /** One ephemeral key set per loaded generation; ordinary updates reuse it. */
  pendingDocumentKeys?: Record<string, string>
  transportFragment?: boolean
}): string {
  const source = data.html, parsed = parse(source, { sourceCodeLocationInfo: true })
  const documentPath = options.documentPath ?? ''
  const authoringPath = options.authoringPath ?? ''
  const authoringPendingPath = options.authoringPendingPath ?? ''
  const prefix = `guoling-module:${encodeURIComponent(options.instanceId)}/${options.nonce}/${documentPath ? `${documentPath}/` : ''}`
  const property = `__guoling_parser_${options.nonce.replace(/-/g, '_')}`
  const programs: AuthoredDocumentPrograms = { graph: webModuleGraphForDocument(data.moduleGraph, documentPath), prefix, property, classic: {},
    moduleProperty: `__guoling_module_urls_${encodeURIComponent(options.instanceId)}`,
    resources: options.resources, resourceBindings: data.resourceBindings, textOverrides: data.textOverrides, transportFragment: options.transportFragment }
  const bundle = documentPath ? data.publishedDocumentBundles?.[documentPath] : data.publishedModuleBundle
  const binding = bundle && publishedWebInitializationBinding(bundle)
  if (bundle && binding) {
    let helper = `__guoling_native_imports_${options.nonce.replace(/[^a-zA-Z0-9_$]/g, '_')}`
    while ((data.html + bundle).includes(helper)) helper += '_'
    const runtime = publishedWebRuntimeImportPreparation(data, documentPath)
    const projected = projectPublishedNativeImportOptions(bundle, publishedWebImportOptionsOperation(data, documentPath), helper)
    programs.published = { helper, contexts: runtime?.contexts, code: `${projected}\n${runtime ? `${binding}.configureRuntimeImport(${helper});` : ''}\n${binding}.ready.catch(${helper}.report);` }
  }
  const edits: Array<{ start: number; end: number; value: string }> = []
  const ownedKeys = new Map<string, number>()
  const countOwnedKeys = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const key = node.attrs.find(attribute => attribute.name === ownedDocumentKeyAttribute)?.value
      if (key) ownedKeys.set(key, (ownedKeys.get(key) ?? 0) + 1)
    }
    if ('childNodes' in node) node.childNodes.forEach(countOwnedKeys)
  }
  countOwnedKeys(parsed)
  let index = 0, iframeIndex = 0
  const quote = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const current = iframeIndex++, srcdoc = node.attrs.find(attribute => attribute.name === 'srcdoc')
      const location = node.sourceCodeLocation?.attrs?.srcdoc
      if (srcdoc && location) {
        const childPath = documentPath ? `${documentPath}/${current}` : String(current)
        const key = node.attrs.find(attribute => attribute.name === ownedDocumentKeyAttribute)?.value || undefined
        const pendingKeys = options.pendingDocumentKeys
        const pendingKey = () => pendingKeys ? pendingKeys[childPath] ??= createBrowserUuid() : createBrowserUuid()
        const softwareKey = key ?? pendingKey()
        const authorSegment = key ? (ownedKeys.get(key) === 1 ? `key:${encodeURIComponent(key)}` : `ambiguous:${encodeURIComponent(key)}:${pendingKey()}`)
          : `pending:${current}:${encodeURIComponent(softwareKey)}`
        const childAuthoringPath = authoringPath ? `${authoringPath}/${authorSegment}` : authorSegment
        const pendingSegment = `pending:${current}:${encodeURIComponent(softwareKey)}`
        const childPendingPath = authoringPendingPath ? `${authoringPendingPath}/${pendingSegment}` : pendingSegment
        const child = authoredDocumentBootstrap({ ...data, html: srcdoc.value, css: undefined }, {
          ...options, nestedOnly: false, documentPath: childPath, authoringPath: childAuthoringPath, authoringPendingPath: childPendingPath, resourceCss: undefined,
          bridge: authoredDocumentProgramsSource,
        })
        // The outer parser decodes this attribute before the child's parser
        // starts. Its resource addresses must stay unprojected until then.
        edits.push({ start: location.startOffset, end: location.endOffset, value: `srcdoc="${quote(child).replace(/guoling-resource:/g, 'guoling&#45;resource:')}"` })
      }
    }
    if ('tagName' in node && node.tagName === 'script' && !options.nestedOnly) {
      const current = index++, location = node.sourceCodeLocation
      if (location?.startTag) {
        const attrs = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]))
        const type = (attrs.type ?? (attrs.language ? `text/${attrs.language}` : 'text/javascript')).trim().toLowerCase()
        if (type === 'importmap' && (programs.published || programs.graph)) {
          edits.push({ start: location.startOffset, end: location.endOffset, value: '' })
          return
        }
        const classic = type === '' || /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type)
        const entry = data.moduleGraph?.entries[documentPath ? `${documentPath}:${current}` : String(current)]
        const start = location.startTag.endOffset, end = location.endTag?.startOffset ?? location.endOffset
        if (entry && attrs.type?.trim().toLowerCase() === 'module') {
          if (location.attrs?.src) edits.push({ start: location.attrs.src.startOffset, end: location.attrs.src.endOffset, value: '' })
          const activation = programs.published
            ? `import {${publishedWebInitializationExport} as program} from ${JSON.stringify(prefix + '__published__')};program.entries.find(entry=>entry.index===${current})?.start(()=>{${programs.published.helper}.assertActive();return true});`
            : `import ${JSON.stringify(prefix + entry)};`
          edits.push({ start, end, value: activation })
        } else if (classic && (Object.hasOwn(attrs, 'data-cw-defer') || Object.hasOwn(attrs, 'data-cw-async') || Object.hasOwn(attrs, 'data-guoling-classic-source'))) {
          // Resource closure retained external classic source inline. Recreate a
          // parser-inserted external script so native defer/async and DCL apply.
          programs.classic[String(current)] = Object.hasOwn(attrs, 'data-guoling-classic-source') ? JSON.parse(attrs['data-guoling-classic-source']) : source.slice(start, end)
          const retained = node.attrs.filter(attribute => !['src', 'data-cw-defer', 'data-cw-async', 'data-guoling-classic-source'].includes(attribute.name))
            .map(attribute => ` ${attribute.name}="${quote(attribute.value)}"`).join('')
          const opening = `<script${retained}${Object.hasOwn(attrs, 'data-cw-defer') && !Object.hasOwn(attrs, 'defer') ? ' defer' : ''}${Object.hasOwn(attrs, 'data-cw-async') && !Object.hasOwn(attrs, 'async') ? ' async' : ''} src="`
          const writer = `document.write(${JSON.stringify(opening)}+window[${JSON.stringify(property)}][${JSON.stringify(String(current))}]+${JSON.stringify('"></script>')})`
          edits.push({ start: location.startOffset, end: location.endOffset, value: `<script>${writer.replace(/<\/script/gi, '<\\/script')}</script>` })
        }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parsed)
  const resolve = (reference: string) => {
    const id = data.resourceBindings?.[reference] ?? reference
    return options.resources[id] ? webRuntimeResourceAddress(id) : undefined
  }
  for (const [index, source] of Object.entries(programs.classic)) programs.classic[index] = resolveWebJavaScriptResources(source, resolve)
  if (programs.graph) programs.graph = { ...programs.graph, modules: Object.fromEntries(Object.entries(programs.graph.modules).map(([path, module]) => {
    let code = module.code
    for (const reference of [...module.imports].sort((a, b) => b.start - a.start)) code = code.slice(0, reference.start) + JSON.stringify(prefix + reference.path) + code.slice(reference.end)
    return [path, { code: projectWebModuleUrls(resolveWebJavaScriptResources(code, resolve, true), `globalThis[${JSON.stringify(programs.moduleProperty)}]`), imports: [] }]
  })) }
  if (programs.published) programs.published.code = projectWebModuleUrls(resolveWebJavaScriptResources(programs.published.code, resolve, true), `globalThis[${JSON.stringify(programs.moduleProperty)}]`)
  const doctype = parsed.childNodes.find(node => node.nodeName === '#documentType')
  const html = parsed.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'html')
  const head = html?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'head')
  // Inserting before an authored head creates an implicit head and makes the
  // parser ignore its later start tag, including the author's attributes.
  const insertion = head?.sourceCodeLocation?.startTag?.endOffset
    ?? html?.sourceCodeLocation?.startTag?.endOffset
    ?? doctype?.sourceCodeLocation?.endOffset ?? 0
  const marker = webResourceReferenceMarker({ $text: options.resourceCss ?? data.css ?? '' }, data.resourceBindings ?? {}, id => options.resources[id] ? webRuntimeResourceAddress(id) : undefined)
  const fonts = splitInstalledBundledFontFaceCss(options.themeCss ?? '')
  const style = [fonts.faces ? `<style data-component-bundled-faces>${fonts.faces.replace(/<\/style/gi, '<\\/style')}</style>` : '',
    fonts.theme ? `<style data-component-initial-theme>${fonts.theme.replace(/<\/style/gi, '<\\/style')}</style>` : '', data.css ? `<style${marker ? ` data-component-resource-bindings="${quote(marker)}"` : ''}>${data.css.replace(/<\/style/gi, '<\\/style')}</style>` : ''].join('')
  const textBootstrap = `${domTextOverrideRealmSource()}(${installParsedPageTextOverrides.toString()})(${JSON.stringify(programs.textOverrides ?? [])},${JSON.stringify(property)},createPageTextOverrides);(${installOwnedDocumentBridge.toString()})(${JSON.stringify(property)},${Boolean(documentPath)},${refreshWebResourceReferences.toString()});${documentPath ? `(${installOwnedDocumentAuthoring.toString()})(${JSON.stringify(property)},${JSON.stringify(authoringPath)},${createDomAuthoring.toString()},{pendingPath:${JSON.stringify(authoringPath.includes('ambiguous:') ? undefined : authoringPendingPath)},refreshResources:${refreshWebResourceReferences.toString()},resolveResource:(reference,bindings)=>window[${JSON.stringify(property)}]?.resourceLease?.resolve(reference,bindings),matchesResource:(reference,liveUrl,bindings)=>window[${JSON.stringify(property)}]?.resourceLease?.matches(reference,liveUrl,bindings)??false,runtimeResources:resources=>{const lease=window[${JSON.stringify(property)}]?.resourceLease;return lease?(Object.keys(resources).length?lease.update(resources):lease.urls):resources}});` : ''}`
  const bootstrap = `<meta charset="utf-8"><script>${(textBootstrap + options.bridge(programs)
    + `;document.write(window[${JSON.stringify(property)}].project(${JSON.stringify(style)}));`).replace(/<\/script/gi, '<\\/script')}</script>`
  // The opaque document first obtains its own short URLs, then the native
  // parser consumes the original remaining markup in the same script order.
  // No base64 image payload is copied into attributes, markers or programs.
  const boundary = `<!--guoling-parser-${options.nonce}-${documentPath}-->`
  if (!options.nestedOnly) edits.push({ start: insertion, end: insertion, value: bootstrap + boundary })
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  if (options.nestedOnly) return result
  const at = result.indexOf(boundary), tail = result.slice(at + boundary.length)
  const write = `document.write(window[${JSON.stringify(property)}].project(${JSON.stringify(tail)}))`
  return result.slice(0, at) + `<script>${write.replace(/<\/script/gi, '<\\/script')}</script>`
}

/** Messages remain between owned srcdoc realms; authors keep their parser and state. */
export function installOwnedDocumentBridge(token: string, nested: boolean, refresh: typeof refreshWebResourceReferences) {
  let activity: { active: boolean; visible: boolean; playing: boolean } | undefined
  const activitySnapshot = () => activity && { ...activity }
  Object.defineProperty(window, '__guolingRuntimeActivity', { configurable: true, get: activitySnapshot })
  const postActivity = (frame: HTMLIFrameElement) => {
    if (activity) frame.contentWindow?.postMessage({ type: 'guoling.runtime.activity', token, value: activitySnapshot() }, '*')
  }
  const activityEvent = (event: Event) => {
    const value = (event as CustomEvent).detail
    if (!value || typeof value.active !== 'boolean' || typeof value.visible !== 'boolean' || typeof value.playing !== 'boolean') return
    activity = { active: value.active, visible: value.visible, playing: value.playing }
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')) postActivity(frame)
  }
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLIFrameElement && event.target.hasAttribute('srcdoc')) postActivity(event.target)
  }
  const receive = (event: MessageEvent) => {
    const data = event.data
    if (event.source === parent && data?.type === 'guoling.runtime.activity' && data.token === token) {
      window.dispatchEvent(new CustomEvent('__runtime.activity', { detail: data.value }))
    } else if (event.source === parent && data?.type === 'guoling.resources.refresh' && data.token === token && data.resources) {
      const lease = (window as unknown as Record<string, { resourceLease?: ReturnType<typeof createWebResourceUrlLease> }>)[token]?.resourceLease
      refresh(document, lease?.update(data.resources) ?? data.resources)
      for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')) frame.contentWindow?.postMessage(data, '*')
    } else if (nested && data?.type === 'guoling.owned-document.click' && data.token === token
      && [...document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]')].some(frame => frame.contentWindow === event.source)) parent.postMessage(data, '*')
  }
  const click = () => parent.postMessage({ type: 'guoling.owned-document.click', token }, '*')
  const release = () => {
    window.removeEventListener('message', receive)
    window.removeEventListener('__runtime.activity', activityEvent)
    window.removeEventListener('load', loaded, true)
    if (Object.getOwnPropertyDescriptor(window, '__guolingRuntimeActivity')?.get === activitySnapshot)
      Reflect.deleteProperty(window, '__guolingRuntimeActivity')
    document.removeEventListener('click', click, true)
    window.removeEventListener('pagehide', release)
  }
  window.addEventListener('message', receive)
  window.addEventListener('__runtime.activity', activityEvent)
  window.addEventListener('load', loaded, true)
  if (nested) document.addEventListener('click', click, true)
  window.addEventListener('pagehide', release, { once: true })
}

/** Each owned parser document uses its own observer and receives only its parent's rule updates. */
export function installParsedPageTextOverrides(rules: readonly LightEditTextOverride[], token: string,
  factory: (roots: readonly Node[], rules: readonly LightEditTextOverride[]) => DomTextOverrideController) {
  const owner = factory([document.documentElement], rules)
  const cascade = (next: readonly LightEditTextOverride[]) => {
    rules = next
    owner.setRules(next)
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]'))
      frame.contentWindow?.postMessage({ type: 'guoling.page-copy.update', token, rules: next }, '*')
  }
  const receive = (event: MessageEvent) => {
    if (event.source === parent && event.data?.type === 'guoling.page-copy.update' && event.data.token === token
      && Array.isArray(event.data.rules)) cascade(event.data.rules)
  }
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLIFrameElement && event.target.hasAttribute('srcdoc'))
      event.target.contentWindow?.postMessage({ type: 'guoling.page-copy.update', token, rules }, '*')
  }
  const consumer: DomTextOverrideController = { setRules: cascade, applyAll: () => owner.applyAll(), samples: () => owner.samples(),
    originalText: node => owner.originalText(node), setLocalText: (node, text) => owner.setLocalText(node, text),
    destroy() { owner.destroy(); window.removeEventListener('message', receive); window.removeEventListener('load', loaded, true) } }
  Object.defineProperty(window, '__cwPageTextOverrides', { configurable: true, value: consumer })
  window.addEventListener('message', receive)
  window.addEventListener('load', loaded, true)
  window.addEventListener('pagehide', () => consumer.destroy(), { once: true })
  owner.applyAll()
}
