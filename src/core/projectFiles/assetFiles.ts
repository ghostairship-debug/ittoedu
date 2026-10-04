import { assetReferencePath, cssUrlReferences } from '../../shared/composition/projectReferences'
import type { AssetSource } from '../../shared/contracts/media-v1/types'
import type { CourseProjectDocument, FlowBlock } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import type { ImageAssetResource } from '../tools/imageAssetMetadata'
import { assetFilePath, type PageNode } from './pageHtml'
import { assetFiles } from './projectFileView'
import { ProjectFileError, type PlannedChange } from './slidePages'

const EXTENSION_TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'xlink:href', 'data'])

/** `assets/<name>`: segments are file names; the extension names the image type. */
export function assetPathIssue(path: string): string | undefined {
  if (!path.startsWith('assets/')) return '素材路径须为 assets/<文件名>'
  const segments = path.slice('assets/'.length).split('/')
  // eslint-disable-next-line no-control-regex
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\:*?"<>|#%\u0000-\u001f]/.test(segment) || segment !== segment.trim()))
    return '素材文件名不能为空，不能含 \\ : * ? " < > | # % 或控制字符'
  if (!EXTENSION_TYPES[path.split('.').at(-1)!.toLowerCase()]) return '素材须为 .svg、.png、.jpg、.webp 或 .gif 图片'
  return undefined
}

export const assetPathType = (path: string) => EXTENSION_TYPES[path.split('.').at(-1)!.toLowerCase()]!

/**
 * Write the bytes of `assets/<name>`. An existing file keeps its asset identity, so every use of it follows
 * (pages by path, objects by identity); a new file becomes an asset stored at that path.
 */
export function planAssetWrite(project: CourseProjectDocument, resources: DocumentResources, path: string,
  prepared: ImageAssetResource, source: AssetSource): PlannedChange {
  const issue = assetPathIssue(path)
  if (issue) throw new ProjectFileError('invalid-path', issue)
  if (prepared.meta.mimeType !== assetPathType(path)) throw new ProjectFileError('type-mismatch', `${path} 的扩展名与图片实际类型（${prepared.meta.mimeType}）不符`)
  const existing = assetFiles(project).find(file => file.path === path)?.meta
  if (Object.values(project.assets).some(meta => meta !== existing && assetFilePath(meta) === path))
    throw new ProjectFileError('software-file', `${path} 由软件维护，不能写入`)
  const id = existing?.id ?? prepared.meta.id
  const next = structuredClone(project)
  next.assets[id] = { ...prepared.meta, id, path, filename: path.split('/').at(-1)!, source }
  return { project: next, resources: { ...resources, assets: { ...resources.assets, [id]: Uint8Array.from(prepared.bytes) } },
    identity: `asset:${id}`, diagnostics: [] }
}

/** Rewrite `../assets/<from>` references written in pages, handout media and the theme. */
function moveReferences(project: CourseProjectDocument, from: string, to: string): void {
  const rewrite = (value: string) => assetReferencePath(value) === from ? value.replace(from.slice('assets/'.length), to.slice('assets/'.length)) : value
  const css = (text: string) => {
    let output = '', cursor = 0
    for (const reference of cssUrlReferences(text)) {
      if (assetReferencePath(reference.reference) !== from) continue
      output += text.slice(cursor, reference.start) + `url(${JSON.stringify(rewrite(reference.reference))})`
      cursor = reference.end
    }
    return output + text.slice(cursor)
  }
  const sources = (blocks: FlowBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'media' && block.source !== undefined) block.source = rewrite(block.source)
      else if (block.type === 'section') sources(block.blocks)
    }
  }
  const visit = (node: PageNode) => {
    if (node.kind === 'document') sources(node.content.blocks)
    if (node.kind !== 'element') return
    for (const [name, value] of Object.entries(node.attributes)) {
      const key = name.toLowerCase()
      if (URL_ATTRIBUTES.has(key)) node.attributes[name] = rewrite(value)
      else if (key === 'srcset') node.attributes[name] = value.split(',').map(part => {
        const [url = '', ...rest] = part.trim().split(/\s+/)
        return [rewrite(url), ...rest].join(' ')
      }).join(', ')
      else if (key === 'style') node.attributes[name] = css(value)
    }
    if (node.tagName.toLowerCase() === 'style') node.children.forEach(child => { if (child.kind === 'text') child.text = css(child.text) })
    node.children.forEach(visit)
  }
  const items = [...project.globalLayerItems.map(entry => entry.item), ...project.surfaces.flatMap(surface => [
    ...surface.surfaceLayerItems.map(entry => entry.item),
    ...surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : surface.type === 'spatial-2d' ? surface.world.layerItems : [],
  ])]
  for (const item of items) if (item.kind === 'composition') visit(item.content.root)
  for (const surface of project.surfaces) if (surface.type === 'flow') sources(surface.blocks)
  if (project.theme) project.theme.css = css(project.theme.css)
}

/** Rename an asset file; pages, handouts and the theme that wrote its old path follow. */
export function planAssetMove(project: CourseProjectDocument, resources: DocumentResources, from: string, to: string): PlannedChange {
  const existing = assetFiles(project).find(file => file.path === from)?.meta
  if (!existing) throw new ProjectFileError('not-found', `没有这个素材：${from}`)
  const issue = assetPathIssue(to)
  if (issue) throw new ProjectFileError('invalid-path', issue)
  if (assetPathType(to) !== existing.mimeType) throw new ProjectFileError('type-mismatch', '改名不能改变图片类型')
  if (Object.values(project.assets).some(meta => meta.id !== existing.id && assetFilePath(meta) === to)) throw new ProjectFileError('exists', `${to} 已存在`)
  const next = structuredClone(project)
  next.assets[existing.id] = { ...next.assets[existing.id]!, path: to, filename: to.split('/').at(-1)! }
  moveReferences(next, from, to)
  return { project: next, resources, identity: `asset:${existing.id}`, diagnostics: [] }
}

/** Deleting an asset frees its path; pages that wrote it show the pending placeholder. Objects that still use it refuse the commit. */
export function planAssetDelete(project: CourseProjectDocument, resources: DocumentResources, path: string): PlannedChange {
  const existing = assetFiles(project).find(file => file.path === path)?.meta
  if (!existing) throw new ProjectFileError('not-found', `没有这个素材：${path}`)
  const next = structuredClone(project)
  delete next.assets[existing.id]
  const { [existing.id]: _removed, ...assets } = resources.assets
  return { project: next, resources: { ...resources, assets }, identity: `asset:${existing.id}`, diagnostics: [] }
}
