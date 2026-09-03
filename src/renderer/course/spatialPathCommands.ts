import { nanoid } from 'nanoid'
import { makeAuthoringAddress } from '../../shared/authoringAddress'
import type {
  CourseProjectDocument,
  SpatialCameraPose,
  SpatialPathDocument,
  SpatialPathStyle,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  rejectSpatialIfStale,
  replaceSpatialSession,
  succeedSpatialCommand,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  deleteSpatialWorldLayersInSession,
  spatialSurfaceIn,
} from './spatialEditorCommands'

export interface AddSpatialPathInput {
  readonly surfaceId: string
  readonly name: string
  readonly layerItemIds: readonly string[]
  readonly style?: SpatialPathStyle
  readonly id?: string
  readonly now?: string
}

export type SpatialPathUpdate =
  | Partial<Omit<SpatialPathDocument, 'id'>>
  | ((path: SpatialPathDocument) => void)

export type SpatialPlaybackStop =
  | {
      readonly kind: 'camera-frame'
      readonly frameId: string
      readonly locationId: string
      readonly pose: SpatialCameraPose
      readonly authoringAddress: string
    }
  | {
      readonly kind: 'path-waypoint'
      readonly pathId: string
      readonly layerItemId: string
      readonly authoringAddress: string
    }

export function stableSpatialGraphId(prefix: string, preferred?: string): string {
  return preferred ?? `${prefix}-${nanoid(10)}`
}

export function spatialGraphValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => spatialGraphValuesEqual(value, right[index]))
  }
  if (
    left === null || right === null
    || typeof left !== 'object' || typeof right !== 'object'
  ) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  return leftKeys.length === Object.keys(rightRecord).length
    && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(rightRecord, key)
      && spatialGraphValuesEqual(leftRecord[key], rightRecord[key])
    ))
}

export function spatialWorldLayerIdSet(surface: SpatialSurfaceDocument): Set<string> {
  return new Set(surface.world.layerItems.map((item) => item.layerItemId))
}

export function assertSpatialWorldLayerIds(
  surface: SpatialSurfaceDocument,
  layerItemIds: readonly string[],
  missingMessage: string,
): void {
  const worldIds = spatialWorldLayerIdSet(surface)
  const danglingId = layerItemIds.find((layerItemId) => !worldIds.has(layerItemId))
  if (danglingId !== undefined) throw new Error(missingMessage)
}

export function worldPaths(surface: SpatialSurfaceDocument): SpatialPathDocument[] {
  return surface.world.paths ?? []
}

export function spatialPathIn(
  surface: SpatialSurfaceDocument,
  pathId: string,
): SpatialPathDocument {
  const path = worldPaths(surface).find((candidate) => candidate.id === pathId)
  if (!path) throw new Error('找不到路径，请刷新后重试')
  return path
}

export function spatialGraphAuthoringAddress(input: {
  readonly projectId: string
  readonly surfaceId: string
  readonly entityId: string
  readonly field: string
}): string {
  return makeAuthoringAddress({
    projectId: input.projectId,
    scope: 'surface',
    surfaceId: input.surfaceId,
    carrier: 'native',
    layerItemId: input.entityId,
    field: input.field,
  })
}

export function spatialPathAuthoringAddress(
  projectId: string,
  surfaceId: string,
  pathId: string,
  field = 'world.paths',
): string {
  return spatialGraphAuthoringAddress({
    projectId,
    surfaceId,
    entityId: pathId,
    field,
  })
}

export function spatialCameraFrameAuthoringAddress(
  projectId: string,
  surfaceId: string,
  frameId: string,
  field = 'camera.frames',
): string {
  return spatialGraphAuthoringAddress({
    projectId,
    surfaceId,
    entityId: frameId,
    field,
  })
}

export function makeSpatialPathAuthoringTarget(
  session: SpatialAuthoringSession,
  pathId: string,
  field = 'world.paths',
): SpatialAuthoringTarget {
  const surfaceId = session.selection.surfaceId
  spatialPathIn(spatialSurfaceIn(session.history.present, surfaceId), pathId)
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.history.present.revision,
    generation: session.generation,
    authoringAddress: spatialPathAuthoringAddress(
      session.history.present.id,
      surfaceId,
      pathId,
      field,
    ),
    scope: 'surface',
    coordinateSpace: 'world',
    layerItemId: pathId,
  })
}

export function commitSpatialGraphHistoryResult(
  session: SpatialAuthoringSession,
  history: SpatialAuthoringHistory,
): SpatialCommandResult {
  if (history === session.history) return succeedSpatialCommand(session, false)
  return succeedSpatialCommand(replaceSpatialSession(session, { history }), true)
}

function validatePathName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('路径名称不能为空')
  if (trimmed.length > 200) throw new Error('路径名称不能超过 200 字')
  return trimmed
}

