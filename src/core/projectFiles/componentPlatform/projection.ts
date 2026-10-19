import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import type { ComponentImplementation, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ContentApplyTarget, HtmlContentProjection } from '../../contentApply/planning/types'
import { prepareComponentAuthorSource, componentAuthorSourceModules, componentAuthorSourceRuntimeNote, type ComponentAuthorSource } from '../../components/source/componentAuthorSource'
import { componentSourceFileText } from '../../components/compilation/componentCompilationInput'
import { htmlDocumentKind } from '../../../shared/html/documentKind'
import { createCourseSurface } from '../../course/courseSurfaceStructure'
import { projectFlowDocument } from '../../components/document/flowDocumentProjection'
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

export type ComponentProjectFileState = { surfaceId: string; stateId: string }
export type ComponentProjectFileScope = ({ kind: 'document' } | { kind: 'surface'; surfaceId: string } | { kind: 'instance'; instanceId: string } | ({ kind: 'graph' } & SpatialGraphScope)) & { state?: ComponentProjectFileState }

type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.ChildNode
const element = (node: Node): node is Element => 'tagName' in node
const stem = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+|\.+$/g, '') || '未命名'
const json = (value: unknown) => JSON.stringify(value, null, 2)
const surfacePath = (title: string, index: number) => `pages/${String(index + 1).padStart(2, '0')}-${stem(title)}`

