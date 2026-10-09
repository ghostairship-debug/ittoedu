import { nanoid } from 'nanoid'
import { IMAGE_DEFINITION } from '../../components/image'
import { createImageData, imageDataSchema, replaceImageSource, type ImageData } from '../../components/image/data'
import { AUDIO_DEFINITION, VIDEO_DEFINITION } from '../../components/media/adapters'
import { createAudioData, createVideoData, audioDataSchema, videoDataSchema, replaceAudioSource, replaceVideoSource } from '../../components/media/data'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { componentDefinitionBuiltinKey, containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentInstance, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import type { AssetSource } from '../../shared/contracts/media-v1/types'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'
import { captureComponentOperation, presentationComponentEdits } from '../drivers/courseV10Operations'
import type { HostImageInput, PrepareImageResourcePort } from './imageResource'
import type { HostMediaInput, PrepareMediaResourcePort } from './mediaResource'

export interface ComponentImageApplicationInput {
  /** Already resolved by the Gateway; no active-document lookup occurs in this leaf. */
  snapshot: DocumentSnapshot
  target: ToolTarget
  image: HostImageInput
  mode: 'insert' | 'replace'
  /** Required for a whole-document insertion; other V10 targets already name their surface. */
  surfaceId?: string
  frame?: ComponentFrame
  fit?: ImageData['fit']
  alt?: string
  source?: AssetSource
  container?: ComponentContainer
  index?: number
}
export interface ComponentImageApplicationPorts {
  prepareImage: PrepareImageResourcePort
  createId?: () => string
}
export interface ComponentMediaApplicationInput extends Omit<ComponentImageApplicationInput, 'image'> { media: HostMediaInput }
export interface ComponentMediaApplicationPorts { prepareMedia: PrepareMediaResourcePort; createId?: () => string }
export interface PreparedComponentImageApplication {
  documentId: string
  epoch: string
  baseRevision: number
  command: ComponentOperationBatch
  assetId: string
  instanceId: string
  target: Extract<ToolTarget, { kind: 'course-instance' }>
}

/** Prepare resources and one command; the Gateway/DocumentSession remains the only writer. */
export async function prepareComponentImageApplication(input: ComponentImageApplicationInput,
  ports: ComponentImageApplicationPorts): Promise<PreparedComponentImageApplication> {
  return prepareComponentMediaApplication({ ...input, media: input.image }, { prepareMedia: ports.prepareImage, createId: ports.createId })
}

/** Image and audio/video adapters share resource registration, captured geometry and one canonical command. */
export async function prepareComponentMediaApplication(input: ComponentMediaApplicationInput,
  ports: ComponentMediaApplicationPorts): Promise<PreparedComponentImageApplication> {
  // Freeze identity, author data and input bytes before any host decode/network continuation.
  const captured = structuredClone(input), { snapshot, target } = captured
  if (snapshot.model.kind !== 'course-v10') throw new Error('媒体应用需要 Project V10 文档')
  const kind = captured.media.mimeType.startsWith('image/') ? 'image' : captured.media.mimeType.startsWith('audio/') ? 'audio'
    : captured.media.mimeType.startsWith('video/') ? 'video' : undefined
  if (!kind) throw new Error('来源不是图片、音频或视频')
  const project = snapshot.model.project
  const surfaceId = target.kind === 'course-surface' || target.kind === 'course-instance' ? target.surfaceId
    : target.kind === 'document' ? captured.surfaceId : undefined
  if (!surfaceId) throw new Error('媒体插入需要已解析的 V10 表面或对象目标')
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface) throw new Error('捕获的媒体表面已不存在')
  const stateId = target.kind === 'course-instance' || target.kind === 'course-surface' ? target.stateId ?? null : null
  if (stateId && !surface.presentation?.states.some(state => state.id === stateId)) throw new Error('捕获的展示状态已不存在')
  let instance: ComponentInstance | undefined
  let container: ComponentContainer | undefined
  if (target.kind === 'course-instance') {
    if (target.dataPath !== undefined || target.from !== undefined || target.to !== undefined || target.fieldScope === 'flowLayout') {
      throw new Error('媒体应用需要整对象目标，不能覆盖所选文字或排版字段')
    }
    instance = resolveComponentPresentation(project, surfaceId, stateId).instances[target.instanceId]
    if (!instance) throw new Error('捕获的媒体对象已不存在')
    let owner = owningContainer(project, instance.id)
    container = owner ?? undefined
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    if (!owner || owner.kind === 'surface' && owner.surfaceId !== surfaceId) throw new Error('媒体对象不属于捕获的表面')
    if (instance.locked) throw new Error('所选对象已锁定，请先解锁')
  }
  let replacement: JsonValue | undefined
  if (captured.mode === 'replace') {
    if (!instance) throw new Error('媒体替换需要现有媒体对象')
    const definition = project.definitions[instance.definitionId]
    if (componentDefinitionBuiltinKey(definition) !== `guoling.${kind}`) throw new Error('请选择同类型的原媒体进行替换')
    replacement = instance.data
  }
  const createId = ports.createId ?? nanoid
  const admitted = await ports.prepareMedia(captured.media, createId)
  const asset = { ...admitted.meta, ...(captured.source ? { source: captured.source } : {}) }
  const edits: ComponentEdit[] = [{ type: 'asset.add', asset, bytes: Uint8Array.from(admitted.bytes) }]
  let instanceId: string
  if (captured.mode === 'replace' && instance) {
    instanceId = instance.id
    const data = kind === 'image' ? replaceImageSource(imageDataSchema.parse(replacement), asset.id)
      : kind === 'audio' ? replaceAudioSource(audioDataSchema.parse(replacement), asset.id)
        : replaceVideoSource(videoDataSchema.parse(replacement), asset.id)
    if (captured.fit !== undefined && 'fit' in data) data.fit = captured.fit
    if (captured.alt !== undefined && 'alt' in data) data.alt = captured.alt
    edits.push({ type: 'data.set', instanceId, path: [], value: JSON.parse(JSON.stringify(data)) as JsonValue })
  } else {
    instanceId = `instance_${createId()}`
    const data = kind === 'image' ? createImageData(asset.id, captured.alt ?? admitted.meta.filename)
      : kind === 'audio' ? createAudioData(asset.id, admitted.meta.filename) : createVideoData(asset.id, admitted.meta.filename)
    if (captured.fit !== undefined && 'fit' in data) data.fit = captured.fit
    container = captured.container ?? container ?? { kind: 'surface', surfaceId }
    const children = containerChildIds(project, container)
    const neighbor = instance ? children.indexOf(instance.id) : -1
    const index = captured.index ?? (neighbor < 0 ? children.length : neighbor + 1)
    const naturalWidth = asset.width ?? 480, naturalHeight = asset.height ?? 300
    const scale = Math.min(1, 480 / naturalWidth, 360 / naturalHeight)
    const width = kind === 'audio' ? 480 : naturalWidth * scale, height = kind === 'audio' ? 64 : naturalHeight * scale
    const frame: ComponentFrame = captured.frame ?? { width, height, transform: [1, 0, 0, 1,
      surface.kind === 'slide' ? ((surface.designSize?.width ?? 1280) - width) / 2 : 0,
      surface.kind === 'slide' ? ((surface.designSize?.height ?? 720) - height) / 2 : 0] }
    const definition = kind === 'image' ? IMAGE_DEFINITION : kind === 'audio' ? AUDIO_DEFINITION : VIDEO_DEFINITION
    if (!project.definitions[definition.id]) edits.push({ type: 'definition.set', definition: structuredClone(definition) })
    edits.push({ type: 'instance.insert', container, index, rootIds: [instanceId], instances: [{ id: instanceId,
      definitionId: definition.id, name: admitted.meta.filename, data: JSON.parse(JSON.stringify(data)) as JsonValue, frame }] })
  }
  const mapped = presentationComponentEdits(project, surfaceId, stateId, edits)
  const command = captureComponentOperation(project, mapped)
  if (mapped !== edits) {
    const original = captureComponentOperation(project, edits)
    command.expected = [...new Map([...command.expected, ...original.expected].map(value => [JSON.stringify(value.path), value])).values()]
  }
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, command,
    assetId: asset.id, instanceId, target: { kind: 'course-instance', surfaceId, instanceId, ...(stateId ? { stateId } : {}) } }
}
