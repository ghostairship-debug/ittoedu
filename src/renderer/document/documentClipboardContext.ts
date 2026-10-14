import { z } from 'zod'
import { ownRecordSchema } from '../../shared/ownRecordSchema'
import { assetMetaSchema } from '../../shared/contracts/media-v1/schema'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
import { componentManifestSchema, embeddedComponentPackageMetaSchema } from '../../shared/contracts/component-v4/schema'
import type { ComponentPackageData, EmbeddedComponentPackageMeta } from '../../shared/contracts/component-v4/types'
import { documentResourcesSchema, type DocumentResources } from '../../shared/document/resources'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import { parseComponentPackageFiles } from '../../core/drivers/codecs/importComponentPackage'
import { courseProjectV10Schema, componentFlowPlacementSchema } from '../../shared/contracts/component-platform/schema'
import { extractComponentLibraryEntry } from '../../core/components/library'
import type { CourseObjectClipboardSource } from '../composition/crossSurfaceCommands'
import { owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'

const bytesSchema = z.array(z.number().int().min(0).max(255))
const contextSchema = z.object({
  kind: z.literal('cw-document-resources'),
  assets: ownRecordSchema(z.string(), z.object({ meta: assetMetaSchema, bytes: bytesSchema }).strict()),
  components: ownRecordSchema(z.string(), z.object({ meta: embeddedComponentPackageMetaSchema, data: z.object({
    manifest: componentManifestSchema, runtimeSource: z.string(), contentSha256: z.string().optional(),
    files: ownRecordSchema(z.string(), bytesSchema),
  }).strict() }).strict()),
}).strict()
export type DocumentClipboardContext = z.infer<typeof contextSchema>

/** Formal V10 bytes are separate from the PM manifest and native file packages. */
const courseContextSchema = z.object({
  kind: z.literal('cw-course-v10-resources'),
  documentId: z.string().optional(),
  project: courseProjectV10Schema,
  roots: z.array(z.string()),
  resources: z.object({
    assets: ownRecordSchema(z.string(), bytesSchema),
    components: ownRecordSchema(z.string(), ownRecordSchema(z.string(), bytesSchema)),
  }).strict(),
  matrices: ownRecordSchema(z.string(), z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])).optional(),
  anchors:z.array(z.object({instanceId:z.string(),placement:componentFlowPlacementSchema}).strict()).optional(),
  diagnostics: z.array(z.string()),
}).strict()
export type CourseDocumentClipboardContext = z.infer<typeof courseContextSchema>

