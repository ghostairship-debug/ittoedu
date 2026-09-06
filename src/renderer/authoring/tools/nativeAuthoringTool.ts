import { z } from 'zod'
import { clearFlowEditorSelection } from '../../course/flowEditorSlice'
import { insertFlowSharedText, insertFlowSharedShape, insertFlowSharedMedia } from '../../course/flowSharedAuthoringAdapters'
import { nativeElementContentSchema } from '../../../shared/courseProjectSchema'
import { SHAPE_TYPES } from '../../../shared/contracts/native-v1/types'
import { openSlideAuthoringSession, setSlideEditingScope } from '../../course/slideAuthoringBackend'
import { addSlideTextLayer, addSlideFormulaLayer, addSlideShapeLayer, addSlideImageLayer, addSlideVideoLayer, addSlideInputLayer } from '../../course/v9SlideContentCommands'
import { addSlideChartLayer } from '../../course/v9ChartCommands'
import { addSlideTableLayer } from '../../course/v9TableCommands'
import { openSpatialAuthoringSession, addSpatialWorldTextLayer, addSpatialWorldFormulaLayer, addSpatialWorldShapeLayer, addSpatialWorldImageLayer, addSpatialWorldVideoLayer, addSpatialWorldChartLayer, addSpatialWorldTableLayer } from '../../course/spatialEditorCommands'
import { resolveEffectiveLayerTarget, deleteEffectiveLayerItem, patchEffectiveLayerPropertiesAtTarget, listOwnedLayerItems, reorderEffectiveLayerItems } from '../../course/effectiveLayerCommands'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { insertionIndex, resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const coordinate = z.number().finite()
const templateBase = { x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional(), label: z.string().optional() }
const mediaFields = { assetId: z.string().min(1), width: coordinate.positive().optional(), height: coordinate.positive().optional() }
const template = z.discriminatedUnion('nativeType', [
  z.object({ ...templateBase, nativeType: z.literal('text'), text: z.string().optional() }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('formula') }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('shape'), shapeType: z.enum(SHAPE_TYPES) }).strict(),
  z.object({ ...templateBase, ...mediaFields, nativeType: z.literal('image') }).strict(),
  z.object({ ...templateBase, ...mediaFields, nativeType: z.literal('video') }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('chart') }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('table') }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('input'), answerType: z.enum(['text', 'number']).optional() }).strict(),
])
const properties = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
}).strict()
export const nativeAuthoringToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('insert'), template }).strict(),
  z.object({ operation: z.literal('content'), content: nativeElementContentSchema }).strict(),
  z.object({ operation: z.literal('properties'), properties }).strict(),
  z.object({ operation: z.literal('delete') }).strict(),
])

