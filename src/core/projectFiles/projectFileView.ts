import type { CompositionLayerItem, CourseProjectDocument, LayerItem, RuntimeLayerItem, SlideSceneDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { unpackHtmlDocumentRuntimeSource } from '../../shared/runtime/htmlDocumentSource'
import { documentDigest } from '../documents/documentDigest'
import { assetFilePath, componentReferenceName, serializePageHtml, type PageNode } from './pageHtml'

export const CONTROLLER_FILE = 'controller/教师控制台.js'
const PAGE_TYPE = { composition: '可编辑页', program: '整页程序', blank: '空白页' } as const
const NATIVE_KIND: Record<string, string> = { text: '文字', formula: '公式', image: '图片', video: '视频', shape: '形状', table: '表格', chart: '图表', input: '输入框' }

export type PageCarrier =
  | { kind: 'composition'; item: CompositionLayerItem }
  | { kind: 'program'; item: RuntimeLayerItem; html: string }

export interface SlidePageFile {
  path: string
  /** 0-based position within its Slide surface; the file number is position + 1. */
  index: number
  surfaceId: string
  sceneId: string
  locationId: string
  scene: SlideSceneDocument
  carrier?: PageCarrier
}

export interface ProjectFileEntry {
  path: string
  type: string
  /** Short facts a model needs to decide what to open; never identities. */
  note?: string
}

/** A name usable as a file name: path separators and reserved characters are replaced. */
export function fileStem(name: string): string {
  // eslint-disable-next-line no-control-regex
  const stem = name.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '')
  return stem || '未命名'
}

/** The page body is the lowest editable composition or software-wrapped page program; other layers stay objects on it. */
export function pageCarrier(scene: SlideSceneDocument): PageCarrier | undefined {
  let found: PageCarrier | undefined
  for (const item of scene.layerItems) {
    let carrier: PageCarrier | undefined
    if (item.kind === 'composition') carrier = { kind: 'composition', item }
    else if (item.kind === 'runtime') {
      const payload = unpackHtmlDocumentRuntimeSource(item.runtime.source)
      if (payload) carrier = { kind: 'program', item, html: payload.html }
    }
    if (carrier && (!found || carrier.item.order < found.item.order)) found = carrier
  }
  return found
}

export function slideFolder(surfaceIndex: number): string {
  return surfaceIndex === 0 ? 'slides' : `slides-${surfaceIndex + 1}`
}

/** One file per scene, numbered in surface order: `slides/01-导入.html`. */
export function slidePageFiles(project: CourseProjectDocument): SlidePageFile[] {
  const pages: SlidePageFile[] = []
  project.surfaces.filter(surface => surface.type === 'slide').forEach((surface, surfaceIndex) => {
    if (surface.type !== 'slide') return
    const width = Math.max(2, String(surface.scenes.length).length)
    surface.scenes.forEach((scene, index) => {
      const location = project.locations.find(value => value.kind === 'slide-scene' && value.surfaceId === surface.id
        && value.sceneId === scene.id && value.stateId === undefined)
      if (!location) return
      const carrier = pageCarrier(scene)
      pages.push({ path: `${slideFolder(surfaceIndex)}/${String(index + 1).padStart(width, '0')}-${fileStem(scene.name)}.html`,
        index, surfaceId: surface.id, sceneId: scene.id, locationId: location.id, scene, ...(carrier ? { carrier } : {}) })
    })
  })
  return pages
}