/** Capture once from the source document; library extraction owns the closure. */
export function createCourseDocumentClipboardContext(source: CourseObjectClipboardSource): CourseDocumentClipboardContext {
  const { entry, diagnostics } = source.roots.length ? extractComponentLibraryEntry(source.project, source.resources, {
    id: `clipboard_${crypto.randomUUID()}`, title: '复制正文对象', rootIds: [...source.roots],
  }) : { entry: { definitions:{},example:{instances:{},rootIds:[]},assets:{},resources: { assets: {}, components: {} } }, diagnostics: [] }
  const ids=new Set(Object.keys(entry.example.instances)),roots=entry.example.rootIds
  const globals:{underlay:string[];overlay:string[]}={underlay:[],overlay:[]},surfaces:CourseProjectV10['surfaces']=[]
  const owner=(id:string)=>{let current=owningContainer(source.project,id);while(current?.kind==='instance')current=owningContainer(source.project,current.instanceId);return current}
  for(const id of roots){const current=owner(id);if(current?.kind==='global')globals[current.plane].push(id)}
  for(const original of source.project.surfaces){const childIds=roots.filter(id=>{const current=owner(id);return current?.kind==='surface' && current.surfaceId===original.id});if(!childIds.length)continue
    const presentation=original.presentation ? {...structuredClone(original.presentation),states:original.presentation.states.flatMap(state=>{
      const overrides=Object.fromEntries(Object.entries(state.overrides).filter(([id])=>ids.has(id))),order=state.order?.filter(id=>childIds.includes(id))
      return Object.keys(overrides).length || order?.length ? [{...structuredClone(state),overrides,...(order?{order}:{})}] : []
    })}:undefined
    if(presentation){if(!presentation.states.some(state=>state.id===presentation.initialStateId))delete presentation.initialStateId;if(!presentation.states.some(state=>state.id===presentation.thumbnailStateId))delete presentation.thumbnailStateId}
    surfaces.push({id:original.id,kind:original.kind,title:original.title,childIds,...(original.designSize?{designSize:structuredClone(original.designSize)}:{}),...(original.flow?{flow:structuredClone(original.flow)}:{}),...(presentation?.states.length?{presentation}:{})})
  }
  const project:CourseProjectV10={schemaVersion:10,id:source.project.id,revision:source.project.revision,title:source.project.title,definitions:entry.definitions,instances:entry.example.instances,assets:entry.assets,global:globals,surfaces}
  const stateKeys=new Set<string>()
  for(const instance of Object.values(project.instances)){const data=instance.data as {answer?:{stateKey?:string;validityKey?:string}};if(data?.answer){if(data.answer.stateKey)stateKeys.add(data.answer.stateKey);if(data.answer.validityKey)stateKeys.add(data.answer.validityKey)}}
  if(stateKeys.size && source.project.logic)project.logic={courseState:source.project.logic.courseState.filter(state=>stateKeys.has(state.key)),navigationGuards:[]}
  return courseContextSchema.parse({
    kind: 'cw-course-v10-resources', documentId: source.documentId,
    project, roots: [...source.roots],
    resources: {
      assets: Object.fromEntries(Object.entries(entry.resources.assets).map(([id, bytes]) => [id, Array.from(bytes)])),
      components: Object.fromEntries(Object.entries(entry.resources.components).map(([id, files]) => [id,
        Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Array.from(bytes)]))])),
    },
    matrices: source.matrices && Object.fromEntries(Object.entries(source.matrices).filter(([id])=>ids.has(id))),
    anchors:source.anchors ?? Object.values(source.project.instances).flatMap(instance=>instance.flowPlacement?.paragraphAnchor && ids.has(instance.flowPlacement.paragraphAnchor.blockId) && !ids.has(instance.id) ? [{instanceId:instance.id,placement:instance.flowPlacement}]:[]),diagnostics: diagnostics.map(value => value.message),
  })
}

export function readCourseDocumentClipboardContext(input: unknown): CourseObjectClipboardSource & { diagnostics: string[] } {
  const context = courseContextSchema.parse(input)
  return {
    documentId: context.documentId, project: context.project, roots: context.roots, matrices: context.matrices,anchors:context.anchors,
    resources: {
      assets: Object.fromEntries(Object.entries(context.resources.assets).map(([id, bytes]) => [id, Uint8Array.from(bytes)])),
      components: Object.fromEntries(Object.entries(context.resources.components).map(([id, files]) => [id,
        Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]))])),
    },
    diagnostics: context.diagnostics,
  }
}

export function selectCourseDocumentClipboardContext(input: unknown, roots: readonly string[]): CourseDocumentClipboardContext {
  const source = readCourseDocumentClipboardContext(input)
  if (roots.some(id => !source.roots.includes(id))) throw new Error('复制正文对象不在捕获的资源闭包中')
  return createCourseDocumentClipboardContext({ ...source, roots })
}
type AssetRef = DocumentResources['assets'][number]
type ComponentRef = DocumentResources['components'][number]
export const documentComponentKey = (resource:Pick<ComponentRef,'packageId'|'version'>):string => JSON.stringify([resource.packageId,resource.version])

export function createDocumentClipboardContext(resources: DocumentResources, source: {
  assets: Readonly<Record<string, AssetMeta>>
  assetFiles: Readonly<Record<string, Uint8Array>>
  componentPackages: Readonly<Record<string, ComponentPackageData>>
}): DocumentClipboardContext {
  documentResourcesSchema.parse(resources)
  const context: DocumentClipboardContext = { kind: 'cw-document-resources', assets: Object.create(null), components: Object.create(null) }
  for (const ref of resources.assets) {
    const meta = source.assets[ref.assetId]
    const bytes = meta && source.assetFiles[ref.assetId]
    if (!meta || !bytes) throw new Error(`复制素材缺少真实文件：${ref.assetId}`)
    context.assets[ref.assetId] = { meta: structuredClone(meta), bytes: Array.from(bytes) }
  }
  for (const ref of resources.components) {
    const key=documentComponentKey(ref),data = source.componentPackages[key] ?? source.componentPackages[ref.packageId]
    if (!data || data.manifest.version !== ref.version) throw new Error(`复制组件缺少真实包：${ref.packageId}@${ref.version}`)
    context.components[key] = { meta: componentPackageMeta(data), data: {
      manifest: structuredClone(data.manifest), runtimeSource: data.runtimeSource, contentSha256: data.contentSha256,
      files: Object.fromEntries(Object.entries(data.files).map(([filename, bytes]) => [filename, Array.from(bytes)])),
    } }
  }
  return validated(context)
}

