import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { WebModuleGraph, WebRuntimeData } from './moduleGraph'
import { webResourceReferenceMarker } from './resources'
import { domTextOverrideRealmSource, type DomTextOverrideController } from '../../player/lightEdit/domTextOverrides'
import type { LightEditTextOverride } from '../../shared/contracts/runtime/lightEdit'

export interface AuthoredDocumentPrograms {
  graph?: WebModuleGraph
  prefix: string
  property: string
  classic: Record<string, string>
  resources: Record<string, string>
  resourceBindings?: Readonly<Record<string, string>>
  textOverrides?: readonly LightEditTextOverride[]
}

/** Runs synchronously in the child's parser, before any authored script. */
export function installAuthoredDocumentPrograms(input: AuthoredDocumentPrograms) {
  const urls: string[] = []
  const resource = (source: string) => source.replace(/cw-resource:[a-zA-Z0-9_.-]+/g,
    reference => input.resources[input.resourceBindings?.[reference] ?? reference] ?? reference)
  const blob = (source: string) => {
    const url = URL.createObjectURL(new Blob([resource(source)], { type: 'text/javascript' }))
    urls.push(url); return url
  }
  const imports: Record<string, string> = {}
  for (const [path, module] of Object.entries(input.graph?.modules ?? {})) {
    let source = module.code
    for (const reference of [...module.imports].sort((a, b) => b.start - a.start))
      source = source.slice(0, reference.start) + JSON.stringify(input.prefix + reference.path) + source.slice(reference.end)
    imports[input.prefix + path] = blob(source)
  }
  if (Object.keys(imports).length) {
    const map = document.createElement('script'); map.type = 'importmap'
    map.textContent = JSON.stringify({ imports }); document.head.append(map)
  }
  const classic = Object.fromEntries(Object.entries(input.classic).map(([index, source]) => [index, blob(source)]))
  Object.defineProperty(window, input.property, { configurable: true, value: classic })
  const release = () => {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url)
    Reflect.deleteProperty(window, input.property); window.removeEventListener('pagehide', release)
  }
  window.addEventListener('pagehide', release, { once: true })
  return { release }
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
}): string {
  const source = data.html, parsed = parse(source, { sourceCodeLocationInfo: true })
  const documentPath = options.documentPath ?? ''
  const prefix = `guoling-module:${encodeURIComponent(options.instanceId)}/${options.nonce}/${documentPath ? `${documentPath}/` : ''}`
  const property = `__guoling_parser_${options.nonce.replace(/-/g, '_')}`
  const programs: AuthoredDocumentPrograms = { graph: data.moduleGraph, prefix, property, classic: {},
    resources: options.resources, resourceBindings: data.resourceBindings, textOverrides: data.textOverrides }
  const edits: Array<{ start: number; end: number; value: string }> = []
  let index = 0, iframeIndex = 0
  const quote = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const current = iframeIndex++, srcdoc = node.attrs.find(attribute => attribute.name === 'srcdoc')
      const location = node.sourceCodeLocation?.attrs?.srcdoc
      if (srcdoc && location) {
        const childPath = documentPath ? `${documentPath}/${current}` : String(current)
        const child = authoredDocumentBootstrap({ ...data, html: srcdoc.value, css: undefined }, {
          ...options, nestedOnly: false, documentPath: childPath, themeCss: undefined, resourceCss: undefined,
          bridge: programs => `(${installAuthoredDocumentPrograms.toString()})(${JSON.stringify(programs)})`,
        })
        edits.push({ start: location.startOffset, end: location.endOffset, value: `srcdoc="${quote(child)}"` })
      }
    }
    if ('tagName' in node && node.tagName === 'script' && !options.nestedOnly) {
      const current = index++, location = node.sourceCodeLocation
      if (location?.startTag) {
        const attrs = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]))
        const type = (attrs.type ?? (attrs.language ? `text/${attrs.language}` : 'text/javascript')).trim().toLowerCase()
        const classic = type === '' || /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type)
        const entry = data.moduleGraph?.entries[documentPath ? `${documentPath}:${current}` : String(current)]
        const start = location.startTag.endOffset, end = location.endTag?.startOffset ?? location.endOffset
        if (entry && attrs.type?.trim().toLowerCase() === 'module') {
          if (location.attrs?.src) edits.push({ start: location.attrs.src.startOffset, end: location.attrs.src.endOffset, value: '' })
          edits.push({ start, end, value: `import ${JSON.stringify(prefix + entry)};` })
        } else if (classic && (Object.hasOwn(attrs, 'data-cw-defer') || Object.hasOwn(attrs, 'data-cw-async'))) {
          // Resource closure retained external classic source inline. Recreate a
          // parser-inserted external script so native defer/async and DCL apply.
          programs.classic[String(current)] = source.slice(start, end)
          const retained = node.attrs.filter(attribute => !['src', 'data-cw-defer', 'data-cw-async'].includes(attribute.name))
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
  const doctype = parsed.childNodes.find(node => node.nodeName === '#documentType')
  const html = parsed.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'html')
  const head = html?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'head')
  // Inserting before an authored head creates an implicit head and makes the
  // parser ignore its later start tag, including the author's attributes.
  const insertion = head?.sourceCodeLocation?.startTag?.endOffset
    ?? html?.sourceCodeLocation?.startTag?.endOffset
    ?? doctype?.sourceCodeLocation?.endOffset ?? 0
  const marker = webResourceReferenceMarker({ $text: options.resourceCss ?? data.css ?? '' }, data.resourceBindings ?? {}, id => options.resources[id])
  const style = [options.themeCss ? `<style data-component-initial-theme>${options.themeCss.replace(/<\/style/gi, '<\\/style')}</style>` : '', data.css ? `<style${marker ? ` data-component-resource-bindings="${quote(marker)}"` : ''}>${data.css.replace(/<\/style/gi, '<\\/style')}</style>` : ''].join('')
  const textBootstrap = `${domTextOverrideRealmSource()}(${installParsedPageTextOverrides.toString()})(${JSON.stringify(programs.textOverrides ?? [])},${JSON.stringify(property)},createPageTextOverrides);`
  const bootstrap = `<meta charset="utf-8"><script>${(textBootstrap + options.bridge(programs)).replace(/<\/script/gi, '<\\/script')}</script>${style}`
  if (!options.nestedOnly) edits.push({ start: insertion, end: insertion, value: bootstrap })
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  return result
}

