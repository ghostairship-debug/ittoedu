import { nanoid } from 'nanoid'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type {
  AudioChannel,
  AssetMeta,
  ImageFit,
  ProjectAudioSettings,
  SoundDefinition,
} from '../../shared/projectTypes'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import {
  COURSE_AUTHORING_TARGET_REJECTION_REASONS,
  validateCourseAuthoringTarget,
  type CourseAuthoringTarget,
  type CourseAuthoringTargetRejectionCode,
  type CurrentCourseAuthoringTargetIdentity,
} from '../authoring/courseAuthoringSession'
import { makeLayerItemAuthoringAddress } from '../authoring/courseAuthoringScope'
import {
  createImageNode,
  createVideoNode,
} from '../project/nativeNodeFactories'
import {
  MEDIA_BATCH_CANVAS_LIMIT,
  layoutMediaBatchFrames,
  planMediaBatchImport,
  type MediaBatchLibraryFallback,
} from '../project/mediaBatch'
import {
  applyCourseAssetImports,
  courseAssetSidecarGaps,
  describeCourseAssetReference,
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  listCourseAssetReferences,
  listCourseSoundReferences,
  mutableCourseAssetSidecar,
  pruneCourseAssetSidecar,
  publishedCourseAssetsAreCovered,
  type CourseAssetSidecar,
  type CourseImportedAsset,
} from '../project/v9AssetAdapter'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  SlideCommandError,
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  selectSlideEditorLayers,
  type SlideAuthoringSelection,
  type SlideAuthoringSessionRef,
  type SlideCommandOptions,
  type SlideCommandResult,
} from './slideEditorCommands'
import { buildSlideEditorView } from './slideEditorView'
import {
  addSlideImageLayer,
  addSlideVideoLayer,
  offsetDefaultSlideInsertion,
  replaceSlideMediaAsset,
  updateSlideNativeLayerContent,
} from './v9SlideContentCommands'
import {
  openSlideAuthoringSession,
  type SlideAuthoringSession,
} from './slideAuthoringBackend'
import { planAssetFileHistoryChange } from '../store/courseResourceState'
import { allocateCourseLayerOrder, sortScopedLayerList } from './globalLayerCommands'

/**
 * V9 MediaTab / sound-library commands. Not wired to the real MediaTab;
 * R3-Z must attach the same V8 MediaTab to these exports. Default product
 * remains V8 `editorStore` import/audio paths.
 */

export {
  MEDIA_BATCH_CANVAS_LIMIT,
  layoutMediaBatchFrames,
  planMediaBatchImport,
} from '../project/mediaBatch'
export {
  collectCoursePublishedAssetIds,
  courseAssetSidecarGaps,
  dedupeCourseMediaImports,
  describeCourseAssetReference,
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  listCourseAssetReferences,
  listCourseSoundReferences,
  pruneCourseAssetSidecar,
  publishedCourseAssetsAreCovered,
  putCourseAssetBytes,
  removeCourseAssetBytes,
} from '../project/v9AssetAdapter'
export type {
  CourseAssetSidecar,
  CourseImportedAsset,
} from '../project/v9AssetAdapter'

const AUDIO_CHANNELS: readonly AudioChannel[] = [
  'music',
  'narration',
  'sfx',
  'ui',
  'video',
]

export interface CourseMediaSession {
  readonly session: SlideAuthoringSession
  readonly sidecar: CourseAssetSidecar
}

export interface CourseMediaCommandResult {
  readonly ok: boolean
  readonly reason?: string
  readonly nextSession: SlideAuthoringSession
  readonly sidecar: CourseAssetSidecar
  readonly historyEntry: boolean
  readonly selection?: SlideAuthoringSelection
  readonly importedAssetIds?: readonly string[]
  readonly reusedAssetIds?: readonly string[]
  readonly soundIds?: readonly string[]
  readonly placedLayerItemIds?: readonly string[]
  readonly destination?: 'canvas' | 'library'
  readonly libraryFallback?: MediaBatchLibraryFallback
}

export interface CourseSoundLibraryEntry {
  readonly sound: SoundDefinition
  readonly asset: AssetMeta | undefined
  readonly bytes: Uint8Array | undefined
}

export interface CourseMediaLibraryView {
  readonly audioSettings: ProjectAudioSettings
  readonly sounds: CourseSoundLibraryEntry[]
  readonly unusedAudioAssets: AssetMeta[]
  readonly videoAssets: AssetMeta[]
  readonly imageAssets: AssetMeta[]
}

export interface CourseAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}

export interface CourseMediaFitCropPatch {
  fit?: ImageFit
  crop?: { left: number; top: number; right: number; bottom: number }
  cropX?: number
  cropY?: number
}

export type ReplaceCourseLayerMediaInput =
  | { assetId: string }
  | { meta: AssetMeta; bytes: Uint8Array }

export interface CourseImageReplacementSelectionHint {
  readonly itemId: string
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId: string | null
}

export interface CourseImageReplacementFeedback {
  readonly kind: 'image-replaced' | 'image-unchanged'
  readonly assetId: string
  readonly assetDisposition: 'added' | 'reused' | 'repaired' | 'unchanged'
}

export type CourseImageReplacementTransactionPlan = EditorTransactionPlan<
  CourseImageReplacementSelectionHint,
  CourseImageReplacementFeedback
>

