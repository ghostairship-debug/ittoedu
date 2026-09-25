import type { AssetMeta, SoundDefinition } from '../../shared/contracts/media-v1/types'
import { applyCourseAssetImports, emptyCourseAssetSidecar, freezeCourseAssetSidecar, mutableCourseAssetSidecar, type CourseAssetSidecar } from '../project/v9AssetAdapter'
import {
  addCourseLibraryMediaToCanvas,
  bindCourseMediaSession,
  deleteCourseAsset,
  deleteCourseSound,
  importAndPlaceCourseMedia,
  importCourseSounds,
  updateCourseAudioSettings,
  updateCourseSound,
  type CourseMediaCommandResult,
} from '../course/v9MediaAudioCommands'
import { addSpatialWorldImageLayer, addSpatialWorldVideoLayer, commitSpatialAuthoringHistory, commitSpatialProjectMutation } from '../course/spatialEditorCommands'
import { succeedSpatialCommand } from '../course/spatialAuthoringHistory'
import { createCourseSoundDefinition } from '../../core/tools/courseAudio'
import { insertFlowSharedMedia } from '../course/flowSharedAuthoringAdapters'
import { insertFlowEditorBlock } from '../course/flowEditorCommands'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import { findFlowBlockRecursive, flowSurfaceIn } from '../../core/tools/flowDocumentModel'
import {
  COURSE_AUTHORING_TARGET_REJECTION_REASONS,
  captureCourseAuthoringTarget,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringSession,
  type CourseAuthoringTarget,
  type CurrentCourseAuthoringTargetIdentity,
} from '../authoring/courseAuthoringSession'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { EffectiveLayerProjection } from '../course/effectiveLayerProjection'
import type { SpatialAuthoringSession, SpatialCommandResult } from '../course/spatialEditorCommands'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import type { FlowCommandResult } from '../course/flowEditorCommands'
import type { FlowSharedAuthoringResult } from '../course/flowSharedAuthoringAdapters'
import type { SlideAuthoringSession } from '../course/slideAuthoringBackend'
import { commitSlideEditorTransactionHistory } from '../course/slideEditorCommands'
import {
  planCourseImageReplacement,
  type CourseImageReplacementFeedback,
  type CourseImageReplacementPlanFailureCode,
} from '../course/v9MediaAudioCommands'
import {
  planCourseMediaLibraryImport,
  type CourseMediaLibraryImportFeedback,
  type CourseMediaLibraryImportPlanFailureCode,
} from './courseMediaLibraryImport'
import type { AudioChannel, ProjectAudioSettings } from '../../shared/contracts/media-v1'
import {
  type CourseProjectRevisionTarget,
} from '../authoring/courseAuthoringSession'

export type { CourseProjectRevisionTarget }

export interface ProjectAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}

export interface ImportedAssetBatchItem {
  meta: AssetMeta
  bytes: Uint8Array
}

export type ImageReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseImageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseImageReplacementPlanFailureCode
      readonly reason: string
    }

export type MediaLibraryImportCommitResult =
  | {
      readonly ok: true
      readonly status: 'imported' | 'unchanged'
      readonly feedback: CourseMediaLibraryImportFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseMediaLibraryImportPlanFailureCode
      readonly reason: string
    }

export type MediaAuthoringState = {
  readonly document: CourseProjectDocument | null
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly authoringSession: CourseAuthoringSession | null
  readonly editingScope: 'scene' | 'global'
  readonly activeSceneId: string
  readonly projection: EffectiveLayerProjection | null
  readonly hasSlideSession: boolean
  readonly hasFlowSession: boolean
  readonly hasSpatialSession: boolean
}