export function validateSpatialPathStyle(style: SpatialPathStyle | undefined): SpatialPathStyle | undefined {
  if (style === undefined) return undefined
  if (style.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(style.color)) {
    throw new Error('路径颜色格式应为 #RRGGBB')
  }
  if (
    style.width !== undefined
    && (!Number.isFinite(style.width) || style.width <= 0 || style.width > 10_000)
  ) {
    throw new Error('路径线宽必须大于 0 且不超过 10000')
  }
  if (
    style.dash !== undefined
    && style.dash !== 'solid'
    && style.dash !== 'dashed'
    && style.dash !== 'dotted'
  ) {
    throw new Error('路径线型无效，请重新选择')
  }
  return {
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.width !== undefined ? { width: style.width } : {}),
    ...(style.dash !== undefined ? { dash: style.dash } : {}),
  }
}

export function validateSpatialPathLayerItemIds(
  surface: SpatialSurfaceDocument,
  layerItemIds: readonly string[],
): string[] {
  if (layerItemIds.length === 0) {
    throw new Error('路径至少需要经过一个世界图层')
  }
  if (new Set(layerItemIds).size !== layerItemIds.length) {
    throw new Error('路径不能重复经过同一图层')
  }
  assertSpatialWorldLayerIds(surface, layerItemIds, '路径引用了不存在的世界图层')
  return [...layerItemIds]
}

export function summarizeSpatialWorldReferenceCleanup(
  surface: SpatialSurfaceDocument,
  removedIds: readonly string[],
): string {
  const removed = new Set(removedIds)
  const remaining = new Set(
    surface.world.layerItems
      .map((item) => item.layerItemId)
      .filter((layerItemId) => !removed.has(layerItemId)),
  )
  const droppedPathNames: string[] = []
  const trimmedPathNames: string[] = []
  for (const path of worldPaths(surface)) {
    const nextIds = path.layerItemIds.filter((layerItemId) => remaining.has(layerItemId))
    if (nextIds.length === 0) droppedPathNames.push(path.name)
    else if (nextIds.length !== path.layerItemIds.length) trimmedPathNames.push(path.name)
  }
  const droppedRelationCount = (surface.world.relations ?? []).filter((relation) => (
    !remaining.has(relation.sourceLayerItemId) || !remaining.has(relation.targetLayerItemId)
  )).length
  const droppedRuleCount = surface.semanticZoom.filter((rule) => {
    const nextIds = rule.layerItemIds.filter((layerItemId) => remaining.has(layerItemId))
    return nextIds.length === 0
  }).length
  const trimmedRuleCount = surface.semanticZoom.filter((rule) => {
    const nextIds = rule.layerItemIds.filter((layerItemId) => remaining.has(layerItemId))
    return nextIds.length > 0 && nextIds.length !== rule.layerItemIds.length
  }).length

  const parts: string[] = []
  if (droppedPathNames.length > 0) {
    parts.push(`将删除路径「${droppedPathNames.join('、')}」`)
  }
  if (trimmedPathNames.length > 0) {
    parts.push(`将从路径「${trimmedPathNames.join('、')}」中去掉已删图层`)
  }
  if (droppedRelationCount > 0) {
    parts.push(`将删除 ${droppedRelationCount} 条关系连线`)
  }
  if (droppedRuleCount > 0) {
    parts.push(`将删除 ${droppedRuleCount} 条语义缩放规则`)
  }
  if (trimmedRuleCount > 0) {
    parts.push(`将从 ${trimmedRuleCount} 条语义缩放规则中去掉已删图层`)
  }
  if (parts.length === 0) {
    return '删除这些世界元素不会改动路径、关系或语义缩放。'
  }
  return `${parts.join('；')}。世界元素删除后会在同一修订内清理引用，以保持课程有效。`
}

/**
 * Calls R5-A world delete (including its cascade) and reports the human-readable
 * cleanup that will happen. Path/relation dedicated commands still refuse
 * dangling writes with explicit reasons.
 */
export function deleteSpatialWorldLayersReportingReferences(
  session: SpatialAuthoringSession,
  options: SpatialCommandOptions = {},
): SpatialCommandResult & { readonly cleanupSummary: string } {
  const surface = spatialSurfaceIn(session.history.present, session.selection.surfaceId)
  const cleanupSummary = summarizeSpatialWorldReferenceCleanup(
    surface,
    session.selection.selectionIds,
  )
  return { ...deleteSpatialWorldLayersInSession(session, options), cleanupSummary }
}