export type CourseImageReplacementPlanFailureCode =
  | CourseAuthoringTargetRejectionCode
  | 'wrong-owner'
  | 'wrong-surface'
  | 'invalid-target'
  | 'target-locked'
  | 'invalid-asset'
  | 'asset-conflict'

export type CourseImageReplacementPlanResult =
  | {
      readonly ok: true
      readonly status: 'planned'
      readonly plan: CourseImageReplacementTransactionPlan
    }
  | {
      readonly ok: true
      readonly status: 'no-op'
      readonly plan: null
      readonly selectionHint: CourseImageReplacementSelectionHint
      readonly feedback: CourseImageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseImageReplacementPlanFailureCode
      readonly reason: string
    }

export interface PlanCourseImageReplacementInput {
  readonly project: CourseProjectDocument
  readonly sidecar: CourseAssetSidecar
  readonly currentIdentity: CurrentCourseAuthoringTargetIdentity
  readonly target: CourseAuthoringTarget
  readonly asset: AssetMeta
  readonly bytes: Uint8Array
  /** Explicit clock input keeps the planner deterministic and side-effect free. */
  readonly now: string
}

export interface ImportAndPlaceCourseMediaInput {
  items: ReadonlyArray<CourseImportedAsset>
  nativeType: 'image' | 'video'
  mode: 'add' | 'library'
  x?: number
  y?: number
}

function freezeSelection(selection: SlideAuthoringSelection): SlideAuthoringSelection {
  return Object.freeze({
    locationId: selection.locationId,
    stateId: selection.stateId,
    selectionIds: Object.freeze([...selection.selectionIds]),
  })
}

function freezeSession(session: SlideAuthoringSessionRef): SlideAuthoringSession {
  return Object.freeze({
    sessionId: session.sessionId,
    history: Object.freeze({
      present: session.history.present,
      past: Object.freeze([...session.history.past]),
      future: Object.freeze([...session.history.future]),
    }),
    selection: freezeSelection(session.selection),
    scope: session.scope,
    generation: session.generation,
  })
}

function current(media: CourseMediaSession): CourseMediaSession {
  return Object.freeze({
    session: freezeSession(media.session),
    sidecar: media.sidecar,
  })
}

function reject(
  media: CourseMediaSession,
  reason: string,
): CourseMediaCommandResult {
  const session = freezeSession(media.session)
  return {
    ok: false,
    reason,
    nextSession: session,
    sidecar: media.sidecar,
    historyEntry: false,
    selection: session.selection,
  }
}

function wrapSlide(
  media: CourseMediaSession,
  result: SlideCommandResult,
  sidecar: CourseAssetSidecar = media.sidecar,
  extra: Partial<CourseMediaCommandResult> = {},
): CourseMediaCommandResult {
  const nextSession = freezeSession(result.nextSession ?? media.session)
  return {
    ok: result.ok,
    reason: result.reason,
    nextSession,
    sidecar,
    historyEntry: result.historyEntry === true,
    selection: result.selection ?? nextSession.selection,
    ...extra,
  }
}

function rejectIfStale(
  media: CourseMediaSession,
  expectedRevision?: number,
): CourseMediaCommandResult | null {
  if (
    expectedRevision !== undefined
    && expectedRevision !== media.session.history.present.revision
  ) {
    return reject(media, SLIDE_REJECT_STALE_REVISION)
  }
  return null
}

function catchCommand(
  media: CourseMediaSession,
  error: unknown,
): CourseMediaCommandResult {
  if (error instanceof SlideCommandError) return reject(media, error.reason)
  if (error instanceof Error) return reject(media, error.message)
  return reject(media, '命令失败')
}

