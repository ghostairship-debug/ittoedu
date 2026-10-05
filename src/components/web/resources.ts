import type { ComponentInstance } from '../../shared/contracts/component-platform'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { tokenizer } from 'acorn'
import { webDataSchema } from './data'

/** Internal projection metadata: asset identity survives equal-content URLs. */
export function webResourceReferenceMarker(templates: Record<string, string>, bindings: Readonly<Record<string, string>>, resolve: (id: string) => string | undefined): string | undefined {
  const assets: Record<string, string> = {}, values: Record<string, string> = {}
  for (const [name, template] of Object.entries(templates)) {
    const tokens = template.match(/cw-resource:[a-zA-Z0-9_.-]+/g) ?? []
    if (!tokens.some(token => bindings[token])) continue
    for (const token of tokens) if (bindings[token]) assets[token] = bindings[token]
    values[name] = template.replace(/cw-resource:[a-zA-Z0-9_.-]+/g, token => resolve(bindings[token]) ?? token)
  }
  return Object.keys(values).length ? JSON.stringify({ templates: Object.fromEntries(Object.keys(values).map(name => [name, templates[name]])), assets, values }) : undefined
}

/** Refresh only software-projected resource fields which author code has not changed. */
export function refreshWebResourceReferences(root: Document | Element, resources: Record<string, string>): void {
  for (const node of root.querySelectorAll('[data-component-resource-bindings]')) {
    if (node.tagName.toLowerCase() === 'script') continue
    let marker: { templates: Record<string, string>; assets: Record<string, string>; values: Record<string, string> }
    try { marker = JSON.parse(node.getAttribute('data-component-resource-bindings')!) } catch { continue }
    for (const [name, template] of Object.entries(marker.templates)) {
      const text = name === '$text' && node.tagName.toLowerCase() === 'style'
      if (!text && !['src', 'href', 'poster', 'srcset', 'xlink:href', 'style'].includes(name)) continue
      const next = template.replace(/cw-resource:[a-zA-Z0-9_.-]+/g, token => resources[marker.assets[token]] ?? token)
      if (name === 'style' && 'style' in node) {
        // CSSOM normalizes spelling and the host removes placement properties.
        // Compare resource declarations individually so neither operation loses identity.
        const declared = node.ownerDocument.createElement('span').style, before = node.ownerDocument.createElement('span').style, after = node.ownerDocument.createElement('span').style
        declared.cssText = template; before.cssText = marker.values[name]; after.cssText = next
        const live = (node as HTMLElement).style
        for (const property of Array.from(declared)) if (declared.getPropertyValue(property).includes('cw-resource:')
          && live.getPropertyValue(property) === before.getPropertyValue(property) && live.getPropertyPriority(property) === before.getPropertyPriority(property))
          live.setProperty(property, after.getPropertyValue(property), after.getPropertyPriority(property))
        marker.values[name] = next
        continue
      }
      const current = text ? node.textContent : node.getAttribute(name)
      if (current !== marker.values[name]) continue
      if (text) node.textContent = next
      else node.setAttribute(name, next)
      marker.values[name] = next
    }
    node.setAttribute('data-component-resource-bindings', JSON.stringify(marker))
  }
}