export function resolveSpatialPlaybackSchedule(
  project: CourseProjectDocument,
  surfaceId: string,
  playbackPathId: string | null = null,
): SpatialPlaybackStop[] {
  const surface = spatialSurfaceIn(project, surfaceId)
  if (!playbackPathId) {
    return surface.camera.frames.map((frame) => {
      const location = project.locations.find((candidate) =>
        candidate.kind === 'spatial-camera'
        && candidate.surfaceId === surfaceId
        && candidate.cameraFrameId === frame.id,
      )
      if (!location) {
        throw new Error(`找不到镜头「${frame.name}」对应的课程位置，请刷新后重试`)
      }
      return {
        kind: 'camera-frame',
        frameId: frame.id,
        locationId: location.id,
        pose: { x: frame.x, y: frame.y, zoom: frame.zoom },
        authoringAddress: spatialCameraFrameAuthoringAddress(project.id, surfaceId, frame.id),
      }
    })
  }
  const path = spatialPathIn(surface, playbackPathId)
  return path.layerItemIds.map((layerItemId) => ({
    kind: 'path-waypoint' as const,
    pathId: path.id,
    layerItemId,
    authoringAddress: spatialPathAuthoringAddress(
      project.id,
      surfaceId,
      path.id,
      'world.paths.layerItemIds',
    ),
  }))
}

export function addSpatialPath(
  history: SpatialAuthoringHistory,
  input: AddSpatialPathInput,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, input.surfaceId)
  const name = validatePathName(input.name)
  const layerItemIds = validateSpatialPathLayerItemIds(surface, input.layerItemIds)
  const style = validateSpatialPathStyle(input.style)
  const pathId = stableSpatialGraphId('path', input.id)
  if (worldPaths(surface).some((path) => path.id === pathId)) {
    throw new Error('路径 ID 已存在，请重新生成后重试')
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, input.surfaceId)
    const paths = draftSurface.world.paths ?? []
    paths.push({
      id: pathId,
      name,
      layerItemIds,
      ...(style !== undefined ? { style } : {}),
    })
    draftSurface.world.paths = paths
  }, input.now)

  return commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialPath(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  update: SpatialPathUpdate,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const current = spatialPathIn(surface, pathId)
  const nextPath = structuredClone(current)
  if (typeof update === 'function') {
    update(nextPath)
  } else if (update !== null && typeof update === 'object') {
    Object.assign(nextPath, structuredClone(update))
  } else {
    throw new Error('路径更新数据无效')
  }
  nextPath.id = current.id
  nextPath.name = validatePathName(nextPath.name)
  nextPath.layerItemIds = validateSpatialPathLayerItemIds(surface, nextPath.layerItemIds)
  const normalizedStyle = validateSpatialPathStyle(nextPath.style)
  if (normalizedStyle === undefined) delete nextPath.style
  else nextPath.style = normalizedStyle
  if (spatialGraphValuesEqual(current, nextPath)) return history

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const paths = draftSurface.world.paths ?? []
    const index = paths.findIndex((path) => path.id === pathId)
    if (index < 0) throw new Error('找不到路径，请刷新后重试')
    paths[index] = nextPath
    draftSurface.world.paths = paths
  }, now)
  return commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialPath(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  if (!worldPaths(surface).some((path) => path.id === pathId)) {
    throw new Error('找不到路径，请刷新后重试')
  }
  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const paths = draftSurface.world.paths ?? []
    const index = paths.findIndex((path) => path.id === pathId)
    if (index < 0) throw new Error('找不到路径，请刷新后重试')
    paths.splice(index, 1)
    draftSurface.world.paths = paths
  }, now)
  return commitSpatialAuthoringHistory(history, next)
}

export function reorderSpatialPathWaypoints(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  pathId: string,
  layerItemIds: readonly string[],
  now?: string,
): SpatialAuthoringHistory {
  return updateSpatialPath(history, surfaceId, pathId, { layerItemIds: [...layerItemIds] }, now)
}

export function addSpatialPathInSession(
  session: SpatialAuthoringSession,
  input: Omit<AddSpatialPathInput, 'surfaceId'> & { readonly surfaceId?: string },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(session, addSpatialPath(session.history, {
      ...input,
      surfaceId: input.surfaceId ?? session.selection.surfaceId,
      now: input.now ?? options.now,
    }))
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateSpatialPathInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  update: SpatialPathUpdate,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      updateSpatialPath(session.history, session.selection.surfaceId, pathId, update, options.now),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function deleteSpatialPathInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      deleteSpatialPath(session.history, session.selection.surfaceId, pathId, options.now),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function reorderSpatialPathWaypointsInSession(
  session: SpatialAuthoringSession,
  pathId: string,
  layerItemIds: readonly string[],
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  return updateSpatialPathInSession(session, pathId, { layerItemIds: [...layerItemIds] }, options)
}

/** G1: dashed camera-frame overlay. Session-only; never writes revision. */
export function setSpatialShowCameraFrames(
  session: SpatialAuthoringSession,
  showCameraFrames: boolean,
): SpatialCommandResult {
  if (session.showCameraFrames === showCameraFrames) {
    return succeedSpatialCommand(session, false)
  }
  return succeedSpatialCommand(replaceSpatialSession(session, { showCameraFrames }), false)
}