function clampVolume(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

function matchesFilter(filter: string, value: string): boolean {
  return !filter || value.toLocaleLowerCase().includes(filter)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function slideSceneContext(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
): {
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} {
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { surface, scene }
}

function sortSceneLayers(scene: SlideSceneDocument): void {
  scene.layerItems.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

function nextSceneLayerOrder(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
  scene: SlideSceneDocument,
): number {
  const used = new Set<number>([
    ...project.globalLayerItems.map((entry) => entry.item.order),
    ...surface.surfaceLayerItems.map((entry) => entry.item.order),
    ...scene.layerItems.map((item) => item.order),
  ])
  let order = Math.max(-1, ...scene.layerItems.map((item) => item.order)) + 1
  if (order < 0) order = 0
  while (used.has(order)) order += 1
  return order
}

function appendSceneLayer(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
  scene: SlideSceneDocument,
  item: LayerItem,
  stateId: string | null,
): void {
  if (scene.layerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (scene.layerItems.some((candidate) => candidate.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSceneLayerOrder(project, surface, scene)
  if (stateId) {
    const presentationState = scene.presentation?.states.find(
      (candidate) => candidate.id === stateId,
    )
    if (!presentationState) throw new Error(`找不到命名状态：${stateId}`)
    item.visible = false
    presentationState.layerItemOverrides[item.layerItemId] = { visible: true }
  }
  scene.layerItems.push(item)
  sortSceneLayers(scene)
}

function writeNativeAssetId(
  scene: SlideSceneDocument,
  stateId: string | null,
  layerItemId: string,
  assetId: string,
): void {
  const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
  if (!base || base.kind !== 'native') {
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  if (stateId) {
    const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
    if (!state) throw new Error('当前命名状态已失效')
    const override = state.layerItemOverrides[layerItemId] ?? {}
    const currentData = mergeCourseNativeData(
      base.content.data as Record<string, unknown>,
      override.nativeData ?? {},
    )
    const nextData = mergeCourseNativeData(currentData, { assetId })
    override.nativeData = Object.fromEntries(
      Object.entries(nextData).filter(([key, value]) =>
        !sameJson((base.content.data as Record<string, unknown>)[key], value),
      ),
    )
    if (Object.keys(override.nativeData).length === 0) delete override.nativeData
    if (Object.keys(override).length === 0) delete state.layerItemOverrides[layerItemId]
    else state.layerItemOverrides[layerItemId] = override
    return
  }
  const native = base as NativeLayerItem
  native.content.data = mergeCourseNativeData(
    native.content.data as Record<string, unknown>,
    { assetId },
  ) as typeof native.content.data
}

type CourseImageTargetResolution =
  | {
      readonly ok: true
      readonly scene: SlideSceneDocument
      readonly currentAssetId: string
      readonly locked: boolean
    }
  | {
      readonly ok: false
      readonly code: CourseImageReplacementPlanFailureCode
      readonly reason: string
    }

const COURSE_IMAGE_REPLACEMENT_FAILURE_REASONS: Readonly<Record<
  Exclude<CourseImageReplacementPlanFailureCode, CourseAuthoringTargetRejectionCode>,
  string
>> = Object.freeze({
  'wrong-owner': '图片替换只接受 Slide 场景中的原生图片',
  'wrong-surface': '图片替换只接受 Slide 场景目标',
  'invalid-target': '目标不是可替换的原生图片',
  'target-locked': '目标图片已锁定，不能替换',
  'invalid-asset': '替换图片的素材信息或二进制内容无效',
  'asset-conflict': '素材 ID 已存在，但 metadata 或二进制内容不同',
})

function courseImageReplacementFailure(
  code: CourseImageReplacementPlanFailureCode,
  reason?: string,
): Extract<CourseImageReplacementPlanResult, { readonly ok: false }> {
  const targetReason = COURSE_AUTHORING_TARGET_REJECTION_REASONS[
    code as CourseAuthoringTargetRejectionCode
  ]
  return Object.freeze({
    ok: false as const,
    code,
    reason: reason ?? targetReason ?? COURSE_IMAGE_REPLACEMENT_FAILURE_REASONS[
      code as Exclude<
        CourseImageReplacementPlanFailureCode,
        CourseAuthoringTargetRejectionCode
      >
    ],
  })
}

function findCourseImageTargetScene(
  project: CourseProjectDocument,
  target: CourseAuthoringTarget,
): {
  readonly surface: SlideSurfaceDocument
  readonly scene: SlideSceneDocument
} | null {
  const location = project.locations.find((candidate) => (
    candidate.id === target.locationId
  ))
  if (
    !location ||
    location.kind !== 'slide-scene' ||
    location.surfaceId !== target.surfaceId
  ) {
    return null
  }
  const surface = project.surfaces.find((candidate) => (
    candidate.id === target.surfaceId
  ))
  if (!surface || surface.type !== 'slide') return null
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  return scene ? { surface, scene } : null
}

function resolveCourseImageTarget(
  project: CourseProjectDocument,
  target: CourseAuthoringTarget,
): CourseImageTargetResolution {
  if (project.id !== target.projectId) {
    return courseImageReplacementFailure('project-mismatch')
  }
  if (target.surfaceType !== 'slide') {
    return courseImageReplacementFailure('wrong-surface')
  }
  if (target.owner !== 'scene') {
    return courseImageReplacementFailure('wrong-owner')
  }
  const resolved = findCourseImageTargetScene(project, target)
  if (!resolved) return courseImageReplacementFailure('wrong-surface')
  const { scene, surface } = resolved
  if (target.ownerKey !== `scene:${scene.id}`) {
    return courseImageReplacementFailure('wrong-owner')
  }
  const baseItem = scene.layerItems.find((candidate) => (
    candidate.layerItemId === target.itemId
  ))
  if (!baseItem) return courseImageReplacementFailure('item-missing')
  if (
    baseItem.kind !== 'native' ||
    baseItem.content.nativeType !== 'image'
  ) {
    return courseImageReplacementFailure('invalid-target')
  }
  const canonicalAddress = makeLayerItemAuthoringAddress({
    projectId: project.id,
    owner: 'scene',
    surfaceId: surface.id,
    sceneId: scene.id,
    kind: baseItem.kind,
    layerItemId: baseItem.layerItemId,
  })
  if (canonicalAddress !== target.authoringAddress) {
    return courseImageReplacementFailure('item-missing')
  }
  try {
    const view = buildSlideEditorView({
      project,
      locationId: target.locationId,
      stateId: target.stateId,
    })
    const layer = view.layers.find((candidate) => (
      candidate.source === 'scene' && candidate.selectionId === target.itemId
    ))
    if (!layer) return courseImageReplacementFailure('item-missing')
    if (
      layer.item.kind !== 'native' ||
      layer.item.content.nativeType !== 'image'
    ) {
      return courseImageReplacementFailure('invalid-target')
    }
    return {
      ok: true,
      scene,
      currentAssetId: layer.item.content.data.assetId,
      locked: layer.item.locked,
    }
  } catch {
    return courseImageReplacementFailure('item-missing')
  }
}

function sameCourseAssetBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
}

function sameCourseAssetMeta(left: AssetMeta, right: AssetMeta): boolean {
  return left.id === right.id &&
    left.filename === right.filename &&
    left.mimeType === right.mimeType &&
    left.kind === right.kind &&
    left.path === right.path &&
    left.byteLength === right.byteLength &&
    left.width === right.width &&
    left.height === right.height &&
    left.duration === right.duration
}

function courseImageAssetInputIsValid(
  asset: AssetMeta,
  bytes: Uint8Array,
): boolean {
  const positiveOptional = (value: number | undefined): boolean => (
    value === undefined || (Number.isFinite(value) && value > 0)
  )
  return Boolean(
    asset.id.trim() &&
    asset.filename.trim() &&
    asset.mimeType.trim() &&
    asset.path.trim() &&
    !/^(?:[a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(asset.path) &&
    asset.kind === 'image' &&
    Number.isInteger(asset.byteLength) &&
    asset.byteLength === bytes.byteLength &&
    positiveOptional(asset.width) &&
    positiveOptional(asset.height) &&
    (asset.duration === undefined || (
      Number.isFinite(asset.duration) && asset.duration >= 0
    ))
  )
}

function courseImageReplacementSelectionHint(
  target: CourseAuthoringTarget,
): CourseImageReplacementSelectionHint {
  return Object.freeze({
    itemId: target.itemId,
    authoringAddress: target.authoringAddress,
    locationId: target.locationId,
    stateId: target.stateId,
  })
}

function createMediaNode(
  nativeType: 'image' | 'video',
  asset: AssetMeta,
  x?: number,
  y?: number,
  id?: string,
) {
  if (nativeType === 'image') {
    const sized = createImageNode(asset.id, asset.width, asset.height, x, y)
    return createImageNode({
      id: id ?? `image-${nanoid(10)}`,
      name: '图片',
      assetId: asset.id,
      width: sized.width,
      height: sized.height,
      x,
      y,
    })
  }
  return createVideoNode({
    id: id ?? `video-${nanoid(10)}`,
    name: '视频',
    assetId: asset.id,
    width: asset.width ?? 640,
    height: asset.height ?? 360,
    x,
    y,
  })
}

function commitMediaProject(
  media: CourseMediaSession,
  project: CourseProjectDocument,
  sidecar: CourseAssetSidecar,
  extra: Partial<CourseMediaCommandResult> = {},
): CourseMediaCommandResult {
  const selection = extra.selection ?? selectSlideEditorLayers({
    project,
    locationId: media.session.selection.locationId,
    stateId: media.session.selection.stateId,
    selectionIds: extra.placedLayerItemIds
      ?? [...media.session.selection.selectionIds],
  })
  const nextSession = freezeSession({
    sessionId: media.session.sessionId,
    history: commitSlideAuthoringHistory(media.session.history, project),
    selection,
    scope: media.session.scope,
    generation: media.session.generation,
  })
  return {
    ok: true,
    nextSession,
    sidecar,
    historyEntry: true,
    selection,
    ...extra,
  }
}

export function openCourseMediaSession(
  project: CourseProjectDocument,
  sidecar: CourseAssetSidecar = emptyCourseAssetSidecar(),
  options: { locationId?: string; sessionId?: string } = {},
): CourseMediaSession {
  return Object.freeze({
    session: openSlideAuthoringSession(project, options),
    sidecar: freezeCourseAssetSidecar(sidecar.files),
  })
}

export function bindCourseMediaSession(
  session: SlideAuthoringSession,
  sidecar: CourseAssetSidecar,
): CourseMediaSession {
  return Object.freeze({
    session: freezeSession(session),
    sidecar: freezeCourseAssetSidecar(sidecar.files),
  })
}

export function readCourseMediaLibrary(
  media: CourseMediaSession,
  filterQuery = '',
): CourseMediaLibraryView {
  const project = media.session.history.present
  const assets = project.assets
  const audioSettings = project.media.audio
  const sounds = audioSettings.sounds
  const filter = filterQuery.trim().toLocaleLowerCase()
  const soundEntries = Object.values(sounds)
    .filter((sound) => {
      const asset = assets[sound.assetId]
      return matchesFilter(filter, `${sound.name} ${asset?.filename ?? ''} 音频 声音`)
    })
    .map((sound) => ({
      sound,
      asset: assets[sound.assetId],
      bytes: media.sidecar.files[sound.assetId],
    }))
  const mappedAudio = new Set(Object.values(sounds).map((sound) => sound.assetId))
  return {
    audioSettings,
    sounds: soundEntries,
    unusedAudioAssets: Object.values(assets).filter((asset) =>
      asset.kind === 'audio'
      && !mappedAudio.has(asset.id)
      && matchesFilter(filter, `${asset.filename} 音频 声音 ${asset.mimeType}`),
    ),
    videoAssets: Object.values(assets).filter((asset) =>
      asset.kind === 'video'
      && matchesFilter(filter, `${asset.filename} 视频 ${asset.mimeType}`),
    ),
    imageAssets: Object.values(assets).filter((asset) =>
      asset.kind === 'image'
      && matchesFilter(filter, `${asset.filename} 图片 图像 ${asset.mimeType}`),
    ),
  }
}

export function readCourseSoundPreview(
  media: CourseMediaSession,
  soundId: string,
): CourseSoundLibraryEntry | null {
  const sound = media.session.history.present.media.audio.sounds[soundId]
  if (!sound) return null
  return {
    sound,
    asset: media.session.history.present.assets[sound.assetId],
    bytes: media.sidecar.files[sound.assetId],
  }
}

export function importCourseMediaAssets(
  media: CourseMediaSession,
  items: ReadonlyArray<CourseImportedAsset>,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  if (items.length === 0) {
    return {
      ok: true,
      nextSession: freezeSession(media.session),
      sidecar: media.sidecar,
      historyEntry: false,
      selection: media.session.selection,
      importedAssetIds: [],
      reusedAssetIds: [],
      destination: 'library',
    }
  }
  try {
    const sidecarFiles = mutableCourseAssetSidecar(media.sidecar)
    const preview = applyCourseAssetImports(
      { ...media.session.history.present.assets },
      sidecarFiles,
      items,
    )
    if (preview.importedAssetIds.length === 0) {
      return {
        ok: true,
        nextSession: freezeSession(media.session),
        sidecar: freezeCourseAssetSidecar(sidecarFiles),
        historyEntry: false,
        selection: media.session.selection,
        importedAssetIds: preview.importedAssetIds,
        reusedAssetIds: preview.reusedAssetIds,
        destination: 'library',
      }
    }
    const writeFiles = mutableCourseAssetSidecar(media.sidecar)
    let importedAssetIds: string[] = []
    let reusedAssetIds: string[] = []
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      const applied = applyCourseAssetImports(draft.assets, writeFiles, items)
      importedAssetIds = applied.importedAssetIds
      reusedAssetIds = applied.reusedAssetIds
    }, options.now)
    return commitMediaProject(
      media,
      project,
      freezeCourseAssetSidecar(writeFiles),
      {
        importedAssetIds,
        reusedAssetIds,
        destination: 'library',
        selection: media.session.selection,
      },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

function placeMediaItems(
  media: CourseMediaSession,
  nativeType: 'image' | 'video',
  items: ReadonlyArray<CourseImportedAsset>,
  x: number | undefined,
  y: number | undefined,
  now?: string,
): CourseMediaCommandResult {
  const sidecarFiles = mutableCourseAssetSidecar(media.sidecar)
  let importedAssetIds: string[] = []
  let reusedAssetIds: string[] = []
  const placedLayerItemIds: string[] = []
  const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
    const applied = applyCourseAssetImports(draft.assets, sidecarFiles, items)
    importedAssetIds = applied.importedAssetIds
    reusedAssetIds = applied.reusedAssetIds
    const global = media.session.scope === 'global'
    const existingCount = global
      ? draft.globalLayerItems.length
      : slideSceneContext(draft, media.session).scene.layerItems.length
    if (!global && existingCount + items.length > MAX_SCENE_NODES) {
      throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
    }
    const single = items.length === 1
    const nodes = items.map((item, index) => {
      const explicit = single && (x !== undefined || y !== undefined)
      const node = offsetDefaultSlideInsertion(
        createMediaNode(
          nativeType,
          item.meta,
          single ? x : undefined,
          single ? y : undefined,
        ),
        existingCount + index,
        explicit,
      )
      return node
    })
    const laidOut = items.length > 1
      ? layoutMediaBatchFrames(nodes).map((frame, index) => ({
        ...nodes[index]!,
        ...frame,
      }))
      : nodes
    for (const node of laidOut) {
      const item = sceneNodeToCourseLayerItem(node)
      if (global) {
        const preferred = Math.max(-1, ...draft.globalLayerItems.map((entry) => entry.item.order)) + 1
        item.order = allocateCourseLayerOrder(draft, Math.max(0, preferred))
        draft.globalLayerItems.push({
          item: structuredClone(item),
          plane: 'overlay',
          visibility: { mode: 'all', locationIds: [] },
        })
        sortScopedLayerList(draft.globalLayerItems)
      } else {
        const { surface, scene } = slideSceneContext(draft, media.session)
        appendSceneLayer(draft, surface, scene, structuredClone(item), media.session.selection.stateId)
      }
      placedLayerItemIds.push(node.id)
    }
  }, now)
  return commitMediaProject(
    media,
    project,
    freezeCourseAssetSidecar(sidecarFiles),
    {
      importedAssetIds,
      reusedAssetIds,
      placedLayerItemIds,
      destination: 'canvas',
      selection: selectSlideEditorLayers({
        project,
        locationId: media.session.selection.locationId,
        stateId: media.session.selection.stateId,
        selectionIds: placedLayerItemIds,
      }),
    },
  )
}

export function importAndPlaceCourseMedia(
  media: CourseMediaSession,
  input: ImportAndPlaceCourseMediaInput,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  if (input.items.length === 0) {
    return {
      ok: true,
      nextSession: freezeSession(media.session),
      sidecar: media.sidecar,
      historyEntry: false,
      selection: media.session.selection,
      destination: input.mode === 'add' ? 'canvas' : 'library',
      importedAssetIds: [],
      placedLayerItemIds: [],
    }
  }
  try {
    const plan = planMediaBatchImport(
      input.mode,
      input.items.length,
      MEDIA_BATCH_CANVAS_LIMIT,
    )
    if (plan.destination === 'library') {
      const imported = importCourseMediaAssets(media, input.items, options)
      return {
        ...imported,
        destination: 'library',
        placedLayerItemIds: [],
        ...(plan.overflowToLibrary ? { libraryFallback: 'batch-size' as const } : {}),
      }
    }
    if (media.session.scope !== 'global') {
      const { scene } = slideSceneContext(media.session.history.present, media.session)
      if (scene.layerItems.length + input.items.length > MAX_SCENE_NODES) {
        const imported = importCourseMediaAssets(media, input.items, options)
        return {
          ...imported,
          destination: 'library',
          placedLayerItemIds: [],
          libraryFallback: 'scene-capacity',
        }
      }
    }
    return placeMediaItems(
      media,
      input.nativeType,
      input.items,
      input.x,
      input.y,
      options.now,
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

/**
 * Places an already-imported library image/video onto the current scene by
 * calling R2-D `addSlideImageLayer` / `addSlideVideoLayer` (same stagger).
 */
export function addCourseLibraryMediaToCanvas(
  media: CourseMediaSession,
  assetId: string,
  input: { x?: number; y?: number; id?: string } = {},
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  const asset = media.session.history.present.assets[assetId]
  if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) {
    return reject(media, `找不到可加入画布的素材：${assetId}`)
  }
  if (!media.sidecar.files[assetId]) {
    return reject(media, `工程缺少素材“${asset.filename}”的二进制内容`)
  }
  const result = asset.kind === 'image'
    ? addSlideImageLayer(media.session, { assetId, ...input }, options)
    : addSlideVideoLayer(media.session, { assetId, ...input }, options)
  return wrapSlide(media, result, media.sidecar, {
    placedLayerItemIds: result.ok ? result.selection?.selectionIds : [],
    destination: 'canvas',
  })
}

/**
 * Plans one captured Slide image replacement without reading live selection,
 * writing a Store, committing history, or mutating either input value.
 */
export function planCourseImageReplacement(
  input: PlanCourseImageReplacementInput,
): CourseImageReplacementPlanResult {
  let resolution: CourseImageTargetResolution | undefined
  const validation = validateCourseAuthoringTarget({
    target: input.target,
    current: input.currentIdentity,
    hasItem: (target) => {
      resolution = resolveCourseImageTarget(input.project, target)
      return resolution.ok
    },
  })
  if (!validation.ok) {
    if (resolution && !resolution.ok) return resolution
    return courseImageReplacementFailure(validation.code, validation.reason)
  }
  if (!resolution || !resolution.ok) {
    return resolution ?? courseImageReplacementFailure('item-missing')
  }
  if (input.project.id !== input.currentIdentity.projectId) {
    return courseImageReplacementFailure('project-mismatch')
  }
  if (input.project.revision !== input.currentIdentity.documentRevision) {
    return courseImageReplacementFailure('revision-conflict')
  }
  if (resolution.locked) {
    return courseImageReplacementFailure('target-locked')
  }
  if (!courseImageAssetInputIsValid(input.asset, input.bytes)) {
    return courseImageReplacementFailure('invalid-asset')
  }

  const existingMeta = input.project.assets[input.asset.id]
  const existingBytes = input.sidecar.files[input.asset.id]
  if (existingMeta && !sameCourseAssetMeta(existingMeta, input.asset)) {
    return courseImageReplacementFailure('asset-conflict')
  }
  if (existingBytes && !sameCourseAssetBytes(existingBytes, input.bytes)) {
    return courseImageReplacementFailure('asset-conflict')
  }

  const selectionHint = courseImageReplacementSelectionHint(input.target)
  if (
    resolution.currentAssetId === input.asset.id &&
    existingMeta !== undefined &&
    existingBytes !== undefined
  ) {
    return Object.freeze({
      ok: true as const,
      status: 'no-op' as const,
      plan: null,
      selectionHint,
      feedback: Object.freeze({
        kind: 'image-unchanged' as const,
        assetId: input.asset.id,
        assetDisposition: 'unchanged' as const,
      }),
    })
  }

  const resourceChange = planAssetFileHistoryChange(
    input.asset.id,
    existingBytes,
    input.bytes,
  )
  const assetDisposition: CourseImageReplacementFeedback['assetDisposition'] =
    existingMeta && existingBytes
      ? 'reused'
      : existingMeta || existingBytes
        ? 'repaired'
        : 'added'
  let nextDocument: CourseProjectDocument
  try {
    nextDocument = commitSlideProjectMutation(input.project, (draft) => {
      if (!draft.assets[input.asset.id]) {
        draft.assets[input.asset.id] = structuredClone(input.asset)
      }
      const targetScene = findCourseImageTargetScene(draft, input.target)
      if (!targetScene) {
        throw new Error('目标 Slide 场景已失效')
      }
      writeNativeAssetId(
        targetScene.scene,
        input.target.stateId,
        input.target.itemId,
        input.asset.id,
      )
    }, input.now)
  } catch (error) {
    return courseImageReplacementFailure(
      'invalid-asset',
      error instanceof Error ? error.message : undefined,
    )
  }

  const feedback = Object.freeze({
    kind: 'image-replaced' as const,
    assetId: input.asset.id,
    assetDisposition,
  })
  const plan: CourseImageReplacementTransactionPlan = Object.freeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument,
    resourceChanges: resourceChange
      ? { assetFileChanges: [resourceChange] }
      : {},
    selectionHint,
    feedback,
  })
  return Object.freeze({
    ok: true as const,
    status: 'planned' as const,
    plan,
  })
}

export function replaceCourseLayerMedia(
  media: CourseMediaSession,
  layerItemId: string,
  input: ReplaceCourseLayerMediaInput,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  if ('assetId' in input) {
    return wrapSlide(
      media,
      replaceSlideMediaAsset(media.session, layerItemId, input.assetId, options),
    )
  }
  try {
    const view = buildSlideEditorView({
      project: media.session.history.present,
      locationId: media.session.selection.locationId,
      stateId: media.session.selection.stateId,
    })
    const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
    if (!layer) throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
    if (layer.source !== 'scene') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前选择不属于当前幻灯片场景')
    }
    if (layer.item.locked) {
      throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
    }
    if (layer.item.kind !== 'native') {
      throw new SlideCommandError('invalid-target', '请选择一个图片或视频后替换')
    }
    const nativeType = layer.item.content.nativeType
    if (nativeType !== 'image' && nativeType !== 'video') {
      throw new SlideCommandError('invalid-target', '请选择一个图片或视频后替换')
    }
    if (input.meta.kind !== nativeType) {
      throw new Error('替换素材类型必须与当前图层一致')
    }
    const sidecarFiles = mutableCourseAssetSidecar(media.sidecar)
    let importedAssetIds: string[] = []
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      const applied = applyCourseAssetImports(draft.assets, sidecarFiles, [input])
      importedAssetIds = applied.importedAssetIds
      const { scene } = slideSceneContext(draft, media.session)
      writeNativeAssetId(scene, media.session.selection.stateId, layerItemId, input.meta.id)
    }, options.now)
    return commitMediaProject(
      media,
      project,
      freezeCourseAssetSidecar(sidecarFiles),
      {
        importedAssetIds,
        reusedAssetIds: importedAssetIds.length === 0 ? [input.meta.id] : [],
        selection: selectSlideEditorLayers({
          project,
          locationId: media.session.selection.locationId,
          stateId: media.session.selection.stateId,
          selectionIds: [layerItemId],
        }),
      },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function updateCourseMediaFitCrop(
  media: CourseMediaSession,
  layerItemId: string,
  patch: CourseMediaFitCropPatch,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const nativeData: Record<string, unknown> = {}
  if (patch.fit !== undefined) nativeData.fit = patch.fit
  if (patch.crop !== undefined) nativeData.crop = patch.crop
  if (patch.cropX !== undefined) nativeData.cropX = patch.cropX
  if (patch.cropY !== undefined) nativeData.cropY = patch.cropY
  return wrapSlide(
    media,
    updateSlideNativeLayerContent(media.session, layerItemId, { nativeData }, options),
  )
}

export function deleteCourseAsset(
  media: CourseMediaSession,
  assetId: string,
  options: SlideCommandOptions & {
    componentPackages?: Readonly<Record<string, import('../../shared/componentTypes').ComponentPackageData>>
  } = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  const project = media.session.history.present
  if (!project.assets[assetId]) return reject(media, `找不到素材：${assetId}`)
  const references = listCourseAssetReferences(project, assetId, {
    componentPackages: options.componentPackages,
    includeDisabledRuntimes: true,
  })
  if (references.length > 0) {
    const locations = references
      .slice(0, 3)
      .map(describeCourseAssetReference)
      .join('；')
    return reject(
      media,
      `该素材仍被引用，不能删除：${locations}${
        references.length > 3 ? `；另有 ${references.length - 3} 处` : ''
      }。`,
    )
  }
  try {
    const sidecarFiles = mutableCourseAssetSidecar(media.sidecar)
    delete sidecarFiles[assetId]
    const next = commitSlideProjectMutation(project, (draft) => {
      delete draft.assets[assetId]
    }, options.now)
    return commitMediaProject(
      media,
      next,
      freezeCourseAssetSidecar(sidecarFiles),
      { selection: media.session.selection },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function importCourseSounds(
  media: CourseMediaSession,
  items: ReadonlyArray<CourseImportedAsset>,
  options: SlideCommandOptions & {
    sound?: Partial<Omit<SoundDefinition, 'id' | 'assetId'>>
  } = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  if (items.length === 0) {
    return {
      ok: true,
      nextSession: freezeSession(media.session),
      sidecar: media.sidecar,
      historyEntry: false,
      selection: media.session.selection,
      soundIds: [],
      importedAssetIds: [],
    }
  }
  try {
    const sidecarFiles = mutableCourseAssetSidecar(media.sidecar)
    const soundIds: string[] = []
    let importedAssetIds: string[] = []
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      const applied = applyCourseAssetImports(draft.assets, sidecarFiles, items)
      importedAssetIds = applied.importedAssetIds
      const single = items.length === 1
      for (const item of items) {
        if (item.meta.kind !== 'audio') {
          throw new Error(`声音导入失败：${item.meta.filename} 不是音频素材`)
        }
        const soundId = `sound_${nanoid()}`
        const definition: SoundDefinition = {
          id: soundId,
          name: (single && options.sound?.name?.trim())
            || item.meta.filename.replace(/\.[^.]+$/, ''),
          assetId: item.meta.id,
          channel: (single && options.sound?.channel) || 'sfx',
          defaultVolume: single && options.sound?.defaultVolume !== undefined
            ? options.sound.defaultVolume
            : 1,
          defaultLoop: single && options.sound?.defaultLoop !== undefined
            ? options.sound.defaultLoop
            : false,
        }
        draft.media.audio.sounds[soundId] = definition
        soundIds.push(soundId)
      }
    }, options.now)
    return commitMediaProject(
      media,
      project,
      freezeCourseAssetSidecar(sidecarFiles),
      {
        importedAssetIds,
        soundIds,
        selection: media.session.selection,
      },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function updateCourseSound(
  media: CourseMediaSession,
  soundId: string,
  patch: Partial<Omit<SoundDefinition, 'id'>>,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  const existing = media.session.history.present.media.audio.sounds[soundId]
  if (!existing) return reject(media, `找不到声音：${soundId}`)
  try {
    let changed = false
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      const sound = draft.media.audio.sounds[soundId]
      if (!sound) return
      if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== sound.name) {
        sound.name = patch.name.trim()
        changed = true
      }
      if (patch.assetId !== undefined && patch.assetId !== sound.assetId) {
        if (!draft.assets[patch.assetId] || draft.assets[patch.assetId]?.kind !== 'audio') {
          throw new Error(`找不到声音素材：${patch.assetId}`)
        }
        sound.assetId = patch.assetId
        changed = true
      }
      if (patch.channel !== undefined && patch.channel !== sound.channel) {
        sound.channel = patch.channel
        changed = true
      }
      if (patch.defaultVolume !== undefined) {
        const next = clampVolume(patch.defaultVolume, sound.defaultVolume)
        if (next !== sound.defaultVolume) {
          sound.defaultVolume = next
          changed = true
        }
      }
      if (patch.defaultLoop !== undefined && patch.defaultLoop !== sound.defaultLoop) {
        sound.defaultLoop = patch.defaultLoop
        changed = true
      }
    }, options.now)
    if (!changed) {
      return {
        ok: true,
        nextSession: freezeSession(media.session),
        sidecar: media.sidecar,
        historyEntry: false,
        selection: media.session.selection,
      }
    }
    return commitMediaProject(
      media,
      project,
      media.sidecar,
      { selection: media.session.selection },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function deleteCourseSound(
  media: CourseMediaSession,
  soundId: string,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  const sound = media.session.history.present.media.audio.sounds[soundId]
  if (!sound) return reject(media, `找不到声音：${soundId}`)
  const references = listCourseSoundReferences(media.session.history.present, soundId)
  if (references.length > 0) {
    return reject(
      media,
      '该声音仍被交互规则引用。请先删除或改写相关声音动作。',
    )
  }
  try {
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      delete draft.media.audio.sounds[soundId]
    }, options.now)
    return commitMediaProject(
      media,
      project,
      media.sidecar,
      { selection: media.session.selection },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function updateCourseAudioSettings(
  media: CourseMediaSession,
  patch: CourseAudioSettingsPatch,
  options: SlideCommandOptions = {},
): CourseMediaCommandResult {
  const stale = rejectIfStale(media, options.expectedRevision)
  if (stale) return stale
  try {
    let changed = false
    const project = commitSlideProjectMutation(media.session.history.present, (draft) => {
      const audio = draft.media.audio
      if (patch.defaultMuted !== undefined && patch.defaultMuted !== audio.defaultMuted) {
        audio.defaultMuted = patch.defaultMuted
        changed = true
      }
      if (patch.masterVolume !== undefined) {
        const next = clampVolume(patch.masterVolume, audio.masterVolume)
        if (next !== audio.masterVolume) {
          audio.masterVolume = next
          changed = true
        }
      }
      if (patch.channelVolumes) {
        for (const channel of AUDIO_CHANNELS) {
          const value = patch.channelVolumes[channel]
          if (value === undefined) continue
          const next = clampVolume(value, audio.channelVolumes[channel])
          if (next !== audio.channelVolumes[channel]) {
            audio.channelVolumes[channel] = next
            changed = true
          }
        }
      }
      if (patch.narrationDucking?.enabled !== undefined
        && patch.narrationDucking.enabled !== audio.narrationDucking.enabled) {
        audio.narrationDucking.enabled = patch.narrationDucking.enabled
        changed = true
      }
      if (patch.narrationDucking?.musicVolume !== undefined) {
        const next = clampVolume(
          patch.narrationDucking.musicVolume,
          audio.narrationDucking.musicVolume,
        )
        if (next !== audio.narrationDucking.musicVolume) {
          audio.narrationDucking.musicVolume = next
          changed = true
        }
      }
      if (
        patch.narrationDucking?.fadeMs !== undefined
        && Number.isFinite(patch.narrationDucking.fadeMs)
      ) {
        const next = Math.max(0, Math.round(patch.narrationDucking.fadeMs))
        if (next !== audio.narrationDucking.fadeMs) {
          audio.narrationDucking.fadeMs = next
          changed = true
        }
      }
    }, options.now)
    if (!changed) {
      return {
        ok: true,
        nextSession: freezeSession(media.session),
        sidecar: media.sidecar,
        historyEntry: false,
        selection: media.session.selection,
      }
    }
    return commitMediaProject(
      media,
      project,
      media.sidecar,
      { selection: media.session.selection },
    )
  } catch (error) {
    return catchCommand(media, error)
  }
}

export function pruneCourseMediaSidecar(
  media: CourseMediaSession,
): CourseMediaCommandResult {
  const sidecar = pruneCourseAssetSidecar(media.session.history.present, media.sidecar)
  return {
    ok: true,
    nextSession: freezeSession(media.session),
    sidecar,
    historyEntry: false,
    selection: media.session.selection,
  }
}

export function courseMediaSidecarIsComplete(media: CourseMediaSession): boolean {
  return courseAssetSidecarGaps(media.session.history.present, media.sidecar).length === 0
    && publishedCourseAssetsAreCovered(media.session.history.present, media.sidecar)
}

export function nextCourseMediaSession(
  result: CourseMediaCommandResult,
): CourseMediaSession {
  return current({ session: result.nextSession, sidecar: result.sidecar })
}
