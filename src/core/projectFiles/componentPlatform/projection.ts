import { componentContainers, componentSurfaces } from '../../../shared/contracts/component-platform/project'
import { defaultTreeAdapter, parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import type { ComponentImplementation, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ContentApplyTarget, HtmlContentProjection } from '../../contentApply/planning/types'
import { prepareComponentAuthorSource, componentAuthorSourceModules, componentAuthorSourceRuntimeNote, type ComponentAuthorSource } from '../../components/source/componentAuthorSource'
import { componentSourceFileText } from '../../components/compilation/componentCompilationInput'
import { htmlDocumentKind } from '../../../shared/html/documentKind'
import { createCourseSurface } from '../../course/courseSurfaceStructure'
import { projectFlowDocument, type FlowProjectionDiagnostic } from '../../components/document/flowDocumentProjection'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../../shared/document/markdown'
import { inlineHtml, serializeFlowHtml } from '../../../shared/document/html'
import { componentAssetIds, sourceAssetIds, sourceModuleBindings } from '../../components/library/references'
import { componentDefinitionBuiltinKey, isComponentVisibleAtSurface, resolveComponentPresentation } from '../../../shared/contracts/component-platform/project'
import { observeSpatialSource, type SpatialObservedRefs, type SpatialGraphScope, spatialGraphItem } from '../../course/courseSpatialEdits'
import { formulaComponentDataSchema, textComponentDataSchema } from '../../../components/text/data'
import { formulaComponentHtml, textComponentHtml } from '../../../components/text/render'
import { imageDataSchema } from '../../../components/image/data'
import { clampCrop, cropGeometry } from '../../../shared/imageCrop'
import { componentBackgroundAssetIds } from '../../../shared/componentBackgroundPaint'
import { projectCssSourceResources, projectHtmlSourceResources } from './sourceResources'
import { builtinComponentSourceKeys, hasBuiltinComponentSource, loadBuiltinComponentSource } from '../../components/source/builtinSources'

export type ComponentProjectFileState = { surfaceId: string; stateId: string }
export type ComponentProjectFileScope = ({ kind: 'document' } | { kind: 'surface'; surfaceId: string } | { kind: 'instance'; instanceId: string } | ({ kind: 'graph' } & SpatialGraphScope)) & { state?: ComponentProjectFileState }

type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.ChildNode
const element = (node: Node): node is Element => 'tagName' in node
const stem = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+|\.+$/g, '') || '未命名'
const json = (value: unknown) => JSON.stringify(value, null, 2)
const surfacePath = (title: string, index: number) => `pages/${String(index + 1).padStart(2, '0')}-${stem(title)}`

/** A file directory carries addresses first; each requested value is built once in this capture. */
function deferredFile(file: ComponentProjectFile, fields: Partial<Record<keyof ComponentProjectFile, () => unknown>>): ComponentProjectFile {
  for (const [name, build] of Object.entries(fields)) {
    const read = once(build!)
    Object.defineProperty(file, name, { enumerable: true, configurable: true,
      get() { const value = read(); Object.defineProperty(this, name, { value, enumerable: true, configurable: true, writable: true }); return value } })
  }
  return file
}

/** Preserve deferred capture values when a consumer changes only an address or view fact. */
export function copyComponentProjectFile(file: ComponentProjectFile, patch: Partial<ComponentProjectFile>): ComponentProjectFile {
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(file), ...Object.getOwnPropertyDescriptors(patch) }) as ComponentProjectFile
}

const once = <T,>(build: () => T): (() => T) => {
  let ready = false, value: T
  return () => { if (!ready) { value = build(); ready = true } return value }
}

/** Observation addresses the formal page even when its contents have no HTML projection. */
export function componentProjectSurfaceId(project: CourseProjectV10, path: string): string | undefined {
  return componentSurfaces(project).find((surface, index) => {
    const base = surfacePath(surface.title, index)
    return path === `${base}.html` || path === `${base}.json`
  })?.id
}

export interface ComponentProjectFile {
  path: string
  kind: 'framework' | 'page' | 'structure' | 'html' | 'data' | 'style' | 'source' | 'asset' | 'reference'
  content?: string
  bytes?: Uint8Array
  mimeType?: string
  note?: string
  /** A mixed projection can be observed while only its concrete child paths are writable. */
  contentEditUnavailable?: string
  /** Directory context only. Explicit file reads retain their complete author content. */
  summary?: string
  /** Shared explanations are read once on demand, rather than copied into every file. */
  references?: Array<{ path: string; type: 'reference' }>
  /** Observation-only context; source implementations remain base author content. */
  observedState?: ComponentProjectFileState
  editingContext?: ComponentProjectFileState
  /** Software-only bindings; tool results expose paths and content, never require these fields. */
  target?: ContentApplyTarget
  projection?: HtmlContentProjection
  language?: 'javascript' | 'typescript'
  implementation?: Extract<ComponentImplementation, { kind: 'source' }>
  sourceFile?: { path: string; files: Record<string, Uint8Array>; privateOwner: boolean }
  authorSource?: { prepared: ComponentAuthorSource; dependencyId?: string }
  /** An unloaded builtin's directory alias; actual author bindings are resolved after its entry is prepared. */
  builtinSource?: { key: string; part: 'entry' | 'implementation' }
  /** Canonical fields that are not object content. Identities stay inside this software projection. */
  binding?:
    | { kind: 'project-settings' }
    | { kind: 'theme' }
    | { kind: 'definition'; definitionId: string }
    | { kind: 'definition-source'; definitionId: string }
    | { kind: 'instance-source'; instanceId: string }
    | { kind: 'instance-authoring'; instanceId: string }
    | { kind: 'spatial'; surfaceId: string; objectPaths: Record<string, string>; refs: SpatialObservedRefs; graphScope?: SpatialGraphScope }
    | { kind: 'asset'; assetId: string }
    | { kind: 'flow'; surfaceId: string; format: 'html' | 'markdown'; document: MarkdownDocument; objectPaths: Record<string, string> }
  /** Initial program region comes from the observed container; never an AI-authored identity or persistent viewport. */
  programViewport?: { width: number; height: number }
  /** Current formal geometry, returned as context rather than a second editable file. */
  frame?: ComponentInstance['frame']
}

