import { z } from 'zod'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { duplicateEffectiveLayerItem, patchEffectiveLayerPropertiesAtTarget, reorderEffectiveLayerItems, resolveEffectiveLayerTarget } from '../../course/effectiveLayerCommands'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { openSlideAuthoringSession, setSlideEditingScope } from '../../course/slideAuthoringBackend'
import { duplicateSlideSceneLayers, reorderSlideSceneLayers } from '../../course/v9SlideActionCommands'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const position = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('front') }).strict(),
  z.object({ kind: z.literal('back') }).strict(),
  z.object({ kind: z.literal('before'), siblingId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('after'), siblingId: z.string().min(1) }).strict(),
])
export const layerEditInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('reorder'), position }).strict(),
  z.object({ operation: z.literal('duplicate'), placement: z.object({
    side: z.enum(['right', 'left', 'above', 'below']), gap: z.number().finite().min(0),
  }).strict() }).strict(),
])

/** Layer wrappers share the existing commands; scene state semantics stay with
 * Slide, and no tool owns a second copy/order writer. */
export const layerEditTool: AuthoringToolDefinition<z.infer<typeof layerEditInputSchema>> = {
  name: 'layer.edit', inputSchema: layerEditInputSchema,
  description: '精确LayerItem update target的两个窄操作。reorder.position指定front/back或同owner同plane的before/after siblingId；不跨Flow正文、global平面或owner。duplicate只复制该实例一次，placement.side/gap相对当前有效frame放置（右侧间距24用right/24）；原实例及共享资源保留。Slide scene命名态只改变当前状态的呈现。Flow正文不是图层，不接受此工具。selectionActions仅提供焦点操作提示；其他对象使用当前request的精确目标，新建对象使用native.content insert或其他正式创建工具。',
  plan({ document, destination, value }) {
    if (destination.kind !== 'update') throw new Error('图层动作需要精确 update target')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
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
