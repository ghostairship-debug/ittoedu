import { parse, serialize, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { htmlObjectStyle, type HtmlAssembly, type HtmlAssemblyObject, type HtmlObjectContent } from '../../../../core/contentApply/assembly/htmlAssembly'
import type { ComponentDefinition, ComponentFrame, CourseProjectV10, JsonObject } from '../../../../shared/contracts/component-platform'
import { htmlContentTargetIds } from './plan'
import type { ContentApplyDiagnostic, ContentChangeRequest, ContentObjectDraft, HtmlContentProjection } from './types'
import { professionalHtmlDraft } from './professionalHtml'
import { measuredFragmentBoxStyle } from '../../../../components/web/measuredFragmentBox'
import { HTML_PROGRAM_DEFINITION, WEB_DEFINITION } from '../../../../components/web/data'
import { htmlDocumentKind } from '../../../../shared/html/documentKind'

type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.ChildNode
const isElement = (node: Node): node is Element => 'tagName' in node
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

export const WEB_DEFINITIONS: ComponentDefinition[] = [WEB_DEFINITION, HTML_PROGRAM_DEFINITION]

function contentHtml(content: HtmlObjectContent, rawText = false): string {
  if (content.kind !== 'element') return content.kind === 'comment' ? `<!--${content.text}-->` : rawText ? content.text : escape(content.text)
  const attributes = { ...content.attributes }
  const style = Object.entries(content.style).map(([key, value]) => `${key}:${value}`).join(';')
  if (style) attributes.style = style
  const open = `<${content.tagName}${Object.entries(attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}>`
  if (VOID.has(content.tagName)) return open
  return `${open}${content.children.map(child => contentHtml(child, ['style', 'script'].includes(content.tagName))).join('')}</${content.tagName}>`
}

function decorationHtml(object: HtmlAssemblyObject): string {
  return object.decorations.map(decoration => {
    const frame = decoration.frame
    return `<div style="position:absolute;left:0;top:0;width:${frame.width}px;height:${frame.height}px;transform-origin:0 0;transform:matrix(${frame.transform.join(',')})">${contentHtml(decoration.content)}</div>`
  }).join('') + object.sourceRegions.map(region => region.html).join('')
}

/** One ordered parent list; measured stacking values are consumed here and then discarded. */
function orderedChildren(object: HtmlAssemblyObject): HtmlAssemblyObject[] {
  const numeric = (value?: string) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : 0
  return object.children.map((child, index) => ({ child, index })).sort((a, b) =>
    numeric(a.child.stacking?.zIndex) - numeric(b.child.stacking?.zIndex)
      || numeric(a.child.stacking?.layoutOrder) - numeric(b.child.stacking?.layoutOrder) || a.index - b.index).map(value => value.child)
}

export function assemblyContentDraft(assembly: HtmlAssembly, resourceBindings: Record<string, string>, options: {
  modules?: Record<string, string>
  createFormulaId(): string
  definitions: Readonly<Record<string, ComponentDefinition>>
  flow?: boolean
}): { draft: ContentObjectDraft; drafts?: ContentObjectDraft[]; definitions: ComponentDefinition[]; diagnostics: ContentApplyDiagnostic[] } {
  const definitions = new Map<string, ComponentDefinition>(), diagnostics: ContentApplyDiagnostic[] = []
  const isDefaultImplementation = (existing: ComponentDefinition, expected: ComponentDefinition) =>
    existing.role === expected.role && existing.implementation.kind === 'builtin'
      && expected.implementation.kind === 'builtin' && existing.implementation.key === expected.implementation.key
  const definitionFor = (expected: ComponentDefinition): ComponentDefinition => {
    const existing = definitions.get(expected.id) ?? options.definitions[expected.id]
    if (!existing) { definitions.set(expected.id, expected); return expected }
    if (isDefaultImplementation(existing, expected)) return existing
    // Source editing keeps the original definition identity. New HTML uses a
    // default implementation under its own identity without changing old instances.
    const reusable = [...definitions.values(), ...Object.values(options.definitions)]
      .find(value => isDefaultImplementation(value, expected))
    if (reusable) return reusable
    let id = `${expected.id}.builtin`, suffix = 2
    while (definitions.has(id) || Object.hasOwn(options.definitions, id)) id = `${expected.id}.builtin-${suffix++}`
    const definition = { ...expected, id }
    definitions.set(id, definition)
    return definition
  }
  const draft = (object: HtmlAssemblyObject): ContentObjectDraft => {
    const professional = professionalHtmlDraft(object, resourceBindings, options.createFormulaId, assembly.supportCss)
    if (professional?.kind === 'native') {
      return { ...professional.draft, definitionId: definitionFor(professional.definition).id }
    } else if (professional?.kind === 'web') diagnostics.push(professional.diagnostic)
    const definition = definitionFor(WEB_DEFINITIONS.find(value => value.id === (object.kind === 'program' ? 'guoling.html-program' : 'guoling.web'))!)
    const originalContent = object.content?.kind === 'element' && object.content.tagName === 'body'
      ? { ...object.content, tagName: 'div' } : object.content
    const measuredStyle = object.kind === 'program' ? object.style : measuredFragmentBoxStyle(object.style)
    const content = object.kind !== 'program' && originalContent?.kind === 'element'
      ? { ...originalContent, style: measuredFragmentBoxStyle(originalContent.style) } : originalContent
    let html = object.program?.html ?? (content ? contentHtml(content) : '')
    const retained = decorationHtml(object)
    if (retained) {
      const closing = content?.kind === 'element' && !VOID.has(content.tagName) ? `</${content.tagName}>` : ''
      html = closing && html.endsWith(closing) ? html.slice(0, -closing.length) + retained + closing : html + retained
    }
    const data: JsonObject = { html, ...(assembly.supportCss ? { css: assembly.supportCss } : {}),
      ...(object.kind === 'program' && options.modules ? { modules: options.modules } : {}),
      ...(Object.keys(resourceBindings).length ? { resourceBindings } : {}) }
    return { definitionId: definition.id, data,
      frame: { width: object.frame.width, height: object.frame.height, transform: [...object.frame.transform] } as ComponentFrame,
      style: object.kind === 'program' ? htmlObjectStyle(object.style, false) : measuredStyle,
      ...(object.kind === 'group' ? { children: orderedChildren(object).map(draft) } : {}) }
  }
  if (options.flow && assembly.root.kind !== 'program' && assembly.flowCoupled) {
    const definition = definitionFor(WEB_DEFINITIONS.find(value => value.id === 'guoling.web')!)
    // One responsive DOM owns the coupled CSS/disclosure layout. Do not turn its
    // descendants into a fixed free-frame stage or stamp used pixel heights into it.
    const root: ContentObjectDraft = { definitionId: definition.id, data: {
      html: assembly.source.html,
      ...(assembly.source.themeCss ? { css: assembly.source.themeCss } : {}),
      ...(Object.keys(resourceBindings).length ? { resourceBindings } : {}),
    }, frame: { width: assembly.root.frame.width, height: assembly.root.frame.height, transform: [1, 0, 0, 1, 0, 0] } }
    return { draft: root, definitions: [...definitions.values()], diagnostics }
  }
  if (options.flow && assembly.root.kind === 'group' && assembly.root.children.length) {
    // Independent text/images remain professional or atomic Web reading blocks.
    const roots = assembly.root.children.map(draft)
    return { draft: roots[0]!, drafts: roots, definitions: [...definitions.values()], diagnostics }
  }
  const root = draft(assembly.root)
  return { draft: root, definitions: [...definitions.values()], diagnostics }
}

function documentBodyFrom(document: DefaultTreeAdapterTypes.Document): Element {
  const root = document.childNodes.find(isElement)
  const body = root?.childNodes.find(node => isElement(node) && node.tagName === 'body')
  if (!body || !isElement(body)) throw new Error('HTML 没有可解析的正文')
  return body
}
function documentBody(html: string): Element { return documentBodyFrom(parse(html)) }
function atPath(body: Element, path: readonly number[]): Element {
  let current: Node = body
  for (const index of path) {
    if (!isElement(current) || !current.childNodes[index]) throw new Error('当前投影路径已不存在')
    current = current.childNodes[index]!
  }
  if (!isElement(current)) throw new Error('当前投影路径不是内容对象')
  return current
}
function allElements(root: Element): Element[] {
  return [root, ...root.childNodes.flatMap(node => isElement(node) ? allElements(node) : [])]
}
/** Text changes do not alter the tree shape; inserted or removed nodes require an author anchor. */
function shape(node: Node): string {
  return isElement(node) ? `${node.namespaceURI}:${node.tagName}(${node.childNodes.filter(isElement).map(shape).join(',')})` : node.nodeName
}

export function projectedHtmlElements(html: string, projection: HtmlContentProjection, instanceIds: readonly string[]): Map<string, Element> {
  const before = documentBody(projection.html), after = documentBody(html)
  const nodes = allElements(after), beforeNodes = allElements(before)
  const sameShape = shape(before) === shape(after)
  const result = new Map<string, Element>()
  for (const instanceId of instanceIds) {
    const entry = projection.entries.find(value => value.instanceId === instanceId)
    if (!entry) throw new Error(`软件投影缺少目标映射：${instanceId}`)
    const prior = atPath(before, entry.sourcePath)
    const anchor = attr(prior, 'id')
    const anchors = anchor ? nodes.filter(node => attr(node, 'id') === anchor) : []
    const beforeAnchors = anchor ? beforeNodes.filter(node => attr(node, 'id') === anchor) : []
    let node: Element | undefined = anchors.length === 1 && beforeAnchors.length === 1 ? anchors[0] : undefined
    if (!node) {
      const signature = serializeOuter(prior)
      const matches = nodes.filter(candidate => serializeOuter(candidate) === signature)
      if (matches.length === 1 && beforeNodes.filter(candidate => serializeOuter(candidate) === signature).length === 1) node = matches[0]
    }
    if (!node && sameShape) {
      // Ignore whitespace-only nodes when translating a path; source formatting may change.
      const ancestors: Element[] = []
      let current: Element = prior
      while (current !== before) { ancestors.unshift(current); current = current.parentNode as Element }
      node = after
      let parent = before
      for (const child of ancestors) {
        const siblings = parent.childNodes.filter(isElement)
        const nextSiblings: Element[] = node?.childNodes.filter(isElement) ?? []
        // An unchanged sibling that moved disproves positional identity for this gap.
        const moved = siblings.some((sibling, index) => {
          const signature = serializeOuter(sibling)
          const matches = nextSiblings.flatMap((candidate, nextIndex) => serializeOuter(candidate) === signature ? [nextIndex] : [])
          return matches.length === 1 && siblings.filter(candidate => serializeOuter(candidate) === signature).length === 1 && matches[0] !== index
        })
        if (moved) { node = undefined; break }
        const index = siblings.indexOf(child)
        node = nextSiblings[index]
        parent = child
      }
    }
    if (!node) throw new Error(`局部目标映射有歧义，保留输入等待修复：${instanceId}`)
    result.set(instanceId, node)
  }
  return result
}

function cloneWithout(node: Node, skip: Set<Element>): Node | undefined {
  if (isElement(node)) {
    if (skip.has(node)) return undefined
    return { ...node, attrs: node.attrs.map(value => ({ ...value })),
      childNodes: node.childNodes.flatMap(child => { const cloned = cloneWithout(child, skip); return cloned ? [cloned] : [] }) }
  }
  return { ...node }
}

/** Target extraction precedes resource admission, so unrelated full-page input cannot add assets. */
export function localHtmlInputs(project: CourseProjectV10, request: ContentChangeRequest): { instanceId: string; html: string }[] {
  if (request.source.kind !== 'html') throw new Error('当前源不是 HTML')
  const ids = htmlContentTargetIds(project, request)
  if (request.source.scope !== 'projection') {
    if (request.target.kind !== 'instance' || (project.instances[request.target.instanceId]?.childIds?.length ?? 0)) {
      throw new Error('编组内容修改需要当前软件投影，不能猜测替换其内部对象')
    }
    return [{ instanceId: request.target.instanceId, html: request.source.html }]
  }
  if (!request.projection) throw new Error('整页输入缺少当前软件投影，未扩大修改范围')
  const mapped = projectedHtmlElements(request.source.html, request.projection, ids)
  return ids.map(instanceId => {
    const instance = project.instances[instanceId]!
    const node = mapped.get(instanceId)!
    const entry = request.projection!.entries.find(value => value.instanceId === instanceId)!
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    const data = instance.data
    const authorHtml = data && typeof data === 'object' && !Array.isArray(data) ? data.html : undefined
    if (!entry.sourcePath.length && implementation?.kind === 'builtin'
      && (implementation.key === 'guoling.html-program' || implementation.key === 'guoling.web'
        && typeof authorHtml === 'string' && htmlDocumentKind(authorHtml) === 'document')) {
      return { instanceId, html: request.source.kind === 'html' ? request.source.html : '' }
    }
    const skip = new Set((instance.childIds ?? []).map(id => mapped.get(id)).filter((value): value is Element => !!value))
    const cloned = cloneWithout(node, skip) as Element
    if (cloned.tagName === 'body') { cloned.tagName = 'div'; cloned.nodeName = 'div' }
    return { instanceId, html: serializeOuter(cloned) }
  })
}

export function htmlForAssembly(request: ContentChangeRequest): string {
  if (request.source.kind !== 'html') throw new Error('当前源不是 HTML')
  if (request.source.scope !== 'projection' || request.target.kind !== 'instance') return request.source.html
  if (!request.projection) throw new Error('整页输入缺少当前软件投影，未扩大重做范围')
  const node = projectedHtmlElements(request.source.html, request.projection, [request.target.instanceId]).get(request.target.instanceId)!
  if (node.tagName === 'body') return request.source.html
  const document = parse(request.source.html), body = documentBodyFrom(document)
  const head = document.childNodes.find(isElement)?.childNodes.find(child => isElement(child) && child.tagName === 'head')
  // The selected body region is the assembly scope; its document styles, language
  // and resource declarations remain its rendering context. Ordinary fragments
  // without a document context retain their existing fragment sizing behavior.
  if (htmlDocumentKind(request.source.html) === 'fragment' && (!head || !isElement(head) || !head.childNodes.length)) return serializeOuter(node)
  body.childNodes = [node]
  node.parentNode = body
  return serialize(document)
}

/** A selected region keeps content bounds even when its document CSS context is retained. */
export function htmlAssemblyFraming(request: ContentChangeRequest): 'content' | 'viewport' | undefined {
  if (request.intent !== 'redo' && request.intent !== 'insert') return undefined
  if (request.target.kind === 'container') return request.intent === 'redo' && request.target.container.kind === 'surface' ? 'viewport' : undefined
  if (request.source.kind !== 'html' || request.source.scope !== 'projection') return undefined
  const instanceId = request.target.instanceId
  return request.projection?.entries.find(entry => entry.instanceId === instanceId)?.sourcePath.length ? 'content' : undefined
}

/** Existing computed outer appearance survives a content edit; nested formatting remains author content. */
export function preserveHtmlOuterStyle(previous: string, next: string): string {
  const oldDocument = parse(previous), nextDocument = parse(next)
  const oldBody = documentBodyFrom(oldDocument), body = documentBodyFrom(nextDocument)
  const oldRoots = oldBody.childNodes.filter(isElement)
  const roots = body.childNodes.filter(isElement)
  if (oldRoots.length === 1 && roots.length === 1 && oldRoots[0]!.tagName === roots[0]!.tagName) {
    roots[0]!.attrs = roots[0]!.attrs.filter(value => value.name !== 'style')
    const style = oldRoots[0]!.attrs.find(value => value.name === 'style')
    if (style) roots[0]!.attrs.push({ ...style })
  }
  if (htmlDocumentKind(next) === 'document') return serialize(nextDocument)
  if (htmlDocumentKind(previous) === 'document') {
    // A local fragment changes this body's content, not its document resources,
    // language, body attributes or doctype. Newly authored fragment styles stay usable.
    oldBody.childNodes = body.childNodes
    oldBody.childNodes.forEach(node => { node.parentNode = oldBody })
    const headOf = (document: DefaultTreeAdapterTypes.Document) => document.childNodes.find(isElement)?.childNodes
      .find((node): node is Element => isElement(node) && node.tagName === 'head')
    const head = headOf(oldDocument), newHead = headOf(nextDocument)
    if (head && newHead) for (const node of newHead.childNodes) { node.parentNode = head; head.childNodes.push(node) }
    return serialize(oldDocument)
  }
  return body.childNodes.map(node => isElement(node) ? serializeOuter(node) : node.nodeName === '#text' ? escape((node as DefaultTreeAdapterTypes.TextNode).value) : '').join('')
}
