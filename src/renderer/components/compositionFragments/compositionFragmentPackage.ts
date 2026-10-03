import { nanoid } from 'nanoid'
import { zipSync } from 'fflate'
import type { ComponentManifest, ComponentPackageData } from '../../../shared/componentTypes'
import type { CompositionLayerItem, CourseAssetMeta, CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { DocumentBlock } from '../../../shared/document/content'
import { walkComposition } from '../../../shared/composition/content'
import { compositionFragmentSchema, instantiateCompositionFragment, type CompositionFragment } from '../../../shared/composition/fragment'
import { visitCompositionReferences } from '../../../shared/composition/references'
import { visitAllCourseLayerItems } from '../../../core/tools/layerOrder'
import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import { componentPackageMeta } from '../../../shared/componentPackageMeta'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import type { HistoryResourceChanges } from '../../store/courseResourceState'
import { rebuildChartItemIds } from '../../../core/tools/chartIdentity'
import { rebuildTableItemIds } from '../../../core/tools/nativeNodeFactories'

function field(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? Reflect.get(value, key) : undefined, object)
}

function setField(object: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.')
  let current = object
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') return
    current = current[part] as Record<string, unknown>
  }
  current[parts.at(-1)!] = value
}

function visitComponentBlocks(content: CompositionLayerItem['content'], visit: (block: Extract<DocumentBlock, { type: 'component' }>) => void): void {
  const blocks = (items: DocumentBlock[]) => items.forEach(block => {
    if (block.type === 'component') visit(block)
    else if (block.type === 'section') blocks(block.blocks)
  })
  walkComposition(content.root, node => { if (node.kind === 'document') blocks(node.content.blocks) })
}

export function compositionLayerIn(project: CourseProjectDocument, layerItemId: string): CompositionLayerItem | null {
  let found: CompositionLayerItem | null = null
  visitAllCourseLayerItems(project, item => { if (item.layerItemId === layerItemId && item.kind === 'composition') found = item })
  return found
}

/** Capture the selected authored composition and its actual managed dependency closure. */
export function createCompositionFragmentPackage(input: {
  project: CourseProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  componentPackages: Readonly<Record<string, ComponentPackageData>>
  layerItemId: string
  name: string
  packageId?: string
}): ComponentPackageData {
  const layer = compositionLayerIn(input.project, input.layerItemId)
  if (!layer) throw new Error('请先选择一个组合内容。')
  const name = input.name.trim()
  if (!name || name.length > 100) throw new Error('资产名称应为 1–100 个字符。')
  const content = structuredClone(layer.content)
  const assetIds = new Set<string>()
  const componentIds = new Set<string>()
  visitCompositionReferences(content, ref => {
    if (ref.kind === 'asset') assetIds.add(ref.id)
    else if (ref.kind === 'component') {
      const pkg = input.componentPackages[ref.id]
      if (!pkg || pkg.manifest.version !== ref.version) throw new Error(`片段依赖组件“${ref.id}”的实际版本缺失。`)
      componentIds.add(ref.id)
    } else if (ref.id !== layer.layerItemId) {
      throw new Error('该片段的互动依赖其它画布对象，请将互动整理为片段内区域后再提取。')
    }
  })
  visitComponentBlocks(content, block => {
    const pkg = input.componentPackages[block.component.packageId]
    pkg?.manifest.editor?.properties.filter(property => property.type === 'image').forEach(property => {
      const id = field(block.props, property.key)
      if (typeof id === 'string' && id) assetIds.add(id)
    })
  })
  const files: Record<string, Uint8Array> = {}
  const fragment: CompositionFragment = {
    format: 'guoling-composition-fragment', version: 1,
    sourceLayerItemId: layer.layerItemId, content, assets: {}, components: {},
    ...(input.project.network?.connectOrigins?.length ? { connectOrigins: [...input.project.network.connectOrigins] } : {}),
  }
  let index = 0
  for (const id of assetIds) {
    const meta = input.project.assets[id]
    const bytes = input.assetFiles[id]
    if (!meta || !bytes || bytes.byteLength !== meta.byteLength) throw new Error(`片段依赖的素材“${id}”尚未完整保存。`)
    const path = `assets/${index++}/${meta.filename.replace(/[\\/]/g, '_')}`
    fragment.assets[id] = { meta: structuredClone(meta), path }
    files[path] = Uint8Array.from(bytes)
  }
  for (const id of componentIds) {
    const data = input.componentPackages[id]!
    if (data.manifest.content?.kind === 'composition') throw new Error('结构片段应作为组合内容插入，不能放入程序组件节点。')
    const root = `dependencies/${index++}`
    fragment.components[id] = { version: data.manifest.version, root }
    Object.entries(data.files).forEach(([path, bytes]) => { files[`${root}/${path}`] = Uint8Array.from(bytes) })
  }
  const manifest: ComponentManifest = {
    schemaVersion: 4, runtimeApiVersion: 4,
    id: input.packageId ?? `local.composition.${nanoid(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`,
    name, version: '1.0.0', description: '可编辑结构片段；插入后文案、布局、专业内容与互动由实例独立拥有。',
    content: { kind: 'composition' }, entry: 'composition.json', supportedScopes: ['scene', 'global'], renderMode: 'dom',
    defaultSize: { width: layer.frame.width, height: layer.frame.height }, minSize: { width: 16, height: 16 },
    preserveAspectRatio: false, assets: {}, defaultProps: {},
  }
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2))
  files['manifest.json'] = encode(manifest)
  files[manifest.entry] = encode(fragment)
  return parseComponentPackageFiles(files)
}

