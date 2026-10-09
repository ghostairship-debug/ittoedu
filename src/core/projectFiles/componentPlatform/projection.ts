import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import type { ComponentImplementation, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ContentApplyTarget, HtmlContentProjection } from '../../contentApply/planning/types'
import { getBuiltinComponentSource } from '../../components/source/builtinSources'
import { componentSourceFileText } from '../../components/compilation/componentCompilationInput'
import { htmlDocumentKind } from '../../../shared/html/documentKind'
import { createCourseSurface } from '../../course/courseSurfaceStructure'
import { projectFlowDocument } from '../../components/document/flowDocumentProjection'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../../shared/document/markdown'
import { inlineHtml, serializeFlowHtml } from '../../../shared/document/html'
import { componentSourceOwnerIsShared } from '../../components/source/sourceAuthoringEdits'
import { componentAssetIds, sourceAssetIds, sourceModuleBindings } from '../../components/library/references'
import { isComponentVisibleAtSurface } from '../../../shared/contracts/component-platform/project'
import { observeSpatialSource, type SpatialObservedRefs } from '../../course/courseSpatialEdits'
import { formulaComponentDataSchema, textComponentDataSchema } from '../../../components/text/data'
import { formulaComponentHtml, textComponentHtml } from '../../../components/text/render'
import { imageDataSchema } from '../../../components/image/data'
import { clampCrop, cropGeometry } from '../../../shared/imageCrop'

export type ComponentProjectFileState = { surfaceId: string; stateId: string }
export type ComponentProjectFileScope = ({ kind: 'document' } | { kind: 'surface'; surfaceId: string } | { kind: 'instance'; instanceId: string }) & { state?: ComponentProjectFileState }

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
  kind: 'framework' | 'page' | 'structure' | 'html' | 'data' | 'style' | 'source' | 'asset'
  content?: string
  bytes?: Uint8Array
  mimeType?: string
  note?: string
  /** Observation-only context; source implementations remain base author content. */
  observedState?: ComponentProjectFileState
  editingContext?: ComponentProjectFileState
  /** Software-only bindings; tool results expose paths and content, never require these fields. */
  target?: ContentApplyTarget
  projection?: HtmlContentProjection
  language?: 'javascript' | 'typescript'
  implementation?: Extract<ComponentImplementation, { kind: 'source' }>
  sourceFile?: { path: string; files: Record<string, Uint8Array>; privateOwner: boolean }
  /** Canonical fields that are not object content. Identities stay inside this software projection. */
  binding?:
    | { kind: 'project-settings' }
    | { kind: 'theme' }
    | { kind: 'definition'; definitionId: string }
    | { kind: 'definition-source'; definitionId: string }
    | { kind: 'instance-source'; instanceId: string }
    | { kind: 'spatial'; surfaceId: string; objectPaths: Record<string, string>; refs: SpatialObservedRefs }
    | { kind: 'asset'; assetId: string }
    | { kind: 'flow'; surfaceId: string; format: 'html' | 'markdown'; document: MarkdownDocument; objectPaths: Record<string, string> }
  /** Initial program region comes from the observed container; never an AI-authored identity or persistent viewport. */
  programViewport?: { width: number; height: number }
}

