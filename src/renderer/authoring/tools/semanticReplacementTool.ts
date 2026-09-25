import { planSelectionReplacement, selectionReplacementSchema } from '../../../core/tools/selectionReplacement'
import { z } from 'zod'
import type { AuthoringToolDestinationV1, AuthoringToolTargetWireV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { locateCourseLayer } from '../../course/effectiveLayerCommands'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { findFlowBlockRecursive } from '../../../core/tools/flowDocumentModel'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { type AuthoringToolDefinition } from './executeAuthoringTool'

const schema = selectionReplacementSchema

/** Additional scopes belong only to the selected target's replacement dependency chain. */
export function captureSelectionReplacementScopes(document: CourseProjectDocument, targets: readonly AuthoringToolTargetWireV1[]): AuthoringToolDestinationV1[] {
  const result: AuthoringToolDestinationV1[] = []
  for (const target of targets) {
    const surface = document.surfaces.find(value => value.id === target.surfaceId)
    const body = surface?.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, target.itemId) : null
    if (!body && !locateCourseLayer(document, target.itemId)) continue
    const { itemId: _itemId, authoringAddress: _address, ...scope } = target
    result.push({ kind: 'create', scope: { ...scope, parent: body ? { kind: 'flow-body', parentBlockId: body.parentId } : { kind: 'owner' }, insertion: { kind: 'append' } } })
    const global = projectEffectiveLayers({ project: document, locationId: target.locationId, owner: 'global' }).scope
    result.push({ kind: 'create', scope: { ...scope, stateId: null, owner: 'global', ownerKey: global.ownerKey, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
  }
  return [...new Map(result.map(destination => [JSON.stringify(destination), destination])).values()]
}

export const semanticReplacementTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'selection.replace', inputSchema: schema,
  description: '完整替换精确选中对象。先在附带 create scope 创建新对象和所需资源，再以 replacementItemId 引用前序创建步骤的 item-id。宿主保留原位置、层级、可见性、旋转和可映射引用；不兼容引用明确失败。所有步骤先私有准备，最终一次提交。修改文字、字号或参数优先使用 edit/component.configure。',
  plan({ document, destination, value }) {
    if (destination.kind !== 'update') throw new Error('完整替换需要原对象的精确 update target')
    const { target, surface } = resolveAuthoringToolScope(document, destination)
    const { nextDocument, address, retainedOriginal, flowBody } = planSelectionReplacement(document, destination.target, value.replacementItemId)
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner, itemIds: [value.replacementItemId], ...(surface.type === 'flow' ? { flowCarrier: flowBody ? 'block' : 'overlay' } : {}) } },
      affected: [{ id: destination.target.itemId, operation: retainedOriginal ? 'updated' : 'deleted', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress },
        { id: value.replacementItemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: address! }] }
  },
}
