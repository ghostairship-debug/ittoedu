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
import { serializeFlowHtml } from '../../../shared/document/html'
import { componentSourceOwnerIsShared } from '../../components/source/sourceAuthoringEdits'

type Element = DefaultTreeAdapterTypes.Element
type Node = DefaultTreeAdapterTypes.ChildNode
const element = (node: Node): node is Element => 'tagName' in node
const stem = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+|\.+$/g, '') || '未命名'
const json = (value: unknown) => JSON.stringify(value, null, 2)

export interface ComponentProjectFile {
  path: string
  kind: 'framework' | 'page' | 'structure' | 'html' | 'data' | 'style' | 'source' | 'asset'
  content?: string
  bytes?: Uint8Array
  mimeType?: string
  note?: string
  /** Software-only bindings; tool results expose paths and content, never require these fields. */
  target?: ContentApplyTarget
  projection?: HtmlContentProjection
  language?: 'javascript' | 'typescript'
  implementation?: Extract<ComponentImplementation, { kind: 'source' }>
  sourceFile?: { path: string; files: Record<string, Uint8Array>; privateOwner: boolean }
  /** Canonical fields that are not object content. Identities stay inside this software projection. */
  binding?:
    | { kind: 'theme' }
    | { kind: 'definition'; definitionId: string }
    | { kind: 'definition-source'; definitionId: string }
    | { kind: 'instance-source'; instanceId: string }
    | { kind: 'spatial'; surfaceId: string; objectPaths: Record<string, string> }
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
    const html = webHtml(project, instance)
    const implementation = instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation
    if (html === undefined || implementation?.kind !== 'builtin' || implementation.key !== 'guoling.web') return undefined
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
  const surfacePath = (title: string, index: number) => `pages/${String(index + 1).padStart(2, '0')}-${stem(title)}`
  const files: ComponentProjectFile[] = [{ path: 'pages', kind: 'framework',
    content: json({ pages: project.surfaces.map((surface, index) => ({ path: `${surfacePath(surface.title, index)}.json`, title: surface.title, kind: surface.kind })) }),
    note: '页面框架目录。surface.add 新增页面；现存页面路径可用 surface.move、surface.remove、surface.title，before 选择本次列出的页面路径，省略即末尾。身份与编号由软件维护。' }]
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
      const source = { home: spatial.home,
        stops: spatial.frames.map(frame => ({ title: frame.title, pose: frame.pose, ...(frame.targetInstanceId ? { target: objectPaths[frame.targetInstanceId] } : {}) })),
        ...(spatial.paths ? { paths: spatial.paths.map(path => ({ title: path.title, stops: path.frameIds.map(id => spatial.frames.findIndex(frame => frame.id === id) + 1),
          objects: path.instanceIds?.map(id => objectPaths[id]), style: path.style })) } : {}),
        ...(spatial.relations ? { relations: spatial.relations.map(relation => ({ from: objectPaths[relation.sourceInstanceId], to: objectPaths[relation.targetInstanceId], label: relation.label, kind: relation.kind })) } : {}),
        ...(spatial.semanticZoom ? { semanticZoom: spatial.semanticZoom.map(rule => ({ objects: rule.instanceIds.map(id => objectPaths[id]), minZoom: rule.minZoom, maxZoom: rule.maxZoom, visible: rule.visible })) } : {}) }
      files.push({ path: `${base}.spatial.json`, kind: 'data', content: json(source), binding: { kind: 'spatial', surfaceId: surface.id, objectPaths },
        note: '空间镜头源文；stops 按镜头顺序，target/objects 使用本次观察的对象路径，paths.stops 使用本文件镜头序号。软件维护身份，修改镜头不重排对象。' })
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
