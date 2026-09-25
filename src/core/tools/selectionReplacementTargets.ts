import type { AuthoringToolTargetWireV1 } from '../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ToolTarget } from '../../shared/workbench/tools'
import { layerToolContext, sameLayerGroup } from './layerEditing'
import { carrierForFlowBlock, makeFlowBlockAuthoringAddress, resolveFlowBlock, flowSurfaceIn } from './flowDocumentModel'

/** Translate only validated host targets; no model-provided wire coordinates. */
export function selectionReplacementTargets(project: CourseProjectDocument, target: ToolTarget, replacement: ToolTarget) {
  let fields: Pick<AuthoringToolTargetWireV1, 'locationId' | 'stateId' | 'surfaceType' | 'surfaceId' | 'owner' | 'ownerKey' | 'itemId' | 'authoringAddress'>
  let replacementItemId: string
  if (target.kind === 'course-object' && replacement.kind === 'course-object') {
    const old = layerToolContext(project, target), next = layerToolContext(project, replacement)
    if (!sameLayerGroup(old, next)) throw new Error('替换对象必须属于同一位置、owner、平面与呈现状态')
    if (old.entry.item.locked || next.entry.item.locked) throw new Error('替换对象已锁定')
    const source = old.located.source
    fields = { locationId: target.locationId, stateId: target.stateId ?? null, surfaceType: old.composition.surfaceType,
      surfaceId: old.composition.surfaceId, owner: source, ownerKey: source === 'global' ? 'global' : `${source}:${source === 'scene' ? old.located.sceneId : old.composition.surfaceId}`,
      itemId: target.itemId, authoringAddress: old.command.authoringAddress }
    replacementItemId = replacement.itemId
  } else if (target.kind === 'flow-block' && replacement.kind === 'flow-block') {
    if (target.surfaceId !== replacement.surfaceId || target.parentId !== replacement.parentId) throw new Error('替换正文必须属于同一表面与父分节')
    const surface = flowSurfaceIn(project, target.surfaceId), old = resolveFlowBlock(project, target)
    resolveFlowBlock(project, replacement)
    const location = project.locations.find(location => location.surfaceId === surface.id)
    if (!location) throw new Error('Flow 表面缺少正式导航位置')
    fields = { locationId: location.id, stateId: null, surfaceType: 'flow', surfaceId: surface.id, owner: 'surface', ownerKey: `surface:${surface.id}`, itemId: target.blockId,
      authoringAddress: makeFlowBlockAuthoringAddress({ projectId: project.id, surfaceId: surface.id, blockId: target.blockId, carrier: carrierForFlowBlock(old.block) }) }
    replacementItemId = replacement.blockId
  } else throw new Error('完整替换需要两个同类的对象或正文块句柄')
  const wire: AuthoringToolTargetWireV1 = { ...fields, projectId: project.id, documentRevision: project.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 0 }
  return { wire, replacementItemId }
}