export function readCompositionFragmentPackage(data: ComponentPackageData): CompositionFragment {
  if (data.manifest.content?.kind !== 'composition') throw new Error('该组件包不是结构片段。')
  const bytes = data.files[data.manifest.entry]
  if (!bytes) throw new Error('结构片段内容文件缺失。')
  return compositionFragmentSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
}

export function exportCompositionFragmentPackage(data: ComponentPackageData): Uint8Array {
  readCompositionFragmentPackage(data)
  return zipSync(data.files)
}

/** Join resources to the existing project owner, then materialise independent authored content. */
export function materializeCompositionFragment(input: {
  document: CourseProjectDocument
  componentPackages: Readonly<Record<string, ComponentPackageData>>
  assetFiles: Readonly<Record<string, Uint8Array>>
  data: ComponentPackageData
  idFactory?: () => string
}): { item: CompositionLayerItem; resourceChanges: HistoryResourceChanges } {
  const id = input.idFactory ?? (() => `fragment-${nanoid(12)}`)
  const fragment = readCompositionFragmentPackage(input.data)
  const assetMap: Record<string, string> = {}
  const changes: HistoryResourceChanges = { assetFileChanges: [], componentPackageChanges: [] }
  const availableFiles = { ...input.assetFiles }
  for (const [sourceId, dependency] of Object.entries(fragment.assets)) {
    const bytes = input.data.files[dependency.path]
    if (!bytes || bytes.byteLength !== dependency.meta.byteLength) throw new Error(`片段素材“${sourceId}”文件缺失。`)
    const reused = Object.values(input.document.assets).find(meta => {
      const existing = availableFiles[meta.id]
      return meta.mimeType === dependency.meta.mimeType && meta.kind === dependency.meta.kind && existing?.byteLength === bytes.byteLength
        && bytes.every((byte, at) => existing[at] === byte)
    })
    if (reused) { assetMap[sourceId] = reused.id; continue }
    const assetId = id()
    const extension = dependency.meta.filename.match(/\.[^./\\]+$/)?.[0] ?? ''
    const meta: CourseAssetMeta = { ...structuredClone(dependency.meta), id: assetId, path: `assets/${assetId}${extension}` }
    input.document.assets[assetId] = meta
    availableFiles[assetId] = bytes
    assetMap[sourceId] = assetId
    changes.assetFileChanges!.push({ assetId, after: Uint8Array.from(bytes) })
  }
  const dependencies: Record<string, ComponentPackageData> = {}
  for (const [packageId, dependency] of Object.entries(fragment.components)) {
    const prefix = `${dependency.root}/`
    const files = Object.fromEntries(Object.entries(input.data.files).filter(([path]) => path.startsWith(prefix))
      .map(([path, bytes]) => [path.slice(prefix.length), bytes]))
    const parsed = parseComponentPackageFiles(files, { expectedId: packageId, expectedVersion: dependency.version })
    const existing = input.componentPackages[packageId]
    if (existing && (existing.manifest.version !== parsed.manifest.version || (existing.contentSha256 ?? componentContentSha256(existing.files)) !== parsed.contentSha256)) {
      throw new Error(`片段组件“${parsed.manifest.name}”与工程内版本不同；现有实例已保留，请先整理版本。`)
    }
    dependencies[packageId] = existing ?? parsed
    if (!existing) {
      input.document.componentPackages[packageId] = componentPackageMeta(parsed)
      changes.componentPackageChanges!.push({ packageId, after: parsed })
    }
  }
  const layerItemId = id()
  const content = instantiateCompositionFragment({ fragment, layerItemId, assetIds: assetMap, idFactory: id,
    rebuildNative: content => content.nativeType === 'chart' ? { ...content, data: rebuildChartItemIds(content.data, id) }
      : content.nativeType === 'table' ? { ...content, data: rebuildTableItemIds(content.data, id) } : content })
  visitComponentBlocks(content, block => {
    dependencies[block.component.packageId]?.manifest.editor?.properties.filter(property => property.type === 'image').forEach(property => {
      const original = field(block.props, property.key)
      if (typeof original === 'string' && assetMap[original]) setField(block.props, property.key, assetMap[original]!)
    })
  })
  if (fragment.connectOrigins?.length) input.document.network = {
    ...input.document.network,
    connectOrigins: [...new Set([...(input.document.network?.connectOrigins ?? []), ...fragment.connectOrigins])],
  }
  return {
    item: { layerItemId, kind: 'composition', label: input.data.manifest.name, content,
      frame: { mode: 'absolute', x: 0, y: 0, ...input.data.manifest.defaultSize },
      order: 0, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit' },
    resourceChanges: changes,
  }
}