export type MediaAuthoringPorts = {
  read(): MediaAuthoringState
  readSlideSession(): SlideAuthoringSession | null
  readSpatialSession(): SpatialAuthoringSession | null
  readFlowSession(): FlowAuthoringSession | null
  setFeedback(feedback: { errorMessage?: string | null; statusMessage?: string | null }): void
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistCandidateResult(
    result: {
      readonly ok: true
      readonly nextSession: SlideAuthoringSession
      readonly historyEntry: true
      readonly selection: SlideAuthoringSession['selection']
      readonly resourceTransition: {
        readonly resourceChanges: EditorTransactionStep['resourceChanges']
        readonly resourceDirection: 'forward'
      }
    },
    extra: {
      readonly statusMessage: string
      readonly transactionStep: EditorTransactionStep
      readonly courseAuthoringSession: CourseAuthoringSession
    },
  ): void
  persistMedia(result: CourseMediaCommandResult): CourseMediaCommandResult
  persistSpatial(result: SpatialCommandResult, extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar }): void
  persistFlow(result: FlowCommandResult | FlowSharedAuthoringResult, extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar }): FlowCommandResult | FlowSharedAuthoringResult
}

export type ImageAuthoringPorts = MediaAuthoringPorts

export function captureCourseProjectRevisionTarget(
  ports: ImageAuthoringPorts,
): CourseProjectRevisionTarget | null {
  const document = ports.read().document
  return document
    ? Object.freeze({
        projectId: document.id,
        documentRevision: document.revision,
      })
    : null
}

export function commitMediaLibraryImportAtTarget(
  ports: ImageAuthoringPorts,
  target: CourseProjectRevisionTarget,
  items: ImportedAssetBatchItem[],
): MediaLibraryImportCommitResult {
  const state = ports.read()
  const document = state.document
  if (!document || document.id !== target.projectId) {
    return {
      ok: false,
      code: 'project-mismatch',
      reason: '媒体库导入目标不属于当前 Course Project，请重新选择文件。',
    }
  }
  const planned = planCourseMediaLibraryImport({
    project: document,
    sidecar: state.sidecar ?? emptyCourseAssetSidecar(),
    items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
    projectId: target.projectId,
    baseRevision: target.documentRevision,
    now: new Date().toISOString(),
  })
  if (!planned.ok) return planned
  if (planned.status === 'no-op') {
    return {
      ok: true,
      status: 'unchanged',
      feedback: planned.feedback,
    }
  }
  try {
    const step = createEditorTransactionStep(document, planned.plan)
    if (!step || !ports.persistTransaction(
      step,
      `已批量导入 ${planned.plan.feedback?.importedAssetIds.length ?? items.length} 个媒体素材`,
    )) {
      return {
        ok: false,
        code: 'invalid-asset',
        reason: '当前 Course Project 没有可用的作者会话。',
      }
    }
    return {
      ok: true,
      status: 'imported',
      feedback: planned.plan.feedback!,
    }
  } catch (error) {
    return {
      ok: false,
      code: 'invalid-asset',
      reason: error instanceof Error ? error.message : '媒体库导入计划无效。',
    }
  }
}

export function captureCourseImageReplacementTarget(
  ports: ImageAuthoringPorts,
): CourseAuthoringTarget | null {
  const state = ports.read()
  const session = ports.readSlideSession()
  const selectedId = session?.selection.selectionIds.at(-1)
  if (!session || state.hasFlowSession || state.hasSpatialSession || !selectedId) return null
  const document = session.history.present
  const projection = state.projection
  const row = projection?.unifiedRows.find((candidate) => candidate.id === selectedId)
  if (
    !projection ||
    projection.surfaceType !== 'slide' ||
    projection.scope.owner !== 'scene' ||
    !row ||
    row.owner !== 'scene' ||
    row.ownerKey !== projection.scope.ownerKey ||
    row.item.kind !== 'native' ||
    row.item.content.nativeType !== 'image'
  ) {
    return null
  }
  let authoringSession = state.authoringSession
  if (!authoringSession) return null
  if (
    authoringSession.token.locationId !== projection.locationId ||
    authoringSession.token.surfaceType !== 'slide'
  ) {
    return null
  }
  authoringSession = updateCourseAuthoringSessionRevision(
    authoringSession,
    document.revision,
  )
  return captureCourseAuthoringTarget({
    sessionToken: authoringSession.token,
    projectId: projection.projectId,
    surfaceId: projection.surfaceId,
    stateId: projection.stateId,
    owner: row.owner,
    ownerKey: row.ownerKey,
    itemId: row.id,
    authoringAddress: row.authoringAddress,
  })
}