/** Each owned parser document uses its own observer and receives only its parent's rule updates. */
export function installParsedPageTextOverrides(rules: readonly LightEditTextOverride[], token: string,
  factory: (roots: readonly Node[], rules: readonly LightEditTextOverride[]) => DomTextOverrideController) {
  const owner = factory([document.documentElement], rules)
  const cascade = (next: readonly LightEditTextOverride[]) => {
    owner.setRules(next)
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[srcdoc]'))
      frame.contentWindow?.postMessage({ type: 'guoling.page-copy.update', token, rules: next }, '*')
  }
  const receive = (event: MessageEvent) => {
    if (event.source === parent && event.data?.type === 'guoling.page-copy.update' && event.data.token === token
      && Array.isArray(event.data.rules)) cascade(event.data.rules)
  }
  const consumer: DomTextOverrideController = { setRules: cascade, applyAll: () => owner.applyAll(), samples: () => owner.samples(),
    originalText: node => owner.originalText(node), setLocalText: (node, text) => owner.setLocalText(node, text),
    destroy() { owner.destroy(); window.removeEventListener('message', receive) } }
  Object.defineProperty(window, '__cwPageTextOverrides', { configurable: true, value: consumer })
  window.addEventListener('message', receive)
  window.addEventListener('pagehide', () => consumer.destroy(), { once: true })
  owner.applyAll()
}