/** Observation addresses the formal page even when its contents have no HTML projection. */
export function componentProjectSurfaceId(project: CourseProjectV10, path: string): string | undefined {
  return project.surfaces.find((surface, index) => {
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

const compactSummary = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 180)
function htmlSummary(content: string): string {
  const parts: string[] = []
  const visit = (node: Node | DefaultTreeAdapterTypes.Document) => {
    if (element(node as Node) && ['head', 'script', 'style', 'template', 'noscript'].includes((node as Element).tagName)) return
    if (node.nodeName === '#text') parts.push((node as DefaultTreeAdapterTypes.TextNode).value)
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(content))
  return compactSummary(parts)
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

function bodyOf(html: string): Element {
  const root = parse(html).childNodes.find(element)!
  return root.childNodes.find(node => element(node) && node.tagName === 'body') as Element
}
function webHtml(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  const key = implementation?.kind === 'builtin' ? implementation.key : componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  if (!['guoling.web', 'guoling.html-program'].includes(key ?? '')) return undefined
  const data = instance.data
  return data && typeof data === 'object' && !Array.isArray(data) && typeof data.html === 'string' ? data.html : undefined
}
const attribute = (value: string) => value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!)
function instanceHtml(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind !== 'builtin') return undefined
  if (implementation.key === 'guoling.text') {
    const data = textComponentDataSchema.parse(instance.data), body = bodyOf(textComponentHtml(data))
    const outer = body.childNodes.find(element)!, content = outer.childNodes.find(element)!
    content.childNodes = bodyOf(inlineHtml(data.content)).childNodes
    content.childNodes.forEach(node => { node.parentNode = content })
    return serializeOuter(outer)
  }
  if (implementation.key === 'guoling.formula') return formulaComponentHtml(formulaComponentDataSchema.parse(instance.data))
  if (implementation.key !== 'guoling.image') return webHtml(project, instance)
  const data = imageDataSchema.parse(instance.data), asset = project.assets[data.assetId], frame = instance.frame
  // Feathering needs the actual pixel projection; keep that image's data/source entry available.
  if (!asset?.width || !asset.height || !frame || data.feather.amount) return undefined
  const whole = cropGeometry({ ...data, frame, source: { width: asset.width, height: asset.height } }).whole
  const crop = clampCrop(data.crop), filters = data.filters
  return `<div style="position:relative;overflow:hidden;width:100%;height:100%;border-radius:${data.cornerRadius}px;filter:brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation}) grayscale(${filters.grayscale}) blur(${filters.blur}px)"><img src="${attribute(`../${asset.path}`)}" alt="${attribute(data.alt)}" style="position:absolute;max-width:none;max-height:none;transform-origin:0 0;left:${whole.x}px;top:${whole.y}px;width:${whole.width}px;height:${whole.height}px;clip-path:inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%);transform:translate(${data.flipX ? '100%' : '0'},${data.flipY ? '100%' : '0'}) scale(${data.flipX ? -1 : 1},${data.flipY ? -1 : 1})"></div>`
}

/** Reconstructed from current canonical objects; no HTML source or mapping is persisted beside them. */
export function projectHtmlProjection(project: CourseProjectV10, rootIds: readonly string[], viewport?: { width: number; height: number }): HtmlContentProjection | undefined {
  if (rootIds.length === 1) {
    const instance = project.instances[rootIds[0]!]!
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    const html = webHtml(project, instance)
    if (html !== undefined && implementation?.kind === 'builtin'
      && (implementation.key === 'guoling.html-program' || htmlDocumentKind(html) === 'document')
      && !instance.childIds?.length) return { html, entries: [{ instanceId: instance.id, sourcePath: [] }] }
  }
  const body = bodyOf(''), mappings = new Map<Element, string>(), css = new Set<string>()
  const build = (id: string): Element | undefined => {
    const instance = project.instances[id]!
    const html = instanceHtml(project, instance)
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    if (html === undefined || implementation?.kind !== 'builtin' || implementation.key === 'guoling.html-program') return undefined
    const parsed = bodyOf(html), roots = parsed.childNodes.filter(element)
    // Multiple-root fragments remain directly editable through their own content.html file.
    if (roots.length !== 1 || parsed.childNodes.some(node => node.nodeName === '#text' && (node as DefaultTreeAdapterTypes.TextNode).value.trim())) return undefined
    const root = roots[0]!
    mappings.set(root, id)
    // A current projection anchor is software-owned, never a second persisted identity.
    if (!root.attrs.some(value => value.name === 'id')) root.attrs.push({ name: 'id', value: `guoling-object-${id}` })
    const data = instance.data as Record<string, unknown>
    if (typeof data.css === 'string') css.add(data.css)
    const styles = Object.entries(instance.style ?? {}).map(([key, value]) => `${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`).join(';')
    const frame = instance.frame
    const geometry = frame ? `position:absolute;left:0;top:0;width:${frame.width}px;height:${frame.height}px;transform-origin:0 0;transform:matrix(${frame.transform.join(',')})` : ''
    const priorStyle = root.attrs.find(attribute => attribute.name === 'style')
    const style = [priorStyle?.value, styles, geometry].filter(Boolean).join(';')
    if (style) {
      root.attrs = root.attrs.filter(attribute => attribute.name !== 'style')
      root.attrs.push({ name: 'style', value: style })
    }
    for (const childId of instance.childIds ?? []) {
      const child = build(childId)
      if (!child) return undefined
      child.parentNode = root; root.childNodes.push(child)
    }
    return root
  }
  for (const id of rootIds) {
    const root = build(id)
    if (!root) return undefined
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
  for (const surface of project.surfaces) {
    const layout = surface.kind === 'flow' ? surface.flow?.layout : undefined
    const viewport = { width: (layout?.widthMode === 'fluid' ? layout.wideContentWidth : layout?.readingWidth)
      ?? surface.designSize?.width ?? fallback.width, height: surface.designSize?.height ?? fallback.height }
    surfaces.set(surface.id, viewport)
    visit(surface.childIds, viewport)
  }
  for (const plane of ['underlay', 'overlay'] as const) visit(project.global[plane], fallback)
  return { fallback, surfaces, instances }
}

export function componentProjectFiles(project: CourseProjectV10, resources: DocumentResources): ComponentProjectFile[] {
  const layouts = componentProjectLayoutViewports(project), defaultViewport = layouts.fallback
  const files: ComponentProjectFile[] = [{ path: 'pages', kind: 'framework',
    content: json({ pages: project.surfaces.map((surface, index) => ({ path: `${surfacePath(surface.title, index)}.json`, title: surface.title, kind: surface.kind })) }),
    summary: `${project.surfaces.length} 个页面`,
    note: '页面框架目录。surface.add 新增页面；现存页面路径可用 surface.move、surface.remove、surface.title，before 选择本次列出的页面路径，省略即末尾。身份与编号由软件维护。' }]
  files.push({ path: 'project.json', kind: 'framework', content: json(project), binding: { kind: 'project-settings' },
    summary: `${project.title}；${project.surfaces.length} 个页面，${Object.keys(project.instances).length} 个对象`,
    note: '完整正式作者内容观察。可直接应用 title/background/designTokens/playback 设置补丁；身份、版本和编号由软件维护。对象、页面、资源和源码修改使用各内容路径或语义工具，保留未提供的设置。' })
  files.push({ path: 'theme.css', kind: 'style', content: project.theme?.css ?? '', binding: { kind: 'theme' },
    note: '整课主题源码；修改主题保留对象和人工 frame，资源仍来自本工程。' })
  files.push({ path: componentProjectApiReferencePath, kind: 'reference', content: componentAuthorSourceRuntimeNote })
  const sources = (base: string, effective: ComponentImplementation, binding: Extract<NonNullable<ComponentProjectFile['binding']>, { kind: 'instance-source' | 'definition-source' }>, target?: ContentApplyTarget) => {
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
        const bytes = sourceFiles[path], content = bytes && componentSourceFileText(bytes)
        files.push({ ...common, path: `${moduleBase}.source/${path}`, kind: content === null ? 'asset' : 'source',
          ...(content === null ? { bytes, mimeType: 'application/octet-stream' } : { content }),
          sourceFile: { path, files: sourceFiles, privateOwner },
          ...(!bytes ? { note: '此源码入口尚未提供；可补入源文，其余文件与依赖保留。' } : {}) })
      }
    }
  }
  Object.values(project.definitions).forEach((definition, index) => {
    const base = `components/${String(index + 1).padStart(2, '0')}-${stem(definition.title ?? definition.id)}`
    const { id: _id, implementation: effective, ...metadata } = definition
    files.push({ path: `${base}.definition.json`, kind: 'data', content: json(metadata), binding: { kind: 'definition', definitionId: definition.id },
      note: '共享定义的名称、角色与专业数据合同；内部身份和源码文件引用由软件维护。' })
    sources(base, effective, { kind: 'definition-source', definitionId: definition.id })
  })
  const objectEntries = new Map<string, ComponentProjectFile>()
  const objects = (ids: readonly string[], folder: string, containerViewport: { width: number; height: number }) => ids.forEach((id, index) => {
    const firstFile = files.length
    const instance = project.instances[id]!, definition = project.definitions[instance.definitionId]!
    const programViewport = layouts.instances.get(id) ?? containerViewport
    const name = `${String(index + 1).padStart(2, '0')}-${stem(definition.title ?? definition.id)}`
    const base = `${folder}/${name}`, target = { kind: 'instance' as const, instanceId: id }
    const html = webHtml(project, instance)
    if (html !== undefined) {
      const projection = instance.childIds?.length ? projectHtmlProjection(project, [id]) : undefined
      files.push({ path: `${base}.content.html`, kind: 'html', content: projection?.html ?? html, target,
        ...(projection ? { projection } : {}), ...(instance.childIds?.length && !projection ? { note: '编组包含专业对象；使用子对象文件修改内容。' } : {}) })
      const data = instance.data
      if (data && typeof data === 'object' && !Array.isArray(data) && data.modules) files.push({
        path: `${base}.data.json`, kind: 'data', content: json(data), target,
        note: 'HTML 程序的正式数据；modules 按原相对路径保存可编辑模块源码。修改后复用同一事务并重新准备运行图。',
      })
    } else files.push({ path: `${base}.data.json`, kind: 'data', content: json(instance.data), target })
    const entry = files[firstFile]!
    entry.summary = componentProjectFileSummary(entry)
    objectEntries.set(id, entry)
    if (instance.authoring !== undefined || project.surfaces.some(surface => surface.presentation?.states.some(state => state.overrides[id]?.authoring !== undefined))) {
      files.push({ path: `${base}.authoring.json`, kind: 'data', content: json(instance.authoring ?? {}), target,
        binding: { kind: 'instance-authoring', instanceId: id },
        note: '当前对象的局部作者记录与资源绑定；修改沿用当前对象和展示状态，业务数据与源码保持。' })
    }
    files.push({ path: `${base}.style.json`, kind: 'style', content: json(instance.style ?? {}), target })
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
  project.surfaces.forEach((surface, index) => {
    const base = surfacePath(surface.title, index)
    const programViewport = layouts.surfaces.get(surface.id) ?? defaultViewport
    const target: ContentApplyTarget = { kind: 'container', container: { kind: 'surface', surfaceId: surface.id } }
    const projection = projectHtmlProjection(project, surface.childIds, programViewport)
    if (projection) files.push({ path: `${base}.html`, kind: 'page', content: projection.html, target, projection, programViewport })
    const structure: ComponentProjectFile = { path: `${base}.json`, kind: 'structure', target, programViewport,
      summary: `${surface.title}；${surface.kind}，${surface.childIds.length} 个顶层对象`,
      note: '当前结构与人工位置；内容通过 objects 的实际 path 读取。可向本页插入内容，整页重做须明确表达 redo。' }
    files.push(structure)
    objects(surface.childIds, base, programViewport)
    structure.content = json({ title: surface.title, kind: surface.kind,
      designSize: surface.designSize, ...(surface.flow ? { flowLayout: surface.flow.layout } : {}), objects: surface.childIds.map((id, order) => {
        const entry = objectEntries.get(id)!
        return { order: order + 1, type: project.definitions[project.instances[id]!.definitionId]!.title ?? project.instances[id]!.definitionId,
          path: entry.path, kind: entry.kind, summary: entry.summary, frame: project.instances[id]!.frame }
      }) })
    if (surface.kind === 'spatial') {
      const spatial = surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && file.binding?.kind !== 'instance-authoring' && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
      const { source, refs } = observeSpatialSource(project, surface.id, objectPaths)
      files.push({ path: `${base}.spatial.json`, kind: 'data', content: json(source), binding: { kind: 'spatial', surfaceId: surface.id, objectPaths, refs },
        note: '空间镜头源文；保留已观察 ref 可重排镜头、路径和关系。新项省略 ref；target/objects 使用本次对象路径，paths.stops 使用已读镜头 ref，新镜头也可用本文件镜头序号。pose 可为 currentViewport，由当前空间视口提供。defaultRoute 选择 frames 或已读路径 ref，新路径也可用本文件路径序号；省略保留既有默认，删除默认路径会回到按镜头顺序。' })
    }
    if (surface.kind === 'flow') {
      const document = projectFlowDocument(project, surface.id)
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && file.binding?.kind !== 'instance-authoring' && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
      const context = { assets: project.assets, packageName: (id: string) => id,
        instanceHtml: (id: string) => `<guoling-instance path="${(objectPaths[id] ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></guoling-instance>` }
      files.push({ path: `${base}.body.html`, kind: 'html', content: serializeFlowHtml({ title: surface.title, blocks: document.content.blocks }, context),
        binding: { kind: 'flow', surfaceId: surface.id, format: 'html', document, objectPaths },
        note: '连续正文源文；专业文本、公式、表格、图表保可编辑语义，正式对象引用路径由软件维护。浮层和人工 frame 保留。' })
      files.push({ path: `${base}.body.md`, kind: 'source', content: serializeDocumentMarkdown(document),
        binding: { kind: 'flow', surfaceId: surface.id, format: 'markdown', document, objectPaths },
        note: '正文 Markdown 投影；软件保留身份和专业字段，修改不覆盖浮层、行为或人工 frame。' })
    }
  })
  for (const plane of ['underlay', 'overlay'] as const) objects(project.global[plane], `global/${plane}`, defaultViewport)
  const usedPaths = new Set(files.map(file => file.path))
  for (const asset of Object.values(project.assets)) {
    const bytes = resources.assets[asset.id]
    const content = bytes && (asset.mimeType?.startsWith('text/') || asset.mimeType === 'image/svg+xml') ? componentSourceFileText(bytes) : null
    let path = asset.path
    const name = asset.path.split('/').at(-1) ?? 'asset'
    for (let suffix = 0; usedPaths.has(path); suffix++) path = `assets/${encodeURIComponent(asset.id)}/${suffix ? `${suffix}-` : ''}${name}`
    usedPaths.add(path)
    files.push({ path, kind: 'asset', bytes, mimeType: asset.mimeType, binding: { kind: 'asset', assetId: asset.id },
      ...(content !== null ? { content } : {}) })
  }
  return files.map(file => ({ ...file, summary: file.summary ?? componentProjectFileSummary(file) }))
}

/** Resolve logical scope against the same canonical capture that produced natural file paths. */
export function componentProjectScopeFiles(project: CourseProjectV10, files: ComponentProjectFile[], scope: ComponentProjectFileScope): ComponentProjectFile[] {
  if (scope.kind === 'document') return files
  if (scope.kind === 'graph') {
    spatialGraphItem(project, scope)
    return files.flatMap(file => file.kind === 'reference' ? [file] : file.binding?.kind === 'spatial' && file.binding.surfaceId === scope.surfaceId
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
    project.surfaces.find(surface => surface.id === scope.surfaceId)?.childIds.forEach(visit)
    for (const id of [...project.global.underlay, ...project.global.overlay]) {
      const instance = project.instances[id]
      if (instance && isComponentVisibleAtSurface(instance, scope.surfaceId)) visit(id)
    }
  }
  for (const reference of Object.values(project.theme?.assets ?? {})) assets.add(reference.assetId)
  componentBackgroundAssetIds(project.background).forEach(id => assets.add(id))
  for (const surface of project.surfaces) {
    if (scope.kind === 'surface' && surface.id !== scope.surfaceId) continue
    if (scope.kind === 'surface') componentBackgroundAssetIds(surface.background).forEach(id => assets.add(id))
    for (const state of surface.presentation?.states ?? []) {
      if (scope.kind === 'surface') componentBackgroundAssetIds(state.background).forEach(id => assets.add(id))
      const effective = resolveComponentPresentation(project, surface.id, state.id)
      for (const id of Object.keys(state.overrides)) if (instances.has(id)) {
        const instance = effective.instances[id], definition = effective.definitions[instance.definitionId]
        if (definition) componentAssetIds(instance, definition).forEach(id => assets.add(id))
      }
    }
  }
  return files.filter(file => {
    if (file.kind === 'reference') return true
    if (file.target?.kind === 'instance') return instances.has(file.target.instanceId)
    if (file.target?.kind === 'container') return scope.kind === 'surface' && file.target.container.kind === 'surface' && file.target.container.surfaceId === scope.surfaceId
    const binding = file.binding
    if (!binding) return false
    if (binding.kind === 'project-settings') return false
    if (binding.kind === 'theme') return true
    if (binding.kind === 'definition' || binding.kind === 'definition-source') return definitions.has(binding.definitionId)
    if (binding.kind === 'instance-source' || binding.kind === 'instance-authoring') return instances.has(binding.instanceId)
    if (binding.kind === 'asset') return assets.has(binding.assetId)
    return scope.kind === 'surface' && binding.surfaceId === scope.surfaceId
  })
}