export function commitCourseImageReplacement(
  ports: ImageAuthoringPorts,
  target: CourseAuthoringTarget,
  asset: AssetMeta,
  bytes: Uint8Array,
): ImageReplacementCommitResult {
  const state = ports.read()
  const session = ports.readSlideSession()
  const activeProject = state.document
  const reject = (
    code: CourseImageReplacementPlanFailureCode,
    reason?: string,
  ): ImageReplacementCommitResult => ({
    ok: false,
    code,
    reason: reason ?? COURSE_AUTHORING_TARGET_REJECTION_REASONS[
      code as keyof typeof COURSE_AUTHORING_TARGET_REJECTION_REASONS
    ] ?? '图片替换目标已失效，请重新选择后再试',
  })
  if (!activeProject || activeProject.id !== target.projectId) {
    return reject('project-mismatch')
  }
  if (!state.authoringSession) return reject('session-stale')
  if (!session) {
    return reject(
      state.authoringSession.token.generation === target.sessionGeneration
        ? 'surface-or-location'
        : 'session-stale',
    )
  }
  const document = session.history.present
  const projection = state.projection
  if (!projection) return reject('surface-or-location')
  let authoringSession = state.authoringSession
  if (!authoringSession) return reject('session-stale')
  authoringSession = updateCourseAuthoringSessionRevision(
    authoringSession,
    document.revision,
  )
  const currentIdentity: CurrentCourseAuthoringTargetIdentity = {
    projectId: document.id,
    documentRevision: document.revision,
    sessionToken: authoringSession.token,
    surfaceId: projection.surfaceId,
    stateId: projection.stateId,
    owner: projection.scope.owner,
    ownerKey: projection.scope.ownerKey,
  }
  const planned = planCourseImageReplacement({
    project: document,
    sidecar: state.sidecar ?? emptyCourseAssetSidecar(),
    currentIdentity,
    target,
    asset,
    bytes,
    now: new Date().toISOString(),
  })
  if (!planned.ok) return planned
  if (planned.status === 'no-op') {
    return {
      ok: true,
      status: 'unchanged',
      feedback: planned.feedback,
    }
  }

  try {
    const step = createEditorTransactionStep(document, planned.plan)
    if (!step) return reject('invalid-asset', '图片替换没有产生可提交的变化')
    const nextSession = {
      ...session,
      history: commitSlideEditorTransactionHistory(session.history, step),
    }
    ports.persistCandidateResult({
      ok: true,
      nextSession,
      historyEntry: true,
      selection: session.selection,
      resourceTransition: {
        resourceChanges: step.resourceChanges,
        resourceDirection: 'forward',
      },
    }, {
      statusMessage: '图片已替换',
      transactionStep: step,
      courseAuthoringSession: updateCourseAuthoringSessionItems(
        updateCourseAuthoringSessionRevision(
          authoringSession,
          step.nextDocument.revision,
        ),
        session.selection.selectionIds,
      ),
    })
    return {
      ok: true,
      status: 'replaced',
      feedback: planned.plan.feedback!,
    }
  } catch (error) {
    return reject(
      'invalid-asset',
      error instanceof Error ? error.message : undefined,
    )
  }
}

