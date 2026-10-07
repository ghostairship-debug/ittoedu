import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { ComponentCompilationInput, ComponentCompilationResult, CompiledJavaScriptModule } from '../../core/components/compilation/types'
import type { ComponentInstance, JsonObject } from '../../shared/contracts/component-platform'
import type { WebData } from './data'

export interface WebModuleGraph {
  modules: Record<string, CompiledJavaScriptModule>
  /** Index in the document's script elements, including non-executable data blocks. */
  entries: Record<string, string>
}
export type WebRuntimeData = WebData & { moduleGraph?: WebModuleGraph }

/** Transport detail only; it is never part of the author's component data. */
export type RuntimeTargetProfile = 'full' | 'references'

const htmlElements = new Set(('html head title base link meta style body address article aside footer header h1 h2 h3 h4 h5 h6 hgroup main nav section search div dd dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr area audio img map track video picture source canvas caption col colgroup table tbody td tfoot th thead tr button datalist fieldset form input label legend meter optgroup option output progress select textarea details dialog summary slot noscript').split(' '))
const svgElements = new Set(('svg a circle clipPath defs desc ellipse filter g image line linearGradient marker mask metadata path pattern polygon polyline radialGradient rect stop style switch symbol text textPath title tspan use view feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence animate animateMotion animateTransform mpath set').toLowerCase().split(' '))
const mathElements = new Set(('math maction menclose merror mfenced mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover none semantics annotation').split(' '))

/** Syntax facts select a cheaper snapshot, never admission or static fallback. */
export function webRuntimeExecutionFacts(data: unknown): { execution: boolean; unknown: boolean } {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('html' in data) || typeof data.html !== 'string')
    return { execution: false, unknown: true }
  const facts = { execution: false, unknown: false }
  // Stored modules also keep full semantics even if there is no current entry.
  if ('modules' in data || 'moduleGraph' in data) facts.execution = true
  const tree = parse(data.html, { onParseError: error => { if (error.code !== 'missing-doctype') facts.unknown = true } })
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      const tag = node.tagName.toLowerCase()
      if (['script', 'iframe', 'object', 'embed', 'template', 'foreignobject'].includes(tag)) facts.execution = true
      const known = node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? htmlElements
        : node.namespaceURI === 'http://www.w3.org/2000/svg' ? svgElements
          : node.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? mathElements : undefined
      if (!known?.has(tag)) facts.unknown = true
      if (node.attrs.some(attribute => /^on/i.test(attribute.name)
        || /^javascript:/i.test(attribute.value.replace(/[\u0000-\u0020]/g, '')))) facts.execution = true
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(tree)
  return facts
}

/** The key comes from effective implementation resolution, and data is projected. */
export function webRuntimeTargetProfile(builtinKey: string | undefined, data: unknown): RuntimeTargetProfile {
  if (builtinKey !== 'guoling.web') return 'full'
  const facts = webRuntimeExecutionFacts(data)
  return facts.execution || facts.unknown ? 'full' : 'references'
}

const moduleBase = 'https://guoling.local/'
/** URL semantics without a file or network read. Bare imports remain bare. */
export function localModulePath(reference: string, importer = '', scriptSource = false): string | undefined {
  if (!scriptSource && !reference.startsWith('./') && !reference.startsWith('../')) return undefined
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|\\)/i.test(reference)) return undefined
  const url = new URL(reference, new URL(importer || 'document.html', moduleBase))
  return decodeURI(url.pathname.slice(1)) + url.search + url.hash
}

/** The HTML stays author source; generated inline entry names exist only in this projection. */
export function webModuleCompilationInput(data: WebData): { input: ComponentCompilationInput; entries: Record<string, string> } | undefined {
  const files: Record<string, string> = { ...data.modules }, entries: Record<string, string> = {}
  const documentEntries = (html: string, documentPath: string) => {
  let scriptIndex = 0, iframeIndex = 0
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const index = iframeIndex++, srcdoc = node.attrs.find(item => item.name === 'srcdoc')?.value
      if (srcdoc !== undefined) documentEntries(srcdoc, documentPath ? `${documentPath}/${index}` : String(index))
    }
    if ('tagName' in node && node.tagName === 'script') {
      const index = scriptIndex++
      const entryKey = documentPath ? `${documentPath}:${index}` : String(index)
      const type = node.attrs.find(item => item.name === 'type')?.value.trim().toLowerCase()
      if (type === 'module') {
        const base = node.attrs.find(item => item.name === 'data-guoling-module-base')?.value
        const importer = base ? `${base}/__document.html` : ''
        const src = node.attrs.find(item => item.name === 'src')?.value
        if (src !== undefined) {
          const path = localModulePath(src, importer, true)
          if (path) entries[entryKey] = path
        } else {
          let name = `${base ? `${base}/` : ''}__html_module_${documentPath.replaceAll('/', '_') || 'root'}_${index}.js`
          while (Object.hasOwn(files, name)) name = `_${name}`
          files[name] = node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
          entries[entryKey] = name
        }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(html))
  }
  documentEntries(data.html, '')
  if (!Object.keys(entries).length) return undefined
  return { input: { entry: Object.values(entries)[0] ?? Object.keys(files)[0]!, files,
    moduleEntries: Object.values(entries), options: { preserveModules: true, sourceMap: false } }, entries }
}

/** Both the Editor and Published producer derive the same native ESM graph through Main's compiler/cache. */
export async function projectWebModuleGraph(instance: ComponentInstance,
  compile: (input: ComponentCompilationInput) => Promise<ComponentCompilationResult>,
  report?: (message: string, severity: 'error' | 'warning') => void): Promise<ComponentInstance> {
  const data = instance.data as WebData
  const prepared = webModuleCompilationInput(data)
  if (!prepared) return instance
  const result = await compile(prepared.input)
  const diagnostics = result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics
  diagnostics.forEach(issue => report?.(`${issue.file ? `${issue.file}: ` : ''}${issue.message}`, issue.severity))
  if (result.status !== 'ready' || !result.artifact.modules) return instance
  return { ...instance, data: { ...data, moduleGraph: { modules: result.artifact.modules, entries: prepared.entries } } as unknown as JsonObject }
}
