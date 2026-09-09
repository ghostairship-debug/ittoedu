import { z } from 'zod'
import { clearFlowEditorSelection } from '../../course/flowEditorSlice'
import { insertFlowSharedText, insertFlowSharedShape, insertFlowSharedMedia } from '../../course/flowSharedAuthoringAdapters'
import { nativeElementContentSchema } from '../../../shared/courseProjectSchema'
import { nativeContentInputSchemaByType } from '../../../shared/contracts/native-v1/schema'
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
import { layerItemPropertiesInputSchema } from './layerItemPropertiesInput'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { remapTextRuns } from '../../../shared/textRuns'

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
export const nativeAuthoringToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('insert'), template }).strict(),
  z.object({ operation: z.literal('content'), content: nativeElementContentSchema }).strict(),
  z.object({ operation: z.literal('properties'), properties: layerItemPropertiesInputSchema }).strict(),
  z.object({ operation: z.literal('edit'), text: z.string().optional(),
    textStyle: nativeContentInputSchemaByType.text.shape.style.partial().extend({
      emphasis: nativeContentInputSchemaByType.text.shape.style.shape.emphasis.unwrap().optional(),
    }).strict().optional(),
    properties: layerItemPropertiesInputSchema.optional() }).strict()
    .refine(value => value.text !== undefined || value.textStyle !== undefined || value.properties !== undefined, '窄编辑至少提供文字、文字样式或属性'),
  z.object({ operation: z.literal('delete') }).strict(),
])

export const nativeAuthoringTool: AuthoringToolDefinition<z.infer<typeof nativeAuthoringToolInputSchema>> = {
  name: 'native.content', inputSchema: nativeAuthoringToolInputSchema,
  referenceSchemas: nativeContentInputSchemaByType,
  description: '仅支持Native对象：insert 使用 create + parent:owner；edit/content/properties/delete 使用 update。修改已有文字、字号、字体或位置优先使用 edit 的 text/textStyle/properties，只提交要改变的字段，其余内容和有效状态保留。content.data 必须满足 references[content.nativeType] 的完整字段合同，不是局部补丁。移动组件使用component.configure的properties。Flow 正文使用 flow.content。完整载体替换使用 selection.replace。',
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
      const effective = projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === located.item.layerItemId)?.item
      let editData: Record<string, unknown> | undefined
      if (value.operation === 'edit' && (value.text !== undefined || value.textStyle !== undefined)) {
        if (effective?.kind !== 'native' || effective.content.nativeType !== 'text') throw new Error('文字窄编辑只接受 Native 文本；其他字段使用对应内容工具')
        const current = effective.content.data
        const text = value.text ?? current.text
        // Run overrides for explicitly changed whole-text fields must not mask the new style.
        const runs = remapTextRuns(current.text, text, current.runs).map(run => ({ ...run, style: Object.fromEntries(Object.entries(run.style).filter(([key]) => !value.textStyle || !Object.hasOwn(value.textStyle, key))) })).filter(run => Object.keys(run.style).length > 0)
        editData = { text, runs, ...(value.textStyle ? { style: value.textStyle } : {}) }
      }
      const result = value.operation === 'delete'
        ? deleteEffectiveLayerItem(document, destination.target, options)
        : patchEffectiveLayerPropertiesAtTarget(document, destination.target,
          value.operation === 'content' ? { nativeData: { ...value.content.data } }
            : value.operation === 'edit' ? { ...value.properties, ...(editData ? { nativeData: editData } : {}) } : value.properties, options)
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
