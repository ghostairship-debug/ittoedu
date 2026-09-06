import { z } from 'zod'
import { resolveEffectiveLayerTarget, patchEffectiveLayerPropertiesAtTarget } from '../../course/effectiveLayerCommands'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { updateFlowDocumentComponentBlock } from '../../course/flowSharedAuthoringAdapters'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { layerItemPropertiesInputSchema } from './layerItemPropertiesInput'

const schema = z.object({ props: z.record(z.string(), z.unknown()).optional(), properties: layerItemPropertiesInputSchema.optional() }).strict()
  .refine(value => value.props !== undefined || value.properties !== undefined, '组件配置至少提供props或properties')
export const componentConfigureTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.configure', inputSchema: schema, usesResources: true,
  description: '配置已有或前序新建组件，carrier均为existing-component。props更新组件参数；properties修改组件图层的frame/rotation/opacity/visible/locked/label。Flow正文组件只接受props，其排版通过flow.content。不要用native.content移动组件。',
  async plan({ document, destination, value, resources, signal }) {
    if (destination.kind !== 'update' || !resources) throw new Error('组件配置需要精确 update target 与当前工程资源')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId) : null
    let nextDocument
    if (body) {
      if (value.properties) throw new Error('Flow 正文组件排版需要 flow.content，不接受图层 properties')
      if (body.block.type !== 'component' || destination.target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: 'component' })) throw new Error('正文组件 target 不匹配')
      const result = updateFlowDocumentComponentBlock(document, { ...selectFlowEditorBlock(document, target.locationId, body.block.id), authoringScope: 'page' }, { props: value.props! })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    } else {
      const located = resolveEffectiveLayerTarget(document, destination.target)
      if (located.item.kind !== 'component' || located.item.layerItemId !== destination.target.itemId || located.source !== scope.owner) throw new Error('组件 target 身份或 owner 不匹配')
      if (located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) throw new Error('组件 target 不属于当前 Surface / scene')
      const result = patchEffectiveLayerPropertiesAtTarget(document, destination.target, { ...value.properties, ...(value.props ? { componentProps: value.props } : {}) })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    }
    await admitDynamicCandidate(nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }], signal)
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
        ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}), itemIds: [destination.target.itemId] } },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }] }
  },
}
