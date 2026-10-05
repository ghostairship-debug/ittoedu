import { nanoid } from 'nanoid'
import type { AssetMeta, AssetSource, AudioChannel, ProjectAudioSettings, SoundDefinition } from '../../shared/contracts/media-v1'
import type { ComponentAsset, ComponentContainer, ComponentDefinition, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform/project'
import { containerChildIds, owningContainer } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget, CourseV10ViewState } from '../documents/CourseV10DocumentBridge'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData, createFormulaComponentData } from '../../components/text/data'
import { SHAPE_DEFINITION, defaultShapeData } from '../../components/shape/authoring'
import { IMAGE_DEFINITION, createImageData, imageDataSchema, planImageTransform, replaceImageSource } from '../../components/image'
import type { ImageTransformOperation } from '../../shared/imageTransformContract'
import { TABLE_DEFINITION } from '../../components/table/adapters'
import { createTableData } from '../../components/table/data'
import { CHART_DEFINITION } from '../../components/chart'
import { createChartData, chartDataSchema, type ChartData } from '../../components/chart/data'
import { INPUT_DEFINITION, createInputData } from '../../components/input'
import type { ShapeData } from '../../components/shape/data'
import { readImageDimensions } from '../project/assetManager'
import { TEACHER_CONTROLLER_DEFINITION, createTeacherControllerData } from '../../components/teacher-controller'
import { AUDIO_DEFINITION, VIDEO_DEFINITION, createAudioData, createVideoData,
  audioDataSchema, videoDataSchema, replaceAudioSource, replaceVideoSource } from '../../components/media'

export interface ProjectAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}
export interface ImportedAssetBatchItem { meta: AssetMeta & { source?: AssetSource }; bytes: Uint8Array }
export interface CourseInsertionOptions {
  x?: number; y?: number; width?: number; height?: number
  center?: { x: number; y: number }
  container?: ComponentContainer; afterInstanceId?: string | null; index?: number
  shapeType?: ShapeData['shapeType']; chartType?: ChartData['chartType']; text?: string
  destination?: 'document' | 'paper'
}
export interface CourseInsertionResult { instanceIds: string[]; documentId: string; surfaceId: string }
export type CourseElementKind = 'text' | 'formula' | 'shape' | 'table' | 'chart' | 'input'