export const componentProjectApiReferencePath = 'references/component-api5.md'

/** Async tool entrances prepare one selected builtin, never all source bodies for a directory. */
export async function prepareComponentProjectFileSource(file: ComponentProjectFile | undefined): Promise<void> {
  if (file?.builtinSource) await loadBuiltinComponentSource(file.builtinSource.key)
}

const compactSummary = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 180)
function htmlSummary(content: string): string {
  let summary = ''
  const visit = (node: Node | DefaultTreeAdapterTypes.Document) => {
    if (summary.length === 180) return
    if (element(node as Node) && ['head', 'script', 'style', 'template', 'noscript'].includes((node as Element).tagName)) return
    if (node.nodeName === '#text') {
      const text = (node as DefaultTreeAdapterTypes.TextNode).value.replace(/\s+/g, ' ').trim().slice(0, 180)
      if (text) summary = compactSummary([summary, text])
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  // Keep the parser's HTML semantics, but never join the complete page merely
  // to return its first 180 preview characters.
  visit(parse(content, { treeAdapter: projectionTreeAdapter }))
  return summary
}
function dataSummary(value: unknown): string {
  const parts: string[] = []
  const visit = (current: unknown, key = '') => {
    if (['css', 'js', 'javascript', 'source', 'modules', 'moduleBindings', 'resourceBindings'].includes(key)) return
    if (typeof current === 'string') {
      if (key === 'html') parts.push(htmlSummary(current))
      else if (!/^(?:id|.*Id|.*Ids|type|kind)$/.test(key)) parts.push(current)
    } else if (Array.isArray(current)) current.forEach(value => visit(value, key))
    else if (current && typeof current === 'object') Object.entries(current).forEach(([name, value]) => visit(value, name))
  }
  visit(value)
  return compactSummary(parts) || compactSummary([value && typeof value === 'object' ? `数据字段：${Object.keys(value).join('、')}` : String(value ?? '')])
}

/** Small directory facts; complete content stays available at the same explicit path. */
export function componentProjectFileSummary(file: Pick<ComponentProjectFile, 'kind' | 'content' | 'mimeType' | 'bytes'>): string {
  if (file.kind === 'source') return `源码，${file.content?.length ?? 0} 字符`
  if (file.kind === 'style') return `样式，${file.content?.length ?? 0} 字符`
  if (file.kind === 'asset') return `${file.mimeType ?? '素材'}，${file.bytes?.byteLength ?? 0} 字节`
  if (file.kind === 'html' || file.kind === 'page') return htmlSummary(file.content ?? '') || 'HTML 内容'
  if (file.kind === 'reference') return '共享 Component API5 与局部增强说明；按需读取'
  if (!file.content) return ''
  try { return dataSummary(JSON.parse(file.content)) } catch { return compactSummary([file.content]) }
}

// parse5's tokenizer builds long character tokens by concatenation. Detach the
// text at the existing tree boundary so the projection doesn't retain a chain
// of per-character strings alongside every other root's tree. All parser and
// serializer semantics remain with parse5, including foster-parented text.
const projectionTreeAdapter: typeof defaultTreeAdapter = {
  ...defaultTreeAdapter,
  insertText(parent, text) { defaultTreeAdapter.insertText(parent, structuredClone(text)) },
  insertTextBefore(parent, text, reference) { defaultTreeAdapter.insertTextBefore(parent, structuredClone(text), reference) },
}
function documentBody(document: DefaultTreeAdapterTypes.Document): Element {
  const root = document.childNodes.find(element)!
  return root.childNodes.find(node => element(node) && node.tagName === 'body') as Element
}
function bodyOf(html: string): Element { return documentBody(parse(html, { treeAdapter: projectionTreeAdapter })) }
function webHtmlSource(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  const key = implementation?.kind === 'builtin' ? implementation.key : componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  if (!['guoling.web', 'guoling.html-program'].includes(key ?? '')) return undefined
  const data = instance.data
  return data && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' ? data.html : undefined
}
function webHtml(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const html = webHtmlSource(project, instance)
  return html === undefined ? undefined : projectHtmlSourceResources(html, project, instance)
}
const attribute = (value: string) => value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!)
type PreparedInstanceHtml = { read: () => string; knownRoot: boolean; program?: boolean }
type PreparedProjectionNode = { instance: ComponentInstance; root: () => Element; children: PreparedProjectionNode[] }
const projectionRootReader = (html: () => string, parsed?: Element) => parsed ? () => parsed : once(() => bodyOf(html()).childNodes.find(element)!)
function prepareInstanceHtml(project: CourseProjectV10, instance: ComponentInstance): PreparedInstanceHtml | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind !== 'builtin') return undefined
  if (implementation.key === 'guoling.text') {
    const data = textComponentDataSchema.parse(instance.data)
    const markup = once(() => textComponentHtml(data))
    // The current math schema can accept inputs that KaTeX rejects. Keep that
    // existing renderer boundary before advertising a page, and reuse its result.
    if (data.content.inlines.some(inline => inline.type === 'math')) markup()
    return { knownRoot: true, read: once(() => {
      const body = bodyOf(markup()), outer = body.childNodes.find(element)!, content = outer.childNodes.find(element)!
      content.childNodes = bodyOf(inlineHtml(data.content)).childNodes
      content.childNodes.forEach(node => { node.parentNode = content })
      return serializeOuter(outer)
    }) }
  }
  if (implementation.key === 'guoling.formula') {
    const html = formulaComponentHtml(formulaComponentDataSchema.parse(instance.data))
    return { knownRoot: true, read: () => html }
  }
  if (implementation.key !== 'guoling.image') {
    const html = webHtml(project, instance)
    return html === undefined ? undefined : { knownRoot: false, program: implementation.key === 'guoling.html-program', read: () => html }
  }
  const data = imageDataSchema.parse(instance.data), asset = project.assets[data.assetId], frame = instance.frame
  // Feathering needs the actual pixel projection; keep that image's data/source entry available.
  if (!asset?.width || !asset.height || !frame || data.feather.amount) return undefined
  const source = { width: asset.width, height: asset.height }
  return { knownRoot: true, read: once(() => {
    const whole = cropGeometry({ ...data, frame, source }).whole
    const crop = clampCrop(data.crop), filters = data.filters
    return `<div style="position:relative;overflow:hidden;width:100%;height:100%;border-radius:${data.cornerRadius}px;filter:brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation}) grayscale(${filters.grayscale}) blur(${filters.blur}px)"><img src="${attribute(`cw-resource:${asset.id}`)}" alt="${attribute(data.alt)}" style="position:absolute;max-width:none;max-height:none;transform-origin:0 0;left:${whole.x}px;top:${whole.y}px;width:${whole.width}px;height:${whole.height}px;clip-path:inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%);transform:translate(${data.flipX ? '100%' : '0'},${data.flipY ? '100%' : '0'}) scale(${data.flipX ? -1 : 1},${data.flipY ? -1 : 1})"></div>`
  }) }
}

