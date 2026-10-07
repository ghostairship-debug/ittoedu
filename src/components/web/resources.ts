import type { ComponentInstance } from '../../shared/contracts/component-platform'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript, tokenizer } from 'acorn'
import { webDataSchema } from './data'
import type { WebData } from './data'

export interface WebNetworkResourceFact {
  /** Undefined when an actual API/DOM resource consumer cannot be resolved from source. */
  url?: string
  usage: string
  source: 'html' | 'css' | 'modules'
}

/** Read current source consumers. Optional import metadata is not an offline proof. */
export function collectWebNetworkResourceFacts(data: Pick<WebData, 'html' | 'css' | 'modules'>): WebNetworkResourceFact[] {
  if (!data || typeof data !== 'object') return [] // Existing source diagnostics own unusable data.
  const facts: WebNetworkResourceFact[] = [], seen = new Set<string>()
  const add = (value: string | undefined, usage: string, source: WebNetworkResourceFact['source'], runtimeAddress = false) => {
    if (value === undefined && !runtimeAddress) return
    let url = value?.trim()
    if (url !== undefined) {
      if (url.startsWith('//')) url = `https:${url}`
      if (!/^(?:https?|wss?):\/\//i.test(url)) return
    }
    const key = JSON.stringify([url, usage, source])
    if (!seen.has(key)) { seen.add(key); facts.push({ ...(url === undefined ? {} : { url }), usage, source }) }
  }
  const cssDecode = (value: string) => value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\r\n\f])/gi,
    (_, hex: string | undefined, character: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character)
  const css = (source: string, location: WebNetworkResourceFact['source']) => {
    const functions: string[] = []
    let cursor = 0
    const string = () => {
      const quote = source[cursor++]!, start = cursor
      while (cursor < source.length && source[cursor] !== quote) cursor += source[cursor] === '\\' ? 2 : 1
      const value = source.slice(start, cursor); cursor++
      return cssDecode(value)
    }
    while (cursor < source.length) {
      if (source.startsWith('/*', cursor)) { const end = source.indexOf('*/', cursor + 2); cursor = end < 0 ? source.length : end + 2; continue }
      if (source[cursor] === '"' || source[cursor] === "'") {
        const value = string()
        if (functions.some(name => name === 'image-set' || name === '-webkit-image-set')) add(value, 'CSS 图片', location)
        continue
      }
      const rawToken = /^(@import|(?:[-\w]|\\(?:[\da-f]{1,6}\s?|[^\r\n]))+)/i.exec(source.slice(cursor))?.[0]
      const token = rawToken ? cssDecode(rawToken) : undefined
      if (token) {
        cursor += rawToken!.length
        while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
        if (token.toLowerCase() === '@import' && (source[cursor] === '"' || source[cursor] === "'")) { add(string(), '样式表', location); continue }
        if (source[cursor] !== '(') continue
        cursor++
        if (token.toLowerCase() !== 'url') { functions.push(token.toLowerCase()); continue }
        while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
        let value: string
        if (source[cursor] === '"' || source[cursor] === "'") value = string()
        else {
          const start = cursor
          while (cursor < source.length && source[cursor] !== ')') cursor += source[cursor] === '\\' ? 2 : 1
          value = cssDecode(source.slice(start, cursor))
        }
        add(value, 'CSS 资源', location)
        while (cursor < source.length && source[cursor] !== ')') cursor++
        cursor++
        continue
      }
      if (source[cursor] === '(') functions.push('')
      else if (source[cursor] === ')') functions.pop()
      cursor++
    }
  }
  type JsNode = { type: string; [key: string]: unknown }
  const javascript = (source: string, module: boolean, location: WebNetworkResourceFact['source']) => {
    let tree: JsNode
    try { tree = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script' }) as unknown as JsNode }
    catch { return } // Compilation/runtime diagnostics own malformed source.
    const children = (node: JsNode): JsNode[] => Object.values(node).flatMap(value => {
      const values = Array.isArray(value) ? value : [value]
      return values.filter((child): child is JsNode => !!child && typeof child === 'object' && typeof (child as { type?: unknown }).type === 'string')
    })
    const scopes = (node: JsNode, parentBindings: ReadonlySet<string>, parentDomBindings: ReadonlyMap<string, string> = new Map()): void => {
      const bindings = new Set(parentBindings)
      const domBindings = new Map(parentDomBindings)
      const memberName = (value: JsNode): string | undefined => {
        const property = value.property as JsNode | undefined
        return property?.type === 'Identifier' && !value.computed ? String(property.name)
          : property?.type === 'Literal' && typeof property.value === 'string' ? property.value : undefined
      }
      const literal = (value: JsNode | undefined): string | undefined => value?.type === 'Literal' && typeof value.value === 'string' ? value.value
        : value?.type === 'TemplateLiteral' && !(value.expressions as unknown[]).length ? ((value.quasis as JsNode[])[0]?.value as { cooked?: string })?.cooked : undefined
      const domKind = (value: JsNode | undefined): string | undefined => {
        if (!value) return undefined
        if (value.type === 'Identifier') return domBindings.get(String(value.name))
        const callee = value.callee as JsNode | undefined
        if (value.type === 'NewExpression' && callee?.type === 'Identifier' && !bindings.has(String(callee.name))) {
          if (callee.name === 'Image') return 'img'
          if (callee.name === 'Audio') return 'audio'
          if (callee.name === 'XMLHttpRequest') return 'xhr'
        }
        if (value.type === 'CallExpression' && callee?.type === 'MemberExpression') {
          const owner = callee.object as JsNode, name = memberName(callee)
          if (owner.type === 'Identifier' && owner.name === 'document' && !bindings.has('document')) {
            const argument = literal((value.arguments as JsNode[])[0])
            if (name === 'createElement') return argument?.toLowerCase()
            if (name === 'querySelector' && argument && /^[a-z]+$/i.test(argument)) return argument.toLowerCase()
            if (name === 'querySelector' || name === 'getElementById') return 'dom'
          }
        }
        return undefined
      }
      const bind = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        const item = value as JsNode
        if (item.type === 'Identifier') { bindings.add(String(item.name)); domBindings.delete(String(item.name)) }
        else if (item.type === 'RestElement') bind(item.argument)
        else if (item.type === 'AssignmentPattern') bind(item.left)
        else if (item.type === 'ArrayPattern') (item.elements as unknown[]).forEach(bind)
        else if (item.type === 'ObjectPattern') for (const property of item.properties as JsNode[]) bind(property.type === 'RestElement' ? property.argument : property.value)
      }
      // Direct scope bindings distinguish user functions/data from global network APIs.
      const collect = (item: JsNode): void => {
        if (item !== node && /Function/.test(item.type)) { if (item.type === 'FunctionDeclaration') bind(item.id); return }
        if (item.type === 'VariableDeclarator') bind(item.id)
        if (item.type === 'ImportDeclaration') for (const specifier of item.specifiers as JsNode[]) bind(specifier.local)
        children(item).forEach(collect)
      }
      collect(node)
      const receivers = (item: JsNode): void => {
        if (item !== node && /Function/.test(item.type)) return
        if (item.type === 'VariableDeclarator' && (item.id as JsNode).type === 'Identifier') {
          const kind = domKind(item.init as JsNode | undefined)
          if (kind) domBindings.set(String((item.id as JsNode).name), kind)
        }
        children(item).forEach(receivers)
      }
      receivers(node)
      if (/Function/.test(node.type)) { bind(node.id); for (const parameter of node.params as JsNode[]) bind(parameter) }
      const visit = (item: JsNode): void => {
        if (item !== node && /Function/.test(item.type)) { scopes(item, bindings, domBindings); return }
        if (item.type === 'CallExpression' || item.type === 'NewExpression') {
          const callee = item.callee as JsNode
          let name = callee.type === 'Identifier' && !bindings.has(String(callee.name)) ? String(callee.name) : undefined
          if (callee.type === 'MemberExpression' && !callee.computed) {
            const owner = callee.object as JsNode, property = callee.property as JsNode
            if (owner.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(String(owner.name)) && !bindings.has(String(owner.name))) name = String(property.name)
          }
          if (name && ['fetch', 'WebSocket', 'EventSource', 'Audio'].includes(name)) {
            const value = literal((item.arguments as JsNode[])[0])
            add(value, name === 'Audio' ? '媒体' : '程序网络调用', location, true)
          }
          if (callee.type === 'MemberExpression') {
            const kind = domKind(callee.object as JsNode), method = memberName(callee), args = item.arguments as JsNode[]
            if (kind === 'xhr' && method === 'open') add(literal(args[1]), '程序网络调用', location, true)
            if (kind && kind !== 'xhr' && method === 'setAttribute') {
              const attribute = literal(args[0])
              if (attribute === 'style') { const value = literal(args[1]); if (value !== undefined) css(value, location) }
              else if (attribute && ['src', 'poster', 'href'].includes(attribute) && ['img', 'image', 'audio', 'video', 'source', 'link', 'script'].includes(kind))
                add(literal(args[1]), '程序资源', location, true)
              else if (kind === 'dom' && attribute && ['src', 'poster', 'href'].includes(attribute)) add(undefined, 'DOM 资源写入', location, true)
            }
          }
        }
        if (item.type === 'AssignmentExpression' && item.operator === '=') {
          const left = item.left as JsNode, right = item.right as JsNode
          if (left.type === 'MemberExpression') {
            const owner = left.object as JsNode, property = memberName(left), kind = domKind(owner)
            if (kind && property && ['src', 'poster', 'href'].includes(property) && ['img', 'image', 'audio', 'video', 'source', 'link', 'script'].includes(kind))
              add(literal(right), '程序资源', location, true)
            else if (kind === 'dom' && property && ['src', 'poster', 'href'].includes(property)) add(undefined, 'DOM 资源写入', location, true)
            if (kind && property && ['innerHTML', 'outerHTML', 'srcdoc'].includes(property)) {
              const value = literal(right)
              if (value !== undefined) html(value)
              else add(undefined, '动态 HTML 资源', location, true)
            }
            if (owner.type === 'MemberExpression' && memberName(owner) === 'style' && domKind(owner.object as JsNode)
              && property && ['cssText', 'background', 'backgroundImage', 'borderImage', 'borderImageSource', 'listStyle', 'listStyleImage', 'mask', 'maskImage', 'cursor', 'fill', 'stroke', 'filter', 'clipPath'].includes(property)) {
              const value = literal(right)
              if (value !== undefined) css(value, location)
              else add(undefined, '动态 CSS 资源', location, true)
            }
          }
        }
        children(item).forEach(visit)
      }
      visit(node)
    }
    scopes(tree, new Set())
  }
  const srcset = (value: string) => {
    // Candidate URL tokens precede descriptors; data URLs remain local.
    for (const match of value.matchAll(/(?:^|[\s,])((?:https?:\/\/|\/\/)[^\s,]+)/gi)) add(match[1], '图片', 'html')
  }
  const html = (source: string) => {
    const visit = (node: DefaultTreeAdapterTypes.Node): void => {
      if ('tagName' in node) {
        const attribute = (name: string) => node.attrs.find(item => item.name === name)?.value
        const tag = node.tagName, rel = (attribute('rel') ?? '').toLowerCase().split(/\s+/)
        if (['img', 'image'].includes(tag) || tag === 'input' && attribute('type')?.toLowerCase() === 'image') { add(attribute('src') ?? attribute('href') ?? attribute('xlink:href'), '图片', 'html'); srcset(attribute('srcset') ?? '') }
        if (['audio', 'video', 'source', 'track'].includes(tag)) { add(attribute('src'), '媒体', 'html'); srcset(attribute('srcset') ?? ''); if (tag === 'video') add(attribute('poster'), '图片', 'html') }
        if (['script', 'iframe', 'object', 'embed'].includes(tag)) add(attribute(tag === 'object' ? 'data' : 'src'), tag === 'script' ? '脚本' : '嵌入内容', 'html')
        if (tag === 'link' && rel.some(value => ['stylesheet', 'icon', 'preload', 'modulepreload'].includes(value))) add(attribute('href'), rel.includes('stylesheet') ? '样式表' : '加载资源', 'html')
        if (attribute('style')) css(attribute('style')!, 'html')
        for (const entry of node.attrs) if (/^on[a-z]+$/i.test(entry.name)) javascript(entry.value, false, 'html')
        if (tag === 'iframe' && attribute('srcdoc')) html(attribute('srcdoc')!)
        const text = node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
        if (tag === 'style') css(text, 'html')
        if (tag === 'script') {
          const type = (attribute('type') ?? '').trim().toLowerCase()
          if (!type || type === 'module' || /^(?:text|application)\/(?:java|ecma)script$/.test(type)) javascript(text, type === 'module', 'html')
        }
        if (tag === 'template' && 'content' in node) visit(node.content)
      }
      if ('childNodes' in node) node.childNodes.forEach(visit)
    }
    visit(parse(source))
  }
  if (typeof data.html === 'string') html(data.html)
  if (typeof data.css === 'string') css(data.css, 'css')
  for (const source of Object.values(data.modules ?? {})) if (typeof source === 'string') javascript(source, true, 'modules')
  return facts
}

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