function validated(input: unknown): DocumentClipboardContext {
  const context = contextSchema.parse(input)
  for (const [id, asset] of Object.entries(context.assets)) {
    if (asset.meta.id !== id || asset.meta.byteLength !== asset.bytes.length) throw new Error(`复制素材身份或字节长度不符：${id}`)
  }
  for (const [id, entry] of Object.entries(context.components)) {
    if (id !== documentComponentKey(entry.meta)) throw new Error(`复制组件身份不符：${id}`)
    const data = parseComponentPackageFiles(Object.fromEntries(Object.entries(entry.data.files).map(([filename, bytes]) => [filename, Uint8Array.from(bytes)])), {
      expectedId: entry.meta.packageId, expectedVersion: entry.meta.version,
      provenance: entry.meta.sha256 ? { sha256: entry.meta.sha256, importedAt: entry.meta.importedAt!, sourceLabel: entry.meta.sourceLabel! } : undefined,
    })
    if (JSON.stringify(data.manifest) !== JSON.stringify(entry.data.manifest) || data.runtimeSource !== entry.data.runtimeSource
      || data.contentSha256 !== entry.meta.contentSha256 || entry.data.contentSha256 !== undefined && data.contentSha256 !== entry.data.contentSha256) throw new Error(`复制组件内容与声明不符：${id}`)
    const expected = componentPackageMeta(data, entry.meta)
    for (const key of ['manifestPath', 'runtimePath', 'thumbnailPath', 'name'] as const) if (entry.meta[key] !== expected[key]) throw new Error(`复制组件元数据不符：${id}`)
  }
  return context
}

export function selectDocumentClipboardContext(input: unknown, resources: DocumentResources): DocumentClipboardContext {
  const context = validated(input)
  documentResourcesSchema.parse(resources)
  const selected: DocumentClipboardContext = { kind: 'cw-document-resources', assets: Object.create(null), components: Object.create(null) }
  for (const ref of resources.assets) {
    if (!Object.hasOwn(context.assets, ref.assetId)) throw new Error(`复制素材不在资源闭包中：${ref.assetId}`)
    selected.assets[ref.assetId] = context.assets[ref.assetId]
  }
  for (const ref of resources.components) {
    const key=documentComponentKey(ref)
    if (!Object.hasOwn(context.components, key)) throw new Error(`复制组件不在资源闭包中：${ref.packageId}@${ref.version}`)
    selected.components[key] = context.components[key]
  }
  return selected
}

export function readDocumentClipboardContext(input: unknown) {
  const context = validated(input)
  const resolveAsset = async (ref: AssetRef): Promise<{ meta: AssetMeta; bytes: Uint8Array }> => {
    const asset = Object.hasOwn(context.assets, ref.assetId) ? context.assets[ref.assetId] : undefined
    if (!asset) throw new Error(`复制素材缺少真实字节：${ref.assetId}`)
    return { meta: structuredClone(asset.meta), bytes: Uint8Array.from(asset.bytes) }
  }
  const prepareComponent = async (ref: ComponentRef, _target?: EmbeddedComponentPackageMeta): Promise<{ meta: EmbeddedComponentPackageMeta; data: ComponentPackageData }> => {
    const key=documentComponentKey(ref),entry = Object.hasOwn(context.components, key) ? context.components[key] : undefined
    if (!entry || entry.meta.version !== ref.version) throw new Error(`复制组件缺少真实包：${ref.packageId}@${ref.version}`)
    const data = parseComponentPackageFiles(Object.fromEntries(Object.entries(entry.data.files).map(([filename, bytes]) => [filename, Uint8Array.from(bytes)])), { expectedId: ref.packageId, expectedVersion: ref.version,
      provenance: entry.meta.sha256 ? { sha256: entry.meta.sha256, importedAt: entry.meta.importedAt!, sourceLabel: entry.meta.sourceLabel! } : undefined })
    return { meta: structuredClone(entry.meta), data }
  }
  return { resolveAsset, prepareComponent, resolveComponent: prepareComponent }
}
