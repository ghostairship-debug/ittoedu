import type { CourseProjectDocument, SpatialRelationDocument, SpatialRelationKind, SpatialSurfaceDocument } from '../../shared/courseProjectTypes'
import { spatialSurfaceIn } from './spatialInsertion'
import { commitCourseProjectMutation as commitSpatialProjectMutation } from './courseProjectMutation'
import { assertSpatialWorldLayerIds, spatialGraphAuthoringAddress, spatialGraphValuesEqual, spatialWorldLayerIdSet, stableSpatialGraphId } from './spatialPath'

export interface AddSpatialRelationInput {
  readonly surfaceId: string
  readonly sourceLayerItemId: string
  readonly targetLayerItemId: string
  readonly kind: SpatialRelationKind
  readonly label?: string
  readonly id?: string
  readonly now?: string
}

export type SpatialRelationUpdate =
  | Partial<Omit<SpatialRelationDocument, 'id'>>
  | ((relation: SpatialRelationDocument) => void)



export function worldRelations(surface: SpatialSurfaceDocument): SpatialRelationDocument[] {
  return surface.world.relations ?? []
}

export function spatialRelationIn(
  surface: SpatialSurfaceDocument,
  relationId: string,
): SpatialRelationDocument {
  const relation = worldRelations(surface).find((candidate) => candidate.id === relationId)
  if (!relation) throw new Error('找不到关系连线，请刷新后重试')
  return relation
}

export function spatialRelationAuthoringAddress(
  projectId: string,
  surfaceId: string,
  relationId: string,
  field = 'world.relations',
): string {
  return spatialGraphAuthoringAddress({
    projectId,
    surfaceId,
    entityId: relationId,
    field,
  })
}

function validateRelationLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined
  const trimmed = label.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 500) throw new Error('关系标签不能超过 500 字')
  return trimmed
}

export function validateSpatialRelationKind(kind: SpatialRelationKind): SpatialRelationKind {
  if (kind !== 'line' && kind !== 'arrow' && kind !== 'bidirectional') {
    throw new Error('关系连线类型无效，请重新选择')
  }
  return kind
}

export function validateSpatialRelationEndpoints(
  surface: SpatialSurfaceDocument,
  sourceLayerItemId: string,
  targetLayerItemId: string,
): void {
  assertSpatialWorldLayerIds(
    surface,
    [sourceLayerItemId, targetLayerItemId],
    '关系连线引用了不存在的世界图层',
  )
  if (sourceLayerItemId === targetLayerItemId) {
    throw new Error('关系连线的起点和终点不能是同一个图层')
  }
}

function normalizedRelation(relation: SpatialRelationDocument): SpatialRelationDocument {
  const label = validateRelationLabel(relation.label)
  return {
    id: relation.id,
    sourceLayerItemId: relation.sourceLayerItemId,
    targetLayerItemId: relation.targetLayerItemId,
    kind: validateSpatialRelationKind(relation.kind),
    ...(label !== undefined ? { label } : {}),
  }
}

export function duplicateSpatialRelationsForCopiedWorldItems(
  relations: readonly SpatialRelationDocument[],
  copiedIdMap: ReadonlyMap<string, string>,
): SpatialRelationDocument[] {
  const duplicated: SpatialRelationDocument[] = []
  for (const relation of relations) {
    const source = copiedIdMap.get(relation.sourceLayerItemId)
    const target = copiedIdMap.get(relation.targetLayerItemId)
    if (!source || !target || source === target) continue
    duplicated.push(normalizedRelation({
      ...relation,
      id: stableSpatialGraphId('relation'),
      sourceLayerItemId: source,
      targetLayerItemId: target,
    }))
  }
  return duplicated
}

