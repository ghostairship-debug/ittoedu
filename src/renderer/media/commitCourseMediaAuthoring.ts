import { nanoid } from 'nanoid'
import type { AssetMeta, AssetSource, ProjectAudioSettings, SoundDefinition } from '../../shared/contracts/media-v1'
import type { ComponentAsset, ComponentDefinition, ComponentInstance } from '../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { flowBodyLayoutEdits } from '../../core/course/courseFlowEdits'
import { equalComponentValue } from '../../core/drivers/courseV10Operations'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget, CourseV10ViewState } from '../documents/CourseV10DocumentBridge'
import { IMAGE_DEFINITION, createImageData, imageDataSchema, planImageTransform, replaceImageSource } from '../../components/image'
import type { ImageTransformOperation } from '../../shared/imageTransformContract'
import { readImageDimensions } from '../project/assetManager'
import { AUDIO_DEFINITION, VIDEO_DEFINITION, createAudioData, createVideoData,
  audioDataSchema, videoDataSchema, replaceAudioSource, replaceVideoSource } from '../../components/media'

export type { ProjectAudioSettingsPatch } from '../../core/course/courseMediaEdits'
import { courseAudioSettings, courseAudioSettingsEdits, courseSoundEdits, courseSoundImportEdits, type ProjectAudioSettingsPatch } from '../../core/course/courseMediaEdits'

export interface ImportedAssetBatchItem { meta: AssetMeta & { source?: AssetSource }; bytes: Uint8Array }
export { insertionContainer, insertionIndex, definitionInsertionEdits, courseAuthorData, resolveCourseInsertionPlacement } from '../../core/course/courseElementInsertion'
export type { CourseInsertionOptions, CourseElementKind } from '../../core/course/courseElementInsertion'
import { definitionInsertionEdits, courseAuthorData, resolveCourseInsertionPlacement, courseInsertionFrame as frame,
  prepareCourseElementEdits, prepareCourseTeacherControllerEdits, type CourseInsertionOptions, type CourseElementKind } from '../../core/course/courseElementInsertion'
export interface CourseInsertionResult { instanceIds: string[]; documentId: string; surfaceId: string }

export function captureCourseInsertionTarget(kernel: EditorStoreKernel): CapturedCourseTarget {
  const target = kernel.captureTarget()
  if (!target.surfaceId) throw new Error('请先选择要插入内容的页面')
  return target
}
export async function commitCourseInsertion(kernel: EditorStoreKernel, target: CapturedCourseTarget, definition: ComponentDefinition,
  instances: ComponentInstance[], options: CourseInsertionOptions = {}, additional: ComponentEdit[] = [],
  rootIds: string[] = instances.map(instance => instance.id)): Promise<CourseInsertionResult> {
  const surface = target.project.surfaces.find(value => value.id === target.surfaceId)
  if (!surface) throw new Error('插入的原页面已不存在')
  const ids = rootIds, placement = resolveCourseInsertionPlacement(target, options, ids)
  const edits: ComponentEdit[] = [...definitionInsertionEdits(target, definition), ...additional,
    { type: 'instance.insert', container: placement.container, index: placement.index, instances, rootIds: ids }, ...placement.edits]
  await kernel.editCaptured(kernel.capture(edits, target))
  kernel.selectInstances(ids, target.surfaceId, target.documentId)
  return { instanceIds: ids, documentId: target.documentId, surfaceId: surface.id }
}
export async function insertCourseElement(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  kind: CourseElementKind, options: CourseInsertionOptions = {}): Promise<CourseInsertionResult> {
  const { edits, instanceIds } = prepareCourseElementEdits(target.project, target.surfaceId, target.instanceId, kind, options)
  await kernel.editCaptured(kernel.capture(edits, target))
  kernel.selectInstances(instanceIds, target.surfaceId, target.documentId)
  return { instanceIds, documentId: target.documentId, surfaceId: target.surfaceId! }
}

