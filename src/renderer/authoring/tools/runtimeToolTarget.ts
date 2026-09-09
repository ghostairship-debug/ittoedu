import type { AuthoringToolDestinationV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { resolveEffectiveLayerTarget } from '../../course/effectiveLayerCommands'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { resolveAuthoringToolScope } from './authoringToolScope'

/** The public tool consumes the selected item identity. Only the host derives
 * its exact field address; field planners keep their existing strict checks. */
export function resolveRuntimeToolTarget(document: CourseProjectDocument, destination: AuthoringToolDestinationV1, field: string) {
  if (destination.kind !== 'update') throw new Error('Runtime 修改需要精确 update target')
  const resolved = resolveAuthoringToolScope(document, destination)
  const { target, surface, scope } = resolved
  const located = resolveEffectiveLayerTarget(document, destination.target)
  if (located.item.kind !== 'runtime' || located.item.layerItemId !== destination.target.itemId || located.source !== scope.owner
    || located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) {
    throw new Error('Runtime target 身份、owner 或 Surface 不匹配')
  }
  const address = (value: string) => makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner,
    surfaceId: surface.id, sceneId: located.sceneId, kind: 'runtime', layerItemId: destination.target.itemId, field: value })
  const authoringAddress = address(field)
  if (destination.target.authoringAddress !== address('item') && destination.target.authoringAddress !== authoringAddress) {
    throw new Error('Runtime target 必须是当前对象或对应字段的正式地址')
  }
  return { ...resolved, runtimeTarget: { ...destination.target, authoringAddress } }
}
