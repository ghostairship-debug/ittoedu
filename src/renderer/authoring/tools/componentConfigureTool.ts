import { z } from 'zod'
import { resolveEffectiveLayerTarget, patchEffectiveLayerPropertiesAtTarget } from '../../course/effectiveLayerCommands'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { updateFlowDocumentComponentBlock } from '../../course/flowSharedAuthoringAdapters'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ props: z.record(z.string(), z.unknown()) }).strict()
export const componentConfigureTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.configure', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources }) {
    if (destination.kind !== 'update' || !resources) throw new Error('组件配置需要精确 update target 与当前工程资源')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId) : null
    let nextDocument
    if (body) {
      if (body.block.type !== 'component' || destination.target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: 'component' })) throw new Error('正文组件 target 不匹配')
      const result = updateFlowDocumentComponentBlock(document, { ...selectFlowEditorBlock(document, target.locationId, body.block.id), authoringScope: 'page' }, { props: value.props })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    } else {
      const located = resolveEffectiveLayerTarget(document, destination.target)
      if (located.item.kind !== 'component' || located.item.layerItemId !== destination.target.itemId || located.source !== scope.owner) throw new Error('组件 target 身份或 owner 不匹配')
      if (located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) throw new Error('组件 target 不属于当前 Surface / scene')
      const result = patchEffectiveLayerPropertiesAtTarget(document, destination.target, { componentProps: value.props })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    }
    await admitDynamicCandidate(nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }])
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
        ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}), itemIds: [destination.target.itemId] } },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }] }
  },
}