const singleRoot = (body: Element) => body.childNodes.filter(element).length === 1
  && !body.childNodes.some(node => node.nodeName === '#text' && (node as DefaultTreeAdapterTypes.TextNode).value.trim())

/** Determine real availability without serializing every page in a directory.
 * Arbitrary web markup still needs the parser; retain only its result and source,
 * not a complete DOM for every unrequested page. */
function prepareProjectHtmlProjection(project: CourseProjectV10, rootIds: readonly string[], viewport?: { width: number; height: number }, retainParsedRoots = false): (() => HtmlContentProjection) | undefined {
  let first: PreparedInstanceHtml | undefined, firstBody: Element | undefined
  if (rootIds.length === 1) {
    const instance = project.instances[rootIds[0]!]!
    first = prepareInstanceHtml(project, instance)
    if (first && !first.knownRoot && !instance.childIds?.length) {
      const html = first.read()
      if (first.program) return once(() => ({ html, entries: [{ instanceId: instance.id, sourcePath: [] }] }))
      const document = parse(html, { treeAdapter: projectionTreeAdapter, sourceCodeLocationInfo: true })
      if (htmlDocumentKind(document) === 'document') return once(() => ({ html, entries: [{ instanceId: instance.id, sourcePath: [] }] }))
      firstBody = documentBody(document)
    }
  }
  const prepare = (id: string, markup = prepareInstanceHtml(project, project.instances[id]!), parsedBody?: Element): PreparedProjectionNode | undefined => {
    if (!markup || markup.program) return undefined
    let parsedRoot: Element | undefined
    if (!markup.knownRoot) {
      const parsed = parsedBody ?? bodyOf(markup.read())
      if (!singleRoot(parsed)) return undefined
      if (retainParsedRoots) parsedRoot = parsed.childNodes.find(element)!
    }
    const instance = project.instances[id]!, children: PreparedProjectionNode[] = []
    for (const childId of instance.childIds ?? []) {
      const child = prepare(childId)
      if (!child) return undefined
      children.push(child)
    }
    return { instance, root: projectionRootReader(markup.read, parsedRoot), children }
  }
  const roots: PreparedProjectionNode[] = []
  for (const [index, id] of rootIds.entries()) {
    const root = index === 0 && first ? prepare(id, first, firstBody) : prepare(id)
    if (!root) return undefined
    roots.push(root)
  }
  let capturedRoots = roots
  return once(() => {
    const projection = materializeHtmlProjection(project, capturedRoots, viewport)
    capturedRoots = []
    return projection
  })
}

