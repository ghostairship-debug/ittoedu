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
import { componentDefinitionBuiltinKey, owningContainer, resolveComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import { normalizeWorkProject } from '../../shared/contracts/component-platform/workProjectMigration'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import { equalComponentValue } from '../../shared/componentValue'

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

/** Formal project bytes are separate from the PM manifest and native file packages. */
const courseContextSchema = z.object({
  kind: z.literal('cw-course-v10-resources'),
  documentId: z.string().optional(),
  project: z.preprocess(input => normalizeWorkProject(input), courseProjectV10Schema),
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
  const { entry: extractedEntry, diagnostics } = source.roots.length ? extractComponentLibraryEntry(source.project, source.resources, {
    id: `clipboard_${crypto.randomUUID()}`, title: '复制正文对象', rootIds: [...source.roots],
  }) : { entry: { schemaVersion: 2 as const, id: 'empty-clipboard', title: '复制正文对象', definitions:{},example:{instances:{},rootIds:[]},assets:{},resources: { assets: {}, components: {} } }, diagnostics: [] }
  const entry: ComponentLibraryEntry = extractedEntry
  const ids = new Set(Object.keys(entry.example.instances)), roots = entry.example.rootIds
  const project: CourseProjectV10 = { schemaVersion: 11, id: source.project.id, revision: source.project.revision,
    title: source.project.title, definitions: entry.definitions, instances: entry.example.instances, assets: entry.assets,
    global: structuredClone(entry.global ?? { underlay: [], overlay: [] }), rootIds: [],
    ...(entry.logic ? { logic: structuredClone(entry.logic) } : {}) }
  // Keep the nearest real container as clipboard context. It supplies Flow placement and
  // local state overrides, while only the selected roots are pasted into the destination.
  const contexts = new Map<string, string[]>()
  const recordRoot = (id: string) => {
    let owner = owningContainer(source.project, id)
    while (owner?.kind === 'instance' && !source.project.instances[owner.instanceId]?.container && !source.project.rootIds.includes(owner.instanceId))
      owner = owningContainer(source.project, owner.instanceId)
    if (owner?.kind === 'global') { if (!project.global[owner.plane].includes(id)) project.global[owner.plane].push(id) }
    else if (owner?.kind === 'instance' && !ids.has(owner.instanceId)) {
      const children = contexts.get(owner.instanceId) ?? []
      if (!children.includes(id)) contexts.set(owner.instanceId, [...children, id])
    } else if (!project.rootIds.includes(id)) project.rootIds.push(id)
  }
  roots.forEach(recordRoot)
  const stateFamilies = new Map<string, Map<string, Record<string, JsonValue>>>()
  // Close the effective states before filtering their overrides: a selected object's
  // rule family or resource can exist only in one named state.
  for (const containerId of contexts.keys()) for (const state of source.project.instances[containerId].container?.presentation?.states ?? []) {
    const variant = extractComponentLibraryEntry(resolveComponentPresentation(source.project, containerId, state.id), source.resources,
      { id: entry.id, title: entry.title, rootIds: [...source.roots] })
    Object.assign(project.definitions, variant.entry.definitions)
    Object.assign(project.assets, variant.entry.assets)
    Object.assign(entry.resources.assets, variant.entry.resources.assets)
    for (const [ownerId, files] of Object.entries(variant.entry.resources.components))
      entry.resources.components[ownerId] = { ...entry.resources.components[ownerId], ...files }
    const families: Record<string, JsonValue> = {}
    for (const [id, instance] of Object.entries(variant.entry.example.instances)) {
      const interaction = componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.interactions'
      if (interaction) families[id] = instance.data
      if (!ids.has(id)) {
        ids.add(id)
        project.instances[id] = { ...structuredClone(instance), ...(interaction ? { data: { rules: [] } } : {}) }
        recordRoot(id)
      }
    }
    const states = stateFamilies.get(containerId) ?? new Map<string, Record<string, JsonValue>>()
    states.set(state.id, families); stateFamilies.set(containerId, states)
    if (variant.entry.logic) {
      project.logic ??= { courseState: [], navigationGuards: [] }
      for (const declaration of variant.entry.logic.courseState)
        if (!project.logic.courseState.some(current => current.key === declaration.key)) project.logic.courseState.push(declaration)
    }
    diagnostics.push(...variant.diagnostics)
  }
  for (const [containerId, childIds] of contexts) {
    const original = source.project.instances[containerId], wrapper = structuredClone(original)
    wrapper.childIds = childIds
    if (!wrapper.container) wrapper.data = {}
    const retainedIds = new Set([...ids, ...contexts.keys()])
    if (wrapper.attachments) wrapper.attachments = wrapper.attachments.filter(attachment => {
      if (!retainedIds.has(attachment.instanceId)) return false
      const target = attachment.target
      return target.kind === 'instance' || target.kind === 'text-range' ? retainedIds.has(target.instanceId)
        : target.kind === 'surface' ? retainedIds.has(target.surfaceId) : true
    })
    const presentation = wrapper.container?.presentation
    if (presentation) {
      presentation.states = presentation.states.flatMap(state => {
        const overrides = Object.fromEntries(Object.entries(state.overrides).filter(([id]) => ids.has(id)))
        const families = stateFamilies.get(containerId)?.get(state.id) ?? {}
        for (const id of ids) if (componentDefinitionBuiltinKey(project.definitions[project.instances[id].definitionId]) === 'guoling.interactions') {
          const data = families[id] ?? { rules: [] }
          if (overrides[id]?.data !== undefined || !equalComponentValue(data, project.instances[id].data))
            overrides[id] = { ...overrides[id], data }
        }
        const order = state.order?.filter(id => childIds.includes(id))
        return Object.keys(overrides).length || order?.length ? [{ ...state, overrides, ...(order ? { order } : {}) }] : []
      })
      if (!presentation.states.some(state => state.id === presentation.initialStateId)) delete presentation.initialStateId
      if (!presentation.states.some(state => state.id === presentation.thumbnailStateId)) delete presentation.thumbnailStateId
      if (!presentation.states.length) delete wrapper.container!.presentation
    }
    project.instances[containerId] = wrapper
    project.definitions[wrapper.definitionId] = structuredClone(source.project.definitions[wrapper.definitionId])
    project.rootIds.push(containerId)
  }
  // Library extraction marks excluded host scopes with its surface binding alias.
  // The clipboard now contains those real scope instances, including Source roots.
  for (const instance of Object.values(project.instances)) if (instance.attachments)
    instance.attachments = instance.attachments.map(attachment => attachment.target.kind === 'surface'
      && project.instances[attachment.target.surfaceId]
      ? { ...attachment, target: { kind: 'instance' as const, instanceId: attachment.target.surfaceId } } : attachment)
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
