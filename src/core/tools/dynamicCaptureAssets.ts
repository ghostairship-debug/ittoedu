import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DynamicInstanceCapture } from '../../shared/dynamicAdmissionContract'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { analyzeCourseAssetReferences } from '../../shared/contracts/course-project-v9/assetReferences'
import { visitCourseFlowBlocks, visitCourseLayerItems } from '../../shared/courseProjectHealth/internal'
import type { DocumentModel } from '../../shared/workbench/document'
import { documentDigest } from '../documents/documentDigest'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>

/** Admission may inspect neighbors conservatively. Only actual instance dependencies justify rewriting their fallbacks. */
export function dynamicCaptureRefreshIds(model: CourseModel, before: CourseModel,
  componentPackages: Readonly<Record<string, ComponentPackageData>>,
  targets: readonly { locationId: string; instanceIds: readonly string[] }[]): ReadonlySet<string> {
  const instances = (project: CourseProjectDocument) => {
    const result = new Map<string, { value: unknown; packageId?: string; version?: string }>()
    visitCourseLayerItems(project, ({ item, owner }) => {
      if (item.kind === 'runtime') result.set(item.layerItemId, { value: { item, owner } })
      else if (item.kind === 'component') result.set(item.layerItemId, { value: { item, owner }, packageId: item.component.packageId, version: item.component.version })
    })
    visitCourseFlowBlocks(project, ({ block, surfaceId }) => {
      if (block.type === 'component') result.set(block.id, { value: { block, surfaceId }, packageId: block.component.packageId, version: block.component.version })
    })
    return result
  }
  const previous = instances(before.project), refresh = new Set<string>()
  for (const [id, entry] of instances(model.project)) {
    if (documentDigest(entry.value) !== documentDigest(previous.get(id)?.value ?? null)) refresh.add(id)
    if (entry.packageId) {
      const key = `${entry.packageId}@${entry.version}`
      if (documentDigest(model.resources.components[key] ?? null) !== documentDigest(before.resources.components[key] ?? null)) refresh.add(id)
    }
  }
  const references = analyzeCourseAssetReferences(model.project, { componentPackages })
  for (const [id, refs] of references.graph) {
    if (documentDigest({ meta: model.project.assets[id] ?? null, bytes: model.resources.assets[id] ?? null }) ===
      documentDigest({ meta: before.project.assets[id] ?? null, bytes: before.resources.assets[id] ?? null })) continue
    for (const reference of refs) {
      if (reference.layerItemId) refresh.add(reference.layerItemId)
      if (reference.blockId) refresh.add(reference.blockId)
    }
  }
  for (const target of targets) {
    const location = model.project.locations.find(location => location.id === target.locationId)
    if (!location) throw new Error('准入位置已不在候选中')
    const surface = model.project.surfaces.find(surface => surface.id === location.surfaceId)
    const prior = before.project.surfaces.find(surface => surface.id === location.surfaceId)
    const geometry = (value: typeof surface) => value?.type === 'flow' ? value.layout : value?.type === 'slide' ? value.canvas : value?.type === 'spatial-2d' ? value.camera : null
    const presentation = surface?.type === 'slide' && location.kind === 'slide-scene' ? surface.scenes.find(scene => scene.id === location.sceneId)?.presentation : null
    const oldPresentation = prior?.type === 'slide' && location.kind === 'slide-scene' ? prior.scenes.find(scene => scene.id === location.sceneId)?.presentation : null
    if (documentDigest(geometry(surface)) !== documentDigest(geometry(prior)) || documentDigest(presentation ?? null) !== documentDigest(oldPresentation ?? null)) {
      target.instanceIds.forEach(id => refresh.add(id))
    }
  }
  return new Set(targets.flatMap(target => target.instanceIds).filter(id => refresh.has(id)))
}

/** A capture is a host result, never arbitrary candidate-provided asset metadata. */
export function componentCaptureAsset(capture: DynamicInstanceCapture, id = `component-capture-${crypto.randomUUID()}`) {
  const prefix = 'data:image/png;base64,'
  if (!capture.dataUrl.startsWith(prefix)) throw new Error('动态后备不是PNG图面')
  const bytes = Uint8Array.from(atob(capture.dataUrl.slice(prefix.length)), char => char.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value)) throw new Error('动态后备PNG内容无效')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(16) !== capture.width || view.getUint32(20) !== capture.height) throw new Error('动态后备PNG尺寸不一致')
  return { bytes, meta: { id, filename: `${id}.png`, path: `assets/${id}.png`, kind: 'image' as const,
    mimeType: 'image/png', byteLength: bytes.length, width: capture.width, height: capture.height } }
}

