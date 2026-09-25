import { layerPositionSchema as position, layerPlacementSchema, layerAlignModeSchema, layerDistributeAxisSchema } from '../../../core/tools/layerEditSchema'
import { z } from 'zod'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { authoringToolTargetWireV1Schema, type AuthoringToolTargetWireV1 } from '../../../shared/authoringToolContract'
import { duplicateEffectiveLayerItem, reorderEffectiveLayerItems, resolveEffectiveLayerTarget } from '../../../core/tools/layerCommands'
import { patchEffectiveLayerPropertiesAtTarget, patchEffectiveLayerPropertiesAtTargets } from '../../course/effectiveLayerCommands'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { openSlideAuthoringSession, setSlideEditingScope } from '../../course/slideAuthoringBackend'
import { planSlideMultiLayerLayoutAtTargets } from '../../course/slideMultiLayerLayout'
import { duplicateSlideSceneLayers, reorderSlideSceneLayers } from '../../course/v9SlideActionCommands'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

export const layerEditInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('reorder'), position }).strict(),
  z.object({ operation: z.literal('duplicate'), placement: layerPlacementSchema }).strict(),
  z.object({
    operation: z.literal('align'),
    targets: z.array(authoringToolTargetWireV1Schema).min(2).max(200),
    mode: layerAlignModeSchema,
    primaryTarget: authoringToolTargetWireV1Schema.optional(),
  }).strict(),
  z.object({
    operation: z.literal('distribute'),
    targets: z.array(authoringToolTargetWireV1Schema).min(3).max(200),
    axis: layerDistributeAxisSchema,
  }).strict(),
])

function sameFormalTarget(left: AuthoringToolTargetWireV1, right: AuthoringToolTargetWireV1): boolean {
  return left.projectId === right.projectId
    && left.documentRevision === right.documentRevision
    && left.revisionPolicy.kind === right.revisionPolicy.kind
    && left.sessionGeneration === right.sessionGeneration
    && left.surfaceType === right.surfaceType
    && left.surfaceId === right.surfaceId
    && left.locationId === right.locationId
    && left.stateId === right.stateId
    && left.owner === right.owner
    && left.ownerKey === right.ownerKey
    && left.itemId === right.itemId
    && left.authoringAddress === right.authoringAddress
}

/** Layer wrappers share the existing commands; scene state semantics stay with
 * Slide, and no tool owns a second copy/order writer. */
