import { z } from 'zod'
import { courseRuntimeDefinitionSchema } from '../../../shared/courseProjectSchema'
import { addSlideRuntimeLayer } from '../../course/v9SlideContentCommands'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { insertFlowSharedRuntime } from '../../course/flowSharedAuthoringAdapters'
import { selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ runtime: courseRuntimeDefinitionSchema, label: z.string().trim().min(1).max(120).optional() }).strict()
export const runtimeInsertTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'runtime.insert', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources, signal }) {
    const { target, surface, location, scope } = resolveAuthoringToolScope(document, destination)
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner' || destination.scope.insertion.kind !== 'append') throw new Error('Runtime 插入需要 owner 追加 scope')
    if (surface.type === 'spatial-2d') throw new Error('Spatial world Runtime 尚无正式动态播放宿主；请使用已支持的 Component')
    if (!value.runtime.enabled || value.runtime.source.length > 2_000_000 || !value.runtime.staticFallback
      || document.assets[value.runtime.staticFallback.assetId]?.kind !== 'image') throw new Error('Runtime 候选必须启用、满足源码上限并声明工程后备图片')
    let nextDocument = document
    let itemIds: readonly string[] = []
    if (surface.type === 'slide') {
      if (target.owner !== 'scene' && target.owner !== 'global') throw new Error('Slide Runtime 插入仅支持 scene / global owner')
      const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
      const result = addSlideRuntimeLayer({ ...opened, scope: target.owner === 'global' ? 'global' : 'scene', selection: { ...opened.selection, stateId: target.stateId } }, value)
      if (!result.ok || !result.nextSession) throw new Error(result.reason)
      nextDocument = result.nextSession.history.present
      itemIds = result.nextSession.selection.selectionIds
    } else if (surface.type === 'flow' && location.kind === 'flow-block') {
      const selection = { ...selectFlowEditorBlock(document, target.locationId, location.blockId), authoringScope: target.owner === 'global' ? 'global' as const : 'page' as const }
      const result = insertFlowSharedRuntime(document, selection, { ...value, placement: 'viewport-overlay' })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
      itemIds = result.createdLayerItemIds ?? []
    } else throw new Error('当前 owner 不支持 Runtime 创建')
    if (itemIds.length !== 1) throw new Error('Runtime 命令没有返回唯一创建身份')
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    await admitDynamicCandidate(nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: itemIds }], signal, false, { onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence) })
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner, itemIds,
        ...(surface.type === 'flow' ? { flowCarrier: 'overlay' } : {}) } },
      affected: itemIds.map(id => ({ id, operation: 'created' as const, ownerKey: target.ownerKey,
        authoringAddress: makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: 'runtime', layerItemId: id, field: 'runtime/source' }) })), ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
  },
}
