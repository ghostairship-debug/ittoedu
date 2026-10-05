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
  let scriptIndex = 0
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'script') {
      const index = scriptIndex++
      const type = node.attrs.find(item => item.name === 'type')?.value.trim().toLowerCase()
      if (type === 'module') {
        const src = node.attrs.find(item => item.name === 'src')?.value
        if (src !== undefined) {
          const path = localModulePath(src, '', true)
          if (path) entries[String(index)] = path
        } else {
          let name = `__html_module_${index}.js`
          while (Object.hasOwn(files, name)) name = `_${name}`
          files[name] = node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
          entries[String(index)] = name
        }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(data.html))
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