export function planSpatialGraphAfterWorldCopy(
  surface: SpatialSurfaceDocument,
  copiedIdMap: ReadonlyMap<string, string>,
): {
  readonly relationsToAdd: SpatialRelationDocument[]
  readonly note: string
} {
  const worldIds = spatialWorldLayerIdSet(surface)
  for (const copiedId of copiedIdMap.values()) {
    if (!worldIds.has(copiedId)) {
      throw new Error('复制后的世界图层还不存在，无法建立关系连线')
    }
  }
  const relationsToAdd = duplicateSpatialRelationsForCopiedWorldItems(
    worldRelations(surface),
    copiedIdMap,
  )
  if (relationsToAdd.length === 0) {
    return {
      relationsToAdd,
      note: '复制世界元素后不会自动改写原有路径；只有两端都被复制的关系连线才会复制一份。',
    }
  }
  return {
    relationsToAdd,
    note: `将为复制出的世界元素新增 ${relationsToAdd.length} 条关系连线；路径仍指向原来的图层。`,
  }
}

export function addCopiedSpatialRelations(
  project: CourseProjectDocument,
  surfaceId: string,
  copiedIdMap: ReadonlyMap<string, string>,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const plan = planSpatialGraphAfterWorldCopy(surface, copiedIdMap)
  if (plan.relationsToAdd.length === 0) return project
  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const relations = draftSurface.world.relations ?? []
    relations.push(...plan.relationsToAdd.map((relation) => structuredClone(relation)))
    draftSurface.world.relations = relations
  }, now)
  return next
}

export function addSpatialRelation(
  project: CourseProjectDocument,
  input: AddSpatialRelationInput,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, input.surfaceId)
  validateSpatialRelationEndpoints(surface, input.sourceLayerItemId, input.targetLayerItemId)
  const kind = validateSpatialRelationKind(input.kind)
  const label = validateRelationLabel(input.label)
  const relationId = stableSpatialGraphId('relation', input.id)
  if (worldRelations(surface).some((relation) => relation.id === relationId)) {
    throw new Error('关系连线 ID 已存在，请重新生成后重试')
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, input.surfaceId)
    const relations = draftSurface.world.relations ?? []
    relations.push({
      id: relationId,
      sourceLayerItemId: input.sourceLayerItemId,
      targetLayerItemId: input.targetLayerItemId,
      kind,
      ...(label !== undefined ? { label } : {}),
    })
    draftSurface.world.relations = relations
  }, input.now)
  return next
}

export function updateSpatialRelation(
  project: CourseProjectDocument,
  surfaceId: string,
  relationId: string,
  update: SpatialRelationUpdate,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  const current = spatialRelationIn(surface, relationId)
  const nextRelation = structuredClone(current)
  if (typeof update === 'function') {
    update(nextRelation)
  } else if (update !== null && typeof update === 'object') {
    Object.assign(nextRelation, structuredClone(update))
  } else {
    throw new Error('关系连线更新数据无效')
  }
  nextRelation.id = current.id
  validateSpatialRelationEndpoints(
    surface,
    nextRelation.sourceLayerItemId,
    nextRelation.targetLayerItemId,
  )
  const normalized = normalizedRelation(nextRelation)
  if (spatialGraphValuesEqual(normalizedRelation(current), normalized)) return project

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const relations = draftSurface.world.relations ?? []
    const index = relations.findIndex((relation) => relation.id === relationId)
    if (index < 0) throw new Error('找不到关系连线，请刷新后重试')
    relations[index] = normalized
    draftSurface.world.relations = relations
  }, now)
  return next
}

export function deleteSpatialRelation(
  project: CourseProjectDocument,
  surfaceId: string,
  relationId: string,
  now?: string,
): CourseProjectDocument {
  const surface = spatialSurfaceIn(project, surfaceId)
  if (!worldRelations(surface).some((relation) => relation.id === relationId)) {
    throw new Error('找不到关系连线，请刷新后重试')
  }
  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const relations = draftSurface.world.relations ?? []
    const index = relations.findIndex((relation) => relation.id === relationId)
    if (index < 0) throw new Error('找不到关系连线，请刷新后重试')
    relations.splice(index, 1)
    draftSurface.world.relations = relations
  }, now)
  return next
}