export const nativeAuthoringTool: AuthoringToolDefinition<z.infer<typeof nativeAuthoringToolInputSchema>> = {
  name: 'native.content', inputSchema: nativeAuthoringToolInputSchema,
  plan({ document, destination, value }) {
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    const options = { expectedRevision: document.revision }
    let nextDocument = document
    let itemId: string
    let address: string
    if (value.operation === 'insert') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner') throw new Error('Native 插入需要 owner create scope')
      const input = value.template
      if (surface.type === 'slide' && scope.owner !== 'world') {
        const opened = openSlideAuthoringSession(document, { locationId: target.locationId })
        const scoped = setSlideEditingScope(opened, scope.owner)
        if (!scoped.ok || !scoped.nextSession) throw new Error(scoped.reason)
        const session = { ...scoped.nextSession, selection: { ...scoped.nextSession.selection, stateId: target.stateId } }
        const result = input.nativeType === 'text' ? addSlideTextLayer(session, input, options)
          : input.nativeType === 'formula' ? addSlideFormulaLayer(session, input, options)
          : input.nativeType === 'shape' ? addSlideShapeLayer(session, input, options)
          : input.nativeType === 'image' ? addSlideImageLayer(session, input, options)
          : input.nativeType === 'video' ? addSlideVideoLayer(session, input, options)
          : input.nativeType === 'chart' ? addSlideChartLayer(session, input, options)
          : input.nativeType === 'table' ? addSlideTableLayer(session, input, options)
          : addSlideInputLayer(session, input, options)
        if (!result.ok || !result.nextSession) throw new Error(result.reason)
        nextDocument = result.nextSession.history.present
        itemId = result.selection?.selectionIds[0] ?? result.nextSession.selection.selectionIds[0] ?? ''
      } else if (surface.type === 'spatial-2d' && scope.owner === 'world') {
        const session = openSpatialAuthoringSession(document, { locationId: target.locationId })
        const result = input.nativeType === 'text' ? addSpatialWorldTextLayer(session, input, options)
          : input.nativeType === 'formula' ? addSpatialWorldFormulaLayer(session, input, options)
          : input.nativeType === 'shape' ? addSpatialWorldShapeLayer(session, input, options)
          : input.nativeType === 'image' ? addSpatialWorldImageLayer(session, input, options)
          : input.nativeType === 'video' ? addSpatialWorldVideoLayer(session, input, options)
          : input.nativeType === 'chart' ? addSpatialWorldChartLayer(session, input, options)
          : input.nativeType === 'table' ? addSpatialWorldTableLayer(session, input, options)
          : null
        if (!result?.ok || !result.nextSession) throw new Error(result?.reason ?? 'Spatial 不支持该 Native 模板')
        nextDocument = result.nextSession.history.present
        itemId = result.nextSession.selection.selectionIds[0] ?? ''
      } else if (surface.type === 'flow' && (scope.owner === 'global' || scope.owner === 'surface')) {
        const selection = clearFlowEditorSelection(document, target.locationId, scope.owner === 'global' ? 'global' : 'page')
        const result = input.nativeType === 'text' ? insertFlowSharedText(document, selection, { text: input.text, label: input.label, placement: 'viewport-overlay' }, options)
          : input.nativeType === 'shape' ? insertFlowSharedShape(document, selection, input, options)
          : input.nativeType === 'image' || input.nativeType === 'video' ? insertFlowSharedMedia(document, selection, { assetId: input.assetId, placement: 'viewport-overlay', caption: input.label }, options)
          : null
        if (!result?.ok || !result.nextDocument) throw new Error(result?.reason ?? 'Flow 浮层不支持该 Native 类型')
        nextDocument = result.nextDocument
        itemId = result.createdLayerItemIds?.[0] ?? ''
        const createdAddress = makeLayerItemAuthoringAddress({ projectId: document.id, owner: scope.owner, surfaceId: surface.id, sceneId: null, kind: 'native', layerItemId: itemId })
        const created = resolveEffectiveLayerTarget(nextDocument, { authoringAddress: createdAddress, locationId: target.locationId, stateId: null })
        if (created.item.kind !== 'native' || created.item.content.nativeType !== input.nativeType) throw new Error('素材类型与 Native 请求不匹配')
        const frame = { ...(input.x !== undefined ? { x: input.x } : {}), ...(input.y !== undefined ? { y: input.y } : {}),
          ...('width' in input && input.width !== undefined ? { width: input.width } : {}), ...('height' in input && input.height !== undefined ? { height: input.height } : {}) }
        if (Object.keys(frame).length > 0) {
          const positioned = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: createdAddress, locationId: target.locationId, stateId: null }, { frame })
          if (!positioned.ok || !positioned.nextDocument) throw new Error(positioned.reason)
          nextDocument = { ...positioned.nextDocument, revision: document.revision + 1 }
        }
      } else throw new Error('此 Native 插入 scope 不受支持')
      if (!itemId) throw new Error('Native 命令未返回创建身份')
      address = makeLayerItemAuthoringAddress({ projectId: document.id, owner: scope.owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: 'native', layerItemId: itemId })
      const requestedSize = { ...(input.width !== undefined ? { width: input.width } : {}), ...(input.height !== undefined ? { height: input.height } : {}) }
      const createdItem = resolveEffectiveLayerTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }).item
      if (Object.entries(requestedSize).some(([key, value]) => createdItem.frame[key as 'width' | 'height'] !== value)) {
        const sized = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, { frame: requestedSize })
        if (!sized.ok || !sized.nextDocument) throw new Error(sized.reason)
        nextDocument = { ...sized.nextDocument, revision: document.revision + 1 }
      }
      if (destination.scope.insertion.kind !== 'append') {
        let siblings = listOwnedLayerItems(nextDocument, scope.owner, { surfaceId: surface.id, sceneId: scope.sceneId })
        if (scope.owner === 'global') {
          const plane = nextDocument.globalLayerItems.find((entry) => entry.item.layerItemId === itemId)?.plane ?? 'overlay'
          const planeIds = new Set(nextDocument.globalLayerItems.filter((entry) => (entry.plane ?? 'overlay') === plane).map((entry) => entry.item.layerItemId))
          siblings = siblings.filter((entry) => planeIds.has(entry.layerItemId))
        }
        const ids = siblings.filter((entry) => entry.layerItemId !== itemId).sort((a, b) => a.order - b.order).map((entry) => entry.layerItemId)
        ids.splice(insertionIndex(ids, destination.scope.insertion), 0, itemId)
        const reordered = reorderEffectiveLayerItems(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, ids, { expectedRevision: nextDocument.revision })
        if (!reordered.ok || !reordered.nextDocument) throw new Error(reordered.reason)
        // Product commands plan against private intermediate revisions; only the
        // final combined step enters the existing authoritative history.
        nextDocument = { ...reordered.nextDocument, revision: document.revision + 1 }
      }
    } else {
      if (destination.kind !== 'update') throw new Error('Native 更新需要完整 update target')
      const located = resolveEffectiveLayerTarget(document, destination.target)
      if (located.source !== scope.owner || located.item.layerItemId !== destination.target.itemId || located.item.kind !== 'native') throw new Error('Native target 身份或 owner 不匹配')
      if (located.source !== 'global' && (located.surfaceId !== surface.id || (located.source === 'scene' && located.sceneId !== scope.sceneId))) throw new Error('Native target 不属于声明的 Surface / scene')
      if (value.operation === 'content' && value.content.nativeType !== located.item.content.nativeType) throw new Error('不得通过内容更新改变 Native 类型')
      const result = value.operation === 'delete'
        ? deleteEffectiveLayerItem(document, destination.target, options)
        : patchEffectiveLayerPropertiesAtTarget(document, destination.target,
          value.operation === 'content' ? { nativeData: { ...value.content.data } } : value.properties, options)
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
      itemId = destination.target.itemId
      address = destination.target.authoringAddress
    }
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
        selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
          ...(surface.type === 'flow' ? { flowCarrier: 'overlay' } : {}),
          itemIds: value.operation === 'delete' ? [] : [itemId] } },
      affected: [{ id: itemId, operation: value.operation === 'insert' ? 'created' : value.operation === 'delete' ? 'deleted' : 'updated', ownerKey: target.ownerKey, authoringAddress: address }],
    }
  },
}