function mediaAssetKind(asset: ComponentAsset): AssetMeta['kind'] | null {
  const mimeType = (asset.mimeType ?? 'application/octet-stream').toLowerCase()
  const filename = asset.filename ?? asset.path.split(/[\\/]/).at(-1) ?? asset.id
  const font = mimeType.startsWith('font/') || /^application\/(?:x-)?font/.test(mimeType)
    || mimeType === 'application/vnd.ms-fontobject' || /\.(?:woff2?|ttf|otf|eot)$/i.test(filename)
  return asset.kind ?? (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : font ? 'font' : null)
}
function assetEdits(target: CapturedCourseTarget, items: readonly ImportedAssetBatchItem[]): ComponentEdit[] {
  const additions = new Map<string, ImportedAssetBatchItem>()
  const metadata = (asset: ComponentAsset, bytes: Uint8Array, baseline: ComponentAsset) => ({
    id: asset.id, path: asset.path, mimeType: asset.mimeType ?? 'application/octet-stream',
    filename: asset.filename ?? asset.path.split(/[\\/]/).at(-1) ?? asset.id,
    kind: mediaAssetKind(asset),
    byteLength: asset.byteLength ?? bytes.byteLength,
    // Older admitted assets can omit decoded dimensions; library placement derives them from the same bytes.
    width: baseline.width === undefined ? undefined : asset.width, height: baseline.height === undefined ? undefined : asset.height,
    duration: baseline.duration === undefined ? undefined : asset.duration, source: asset.source,
  })
  for (const item of items) {
    const existing = Object.hasOwn(target.project.assets, item.meta.id) ? target.project.assets[item.meta.id] : additions.get(item.meta.id)?.meta
    const bytes = Object.hasOwn(target.project.assets, item.meta.id) ? target.resources.assets[item.meta.id] : additions.get(item.meta.id)?.bytes
    if (existing) {
      if (!bytes || !equalComponentValue(metadata(existing, bytes, existing), metadata(item.meta, item.bytes, existing))
        || bytes.byteLength !== item.bytes.byteLength || !bytes.every((value, index) => value === item.bytes[index])) {
        throw new Error('素材身份已存在，元数据或字节不同；请使用新的素材身份')
      }
      continue
    }
    additions.set(item.meta.id, { meta: structuredClone(item.meta), bytes: Uint8Array.from(item.bytes) })
  }
  return [...additions.values()].map(item => ({ type: 'asset.add', asset: item.meta, bytes: item.bytes }))
}
export async function importCourseMediaLibrary(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  items: readonly ImportedAssetBatchItem[]): Promise<void> {
  const edits = assetEdits(target, items)
  if (edits.length) await kernel.editCaptured(kernel.capture(edits, target))
}
export async function insertCourseMedia(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  items: readonly ImportedAssetBatchItem[], options: CourseInsertionOptions = {}): Promise<CourseInsertionResult> {
  if (!items.length) return { instanceIds: [], documentId: target.documentId, surfaceId: target.surfaceId ?? '' }
  const definitions = new Map<string, ComponentDefinition>()
  const instances = items.map((item, index): ComponentInstance => {
    const kind = item.meta.kind
    if (kind !== 'image' && kind !== 'audio' && kind !== 'video') throw new Error('该素材不是图片、音频或视频')
    const definition = kind === 'image' ? IMAGE_DEFINITION : kind === 'audio' ? AUDIO_DEFINITION : VIDEO_DEFINITION
    definitions.set(definition.id, definition)
    const naturalWidth = item.meta.width ?? 480, naturalHeight = item.meta.height ?? 300
    const scale = Math.min(1, 480 / naturalWidth, 360 / naturalHeight)
    const width = kind === 'audio' ? 480 : naturalWidth * scale, height = kind === 'audio' ? 64 : naturalHeight * scale
    const data = kind === 'image' ? createImageData(item.meta.id, item.meta.filename)
      : kind === 'audio' ? createAudioData(item.meta.id, item.meta.filename) : createVideoData(item.meta.id, item.meta.filename)
    return { id: `instance_${nanoid()}`, definitionId: definition.id, name: item.meta.filename,
      data: courseAuthorData(data), frame: frame(target, width, height,
        { ...options, ...(options.x === undefined ? {} : { x: options.x + index * 20 }), ...(options.y === undefined ? {} : { y: options.y + index * 20 }) }) }
  })
  const [definition, ...rest] = [...definitions.values()]
  return commitCourseInsertion(kernel, target, definition, instances, options,
    [...rest.flatMap(value => definitionInsertionEdits(target, value)), ...assetEdits(target, items)])
}
export async function insertCoursePreparedMedia(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  selected: { asset: ComponentAsset; bytes: Uint8Array }, options: CourseInsertionOptions = {}): Promise<CourseInsertionResult> {
  const mimeType = selected.asset.mimeType ?? 'application/octet-stream'
  const kind = selected.asset.kind ?? (mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'font')
  const meta: AssetMeta = { ...selected.asset, kind, mimeType, filename: selected.asset.filename ?? selected.asset.path.split(/[\\/]/).at(-1) ?? selected.asset.id,
    byteLength: selected.bytes.byteLength }
  return insertCourseMedia(kernel, target, [{ meta, bytes: selected.bytes }], options)
}
export async function replaceCourseImageAtTarget(kernel: EditorStoreKernel, target: CapturedCourseTarget, item: ImportedAssetBatchItem): Promise<void> {
  const instance = target.instanceId ? target.editingProject.instances[target.instanceId] : undefined
  if (!instance || componentDefinitionBuiltinKey(target.project.definitions[instance.definitionId]) !== 'guoling.image') throw new Error('请先选择要替换的图片')
  const data = replaceImageSource(imageDataSchema.parse(instance.data), item.meta.id)
  await kernel.editCaptured(kernel.capture([...assetEdits(target, [item]), { type: 'data.set', instanceId: instance.id, path: [], value: data }], target))
}
/** Pixel operations reuse the professional image algorithm and commit resources with data in one history entry. */
export async function transformCourseImageAtTarget(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  operations: readonly ImageTransformOperation[]): Promise<void> {
  const instance = target.instanceId ? target.editingProject.instances[target.instanceId] : undefined
  const definition = instance ? target.project.definitions[instance.definitionId] : undefined
  if (!instance || componentDefinitionBuiltinKey(definition) !== 'guoling.image') {
    throw new Error('请选择要变换的图片')
  }
  const data = imageDataSchema.parse(instance.data)
  const asset = target.project.assets[data.assetId], bytes = target.resources.assets[data.assetId]
  if (!asset || !bytes) throw new Error('原图片素材不可用，无法变换')
  const plan = await planImageTransform(data, { assetId: data.assetId, bytes,
    filename: asset.filename ?? asset.path.split(/[\\/]/).at(-1) ?? asset.id,
    mimeType: asset.mimeType ?? 'application/octet-stream' }, operations)
  if (!plan.changed || !plan.resource) return
  await kernel.editCaptured(kernel.capture([...assetEdits(target, [plan.resource]),
    { type: 'data.set', instanceId: instance.id, path: [], value: courseAuthorData(plan.data) }], target))
}
export async function replaceCourseMediaAtTarget(kernel: EditorStoreKernel, target: CapturedCourseTarget, item: ImportedAssetBatchItem): Promise<void> {
  if (item.meta.kind === 'image') return replaceCourseImageAtTarget(kernel, target, item)
  const instance = target.instanceId ? target.editingProject.instances[target.instanceId] : undefined
  const definition = instance ? target.project.definitions[instance.definitionId] : undefined
  const key = componentDefinitionBuiltinKey(definition)
  if (!instance || key !== `guoling.${item.meta.kind}` || (item.meta.kind !== 'video' && item.meta.kind !== 'audio')) throw new Error('请选择同类型的原媒体进行替换')
  const data = item.meta.kind === 'audio' ? replaceAudioSource(audioDataSchema.parse(instance.data), item.meta.id)
    : replaceVideoSource(videoDataSchema.parse(instance.data), item.meta.id)
  await kernel.editCaptured(kernel.capture([...assetEdits(target, [item]), { type: 'data.set', instanceId: instance.id, path: [], value: data }], target))
}
export async function patchCourseFlowMediaLayout(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  instanceId: string, patch: Partial<NonNullable<ComponentInstance['flowLayout']>>): Promise<void> {
  await kernel.editCaptured(kernel.capture(flowBodyLayoutEdits(target.project, instanceId, patch), target))
}
export function readCourseMediaLibrary(view: CourseV10ViewState): { assets: Record<string, AssetMeta>; files: Record<string, Uint8Array> } {
  const project = view.project, files = view.views.find(value => value.documentId === view.activeDocumentId)?.model.resources.assets ?? {}
  const assets: Record<string, AssetMeta> = {}
  for (const asset of Object.values(project?.assets ?? {})) {
    const mimeType = asset.mimeType ?? 'application/octet-stream'
    const filename = asset.filename ?? asset.path.split(/[\\/]/).at(-1) ?? asset.id
    const kind = mediaAssetKind(asset)
    if (!kind) continue
    assets[asset.id] = { ...asset, id: asset.id, filename, mimeType, kind, path: asset.path, byteLength: files[asset.id]?.byteLength ?? asset.byteLength ?? 0 }
  }
  return { assets, files }
}
export async function insertCourseLibraryAsset(kernel: EditorStoreKernel, assetId: string, options: CourseInsertionOptions = {},
  captured = captureCourseInsertionTarget(kernel)): Promise<CourseInsertionResult> {
  const target = captured, view = kernel.readView(), original = view.views.find(item => item.documentId === target.documentId)
  if (!original) throw new Error('原媒体文档已关闭')
  const library = readCourseMediaLibrary({ ...view, activeDocumentId: target.documentId, project: target.project }), meta = library.assets[assetId], bytes = library.files[assetId]
  if (!meta || !bytes) throw new Error('原素材字节不存在，无法插入')
  if (meta.kind === 'image') Object.assign(meta, await readImageDimensions(bytes, meta.mimeType))
  return insertCourseMedia(kernel, target, [{ meta, bytes }], options)
}
export function mediaAuthoringError(kernel: EditorStoreKernel, error: unknown): void {
  kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error) })
}
export function readCourseAudioSettings(view: Pick<CourseV10ViewState, 'project'>): ProjectAudioSettings {
  return courseAudioSettings(view.project)
}
export async function updateCourseAudioSettings(kernel: EditorStoreKernel, patch: ProjectAudioSettingsPatch): Promise<void> {
  const target = kernel.captureTarget()
  await kernel.editCaptured(kernel.capture(courseAudioSettingsEdits(target.project, patch), target))
}
export async function updateCourseSound(kernel: EditorStoreKernel, soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>> | null): Promise<void> {
  const target = kernel.captureTarget()
  await kernel.editCaptured(kernel.capture(courseSoundEdits(target.project, soundId, patch), target))
}
export async function importCourseSounds(kernel: EditorStoreKernel, target: CapturedCourseTarget, items: ImportedAssetBatchItem[]): Promise<void> {
  await kernel.editCaptured(kernel.capture([...assetEdits(target, items), ...courseSoundImportEdits(target.project, items.map(item => item.meta))], target))
}
export async function removeCourseAsset(kernel: EditorStoreKernel, assetId: string): Promise<void> {
  const target = kernel.captureTarget()
  await kernel.editCaptured(kernel.capture([{ type: 'asset.remove', assetId }], target))
}
export async function ensureCourseTeacherController(kernel: EditorStoreKernel, target = captureCourseInsertionTarget(kernel), origin?: 'slide-authoring'): Promise<CourseInsertionResult> {
  const { edits, instanceIds } = prepareCourseTeacherControllerEdits(target.project, target.surfaceId, origin, target.instanceId)
  if (edits.length) await kernel.editCaptured(kernel.capture(edits, target))
  kernel.selectInstances(instanceIds, target.surfaceId, target.documentId)
  return { instanceIds, documentId: target.documentId, surfaceId: target.surfaceId! }
}