export function captureCourseInsertionTarget(kernel: EditorStoreKernel): CapturedCourseTarget {
  const target = kernel.captureTarget()
  if (!target.surfaceId) throw new Error('请先选择要插入内容的页面')
  return target
}
export function insertionContainer(target: CapturedCourseTarget, options: CourseInsertionOptions = {}): ComponentContainer {
  if (options.destination === 'paper' && options.container?.kind !== 'global'
    && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow') {
    if (!target.surfaceId) throw new Error('插入目标没有页面')
    return { kind: 'surface', surfaceId: target.surfaceId }
  }
  if (options.container) return options.container
  const selectedOwner = target.instanceId ? owningContainer(target.project, target.instanceId) : null
  if (selectedOwner?.kind === 'global') return selectedOwner
  if (selectedOwner?.kind === 'instance' && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow') return selectedOwner
  if (!target.surfaceId) throw new Error('插入目标没有页面')
  return { kind: 'surface', surfaceId: target.surfaceId }
}
export function insertionIndex(target: CapturedCourseTarget, container: ComponentContainer, options: CourseInsertionOptions = {}): number {
  const ids = containerChildIds(target.project, container)
  if (options.index !== undefined) return options.index
  if (options.afterInstanceId === null) return 0
  const selected = options.afterInstanceId === undefined ? target.instanceId : options.afterInstanceId
  const index = selected ? ids.indexOf(selected) : -1
  return index < 0 ? ids.length : index + 1
}
export function definitionInsertionEdits(target: CapturedCourseTarget, definition: ComponentDefinition): ComponentEdit[] {
  return target.project.definitions[definition.id] ? [] : [{ type: 'definition.set', definition: structuredClone(definition) }]
}
/** Persist the professional rich data as JSON, retaining inlines and removing only absent optional values. */
export function courseAuthorData(data: unknown): JsonValue {
  return JSON.parse(JSON.stringify(data))
}
/** Shared placement for library roots and native instances; child ownership stays with the component. */
export function resolveCourseInsertionPlacement(target: CapturedCourseTarget, options: CourseInsertionOptions = {}, rootIds: readonly string[] = []) {
  const container = insertionContainer(target, options)
  const flowPaper = container.kind !== 'global' && target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind === 'flow' && options.destination === 'paper'
  const edits: ComponentEdit[] = flowPaper ? rootIds.map(instanceId => ({ type: 'instance.flowPlacement.set', instanceId,
    flowPlacement: { space: 'paper', plane: 'overlay' } })) : []
  return { container, index: insertionIndex(target, container, options), edits }
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
function frame(target: CapturedCourseTarget, width: number, height: number, options: CourseInsertionOptions) {
  const surface = target.project.surfaces.find(value => value.id === target.surfaceId)!
  const size = surface.designSize ?? { width: 1280, height: 720 }
  const actualWidth = options.width ?? width, actualHeight = options.height ?? height
  return { width: actualWidth, height: actualHeight,
    transform: [1, 0, 0, 1, options.x ?? (options.center ? options.center.x - actualWidth / 2 : surface.kind === 'slide' ? (size.width - width) / 2 : 0),
      options.y ?? (options.center ? options.center.y - actualHeight / 2 : surface.kind === 'slide' ? (size.height - height) / 2 : 0)] as [number, number, number, number, number, number] }
}
export async function insertCourseElement(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  kind: CourseElementKind, options: CourseInsertionOptions = {}): Promise<CourseInsertionResult> {
  let definition: ComponentDefinition, data: unknown, width = 400, height = 70
  if (kind === 'text') { definition = TEXT_DEFINITION; data = createTextComponentData(options.text ?? '双击编辑文字') }
  else if (kind === 'formula') { definition = FORMULA_DEFINITION; data = createFormulaComponentData(`formula_${nanoid()}`, options.text ?? 'x^2+y^2=r^2'); height = 90 }
  else if (kind === 'shape') { definition = SHAPE_DEFINITION; data = defaultShapeData(options.shapeType); width = 220; height = 140 }
  else if (kind === 'table') { definition = TABLE_DEFINITION; data = createTableData(); width = 600; height = 220 }
  else if (kind === 'input') { definition = INPUT_DEFINITION; data = createInputData(); height = 120 }
  else {
    definition = CHART_DEFINITION; const chart = createChartData(), chartType = options.chartType ?? chart.chartType
    if (chartType === 'pie' || chartType === 'donut') {
      const cartesianFields = new Set(['showCategoryAxis', 'showValueAxis', 'showGridLines', 'barDirection', 'valueMin', 'valueMax'])
      const style = Object.fromEntries(Object.entries(chart.style).filter(([key]) => !cartesianFields.has(key)))
      data = chartDataSchema.parse({ ...chart, chartType, series: [chart.series[0]], style: { ...style, ...(chartType === 'donut' ? { holeSize: 50 } : {}) } })
    } else data = chartDataSchema.parse({ ...chart, chartType })
    width = 520; height = 320
  }
  const instance: ComponentInstance = { id: `instance_${nanoid()}`, definitionId: definition.id,
    name: definition.title, data: courseAuthorData(data), frame: frame(target, width, height, options) }
  return commitCourseInsertion(kernel, target, definition, [instance], options)
}

function assetEdits(target: CapturedCourseTarget, items: readonly ImportedAssetBatchItem[]): ComponentEdit[] {
  return items.filter(item => !target.project.assets[item.meta.id]).map(item => ({ type: 'asset.add' as const,
    asset: { ...item.meta }, bytes: item.bytes }))
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
  if (!instance || target.project.definitions[instance.definitionId]?.implementation.kind !== 'builtin'
    || (target.project.definitions[instance.definitionId]?.implementation as { key: string }).key !== 'guoling.image') throw new Error('请先选择要替换的图片')
  const data = replaceImageSource(imageDataSchema.parse(instance.data), item.meta.id)
  await kernel.editCaptured(kernel.capture([...assetEdits(target, [item]), { type: 'data.set', instanceId: instance.id, path: [], value: data }], target))
}
/** Pixel operations reuse the professional image algorithm and commit resources with data in one history entry. */
export async function transformCourseImageAtTarget(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  operations: readonly ImageTransformOperation[]): Promise<void> {
  const instance = target.instanceId ? target.editingProject.instances[target.instanceId] : undefined
  const definition = instance ? target.project.definitions[instance.definitionId] : undefined
  if (!instance || definition?.implementation.kind !== 'builtin' || definition.implementation.key !== 'guoling.image') {
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
  const key = definition?.implementation.kind === 'builtin' ? definition.implementation.key : null
  if (!instance || key !== `guoling.${item.meta.kind}` || (item.meta.kind !== 'video' && item.meta.kind !== 'audio')) throw new Error('请选择同类型的原媒体进行替换')
  const data = item.meta.kind === 'audio' ? replaceAudioSource(audioDataSchema.parse(instance.data), item.meta.id)
    : replaceVideoSource(videoDataSchema.parse(instance.data), item.meta.id)
  await kernel.editCaptured(kernel.capture([...assetEdits(target, [item]), { type: 'data.set', instanceId: instance.id, path: [], value: data }], target))
}
export async function patchCourseFlowMediaLayout(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  instanceId: string, patch: Partial<NonNullable<ComponentInstance['flowLayout']>>): Promise<void> {
  const instance = target.project.instances[instanceId]
  if (!instance) throw new Error('原媒体实例已不存在')
  const flowLayout = { width: 'content-width' as const, ...instance.flowLayout, ...patch }
  await kernel.editCaptured(kernel.capture([{ type: 'instance.flowLayout.set', instanceId, flowLayout }], target))
}
export function readCourseMediaLibrary(view: CourseV10ViewState): { assets: Record<string, AssetMeta>; files: Record<string, Uint8Array> } {
  const project = view.project, files = view.views.find(value => value.documentId === view.activeDocumentId)?.model.resources.assets ?? {}
  const assets: Record<string, AssetMeta> = {}
  for (const asset of Object.values(project?.assets ?? {})) {
    const mimeType = asset.mimeType ?? 'application/octet-stream'
    const filename = asset.filename ?? asset.path.split(/[\\/]/).at(-1) ?? asset.id
    const mediaMime = mimeType.toLowerCase()
    const font = mediaMime.startsWith('font/') || /^application\/(?:x-)?font/.test(mediaMime)
      || mediaMime === 'application/vnd.ms-fontobject' || /\.(?:woff2?|ttf|otf|eot)$/i.test(filename)
    const kind = asset.kind ?? (mediaMime.startsWith('image/') ? 'image' : mediaMime.startsWith('video/') ? 'video' : mediaMime.startsWith('audio/') ? 'audio' : font ? 'font' : null)
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
  return view.project?.media?.audio ?? { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
    sounds: {} as Record<string, SoundDefinition>, narrationDucking: { enabled: false, musicVolume: .25, fadeMs: 300 } }
}
export async function updateCourseAudioSettings(kernel: EditorStoreKernel, patch: ProjectAudioSettingsPatch): Promise<void> {
  const target = kernel.captureTarget(), audio = readCourseAudioSettings({ project: target.project })
  const next = { ...audio, ...patch, channelVolumes: { ...audio.channelVolumes, ...patch.channelVolumes },
    narrationDucking: { ...audio.narrationDucking, ...patch.narrationDucking } }
  await kernel.editCaptured(kernel.capture([{ type: 'project.media.set', media: { audio: next } }], target))
}
export async function updateCourseSound(kernel: EditorStoreKernel, soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>> | null): Promise<void> {
  const target = kernel.captureTarget(), audio = readCourseAudioSettings({ project: target.project })
  if (!audio.sounds[soundId]) throw new Error('原声音已不存在')
  const sounds = { ...audio.sounds }
  if (patch === null) delete sounds[soundId]
  else sounds[soundId] = { ...sounds[soundId], ...patch }
  await kernel.editCaptured(kernel.capture([{ type: 'project.media.set', media: { audio: { ...audio, sounds } } }], target))
}
export async function importCourseSounds(kernel: EditorStoreKernel, target: CapturedCourseTarget, items: ImportedAssetBatchItem[]): Promise<void> {
  const audio = readCourseAudioSettings({ project: target.project }), sounds = { ...audio.sounds }
  for (const item of items) {
    if (item.meta.kind !== 'audio') throw new Error('声音库只接受音频素材')
    const id = `sound_${nanoid()}`
    sounds[id] = { id, name: item.meta.filename.replace(/\.[^.]+$/, ''), assetId: item.meta.id,
      channel: 'sfx', defaultVolume: 1, defaultLoop: false }
  }
  await kernel.editCaptured(kernel.capture([...assetEdits(target, items), { type: 'project.media.set', media: { audio: { ...audio, sounds } } }], target))
}
export async function removeCourseAsset(kernel: EditorStoreKernel, assetId: string): Promise<void> {
  const target = kernel.captureTarget()
  await kernel.editCaptured(kernel.capture([{ type: 'asset.remove', assetId }], target))
}
export async function ensureCourseTeacherController(kernel: EditorStoreKernel): Promise<CourseInsertionResult> {
  const target = captureCourseInsertionTarget(kernel)
  const existing = Object.values(target.project.instances).find(instance => instance.definitionId === TEACHER_CONTROLLER_DEFINITION.id)
  if (existing) {
    kernel.selectInstances([existing.id], target.surfaceId, target.documentId)
    return { instanceIds: [existing.id], documentId: target.documentId, surfaceId: target.surfaceId! }
  }
  const data = JSON.parse(JSON.stringify(createTeacherControllerData())) as JsonValue
  return commitCourseInsertion(kernel, target, TEACHER_CONTROLLER_DEFINITION, [{ id: `instance_${nanoid()}`,
    definitionId: TEACHER_CONTROLLER_DEFINITION.id, name: '教师控制台', data,
    frame: { width: 720, height: 80, transform: [1, 0, 0, 1, 20, 20] } }], { container: { kind: 'global', plane: 'overlay' } })
}