function bodyOf(html: string): Element {
  const root = parse(html).childNodes.find(element)!
  return root.childNodes.find(node => element(node) && node.tagName === 'body') as Element
}
function webHtml(project: CourseProjectV10, instance: ComponentInstance): string | undefined {
  const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
  if (implementation?.kind !== 'builtin' || !['guoling.web', 'guoling.html-program'].includes(implementation.key)) return undefined
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
export function projectHtmlProjection(project: CourseProjectV10, rootIds: readonly string[]): HtmlContentProjection | undefined {
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
  return { html: `<!doctype html><html><head>${[...css].map(value => `<style>${value}</style>`).join('')}</head>${serializeOuter(body)}</html>`, entries }
}

/** Natural paths are derived once per observation from current order and names. */
export function componentProjectFiles(project: CourseProjectV10, resources: DocumentResources): ComponentProjectFile[] {
  const defaultViewport = createCourseSurface(project, { kind: 'slide' }, () => 'source-viewport').designSize!
  const files: ComponentProjectFile[] = [{ path: 'pages', kind: 'framework',
    content: json({ pages: project.surfaces.map((surface, index) => ({ path: `${surfacePath(surface.title, index)}.json`, title: surface.title, kind: surface.kind })) }),
    note: '页面框架目录。surface.add 新增页面；现存页面路径可用 surface.move、surface.remove、surface.title，before 选择本次列出的页面路径，省略即末尾。身份与编号由软件维护。' }]
  files.push({ path: 'project.json', kind: 'framework', content: json(project), binding: { kind: 'project-settings' },
    note: '完整正式作者内容观察。可直接应用 title/background/designTokens/playback 设置补丁；身份、版本和编号由软件维护。对象、页面、资源和源码修改使用各内容路径或语义工具，保留未提供的设置。' })
  files.push({ path: 'theme.css', kind: 'style', content: project.theme?.css ?? '', binding: { kind: 'theme' },
    note: '整课主题源码；修改主题保留对象和人工 frame，资源仍来自本工程。' })
  Object.values(project.definitions).forEach((definition, index) => {
    const base = `components/${String(index + 1).padStart(2, '0')}-${stem(definition.title ?? definition.id)}`
    const { id: _id, implementation: effective, ...metadata } = definition
    files.push({ path: `${base}.definition.json`, kind: 'data', content: json(metadata), binding: { kind: 'definition', definitionId: definition.id },
      note: '共享定义的名称、角色与专业数据合同；内部身份和源码文件引用由软件维护。' })
    const implementation = effective.kind === 'source' ? effective : getBuiltinComponentSource(effective.key)
    if (implementation?.kind !== 'source') return
    const binding = { kind: 'definition-source' as const, definitionId: definition.id }
    if (!implementation.workspace) {
      files.push({ path: `${base}.view.${implementation.language === 'typescript' ? 'ts' : 'js'}`, kind: 'source', content: implementation.source,
        language: implementation.language, implementation, binding, note: '共享定义源码；应用后所有未独立源码的实例一起更新。' })
      return
    }
    const sourceFiles = resources.components[implementation.workspace.ownerId] ?? {}
    const privateOwner = !componentSourceOwnerIsShared(project, '', implementation.workspace.ownerId, definition.id)
    if (!Object.hasOwn(sourceFiles, implementation.workspace.entry)) files.push({ path: `${base}.source/${implementation.workspace.entry}`,
      kind: 'source', language: implementation.language, implementation, binding,
      sourceFile: { path: implementation.workspace.entry, files: sourceFiles, privateOwner },
      note: '此共享定义的源码入口尚未提供；可补入源文，其余内容仍保留。' })
    for (const [path, bytes] of Object.entries(sourceFiles)) {
      const content = componentSourceFileText(bytes)
      files.push({ path: `${base}.source/${path}`, kind: content === null ? 'asset' : 'source', ...(content === null ? { bytes, mimeType: 'application/octet-stream' } : { content }),
        binding, implementation, language: implementation.language, sourceFile: { path, files: sourceFiles, privateOwner },
        note: '共享定义的正式文件；源文与二进制资源在同一批提交。' })
    }
  })
  const objects = (ids: readonly string[], folder: string, containerViewport: { width: number; height: number }) => ids.forEach((id, index) => {
    const firstFile = files.length
    const instance = project.instances[id]!, definition = project.definitions[instance.definitionId]!
    const programViewport = instance.frame ? { width: instance.frame.width, height: instance.frame.height } : containerViewport
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
    files.push({ path: `${base}.style.json`, kind: 'style', content: json(instance.style ?? {}), target })
    const effectiveImplementation = instance.implementationOverride ?? definition.implementation
    const implementation = effectiveImplementation.kind === 'source' ? effectiveImplementation
      : getBuiltinComponentSource(effectiveImplementation.key)
    if (implementation?.kind === 'source') {
      if (implementation.workspace) {
        const ownerId = implementation.workspace.ownerId
        const sourceFiles = resources.components[ownerId] ?? {}
        if (!Object.hasOwn(sourceFiles, implementation.workspace.entry)) files.push({
          path: `${base}.source/${implementation.workspace.entry}`, kind: 'source', target,
          language: implementation.language, implementation,
          sourceFile: { path: implementation.workspace.entry, files: sourceFiles, privateOwner: false },
          note: '此组件的正式源码入口尚未提供；其余工程内容仍可读取。',
        })
        const usedElsewhere = componentSourceOwnerIsShared(project, instance.id, ownerId)
        for (const [path, bytes] of Object.entries(sourceFiles)) {
          const content = componentSourceFileText(bytes)
          if (content === null) files.push({ path: `${base}.source/${path}`, kind: 'asset', bytes, mimeType: 'application/octet-stream',
            target, binding: { kind: 'instance-source', instanceId: id }, implementation,
            sourceFile: { path, files: sourceFiles, privateOwner: !!instance.implementationOverride && !usedElsewhere },
            note: 'workspace 的二进制原文件；应用为本实例保留原字节，其余文件和共享定义保持。' })
          else files.push({ path: `${base}.source/${path}`, kind: 'source', content, target,
            language: implementation.language, implementation,
            sourceFile: { path, files: sourceFiles, privateOwner: !!instance.implementationOverride && !usedElsewhere },
            note: '正式组件源码文件；应用只修改这一文件，并保留同一 workspace 的其他文件。默认定义编辑为本实例私有实现。' })
        }
      } else files.push({ path: `${base}.view.${implementation.language === 'typescript' ? 'ts' : 'js'}`,
        kind: 'source', content: implementation.source, target, language: implementation.language, implementation,
        note: '应用为这个实例的私有实现；默认定义及其他实例保留。' })
    }
    for (const file of files.slice(firstFile)) {
      if (file.target?.kind !== 'instance' || file.target.instanceId !== id) continue
      file.programViewport = programViewport
      if (effectiveImplementation.kind === 'source') file.implementation = effectiveImplementation
    }
    if (instance.childIds?.length) objects(instance.childIds, base, programViewport)
  })
  project.surfaces.forEach((surface, index) => {
    const base = surfacePath(surface.title, index)
    const layout = surface.kind === 'flow' ? surface.flow?.layout : undefined
    const programViewport = { width: (layout?.widthMode === 'fluid' ? layout.wideContentWidth : layout?.readingWidth)
      ?? surface.designSize?.width ?? defaultViewport.width, height: surface.designSize?.height ?? defaultViewport.height }
    const target: ContentApplyTarget = { kind: 'container', container: { kind: 'surface', surfaceId: surface.id } }
    const projection = projectHtmlProjection(project, surface.childIds)
    if (projection) files.push({ path: `${base}.html`, kind: 'page', content: projection.html, target, projection, programViewport })
    files.push({ path: `${base}.json`, kind: 'structure', content: json({ title: surface.title, kind: surface.kind,
      designSize: surface.designSize, objects: surface.childIds.map((id, order) => ({ order: order + 1, type: project.definitions[project.instances[id]!.definitionId]!.title ?? project.instances[id]!.definitionId,
        frame: project.instances[id]!.frame })) }), target, programViewport, note: '当前结构与人工位置；内容在同名目录。可向本页插入内容，整页重做须明确表达 redo。' })
    objects(surface.childIds, base, programViewport)
    if (surface.kind === 'spatial') {
      const spatial = surface.spatial ?? { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
      const { source, refs } = observeSpatialSource(project, surface.id, objectPaths)
      files.push({ path: `${base}.spatial.json`, kind: 'data', content: json(source), binding: { kind: 'spatial', surfaceId: surface.id, objectPaths, refs },
        note: '空间镜头源文；保留已观察 ref 可重排镜头、路径和关系。新项省略 ref；target/objects 使用本次对象路径，paths.stops 使用已读镜头 ref，新镜头也可用本文件镜头序号。pose 可为 currentViewport，由当前空间视口提供。' })
    }
    if (surface.kind === 'flow') {
      const document = projectFlowDocument(project, surface.id)
      const objectPaths = Object.fromEntries(files.flatMap(file => file.target?.kind === 'instance' && (file.kind === 'data' || file.kind === 'html') ? [[file.target.instanceId, file.path]] : []))
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
  for (const asset of Object.values(project.assets)) {
    const bytes = resources.assets[asset.id]
    const content = bytes && (asset.mimeType?.startsWith('text/') || asset.mimeType === 'image/svg+xml') ? componentSourceFileText(bytes) : null
    files.push({ path: asset.path, kind: 'asset', bytes, mimeType: asset.mimeType, binding: { kind: 'asset', assetId: asset.id },
      ...(content !== null ? { content } : {}) })
  }
  return files
}

/** Resolve logical scope against the same canonical capture that produced natural file paths. */
export function componentProjectScopeFiles(project: CourseProjectV10, files: ComponentProjectFile[], scope: ComponentProjectFileScope): ComponentProjectFile[] {
  if (scope.kind === 'document') return files
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
  if (project.background?.assetId) assets.add(project.background.assetId)
  for (const surface of project.surfaces) {
    if (scope.kind === 'surface' && surface.id !== scope.surfaceId) continue
    if (scope.kind === 'surface' && surface.background?.assetId) assets.add(surface.background.assetId)
    for (const state of surface.presentation?.states ?? []) {
      if (scope.kind === 'surface' && state.background?.assetId) assets.add(state.background.assetId)
      for (const [id, override] of Object.entries(state.overrides)) if (instances.has(id) && override.data !== undefined) {
        const instance = project.instances[id], definition = project.definitions[instance.definitionId]
        if (definition) componentAssetIds({ ...instance, data: override.data }, definition).forEach(id => assets.add(id))
      }
    }
  }
  return files.filter(file => {
    if (file.target?.kind === 'instance') return instances.has(file.target.instanceId)
    if (file.target?.kind === 'container') return scope.kind === 'surface' && file.target.container.kind === 'surface' && file.target.container.surfaceId === scope.surfaceId
    const binding = file.binding
    if (!binding) return false
    if (binding.kind === 'project-settings') return false
    if (binding.kind === 'theme') return true
    if (binding.kind === 'definition' || binding.kind === 'definition-source') return definitions.has(binding.definitionId)
    if (binding.kind === 'instance-source') return instances.has(binding.instanceId)
    if (binding.kind === 'asset') return assets.has(binding.assetId)
    return scope.kind === 'surface' && binding.surfaceId === scope.surfaceId
  })
}