export interface DynamicCaptureAssetChange { assetId: string; before?: Uint8Array; after?: Uint8Array }

/** Pure projection of successful admission captures into that exact candidate and its resource closure. */
export function applyDynamicInstanceCaptures(input: {
  project: CourseProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  componentPackages: Readonly<Record<string, ComponentPackageData>>
  targets: readonly { locationId: string; instanceIds: readonly string[] }[]
  captures: readonly DynamicInstanceCapture[]
  refreshInstanceIds?: ReadonlySet<string>
}) {
  const expected = new Map<string, Set<string>>()
  for (const target of input.targets) for (const id of target.instanceIds) {
    const locations = expected.get(id) ?? new Set<string>(); locations.add(target.locationId); expected.set(id, locations)
  }
  const captures = new Map<string, DynamicInstanceCapture>()
  for (const capture of input.captures) {
    if (!expected.get(capture.instanceId)?.has(capture.locationId) || captures.has(capture.instanceId)) throw new Error(`动态后备目标重复或不属于本次准入：${capture.instanceId}`)
    captures.set(capture.instanceId, capture)
  }
  for (const id of expected.keys()) if (!captures.has(id)) throw new Error(`实例 ${id} 缺少真实后备图面`)
  const refresh = input.refreshInstanceIds ?? new Set(expected.keys())
  for (const id of refresh) if (!expected.has(id)) throw new Error(`后备刷新实例不属于本次准入：${id}`)
  const project = structuredClone(input.project), assetFiles = { ...input.assetFiles }
  const assetFileChanges: DynamicCaptureAssetChange[] = [], previousCaptures = new Set<string>(), applied = new Set<string>()
  const asset = (id: string, old: string | undefined, runtime: boolean) => {
    if (applied.has(id)) throw new Error(`动态实例身份重复：${id}`)
    applied.add(id)
    const value = componentCaptureAsset(captures.get(id)!, `${runtime ? 'runtime' : 'component'}-capture-${crypto.randomUUID()}`)
    if (project.assets[value.meta.id] || assetFiles[value.meta.id]) throw new Error('动态后备资源身份冲突')
    if (old?.startsWith('component-capture-') || old?.startsWith('runtime-capture-')) previousCaptures.add(old)
    project.assets[value.meta.id] = value.meta; assetFiles[value.meta.id] = value.bytes
    assetFileChanges.push({ assetId: value.meta.id, after: value.bytes })
    return value.meta.id
  }
  visitCourseLayerItems(project, ({ item }) => {
    if (!refresh.has(item.layerItemId)) return
    if (item.kind === 'component') item.staticFallbackAssetId = asset(item.layerItemId, item.staticFallbackAssetId, false)
    else if (item.kind === 'runtime') {
      const old = item.runtime.staticFallback
      if (!old) throw new Error(`Runtime ${item.layerItemId} 未声明后备覆盖范围`)
      item.runtime.staticFallback = { ...old, assetId: asset(item.layerItemId, old.assetId, true) }
    } else throw new Error(`准入目标不是动态实例：${item.layerItemId}`)
  })
  visitCourseFlowBlocks(project, ({ block }) => {
    if (!refresh.has(block.id)) return
    if (block.type !== 'component') throw new Error(`准入目标不是动态正文实例：${block.id}`)
    block.staticFallbackAssetId = asset(block.id, block.staticFallbackAssetId, false)
  })
  for (const id of refresh) if (!applied.has(id)) throw new Error(`准入实例已不在候选中：${id}`)
  const references = analyzeCourseAssetReferences(project, { componentPackages: input.componentPackages })
  if (!references.missingComponentContexts.length) for (const id of previousCaptures) {
    if (references.graph.has(id)) continue
    delete project.assets[id]; delete assetFiles[id]
    const before = input.assetFiles[id]
    if (before) assetFileChanges.push({ assetId: id, before })
  }
  return { project: courseProjectDocumentSchema.parse(project), assetFiles, assetFileChanges }
}