/** URLs are runtime leases; only asset identities remain in the author data. */
export function resolveWebResourceBindings(instance: ComponentInstance, resolve: (assetId: string) => string | undefined, report?: (message: string) => void): ComponentInstance {
  const { moduleGraph, ...source } = instance.data as unknown as import('./moduleGraph').WebRuntimeData
  const data = webDataSchema.parse(source)
  const urls = new Map<string, string>()
  for (const [reference, assetId] of Object.entries(data.resourceBindings ?? {})) {
    if (!/^cw-resource:[a-zA-Z0-9_.-]+$/.test(reference)) { report?.(`${instance.id} 资源引用键不是完整token：${reference}；原内容已保留`); continue }
    const url = resolve(assetId)
    if (!url) { report?.(`${instance.id} Web 内容资源尚不可用：${assetId}；其余内容继续运行`); continue }
    urls.set(reference, url)
  }
  const references = (value: string) => value.replace(/cw-resource:[a-zA-Z0-9_.-]+/g, reference => urls.get(reference) ?? reference)
  const cssString = (value: string, quote: string) => value.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`)
    .replace(/[\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)
  const cssUrls = (value: string) => value.replace(/url\(\s*(['"]?)([^)]*?)\1\s*\)/gi, (match, quote: string, url: string) => {
    const resolved = references(url)
    if (resolved === url) return match
    const delimiter = quote || (/[\s()'"\\]/.test(resolved) ? '"' : '')
    return `url(${delimiter}${delimiter ? cssString(resolved, delimiter) : resolved}${delimiter})`
  })
  const javascript = (source: string, module = false) => {
    if (!urls.size || !source.includes('cw-resource:')) return source
    const replacements: Array<{ start: number; end: number; value: string }> = []
    try {
      // Only literal contents are URLs. Comments, regexes and ordinary source
      // spelling must not acquire resource substitutions or new JS syntax.
      for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script' })) {
        const literal = 'value' in token ? token.value : undefined
        if (!['string', 'template', 'invalidTemplate'].includes(token.type.label) || typeof literal !== 'string') continue
        const resolved = references(literal)
        if (resolved === literal) continue
        const value = token.type.label === 'string' ? JSON.stringify(resolved).replace(/</g, '\\u003c')
          : source.slice(token.start, token.end).replace(/cw-resource:[a-zA-Z0-9_.-]+/g, reference => {
            const url = urls.get(reference)
            return url === undefined ? reference : url.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
              .replace(/</g, '\\u003c').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
          })
        replacements.push({ start: token.start, end: token.end, value })
      }
    } catch {
      report?.(`${instance.id} 局部脚本资源引用未能解析；原源码和其他内容已保留`)
      return source
    }
    let result = source
    for (const replacement of replacements.sort((a, b) => b.start - a.start))
      result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end)
    return result
  }
  const htmlAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  // Preserve author syntax, doctype and parser order. DOM serialization would add
  // implicit document tags and turn a no-doctype document into a different load.
  const edits: Array<{ start: number; end: number; value: string }> = []
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node) {
      const templates: Record<string, string> = {}
      for (const attribute of node.attrs) {
        const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name
        const location = node.sourceCodeLocation?.attrs?.[name]
        if (!location || !['src', 'href', 'poster', 'srcset', 'xlink:href', 'style'].includes(name) && !/^on[a-z]+$/i.test(name)) continue
        const raw = data.html.slice(location.startOffset, location.endOffset)
        const projected = name === 'style' ? cssUrls(attribute.value) : /^on[a-z]+$/i.test(name) ? javascript(attribute.value) : references(attribute.value)
        if (node.tagName !== 'script' && !/^on[a-z]+$/i.test(name)) templates[name] = attribute.value
        if (projected !== attribute.value) edits.push({ start: location.startOffset, end: location.endOffset,
          value: `${raw.match(/^[^\s=]+/)?.[0] ?? name}="${htmlAttribute(projected)}"` })
      }
      const declared = node.attrs.find(attribute => attribute.name === 'type')?.value
      const language = node.attrs.find(attribute => attribute.name === 'language')?.value
      const type = (declared ?? (language ? `text/${language}` : 'text/javascript')).trim().toLowerCase()
      const script = node.tagName === 'script' && (type === '' || type === 'module' || /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript)|application\/(?:ld\+)?json)$/.test(type))
      if (node.tagName === 'style' || script) for (const child of node.childNodes) {
        if (child.nodeName !== '#text' || !child.sourceCodeLocation) continue
        const { startOffset: start, endOffset: end } = child.sourceCodeLocation
        const source = data.html.slice(start, end), value = script ? javascript(source, type === 'module') : cssUrls(source)
        if (!script) templates.$text = source
        if (value !== source) edits.push({ start, end, value })
      }
      const marker = webResourceReferenceMarker(templates, data.resourceBindings ?? {}, resolve)
      const opening = node.sourceCodeLocation?.startTag
      if (marker && opening) {
        const existing = node.sourceCodeLocation?.attrs?.['data-component-resource-bindings']
        if (existing) edits.push({ start: existing.startOffset, end: existing.endOffset, value: '' })
        const end = opening.endOffset - (data.html[opening.endOffset - 2] === '/' ? 2 : 1)
        edits.push({ start: end, end, value: ` data-component-resource-bindings="${htmlAttribute(marker)}"` })
      }
      if (node.tagName === 'template' && 'content' in node) visit(node.content)
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(data.html, { sourceCodeLocationInfo: true }))
  let html = data.html
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end)
  return { ...instance, data: { ...data, ...(moduleGraph ? { moduleGraph: moduleGraph as unknown as import('../../shared/contracts/component-platform').JsonObject } : {}), html, ...(data.css === undefined ? {} : { css: cssUrls(data.css) }) } }
}