function materializeHtmlProjection(project: CourseProjectV10, roots: readonly PreparedProjectionNode[], viewport?: { width: number; height: number }): HtmlContentProjection {
  const body = bodyOf(''), mappings = new Map<Element, string>(), css = new Set<string>()
  const build = (prepared: typeof roots[number]): Element => {
    const { instance } = prepared, root = prepared.root()
    mappings.set(root, instance.id)
    // A current projection anchor is software-owned, never a second persisted identity.
    if (!root.attrs.some(value => value.name === 'id')) root.attrs.push({ name: 'id', value: `guoling-object-${instance.id}` })
    const data = instance.data as Record<string, unknown>
    if (typeof data.css === 'string') css.add(projectCssSourceResources(data.css, project, instance))
    const styles = Object.entries(instance.style ?? {}).map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`).join(';')
    const frame = instance.frame
    const geometry = frame ? `position:absolute;left:0;top:0;width:${frame.width}px;height:${frame.height}px;transform-origin:0 0;transform:matrix(${frame.transform.join(',')})` : ''
    const priorStyle = root.attrs.find(attribute => attribute.name === 'style')
    const style = [priorStyle?.value, styles, geometry].filter(Boolean).join(';')
    if (style) {
      root.attrs = root.attrs.filter(attribute => attribute.name !== 'style')
      root.attrs.push({ name: 'style', value: style })
    }
    for (const preparedChild of prepared.children) {
      const child = build(preparedChild)
      child.parentNode = root; root.childNodes.push(child)
    }
    return root
  }
  for (const prepared of roots) {
    const root = build(prepared)
    root.parentNode = body; body.childNodes.push(root)
  }
  const entries: HtmlContentProjection['entries'] = []
  const visit = (node: Element, sourcePath: number[]) => {
    const instanceId = mappings.get(node)
    if (instanceId) entries.push({ instanceId, sourcePath })
    node.childNodes.forEach((child, index) => { if (element(child)) visit(child, [...sourcePath, index]) })
  }
  body.childNodes.forEach((node, index) => { if (element(node)) visit(node, [index]) })
  const canvasCss = `html,body{margin:0;padding:0;${viewport ? `width:${viewport.width}px;height:${viewport.height}px;` : ''}}`
  return { html: `<!doctype html><html><head><style>${canvasCss}</style>${[...css].map(value => `<style>${value}</style>`).join('')}</head>${serializeOuter(body)}</html>`, entries }
}

/** Reconstructed from current canonical objects; no HTML source or mapping is persisted beside them. */
export function projectHtmlProjection(project: CourseProjectV10, rootIds: readonly string[], viewport?: { width: number; height: number }): HtmlContentProjection | undefined {
  return prepareProjectHtmlProjection(project, rootIds, viewport, true)?.()
}

/** Natural paths are derived once per observation from current order and names. */
/** Geometry-only projection, shared by base files and effective presentation-state context. */
export function componentProjectLayoutViewports(project: CourseProjectV10) {
  const fallback = createCourseSurface(project, { kind: 'slide' }, () => 'source-viewport').designSize!
  const instances = new Map<string, { width: number; height: number }>()
  const surfaces = new Map<string, { width: number; height: number }>()
  const visit = (ids: readonly string[], container: { width: number; height: number }) => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance) continue
      const viewport = instance.frame ? { width: instance.frame.width, height: instance.frame.height } : container
      instances.set(id, viewport)
      if (instance.childIds?.length) visit(instance.childIds, viewport)
    }
  }
  for (const surface of componentContainers(project)) {
    const layout = surface.kind === 'flow' ? surface.flow?.layout : undefined
    const viewport = { width: (layout?.widthMode === 'fluid' ? layout.wideContentWidth : layout?.readingWidth)
      ?? surface.designSize?.width ?? fallback.width, height: surface.designSize?.height ?? fallback.height }
    surfaces.set(surface.id, viewport)
    instances.set(surface.id, viewport)
    visit(surface.childIds, viewport)
  }
  visit(project.rootIds.filter(id => !project.instances[id]?.container), fallback)
  for (const plane of ['underlay', 'overlay'] as const) visit(project.global[plane], fallback)
  return { fallback, surfaces, instances }
}

export function componentProjectFiles(project: CourseProjectV10, resources: DocumentResources,
  requested?: string | ComponentProjectFile): ComponentProjectFile[] {
  const includeProjection = (path: string, target: ContentApplyTarget) => requested === undefined || (typeof requested === 'string' ? requested === path
    : requested.path === path || requested.target?.kind === target.kind && (target.kind === 'instance'
      ? requested.target.kind === 'instance' && requested.target.instanceId === target.instanceId
      : requested.target.kind === 'container' && JSON.stringify(requested.target.container) === JSON.stringify(target.container)))
  const layouts = componentProjectLayoutViewports(project), defaultViewport = layouts.fallback
  const files: ComponentProjectFile[] = [{ path: 'pages', kind: 'framework',
    content: json({ pages: componentSurfaces(project).map((surface, index) => ({ path: `${surfacePath(surface.title, index)}.json`, title: surface.title, kind: surface.kind })) }),
    summary: `${componentSurfaces(project).length} 个页面`,
    note: '页面框架目录。surface.add 新增页面；现存页面路径可用 surface.move、surface.remove、surface.title，before 选择本次列出的页面路径，省略即末尾。身份与编号由软件维护。' }]
  files.push(deferredFile({ path: 'project.json', kind: 'framework', binding: { kind: 'project-settings' },
    summary: `${project.title}；${componentSurfaces(project).length} 个页面，${Object.keys(project.instances).length} 个对象`,
    note: '完整正式作者内容观察。可直接应用 title/background/designTokens/playback 设置补丁；身份、版本和编号由软件维护。对象、页面、资源和源码修改使用各内容路径或语义工具，保留未提供的设置。' }, { content: () => json(project) }))
  files.push({ path: 'roots', kind: 'framework', content: json({ rootIds: project.rootIds, entry: project.entry }),
    summary: `${project.rootIds.length} 个作品根`,
    note: '作品根与入口由软件维护。完整 HTML 程序可向 entry.html 使用 program.set；已有入口的内容、参数和源码仍通过同一对象文件修改。' })
  files.push({ path: 'theme.css', kind: 'style', content: project.theme?.css ?? '', binding: { kind: 'theme' },
    note: '整课主题源码；修改主题保留对象和人工 frame，资源仍来自本工程。' })
  files.push({ path: componentProjectApiReferencePath, kind: 'reference', content: componentAuthorSourceRuntimeNote })
  const sources = (base: string, effective: ComponentImplementation, binding: Extract<NonNullable<ComponentProjectFile['binding']>, { kind: 'instance-source' | 'definition-source' }>, target?: ContentApplyTarget) => {
    if (typeof requested === 'string' && !requested.startsWith(`${base}.view.`)
      && !requested.startsWith(`${base}.source/`) && !requested.startsWith(`${base}.dependencies/`)) return
    if (requested && typeof requested !== 'string' && requested.path) {
      const expected = requested.binding
      if (!expected || expected.kind !== binding.kind || (binding.kind === 'instance-source'
        ? expected.kind !== 'instance-source' || expected.instanceId !== binding.instanceId
        : expected.kind !== 'definition-source' || expected.definitionId !== binding.definitionId)) return
    }
    if (effective.kind === 'builtin') {
      if (!builtinComponentSourceKeys.includes(effective.key)) return
      const prepared = once(() => {
        const source = prepareComponentAuthorSource(project, effective)
        if (!source) throw new Error('当前默认组件没有可读取的源码入口')
        return source
      })
      for (const part of ['entry', 'implementation'] as const) {
        const implementation = once(() => part === 'entry' ? prepared().implementation
          : (prepared().definitions.find(definition => definition.id === prepared().implementation.moduleBindings?.['./implementation'])
            ?? project.definitions[prepared().implementation.moduleBindings!['./implementation']!])!.implementation as Extract<ComponentImplementation, { kind: 'source' }>)
        const authorSource: NonNullable<ComponentProjectFile['authorSource']> = { get prepared() { return prepared() },
          get dependencyId() { return part === 'implementation' && hasBuiltinComponentSource(effective.key)
            ? prepared().implementation.moduleBindings?.['./implementation'] : undefined } }
        files.push(deferredFile({ path: part === 'entry' ? `${base}.view.js` : `${base}.dependencies/implementation.view.js`,
          kind: 'source', language: 'javascript', binding, target, builtinSource: { key: effective.key, part }, authorSource,
          summary: part === 'entry' ? '默认组件作者入口；按需读取完整源码' : '默认组件的完整实现；按需读取',
          note: part === 'implementation' ? '软件路径别名，读取后绑定本次实际实现。深改沿原 Source/COW 服务保留其余实例。'
            : binding.kind === 'definition-source' ? '共享定义的作者入口；应用后使用此定义的实例一起更新。' : '当前实例的作者入口；应用只改变本实例。',
          references: [{ path: componentProjectApiReferencePath, type: 'reference' }] },
        { implementation, content: () => implementation().source }))
      }
      return
    }
    const prepared = prepareComponentAuthorSource(project, effective)
    if (!prepared) return
    for (const module of componentAuthorSourceModules(project, resources, prepared)) {
      const implementation = module.implementation
      const moduleBase = module.id ? `${base}.dependencies/${stem(module.id)}` : base
      const note = module.id ? '完整依赖源码；仅深改底层实现时按需读取。从此作者入口深改只复制必要引用路径，其他实例和未改依赖保持。'
        : `${binding.kind === 'definition-source' ? '共享定义的作者入口；应用后使用此定义的实例一起更新。' : '当前实例的作者入口；应用只改变本实例。'}${binding.kind === 'instance-source' && Object.keys(project.instances[binding.instanceId]?.stateBindings ?? {}).length ? ` 当前显式状态别名：${JSON.stringify(project.instances[binding.instanceId].stateBindings)}` : ''}`
      const common = { binding, target, implementation, language: implementation.language, authorSource: { prepared, dependencyId: module.id }, note,
        references: [{ path: componentProjectApiReferencePath, type: 'reference' as const }] }
      if (!implementation.workspace) {
        files.push({ ...common, path: `${moduleBase}.view.${implementation.language === 'typescript' ? 'ts' : 'js'}`, kind: 'source', content: implementation.source })
        continue
      }
      const sourceFiles = resources.components[implementation.workspace.ownerId] ?? {}
      // The final transaction performs owner COW; retain original bytes for its CAS.
      const privateOwner = true
      const names = new Set([implementation.workspace.entry, ...Object.keys(sourceFiles)])
      for (const path of names) {
        const bytes = sourceFiles[path], text = once(() => bytes && componentSourceFileText(bytes))
        files.push(deferredFile({ ...common, path: `${moduleBase}.source/${path}`, kind: 'source',
          sourceFile: { path, files: sourceFiles, privateOwner },
          ...(!bytes ? { note: '此源码入口尚未提供；可补入源文，其余文件与依赖保留。' } : {}) },
        { kind: () => text() === null ? 'asset' : 'source', content: () => text() ?? undefined,
          bytes: () => text() === null ? bytes : undefined, mimeType: () => text() === null ? 'application/octet-stream' : undefined }))
      }
    }
  }
  Object.values(project.definitions).forEach((definition, index) => {
    const base = `components/${String(index + 1).padStart(2, '0')}-${stem(definition.title ?? definition.id)}`
    const { id: _id, implementation: effective, ...metadata } = definition
    files.push(deferredFile({ path: `${base}.definition.json`, kind: 'data', binding: { kind: 'definition', definitionId: definition.id },
      note: '共享定义的名称、角色与专业数据合同；内部身份和源码文件引用由软件维护。' }, { content: () => json(metadata) }))
    sources(base, effective, { kind: 'definition-source', definitionId: definition.id })
  })
  const objectEntries = new Map<string, ComponentProjectFile>()
  const containerBases = new Map<string, string>()
  const objects = (ids: readonly string[], folder: string, containerViewport: { width: number; height: number }) => ids.forEach((id, index) => {
    const firstFile = files.length
    const instance = project.instances[id]!, definition = project.definitions[instance.definitionId]!
    const programViewport = layouts.instances.get(id) ?? containerViewport
    const name = `${String(index + 1).padStart(2, '0')}-${stem(definition.title ?? definition.id)}`
    const base = `${folder}/${name}`, target = { kind: 'instance' as const, instanceId: id }
    const rawHtml = webHtmlSource(project, instance), html = once(() => webHtml(project, instance)!)
    if (rawHtml !== undefined) {
      const program = componentDefinitionBuiltinKey(definition) === 'guoling.html-program'
      const projection = once(() => instance.childIds?.length && !program ? projectHtmlProjection(project, [id]) : undefined)
      files.push(deferredFile({ path: `${base}.content.html`, kind: 'html', target },
        { content: () => projection()?.html ?? html(), projection,
          ...(instance.childIds?.length && !program ? {
            note: () => projection() ? undefined : '编组包含专业对象；使用子对象文件修改内容。',
            contentEditUnavailable: () => projection() ? undefined : '编组包含专业对象；使用子对象文件修改内容。' } : {}) }))
      const data = instance.data
      if (data && typeof data === 'object' && !Array.isArray(data)) files.push(deferredFile({
        path: `${base}.data.json`, kind: 'data', target,
        note: 'HTML 程序的正式数据；modules 按原相对路径保存可编辑模块源码。修改后复用同一事务并重新准备运行图。',
      }, { content: () => json(data), summary: () => dataSummary(data) }))
    } else files.push(deferredFile({ path: `${base}.data.json`, kind: 'data', target },
      { content: () => json(instance.data), summary: () => dataSummary(instance.data) }))
    const entry = files[firstFile]!
    objectEntries.set(id, entry)
    if (instance.container) containerBases.set(instance.id, base)
    if (instance.container) files.push(deferredFile({ path: `${base}.container.json`, kind: 'structure',
      target: { kind: 'container', container: { kind: 'instance', instanceId: id } }, programViewport,
      note: '当前嵌套容器及其直接子对象；可在此 insert 内容，保留容器外的作品与人工布局。' },
      { content: () => json({ title: instance.name, ...instance.container, childIds: instance.childIds ?? [] }) }))
    if (instance.authoring !== undefined || componentContainers(project).some(surface => surface.presentation?.states.some(state => state.overrides[id]?.authoring !== undefined))) {
      files.push(deferredFile({ path: `${base}.authoring.json`, kind: 'data', target,
        binding: { kind: 'instance-authoring', instanceId: id },
        note: '当前对象的局部作者记录与资源绑定；修改沿用当前对象和展示状态，业务数据与源码保持。' },
        { content: () => json(instance.authoring ?? {}) }))
    }
    files.push(deferredFile({ path: `${base}.style.json`, kind: 'style', target }, { content: () => json(instance.style ?? {}) }))
    const effectiveImplementation = instance.implementationOverride ?? definition.implementation
    sources(base, effectiveImplementation, { kind: 'instance-source', instanceId: id }, target)
    for (const file of files.slice(firstFile)) {
      if (file.target?.kind !== 'instance' || file.target.instanceId !== id) continue
      file.programViewport = programViewport
      if (instance.frame) file.frame = instance.frame
      if (effectiveImplementation.kind === 'source' && !file.authorSource) file.implementation = effectiveImplementation
    }
    if (instance.childIds?.length) objects(instance.childIds, base, programViewport)
  })
  componentSurfaces(project).forEach((surface, index) => {
    const base = surfacePath(surface.title, index)
    containerBases.set(surface.id, base)
    const programViewport = layouts.surfaces.get(surface.id) ?? defaultViewport
    const target: ContentApplyTarget = { kind: 'container', container: { kind: 'surface', surfaceId: surface.id } }
    const projection = includeProjection(`${base}.html`, target) ? prepareProjectHtmlProjection(project, surface.childIds, programViewport,
      typeof requested === 'string' ? requested === `${base}.html` : requested?.kind === 'page') : undefined
    if (projection) files.push(deferredFile({ path: `${base}.html`, kind: 'page', target, programViewport,
      summary: `${surface.title}；${surface.kind}，${surface.childIds.length} 个顶层对象` },
    { content: () => projection().html, projection }))
    const structure: ComponentProjectFile = { path: `${base}.json`, kind: 'structure', target, programViewport,
      summary: `${surface.title}；${surface.kind}，${surface.childIds.length} 个顶层对象`,
      note: '当前结构与人工位置；内容通过 objects 的实际 path 读取。可向本页插入内容，整页重做须明确表达 redo。' }
    files.push(structure)
    objects(surface.childIds, base, programViewport)
    deferredFile(structure, { content: () => json({ title: surface.title, kind: surface.kind,
      designSize: surface.designSize, ...(surface.flow ? { flowLayout: surface.flow.layout } : {}), objects: surface.childIds.map((id, order) => {
        const entry = objectEntries.get(id)!
        return { order: order + 1, type: project.definitions[project.instances[id]!.definitionId]!.title ?? project.instances[id]!.definitionId,
          path: entry.path, kind: entry.kind, summary: entry.summary, frame: project.instances[id]!.frame }
      }) }) })

  })
  objects(project.rootIds.filter(id => !project.instances[id]?.container), 'roots', defaultViewport)
  const entryId = project.entry?.rootInstanceId, entry = entryId ? project.instances[entryId] : undefined
  const entryHtml = entry && webHtmlSource(project, entry)
  if (entry && entryHtml !== undefined) files.push(deferredFile({ path: 'entry.html', kind: 'html',
    target: { kind: 'instance', instanceId: entry.id },
    note: '当前作品入口的完整 HTML；它与 roots 对象文件指向同一正式实例。content/edits 修改当前程序，program.set 建立或更新完整程序入口。' },
    { content: () => webHtml(project, entry) }))
  for (const plane of ['underlay', 'overlay'] as const) {
    const base = `global/${plane}`
    const structure: ComponentProjectFile = { path: `${base}.json`, kind: 'structure',
      target: { kind: 'container', container: { kind: 'global', plane } }, programViewport: defaultViewport,
      summary: `全局${plane === 'overlay' ? '前景' : '背景'}；${project.global[plane].length} 个顶层对象`,
      note: '跨页共享的正式内容容器；可直接 insert 内容，自设计持续导航只装配一次。透明空白保持场景操作。' }
    files.push(structure)
    objects(project.global[plane], base, defaultViewport)
    deferredFile(structure, { content: () => json({ plane, objects: project.global[plane].map((id, order) => {
      const entry = objectEntries.get(id)!
      return { order: order + 1, path: entry.path, kind: entry.kind, summary: entry.summary, frame: project.instances[id]!.frame }
    }) }) })
  }
  for (const surface of componentContainers(project)) {
    const base = containerBases.get(surface.id)
    if (!base) continue
    if (surface.kind === 'spatial') {
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && !file.binding && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
      const observed = once(() => observeSpatialSource(project, surface.id, objectPaths))
      const binding: Extract<NonNullable<ComponentProjectFile['binding']>, { kind: 'spatial' }> = { kind: 'spatial', surfaceId: surface.id, objectPaths, get refs() { return observed().refs } }
      files.push(deferredFile({ path: `${base}.spatial.json`, kind: 'data', binding,
        note: '空间镜头源文；保留已观察 ref 可重排镜头、路径和关系。新项省略 ref；target/objects 使用本次对象路径，paths.stops 使用已读镜头 ref，新镜头也可用本文件镜头序号。pose 可为 currentViewport，由当前空间视口提供。defaultRoute 选择 frames 或已读路径 ref，新路径也可用本文件路径序号；省略保留既有默认，删除默认路径会回到按镜头顺序。' },
        { content: () => json(observed().source) }))
    }
    if (surface.kind === 'flow') {
      const diagnostics: FlowProjectionDiagnostic[] = []
      const document = once(() => projectFlowDocument(project, surface.id, diagnostics))
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && !file.binding && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
      const note = (base: string) => {
        document()
        return [base, ...diagnostics.map(diagnostic => `${objectPaths[diagnostic.instanceId] ?? diagnostic.instanceId}：${diagnostic.message}`)].join('\n')
      }
      const context = { assets: project.assets, packageName: (id: string) => id,
        instanceHtml: (id: string, childrenHtml?: string) => `<guoling-instance path="${(objectPaths[id] ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"${childrenHtml === undefined ? '' : ' data-flow-layout-group="true"'}>${childrenHtml ?? ''}</guoling-instance>` }
      files.push(deferredFile({ path: `${base}.body.html`, kind: 'html',
        binding: { kind: 'flow', surfaceId: surface.id, format: 'html', get document() { return document() }, objectPaths } },
        { content: () => serializeFlowHtml({ title: surface.title, blocks: document().content.blocks }, context),
          note: () => note('连续正文源文；专业文本、公式、表格、图表保可编辑语义，正式对象引用路径由软件维护。浮层和人工 frame 保留。') }))
      files.push(deferredFile({ path: `${base}.body.md`, kind: 'source',
        binding: { kind: 'flow', surfaceId: surface.id, format: 'markdown', get document() { return document() }, objectPaths } },
        { content: () => serializeDocumentMarkdown(document()),
          note: () => note('正文 Markdown 投影；软件保留身份和专业字段，修改不覆盖浮层、行为或人工 frame。') }))
    }
  }
  const usedPaths = new Set(files.map(file => file.path))
  for (const asset of Object.values(project.assets)) {
    const bytes = resources.assets[asset.id]
    const content = once(() => bytes && (asset.mimeType?.startsWith('text/') || asset.mimeType === 'image/svg+xml') ? componentSourceFileText(bytes) : null)
    let path = asset.path
    const name = asset.path.split('/').at(-1) ?? 'asset'
    for (let suffix = 0; usedPaths.has(path); suffix++) path = `assets/${encodeURIComponent(asset.id)}/${suffix ? `${suffix}-` : ''}${name}`
    usedPaths.add(path)
    files.push(deferredFile({ path, kind: 'asset', bytes, mimeType: asset.mimeType, binding: { kind: 'asset', assetId: asset.id } },
      { content: () => content() ?? undefined }))
  }
  for (const file of files) if (!Object.hasOwn(file, 'summary')) deferredFile(file, { summary: () => componentProjectFileSummary(file) })
  return files
}

/** Resolve logical scope against the same canonical capture that produced natural file paths. */
export function componentProjectScopeFiles(project: CourseProjectV10, files: ComponentProjectFile[], scope: ComponentProjectFileScope): ComponentProjectFile[] {
  if (scope.kind === 'document') return files
  if (scope.kind === 'graph') {
    spatialGraphItem(project, scope)
    return files.flatMap(file => file.path === componentProjectApiReferencePath ? [file] : file.binding?.kind === 'spatial' && file.binding.surfaceId === scope.surfaceId
      ? [{ ...file, binding: { ...file.binding, graphScope: { surfaceId: scope.surfaceId, graph: scope.graph, graphId: scope.graphId } },
          note: `${file.note ?? ''} 本次仅所选 ${scope.graph === 'path' ? '路径' : '关系'} ${Object.entries(file.binding.refs[scope.graph === 'path' ? 'paths' : 'relations']).find(([, id]) => id === scope.graphId)?.[0]} 可修改；首页、镜头、其他图项和图项数量必须保持。` }] : [])
  }
  const instances = new Set<string>(), definitions = new Set<string>(), assets = new Set<string>()
  const visitDefinition = (id: string) => {
    if (definitions.has(id)) return
    definitions.add(id)
    const implementation = project.definitions[id]?.implementation
    if (implementation?.kind === 'source') {
      sourceAssetIds(implementation).forEach(id => assets.add(id))
      Object.values(sourceModuleBindings(implementation)).forEach(visitDefinition)
    }
  }
  const visit = (id: string) => {
    if (instances.has(id)) return
    const instance = project.instances[id]
    if (!instance) return
    instances.add(id); visitDefinition(instance.definitionId)
    const definition = project.definitions[instance.definitionId]
    if (definition) componentAssetIds(instance, definition).forEach(id => assets.add(id))
    if (instance.implementationOverride?.kind === 'source') Object.values(sourceModuleBindings(instance.implementationOverride)).forEach(visitDefinition)
    instance.childIds?.forEach(visit)
  }
  if (scope.kind === 'instance') visit(scope.instanceId)
  else {
    if (project.instances[scope.surfaceId]?.container) visit(scope.surfaceId)
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      const instance = project.instances[id]
      if (instance && isComponentVisibleAtSurface(instance, scope.surfaceId)) visit(id)
    }
  }
  for (const reference of Object.values(project.theme?.assets ?? {})) assets.add(reference.assetId)
  componentBackgroundAssetIds(project.background).forEach(id => assets.add(id))
  for (const surface of componentContainers(project)) {
    const includedContainer = instances.has(surface.id) || scope.kind === 'surface' && surface.id === scope.surfaceId
    if (scope.kind === 'surface' && !includedContainer) continue
    if (includedContainer) componentBackgroundAssetIds(surface.background).forEach(id => assets.add(id))
    for (const state of surface.presentation?.states ?? []) {
      if (includedContainer) componentBackgroundAssetIds(state.background).forEach(id => assets.add(id))
      const effective = resolveComponentPresentation(project, surface.id, state.id)
      for (const id of Object.keys(state.overrides)) if (instances.has(id)) {
        const instance = effective.instances[id], definition = effective.definitions[instance.definitionId]
        if (definition) componentAssetIds(instance, definition).forEach(id => assets.add(id))
      }
    }
  }
  return files.filter(file => {
    if (file.path === componentProjectApiReferencePath) return true
    if (file.target?.kind === 'instance') return instances.has(file.target.instanceId)
    if (file.target?.kind === 'container') return file.target.container.kind === 'instance' ? instances.has(file.target.container.instanceId)
      : scope.kind === 'surface' && file.target.container.kind === 'surface' && file.target.container.surfaceId === scope.surfaceId
    const binding = file.binding
    if (!binding) return false
    if (binding.kind === 'project-settings') return false
    if (binding.kind === 'theme') return true
    if (binding.kind === 'definition' || binding.kind === 'definition-source') return definitions.has(binding.definitionId)
    if (binding.kind === 'instance-source' || binding.kind === 'instance-authoring') return instances.has(binding.instanceId)
    if (binding.kind === 'asset') return assets.has(binding.assetId)
    return instances.has(binding.surfaceId) || scope.kind === 'surface' && binding.surfaceId === scope.surfaceId
  })
}