export function createMediaAuthoringActions(ports: ImageAuthoringPorts) {
  const mediaSession = () => {
    const session = ports.readSlideSession()
    if (!session) return null
    return bindCourseMediaSession(session, ports.read().sidecar ?? emptyCourseAssetSidecar())
  }

  const importSpatialSounds = (
    items: ImportedAssetBatchItem[],
    sound?: Partial<SoundDefinition>,
  ): string[] => {
    const spatial = ports.readSpatialSession()
    const state = ports.read()
    const present = spatial?.history.present
    if (!spatial || !present || !state.document || state.document.id !== present.id
      || state.document.revision !== present.revision) {
      ports.setFeedback({ errorMessage: '当前 Spatial 课程工程已改变，请重新选择音频。', statusMessage: null })
      return []
    }
    if (!items.length) return []
    try {
      // Use the same asset import and sound-definition rules as Slide, then submit
      // through Spatial's resource-aware History/DocumentSession adapter.
      const definitions = items.map(item => createCourseSoundDefinition(item.meta, items.length === 1 ? sound : undefined))
      const files = mutableCourseAssetSidecar(state.sidecar ?? emptyCourseAssetSidecar())
      const project = commitSpatialProjectMutation(present, draft => {
        applyCourseAssetImports(draft.assets, files, items)
        for (const definition of definitions) draft.media.audio.sounds[definition.id] = definition
      })
      const nextSession = {
        ...spatial,
        history: commitSpatialAuthoringHistory(spatial.history, project),
      }
      ports.persistSpatial(succeedSpatialCommand(nextSession, true), {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已加入声音库供互动播放',
      })
      const committed = ports.readSpatialSession()
      const committedSidecar = ports.read().sidecar
      if (committed?.history.present.revision !== project.revision
        || definitions.some(definition => committed.history.present.media.audio.sounds[definition.id]?.assetId !== definition.assetId)
        || items.some(item => committedSidecar?.files[item.meta.id]?.byteLength !== item.bytes.byteLength)) {
        ports.setFeedback({ errorMessage: '声音未写入当前 Spatial 课程工程，请重试。', statusMessage: null })
        return []
      }
      return definitions.map(definition => definition.id)
    } catch (error) {
      ports.setFeedback({ errorMessage: error instanceof Error ? error.message : '声音导入失败。', statusMessage: null })
      return []
    }
  }

  const placeImage = (
    asset: AssetMeta,
    bytes: Uint8Array,
    x?: number,
    y?: number,
  ) => {
    const spatial = ports.readSpatialSession()
    if (spatial) {
      const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
      const files = { ...sidecar.files, [asset.id]: bytes.slice() }
      const present = spatial.history.present
      const withAsset = present.assets[asset.id]
        ? spatial
        : {
            ...spatial,
            history: {
              ...spatial.history,
              present: {
                ...present,
                assets: { ...present.assets, [asset.id]: structuredClone(asset) },
              },
            },
          }
      ports.persistSpatial(addSpatialWorldImageLayer(withAsset, {
        assetId: asset.id,
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: present.revision }), {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已添加图片',
      })
      return
    }
    const flow = ports.readFlowSession()
    if (flow) {
      const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
      const files = { ...sidecar.files, [asset.id]: bytes.slice() }
      const present = flow.history.present
      const prepared = present.assets[asset.id]
        ? present
        : { ...present, assets: { ...present.assets, [asset.id]: structuredClone(asset) } }
      ports.persistFlow(insertFlowSharedMedia(prepared, flow.selection, {
        assetId: asset.id,
      }, { expectedRevision: flow.history.present.revision }), {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已插入文中图片',
      })
      return
    }
    const media = mediaSession()
    if (!media) {
      ports.setFeedback({ errorMessage: '当前会话没有课程工程', statusMessage: null })
      return
    }
    const present = media.session.history.present
    if (present.assets[asset.id]) {
      ports.persistMedia(addCourseLibraryMediaToCanvas(media, asset.id, {
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: present.revision }))
      return
    }
    ports.persistMedia(importAndPlaceCourseMedia(media, {
      items: [{ meta: asset, bytes }],
      nativeType: 'image',
      mode: 'add',
      ...(typeof x === 'number' ? { x } : {}),
      ...(typeof y === 'number' ? { y } : {}),
    }, { expectedRevision: present.revision }))
  }

  const placeVideo = (
    asset: AssetMeta,
    bytes: Uint8Array,
    x?: number,
    y?: number,
  ) => {
    const spatial = ports.readSpatialSession()
    if (spatial) {
      const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
      const files = { ...sidecar.files, [asset.id]: bytes.slice() }
      ports.persistSpatial(addSpatialWorldVideoLayer(spatial, {
        assetId: asset.id,
        asset,
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: spatial.history.present.revision }), {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已添加视频',
      })
      return
    }
    const flow = ports.readFlowSession()
    if (flow) {
      const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
      const files = { ...sidecar.files, [asset.id]: bytes.slice() }
      const present = flow.history.present
      const prepared = present.assets[asset.id]
        ? present
        : { ...present, assets: { ...present.assets, [asset.id]: structuredClone(asset) } }
      ports.persistFlow(insertFlowSharedMedia(prepared, flow.selection, {
        assetId: asset.id,
      }, { expectedRevision: flow.history.present.revision }), {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已插入文中视频',
      })
      return
    }
    const media = mediaSession()
    if (!media) {
      ports.setFeedback({ errorMessage: '当前会话没有课程工程', statusMessage: null })
      return
    }
    const present = media.session.history.present
    if (present.assets[asset.id]) {
      ports.persistMedia(addCourseLibraryMediaToCanvas(media, asset.id, {
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: present.revision }))
      return
    }
    ports.persistMedia(importAndPlaceCourseMedia(media, {
      items: [{ meta: asset, bytes }],
      nativeType: 'video',
      mode: 'add',
      ...(typeof x === 'number' ? { x } : {}),
      ...(typeof y === 'number' ? { y } : {}),
    }, { expectedRevision: present.revision }))
  }

  return {
    captureMediaLibraryImportTarget() {
      return captureCourseProjectRevisionTarget(ports)
    },
    importAssetsAtTarget(
      target: CourseProjectRevisionTarget,
      items: ImportedAssetBatchItem[],
    ) {
      return commitMediaLibraryImportAtTarget(ports, target, items)
    },
    captureImageReplacementTarget() {
      return captureCourseImageReplacementTarget(ports)
    },
    replaceImageAssetAtTarget(
      target: CourseAuthoringTarget,
      asset: AssetMeta,
      bytes: Uint8Array,
    ) {
      return commitCourseImageReplacement(ports, target, asset, bytes)
    },
    addImageNode(asset: AssetMeta, bytes: Uint8Array, x?: number, y?: number) {
      placeImage(asset, bytes, x, y)
    },
    addVideoNode(asset: AssetMeta, bytes: Uint8Array, x?: number, y?: number) {
      placeVideo(asset, bytes, x, y)
    },
    addImageNodes(
      items: ImportedAssetBatchItem[],
      position?: { x?: number; y?: number },
    ): string[] {
      if (ports.read().hasSpatialSession || ports.read().hasFlowSession) {
        for (const item of items) {
          placeImage(item.meta, item.bytes, position?.x, position?.y)
        }
        return items.map((item) => item.meta.id)
      }
      const media = mediaSession()
      if (!media) return []
      const result = ports.persistMedia(importAndPlaceCourseMedia(media, {
        items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
        nativeType: 'image',
        mode: 'add',
        ...(typeof position?.x === 'number' ? { x: position.x } : {}),
        ...(typeof position?.y === 'number' ? { y: position.y } : {}),
      }, { expectedRevision: media.session.history.present.revision }))
      return [...(result.placedLayerItemIds ?? [])]
    },
    addVideoNodes(
      items: ImportedAssetBatchItem[],
      position?: { x?: number; y?: number },
    ): string[] {
      if (ports.read().hasSpatialSession || ports.read().hasFlowSession) {
        for (const item of items) {
          placeVideo(item.meta, item.bytes, position?.x, position?.y)
        }
        return items.map((item) => item.meta.id)
      }
      const media = mediaSession()
      if (!media) return []
      const result = ports.persistMedia(importAndPlaceCourseMedia(media, {
        items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
        nativeType: 'video',
        mode: 'add',
        ...(typeof position?.x === 'number' ? { x: position.x } : {}),
        ...(typeof position?.y === 'number' ? { y: position.y } : {}),
      }, { expectedRevision: media.session.history.present.revision }))
      return [...(result.placedLayerItemIds ?? [])]
    },
    insertFlowAudioNodes(items: ImportedAssetBatchItem[]): {
      completedCount: number
      issues: { name: string; message: string }[]
    } {
      const issues: { name: string; message: string }[] = []
      let completedCount = 0
      for (const item of items) {
        const flow = ports.readFlowSession()
        if (!flow || flow.selection.authoringScope !== 'page') {
          issues.push({ name: item.meta.filename, message: '请切换到 Flow 当前文档页后重新选择音频。' })
          break
        }
        if (item.meta.kind !== 'audio') {
          issues.push({ name: item.meta.filename, message: '所选资源不是音频。' })
          break
        }
        const present = flow.history.present
        const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
        if (present.assets[item.meta.id] && !sidecar.files[item.meta.id]) {
          issues.push({ name: item.meta.filename, message: '现有音频资源缺少文件，无法插入正文。' })
          break
        }
        const prepared = present.assets[item.meta.id]
          ? present
          : { ...present, assets: { ...present.assets, [item.meta.id]: structuredClone(item.meta) } }
        const planned = insertFlowSharedMedia(prepared, flow.selection, {
          assetId: item.meta.id,
          placement: 'document-block',
        }, { expectedRevision: present.revision })
        if (!planned.ok || !planned.nextDocument) {
          issues.push({ name: item.meta.filename, message: planned.reason ?? '无法插入当前正文位置。' })
          break
        }
        const files = present.assets[item.meta.id]
          ? sidecar.files
          : { ...sidecar.files, [item.meta.id]: item.bytes.slice() }
        const committed = ports.persistFlow(planned, {
          sidecar: freezeCourseAssetSidecar(files),
          statusMessage: '已插入文中音频',
        })
        if (!committed.ok) {
          issues.push({ name: item.meta.filename, message: committed.reason ?? '当前正文未接受音频插入。' })
          break
        }
        completedCount += 1
      }
      if (issues.length > 0 && completedCount + issues.length < items.length) {
        for (const item of items.slice(completedCount + issues.length)) {
          issues.push({ name: item.meta.filename, message: '前一项未完成，未继续插入。' })
        }
      }
      return { completedCount, issues }
    },
    insertFlowMediaAt(item: ImportedAssetBatchItem, afterBlockId: string | null): {
      ok: boolean
      reason?: string
      blockId?: string
    } {
      const flow = ports.readFlowSession()
      if (!flow || flow.selection.authoringScope !== 'page') {
        return { ok: false, reason: '请切换到 Flow 当前文档页后重新拖入媒体。' }
      }
      const mediaKind = item.meta.kind
      if (mediaKind !== 'image' && mediaKind !== 'video' && mediaKind !== 'audio') {
        return { ok: false, reason: '所选文件不是可插入正文的媒体。' }
      }
      const present = flow.history.present
      const surface = flowSurfaceIn(present, flow.selection.surfaceId)
      const anchor = afterBlockId === null ? null : findFlowBlockRecursive(surface.blocks, afterBlockId)
      if (afterBlockId !== null && !anchor) return { ok: false, reason: '正文拖放位置已经改变，请重新拖入。' }
      const sidecar = ports.read().sidecar ?? emptyCourseAssetSidecar()
      if (present.assets[item.meta.id] && !sidecar.files[item.meta.id]) {
        return { ok: false, reason: '现有媒体资源缺少文件，无法插入正文。' }
      }
      const prepared = present.assets[item.meta.id]
        ? present
        : { ...present, assets: { ...present.assets, [item.meta.id]: structuredClone(item.meta) } }
      const inserted = insertFlowEditorBlock(prepared, {
        surfaceId: surface.id,
        parentId: anchor?.parentId ?? null,
        index: anchor ? anchor.index + 1 : 0,
        block: { type: 'media', assetId: item.meta.id, mediaKind, layout: 'content-width' },
      }, { expectedRevision: present.revision })
      const blockId = inserted.createdBlockIds?.[0]
      if (!inserted.ok || !inserted.nextDocument || !blockId) {
        return { ok: false, reason: inserted.reason ?? '无法插入当前正文位置。' }
      }
      const files = present.assets[item.meta.id]
        ? sidecar.files
        : { ...sidecar.files, [item.meta.id]: item.bytes.slice() }
      const committed = ports.persistFlow({
        ...inserted,
        selection: selectFlowEditorBlock(inserted.nextDocument, flow.selection.locationId, blockId),
      }, {
        sidecar: freezeCourseAssetSidecar(files),
        statusMessage: '已插入文中媒体',
      })
      return committed.ok
        ? { ok: true, blockId }
        : { ok: false, reason: committed.reason ?? '当前正文未接受媒体插入。' }
    },
    importAsset(asset: AssetMeta, bytes: Uint8Array) {
      const target = captureCourseProjectRevisionTarget(ports)
      if (!target) return
      const result = commitMediaLibraryImportAtTarget(ports, target, [{ meta: asset, bytes }])
      if (!result.ok) ports.setFeedback({ errorMessage: result.reason, statusMessage: null })
    },
    importAssets(items: ImportedAssetBatchItem[]) {
      const target = captureCourseProjectRevisionTarget(ports)
      if (!target) return
      const result = commitMediaLibraryImportAtTarget(ports, target, items)
      if (!result.ok) ports.setFeedback({ errorMessage: result.reason, statusMessage: null })
    },
    importSounds(items: ImportedAssetBatchItem[]): string[] {
      if (ports.readSpatialSession()) return importSpatialSounds(items)
      const media = mediaSession()
      if (!media) return []
      const result = ports.persistMedia(importCourseSounds(media, items.map((item) => ({
        meta: item.meta,
        bytes: item.bytes,
      })), { expectedRevision: media.session.history.present.revision }))
      return [...(result.soundIds ?? [])]
    },
    importSound(asset: AssetMeta, bytes: Uint8Array, sound?: Partial<SoundDefinition>): string {
      if (ports.readSpatialSession()) return importSpatialSounds([{ meta: asset, bytes }], sound)[0] ?? ''
      const media = mediaSession()
      if (!media) return ''
      const result = ports.persistMedia(importCourseSounds(media, [{
        meta: asset,
        bytes,
      }], {
        expectedRevision: media.session.history.present.revision,
        sound,
      }))
      return result.soundIds?.[0] ?? ''
    },
    updateAudioSettings(patch: Parameters<typeof updateCourseAudioSettings>[1]) {
      const media = mediaSession()
      if (!media) return
      ports.persistMedia(updateCourseAudioSettings(media, patch, {
        expectedRevision: media.session.history.present.revision,
      }))
    },
    updateSound(soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>>) {
      const media = mediaSession()
      if (!media) return
      ports.persistMedia(updateCourseSound(media, soundId, patch, {
        expectedRevision: media.session.history.present.revision,
      }))
    },
    deleteSound(soundId: string): boolean {
      const media = mediaSession()
      if (!media) return false
      return ports.persistMedia(deleteCourseSound(media, soundId, {
        expectedRevision: media.session.history.present.revision,
      })).ok
    },
    deleteAsset(assetId: string): boolean {
      const media = mediaSession()
      if (!media) return false
      const componentPackages = ports.read().componentPackages
      return ports.persistMedia(deleteCourseAsset(media, assetId, {
        expectedRevision: media.session.history.present.revision,
        componentPackages,
      })).ok
    },
    importV9CandidateMedia(input: {
      items: ImportedAssetBatchItem[]
      nativeType?: 'image' | 'video' | 'audio'
      mode?: 'add' | 'library'
      x?: number
      y?: number
    }): CourseMediaCommandResult {
      const media = mediaSession()
      if (!media) {
        return {
          ok: false,
          reason: 'not-slide-authoring-backend',
          nextSession: undefined as unknown as SlideAuthoringSession,
          sidecar: emptyCourseAssetSidecar(),
          historyEntry: false,
        }
      }
      const items = input.items.map((item) => ({ meta: item.meta, bytes: item.bytes }))
      if (input.nativeType === 'audio') {
        return ports.persistMedia(importCourseSounds(media, items, {
          expectedRevision: media.session.history.present.revision,
        }))
      }
      if (!input.nativeType) {
        const target = captureCourseProjectRevisionTarget(ports)
        const committed = target
          ? commitMediaLibraryImportAtTarget(ports, target, items)
          : {
              ok: false as const,
              code: 'project-mismatch' as const,
              reason: '当前没有可写入的 Course Project。',
            }
        const session = ports.readSlideSession() ?? media.session
        return {
          ok: committed.ok,
          reason: committed.ok ? undefined : committed.reason,
          nextSession: session,
          sidecar: ports.read().sidecar ?? media.sidecar,
          historyEntry: committed.ok && committed.status === 'imported',
          selection: session.selection,
          importedAssetIds: committed.ok ? committed.feedback.importedAssetIds : [],
          reusedAssetIds: committed.ok ? committed.feedback.reusedAssetIds : [],
          destination: 'library',
        }
      }
      return ports.persistMedia(importAndPlaceCourseMedia(media, {
        items,
        nativeType: input.nativeType,
        mode: input.mode ?? 'library',
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
      }, {
        expectedRevision: media.session.history.present.revision,
      }))
    },
  }
}