export const layerEditTool: AuthoringToolDefinition<z.infer<typeof layerEditInputSchema>> = {
  name: 'layer.edit', inputSchema: layerEditInputSchema,
  description: '精确 LayerItem 操作。reorder.position 指定 front/back 或同 owner/plane 的 before/after siblingId；duplicate 的 placement.side/gap 相对当前有效 frame 放置。Slide 多对象布局使用 align 或 distribute：targets 原样复制同一次冻结观察中的正式 update target（对齐至少2个，分布至少3个），destination.target 也必须是其中一个；align.mode 支持 left/center/right/top/middle/bottom，可选 primaryTarget 必须精确属于 targets 并作为视觉包围盒锚点，例如 {operation:"align",targets:[targetA,targetB],mode:"top",primaryTarget:targetA}；distribute.axis 支持 horizontal/vertical，例如 {operation:"distribute",targets:[targetA,targetB,targetC],axis:"horizontal"}。全部目标必须同工程版本、Slide location/state、owner 与 plane；旋转按视觉包围盒计算，锁定对象不移动，命名态只写当前状态，一次候选只形成一个正式事务。Flow 正文不是绝对布局图层。selectionActions 仅提供焦点提示，不替代 targets。',
  plan({ document, destination, value }) {
    if (destination.kind !== 'update') throw new Error('图层动作需要精确 update target')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    if (value.operation === 'align' || value.operation === 'distribute') {
      if (surface.type !== 'slide') throw new Error('成组对齐与分布只支持 Slide 图层')
      if (!value.targets.some((candidate) => sameFormalTarget(candidate, destination.target))) {
        throw new Error('成组布局 destination.target 必须精确包含在 targets 中')
      }
      const planned = planSlideMultiLayerLayoutAtTargets(document, {
        targets: value.targets,
        intent: value.operation === 'align'
          ? { kind: 'align', mode: value.mode }
          : { kind: 'distribute', axis: value.axis },
        ...(value.operation === 'align' && value.primaryTarget
          ? { primaryTarget: value.primaryTarget }
          : {}),
      })
      if (!planned.ok) throw new Error(planned.reason)
      const result = patchEffectiveLayerPropertiesAtTargets(
        document,
        planned.patches.map(({ target: patchTarget, patch }) => ({ target: patchTarget, patch })),
        { expectedRevision: document.revision },
      )
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      return {
        transaction: {
          projectId: document.id,
          baseRevision: document.revision,
          nextDocument: result.nextDocument,
          resourceChanges: {},
          selectionHint: {
            kind: 'authoring-tool-selection',
            locationId: target.locationId,
            stateId: target.stateId,
            owner: target.owner,
            itemIds: value.targets.map((candidate) => candidate.itemId),
          },
        },
        affected: planned.patches.map((patch) => ({
          id: patch.itemId,
          operation: 'updated' as const,
          ownerKey: patch.ownerKey,
          authoringAddress: patch.authoringAddress,
        })),
      }
    }
    const located = resolveEffectiveLayerTarget(document, destination.target)
    if (located.item.layerItemId !== destination.target.itemId || located.source !== target.owner
      || located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) {
      throw new Error('图层动作 target 的身份或 owner 不匹配')
    }
    const view = projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner })
    const row = view.unifiedRows.find(entry => entry.id === located.item.layerItemId)
    if (!row || row.authoringAddress !== destination.target.authoringAddress || row.locked) throw new Error('当前图层已失效或锁定')
    const options = { expectedRevision: document.revision }
    let nextDocument: CourseProjectDocument, itemId = located.item.layerItemId
    const slide = surface.type === 'slide' && target.owner === 'scene'
      ? (() => {
        const selected = setSlideEditingScope(openSlideAuthoringSession(document, { locationId: target.locationId }), 'scene')
        if (!selected.ok || !selected.nextSession) throw new Error(selected.reason)
        return { ...selected.nextSession, selection: { ...selected.nextSession.selection, stateId: target.stateId } }
      })() : null
    if (value.operation === 'reorder') {
      const siblings = view.unifiedRows.filter(entry => entry.reorderGroupKey === row.reorderGroupKey)
      const ids = siblings.map(entry => entry.id).filter(id => id !== itemId)
      const position = value.position
      let index = position.kind === 'front' ? ids.length : 0
      if (position.kind === 'before' || position.kind === 'after') {
        index = ids.indexOf(position.siblingId)
        if (index < 0) throw new Error('排序锚点必须是同 owner/plane 的另一个图层')
        if (position.kind === 'after') index++
      }
      ids.splice(index, 0, itemId)
      if (slide) {
        const result = reorderSlideSceneLayers(slide, ids, options)
        if (!result.ok || !result.nextSession) throw new Error(result.reason)
        nextDocument = result.nextSession.history.present
      } else {
        const result = reorderEffectiveLayerItems(document, destination.target, ids, options)
        if (!result.ok || !result.nextDocument) throw new Error(result.reason)
        nextDocument = result.nextDocument
      }
    } else {
      if (slide) {
        const result = duplicateSlideSceneLayers(slide, [itemId], options)
        if (!result.ok || !result.nextSession) throw new Error(result.reason)
        nextDocument = result.nextSession.history.present
        itemId = result.nextSession.selection.selectionIds[0] ?? ''
      } else {
        const result = duplicateEffectiveLayerItem(document, destination.target, options)
        if (!result.ok || !result.nextDocument || !result.createdLayerItemId) throw new Error(result.reason)
        nextDocument = result.nextDocument
        itemId = result.createdLayerItemId
      }
      if (!itemId || itemId === located.item.layerItemId) throw new Error('正式复制命令未生成独立实例')
      const address = makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner, surfaceId: surface.id,
        sceneId: located.sceneId, kind: located.item.kind, layerItemId: itemId })
      const { side, gap } = value.placement, frame = row.item.frame
      const x = frame.x + (side === 'right' ? frame.width + gap : side === 'left' ? -frame.width - gap : 0)
      const y = frame.y + (side === 'below' ? frame.height + gap : side === 'above' ? -frame.height - gap : 0)
      const positioned = patchEffectiveLayerPropertiesAtTarget(nextDocument,
        { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, { frame: { x, y } }, { expectedRevision: nextDocument.revision })
      if (!positioned.ok || !positioned.nextDocument) throw new Error(positioned.reason)
      nextDocument = { ...positioned.nextDocument, revision: document.revision + 1 }
    }
    const address = makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner, surfaceId: surface.id,
      sceneId: located.sceneId, kind: located.item.kind, layerItemId: itemId })
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
        ...(surface.type === 'flow' ? { flowCarrier: 'overlay' } : {}), itemIds: [itemId] } },
      affected: [{ id: itemId, operation: value.operation === 'duplicate' ? 'created' : 'updated', ownerKey: target.ownerKey, authoringAddress: address }] }
  },
}