/** Software-owned images (static fallbacks of programs and components) are not author files. */
function softwareAssetIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  const node = (value: PageNode) => {
    if (value.kind === 'runtime' && value.runtime.staticFallback) ids.add(value.runtime.staticFallback.assetId)
    if (value.kind === 'element') value.children.forEach(node)
  }
  const layer = (item: LayerItem) => {
    if (item.kind === 'runtime' && item.runtime.staticFallback) ids.add(item.runtime.staticFallback.assetId)
    if (item.kind === 'component' && item.staticFallbackAssetId) ids.add(item.staticFallbackAssetId)
    if (item.kind === 'composition') node(item.content.root)
  }
  const blocks = (values: readonly unknown[]) => values.forEach(value => {
    const block = value as { type?: string; staticFallbackAssetId?: string; blocks?: unknown[] }
    if (block.type === 'component' && block.staticFallbackAssetId) ids.add(block.staticFallbackAssetId)
    if (block.type === 'section' && Array.isArray(block.blocks)) blocks(block.blocks)
  })
  project.globalLayerItems.forEach(entry => layer(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach(entry => layer(entry.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => scene.layerItems.forEach(layer))
    else if (surface.type === 'spatial-2d') surface.world.layerItems.forEach(layer)
    else blocks(surface.blocks)
  }
  return ids
}

export function assetFiles(project: CourseProjectDocument) {
  const hidden = softwareAssetIds(project)
  return Object.values(project.assets).filter(meta => !hidden.has(meta.id)).map(meta => ({ path: assetFilePath(meta), meta }))
}

const RELATIVE_ASSET = /(?:^|[\s"'(,=])(?:\.{1,2}\/)*assets\/([^\s"'(),?#<>]+)/g

/** References a page makes to files that do not exist yet: `../assets/x.svg` and `../components/x.html`. */
function pendingReferences(pages: readonly SlidePageFile[], project: CourseProjectDocument) {
  const assets = new Set(assetFiles(project).map(file => file.path))
  const pending = new Map<string, { type: '待填素材' | '待写组件'; description?: string; usedBy: Set<string> }>()
  const add = (path: string, type: '待填素材' | '待写组件', page: string, description?: string) => {
    const entry = pending.get(path) ?? { type, usedBy: new Set<string>() }
    entry.usedBy.add(page)
    if (!entry.description && description) entry.description = description
    pending.set(path, entry)
  }
  for (const page of pages) {
    if (page.carrier?.kind !== 'composition') continue
    const visit = (node: PageNode) => {
      if (node.kind !== 'element') return
      const description = node.attributes.alt || node.attributes.title || node.attributes['aria-label']
      const component = node.tagName === 'iframe' ? componentReferenceName(node.attributes.src) : undefined
      if (component !== undefined && !node.children.some(child => child.kind === 'runtime')) add(`components/${component}.html`, '待写组件', page.path, description)
      for (const value of Object.values(node.attributes)) for (const match of value.matchAll(RELATIVE_ASSET)) {
        let name = match[1]!
        try { name = decodeURI(name) } catch { /* Keep the written form. */ }
        if (!assets.has(`assets/${name}`)) add(`assets/${name}`, '待填素材', page.path, description)
      }
      node.children.forEach(visit)
    }
    visit(page.carrier.item.content.root)
  }
  return pending
}

function controllerItem(project: CourseProjectDocument) {
  const entry = project.globalLayerItems.find(value => value.item.kind === 'component' && value.item.role === 'teacher-controller')
  return entry?.item.kind === 'component' ? entry.item : undefined
}

/** The installed controller package's entry source, if this project has a teacher controller. */
export function controllerSource(project: CourseProjectDocument, resources: DocumentResources): { source: string; packageId: string; version: string; entry: string } | undefined {
  const item = controllerItem(project)
  const meta = item && project.componentPackages[item.component.packageId]
  if (!item || !meta || meta.version !== item.component.version) return undefined
  const files = resources.components[`${meta.packageId}@${meta.version}`]
  const manifest = files?.['manifest.json'] && JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { entry?: unknown }
  const entry = typeof manifest?.entry === 'string' ? manifest.entry : undefined
  const bytes = entry ? files?.[entry] : undefined
  return bytes && entry ? { source: new TextDecoder().decode(bytes), packageId: meta.packageId, version: meta.version, entry } : undefined
}

function objectSummary(scene: SlideSceneDocument, carrier: PageCarrier | undefined): string[] {
  return [...scene.layerItems].sort((a, b) => a.order - b.order).filter(item => item !== carrier?.item).map(item => {
    const kind = item.kind === 'native' ? NATIVE_KIND[item.content.nativeType] ?? '对象' : item.kind === 'component' ? '组件'
      : item.kind === 'runtime' ? '程序' : '组合内容'
    return item.label ? `${kind}“${item.label}”` : kind
  })
}

export function listProjectFiles(project: CourseProjectDocument, resources: DocumentResources): ProjectFileEntry[] {
  const pages = slidePageFiles(project)
  const files: ProjectFileEntry[] = pages.map(page => {
    const objects = objectSummary(page.scene, page.carrier)
    return { path: page.path, type: PAGE_TYPE[page.carrier?.kind ?? 'blank'], ...(objects.length ? { note: `另有独立对象：${objects.join('、')}` } : {}) }
  })
  for (const { path, meta } of assetFiles(project)) files.push({ path, type: '素材',
    note: [meta.mimeType, meta.width && meta.height ? `${meta.width}×${meta.height}` : ''].filter(Boolean).join('，') })
  for (const [path, entry] of pendingReferences(pages, project)) files.push({ path, type: entry.type,
    note: [entry.description && `说明：${entry.description}`, `引用页：${[...entry.usedBy].join('、')}`].filter(Boolean).join('；') })
  if (controllerSource(project, resources)) files.push({ path: CONTROLLER_FILE, type: '教师控制台' })
  return files
}

export type ProjectFileRead =
  | { kind: 'page'; path: string; type: string; content: string; objects: string[]; page: SlidePageFile }
  | { kind: 'asset'; path: string; mediaType: string; byteLength: number; width?: number; height?: number; content?: string; assetId: string }
  | { kind: 'controller'; path: string; content: string }

/** Current content of one project file, including unsaved human edits held by the session. */
export function readProjectFile(project: CourseProjectDocument, resources: DocumentResources, path: string): ProjectFileRead | undefined {
  const page = slidePageFiles(project).find(value => value.path === path)
  if (page) {
    const carrier = page.carrier
    const content = carrier?.kind === 'composition' ? serializePageHtml(carrier.item.content, project.assets)
      : carrier?.kind === 'program' ? carrier.html.replace(/cw-resource:([a-zA-Z0-9_.-]+)/g, (reference, key: string) => {
        const meta = project.assets[carrier.item.runtime.assets[key]?.assetId ?? '']
        return meta ? `../${assetFilePath(meta)}` : reference
      }) : ''
    return { kind: 'page', path, type: PAGE_TYPE[page.carrier?.kind ?? 'blank'], content, objects: objectSummary(page.scene, page.carrier), page }
  }
  const asset = assetFiles(project).find(value => value.path === path)
  if (asset) {
    const bytes = resources.assets[asset.meta.id]
    const text = asset.meta.mimeType === 'image/svg+xml' && bytes ? new TextDecoder().decode(bytes) : undefined
    return { kind: 'asset', path, mediaType: asset.meta.mimeType, byteLength: asset.meta.byteLength, assetId: asset.meta.id,
      ...(asset.meta.width !== undefined ? { width: asset.meta.width } : {}), ...(asset.meta.height !== undefined ? { height: asset.meta.height } : {}),
      ...(text !== undefined ? { content: text } : {}) }
  }
  if (path === CONTROLLER_FILE) {
    const controller = controllerSource(project, resources)
    if (controller) return { kind: 'controller', path, content: controller.source }
  }
  return undefined
}

/** Version a run records when it reads a file; a whole-file write compares it with the current one. */
export function projectFileVersion(file: ProjectFileRead, resources: DocumentResources): string {
  return file.kind === 'asset' ? documentDigest([file.mediaType, resources.assets[file.assetId] ?? null]) : documentDigest(file.content)
}

/** The stable object a file path currently addresses; survives renames and reordering. */
export function projectFileIdentity(file: ProjectFileRead): string {
  return file.kind === 'page' ? `page:${file.page.sceneId}` : file.kind === 'asset' ? `asset:${file.assetId}` : 'controller'
}
