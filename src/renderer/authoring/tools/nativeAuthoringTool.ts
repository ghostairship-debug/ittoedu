import { imageReplacementInputSchema as imageEdit, nativeImageReplacementData } from '../../../core/tools/imageApplication'
import { nativeTemplateSchema as template, nativeShapeStyleSchema as shapeStyle } from '../../../core/tools/nativeInsertionSchema'
import { z } from 'zod'
import { clearFlowEditorSelection } from '../../course/flowEditorSlice'
import { insertFlowSharedText, insertFlowSharedShape, insertFlowSharedMedia, patchFlowOverlayPaperSpace } from '../../course/flowSharedAuthoringAdapters'
import { nativeElementContentSchema } from '../../../shared/courseProjectSchema'
import { nativeContentInputSchemaByType } from '../../../shared/contracts/native-v1/schema'
import { openSlideAuthoringSession, setSlideEditingScope } from '../../course/slideAuthoringBackend'
import { addSlideTextLayer, addSlideFormulaLayer, addSlideShapeLayer, addSlideImageLayer, addSlideVideoLayer, addSlideInputLayer } from '../../course/v9SlideContentCommands'
import { addSlideChartLayer } from '../../course/v9ChartCommands'
import { addSlideTableLayer } from '../../course/v9TableCommands'
import { openSpatialAuthoringSession, addSpatialWorldTextLayer, addSpatialWorldFormulaLayer, addSpatialWorldShapeLayer, addSpatialWorldImageLayer, addSpatialWorldVideoLayer, addSpatialWorldChartLayer, addSpatialWorldTableLayer } from '../../course/spatialEditorCommands'
import { resolveEffectiveLayerTarget, deleteEffectiveLayerItem, listOwnedLayerItems, reorderEffectiveLayerItems } from '../../../core/tools/layerCommands'
import { patchEffectiveLayerPropertiesAtTarget } from '../../course/effectiveLayerCommands'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { insertionIndex, resolveAuthoringToolScope } from './authoringToolScope'
import { AuthoringToolFailure, type AuthoringToolDefinition } from './executeAuthoringTool'
import { nativeLayerItemPropertiesInputSchema as layerItemPropertiesInputSchema } from '../../../core/tools/toolSchemas'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { planNativeTextEdit } from '../../../core/tools/nativeText'

const formulaEdit = nativeContentInputSchemaByType.formula.pick({ ast: true, accessibleText: true }).extend({
  style: nativeContentInputSchemaByType.formula.shape.style.partial().strict().optional(),
}).strict()
const textStyleEdit = nativeContentInputSchemaByType.text.shape.style.partial().extend({
  emphasis: nativeContentInputSchemaByType.text.shape.style.shape.emphasis.unwrap().optional(),
}).strict()
const textReplacement = z.object({
  original: z.string().min(1),
  replacement: z.string(),
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
}).strict()
const legacyEditInputSchema = z.object({ operation: z.literal('edit'), text: z.string().optional(),
  replacements: z.array(textReplacement).min(1).max(100).optional(),
  image: imageEdit.optional(), formula: formulaEdit.optional(), textStyle: textStyleEdit.optional(),
  properties: layerItemPropertiesInputSchema.optional() }).strict()
  .refine(value => value.text !== undefined || value.replacements !== undefined || value.textStyle !== undefined || value.properties !== undefined || value.image !== undefined || value.formula !== undefined, '窄编辑至少提供文字、公式、图片或属性')
  .refine(value => value.text === undefined || value.replacements === undefined, 'text 与 replacements 不能同时提供')
/** These are real executable branches, so selecting a text card cannot pull
 * formula AST into its reference closure. The legacy edit reader stays intact. */
export const nativeContentEditSchemas = {
  shape: z.object({ operation: z.literal('edit-shape'), shapeStyle: shapeStyle.optional(), properties: layerItemPropertiesInputSchema.optional() }).strict()
    .refine(value => Object.keys(value.shapeStyle ?? {}).length > 0 || Object.keys(value.properties ?? {}).length > 0, '图形窄编辑至少提供一个样式或属性字段'),
  text: z.object({ operation: z.literal('edit-text'), text: z.string().optional(), replacements: z.array(textReplacement).min(1).max(100).optional(), textStyle: textStyleEdit.optional(), properties: layerItemPropertiesInputSchema.optional() }).strict()
    .refine(value => value.text !== undefined || value.replacements !== undefined || value.textStyle !== undefined || value.properties !== undefined, '文字窄编辑至少提供文字、样式或属性')
    .refine(value => value.text === undefined || value.replacements === undefined, 'text 与 replacements 不能同时提供'),
  image: z.object({ operation: z.literal('edit-image'), image: imageEdit, properties: layerItemPropertiesInputSchema.optional() }).strict(),
  formula: z.object({ operation: z.literal('edit-formula'), formula: formulaEdit, properties: layerItemPropertiesInputSchema.optional() }).strict(),
}
export const nativeAuthoringToolInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('insert'), template }).strict(),
  z.object({ operation: z.literal('content'), content: nativeElementContentSchema }).strict(),
  z.object({ operation: z.literal('properties'), properties: layerItemPropertiesInputSchema }).strict(),
  legacyEditInputSchema, nativeContentEditSchemas.text, nativeContentEditSchemas.image, nativeContentEditSchemas.formula, nativeContentEditSchemas.shape,
  z.object({ operation: z.literal('delete') }).strict(),
])

export const nativeAuthoringTool: AuthoringToolDefinition<z.infer<typeof nativeAuthoringToolInputSchema>> = {
  name: 'native.content', inputSchema: nativeAuthoringToolInputSchema,
  conditions: [
    { operations: ['insert'], destination: 'create', parents: ['owner'], nativeTypesByScope: {
      'slide:scene': ['text', 'formula', 'shape', 'image', 'video', 'chart', 'table', 'input'],
      'slide:global': ['text', 'formula', 'shape', 'image', 'video', 'chart', 'table'],
      'flow:surface': ['text', 'shape', 'image', 'video'], 'flow:global': ['text', 'shape', 'image', 'video'],
      'spatial-2d:world': ['text', 'formula', 'shape', 'image', 'video', 'chart', 'table'],
    }, message: '创建对象使用 insert + template，目标为 create parent:owner。修改已有对象使用 update 目标。' },
    { operations: ['content', 'properties', 'edit', 'edit-text', 'edit-image', 'edit-formula', 'edit-shape', 'delete'], destination: 'update', message: '更新需要 update 目标；要新增对象请使用 insert + template，可与修改步骤组合提交。' },
  ],
  referenceSchemas: nativeContentInputSchemaByType,
  description: 'Native：insert创建，其余update；edit-text优先replacements，重复原文加context，整段text歧义拒绝；保留未指定字段。line缺省水平；端点定向，竖线:[0.5,0]→[0.5,1]。Flow正文及图片/组件替换用专用工具。',
  plan({ document, destination, value: rawValue }) {
    const value = rawValue.operation === 'edit-text' || rawValue.operation === 'edit-image' || rawValue.operation === 'edit-formula'
      ? legacyEditInputSchema.parse({ ...rawValue, operation: 'edit' }) : rawValue
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    const paperSpace = value.operation === 'insert' ? value.template.paperSpace
      : value.operation === 'properties' || value.operation === 'edit' || value.operation === 'edit-shape' ? value.properties?.paperSpace : undefined
    if (paperSpace !== undefined && surface.type !== 'flow') throw new Error('paperSpace 仅适用于 Flow 浮层')
    const properties = value.operation === 'properties' || value.operation === 'edit' || value.operation === 'edit-shape'
      ? Object.fromEntries(Object.entries(value.properties ?? {}).filter(([key]) => key !== 'paperSpace')) : {}
    const options = { expectedRevision: document.revision }
    let nextDocument = document
    let itemId: string
    let address: string
    if (value.operation === 'insert') {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'owner') throw new Error('Native 插入需要 owner create scope')
      const input = value.template
      if (input.placement && (input.x !== undefined || input.y !== undefined)) throw new Error('相对居中与显式 x/y 不能同时指定')
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
      // Reuse the real factory and patch command on private state; all surfaces
      // receive the explicitly requested initial style, including Flow adapters.
      const initialData = Object.fromEntries(Object.entries(input).filter(([key]) => ['style', 'ast', 'accessibleText', 'chartType', 'title', 'categories', 'series', 'columns', 'rows', 'headerRowCount', 'merges'].includes(key)))
      if (Object.keys(initialData).length) {
        const styled = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, { nativeData: initialData })
        if (!styled.ok || !styled.nextDocument) throw new Error(styled.reason)
        nextDocument = { ...styled.nextDocument, revision: document.revision + 1 }
      }
      if (input.nativeType === 'image' && input.fit !== undefined) {
        const fitted = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, { nativeData: { fit: input.fit, preserveAspectRatio: input.fit !== 'stretch' } })
        if (!fitted.ok || !fitted.nextDocument) throw new Error(fitted.reason)
        nextDocument = { ...fitted.nextDocument, revision: document.revision + 1 }
      }
      const requestedSize = { ...(input.width !== undefined ? { width: input.width } : {}), ...(input.height !== undefined ? { height: input.height } : {}) }
      const createdItem = resolveEffectiveLayerTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }).item
      if (Object.entries(requestedSize).some(([key, value]) => createdItem.frame[key as 'width' | 'height'] !== value)) {
        const sized = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId }, { frame: requestedSize })
        if (!sized.ok || !sized.nextDocument) throw new Error(sized.reason)
        nextDocument = { ...sized.nextDocument, revision: document.revision + 1 }
      }
      if (input.placement) {
        const anchorId = input.placement.anchorItemId
        const anchor = projectEffectiveLayers({ project: nextDocument, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === anchorId)?.item
        if (!anchor || anchorId === itemId) throw new Error('居中锚点必须是当前目标范围中已经存在的独立图层')
        const currentItem = projectEffectiveLayers({ project: nextDocument, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === itemId)!.item
        const centered = patchEffectiveLayerPropertiesAtTarget(nextDocument, { authoringAddress: address, locationId: target.locationId, stateId: target.stateId },
          { frame: { x: anchor.frame.x + (anchor.frame.width - currentItem.frame.width) / 2, y: anchor.frame.y + (anchor.frame.height - currentItem.frame.height) / 2 } })
        if (!centered.ok || !centered.nextDocument) throw new Error(centered.reason)
        nextDocument = { ...centered.nextDocument, revision: document.revision + 1 }
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
      if (value.operation === 'edit-shape') {
        if (effective?.kind !== 'native' || effective.content.nativeType !== 'shape') throw new Error('图形窄编辑只接受 Native 图形')
        editData = value.shapeStyle ? { style: value.shapeStyle } : undefined
      }
      if (value.operation === 'edit' && (value.text !== undefined || value.replacements !== undefined || value.textStyle !== undefined)) {
        if (value.formula || value.image) throw new Error('一次 Native 窄编辑只能修改一种内容类型')
        if (effective?.kind !== 'native' || effective.content.nativeType !== 'text') throw new Error('文字窄编辑只接受 Native 文本；其他字段使用对应内容工具')
        const current = effective.content.data
        const mapping = planNativeTextEdit(current, value)
        if (!mapping.ok) throw new AuthoringToolFailure([{
          code: `native-text-${mapping.code}`,
          message: mapping.reason,
          path: ['input', value.replacements ? 'replacements' : 'text'],
        }])
        editData = mapping.data
      }
      if (value.operation === 'edit' && value.image) {
        if (value.formula) throw new Error('图片窄编辑只接受 Native 图片')
        editData = nativeImageReplacementData(document, effective, value.image)
      }
      if (value.operation === 'edit' && value.formula) {
        if (effective?.kind !== 'native' || effective.content.nativeType !== 'formula') throw new Error('公式窄编辑只接受 Native 公式')
        editData = { ...value.formula }
      }
      let patchDocument = document
      if (paperSpace !== undefined) {
        const selection = { ...clearFlowEditorSelection(document, target.locationId, scope.owner === 'global' ? 'global' : 'page'), selectedOverlayIds: [located.item.layerItemId] }
        const placed = patchFlowOverlayPaperSpace(document, selection, paperSpace, options)
        if (!placed.ok || !placed.nextDocument) throw new Error(placed.reason)
        patchDocument = placed.nextDocument
      }
      const result = value.operation === 'delete'
        ? deleteEffectiveLayerItem(document, destination.target, options)
        : patchEffectiveLayerPropertiesAtTarget(patchDocument, destination.target,
          value.operation === 'content' ? { nativeData: { ...value.content.data } }
            : value.operation === 'edit' || value.operation === 'edit-shape' ? { ...properties, ...(editData ? { nativeData: editData } : {}) } : properties, { expectedRevision: patchDocument.revision })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument === document ? document : { ...result.nextDocument, revision: document.revision + 1 }
      itemId = destination.target.itemId
      address = destination.target.authoringAddress
    }
    if (paperSpace !== undefined && value.operation === 'insert') {
      const selection = { ...clearFlowEditorSelection(nextDocument, target.locationId, scope.owner === 'global' ? 'global' : 'page'), selectedOverlayIds: [itemId] }
      const placed = patchFlowOverlayPaperSpace(nextDocument, selection, paperSpace, { expectedRevision: nextDocument.revision })
      if (!placed.ok || !placed.nextDocument) throw new Error(placed.reason)
      nextDocument = placed.nextDocument === document ? document : { ...placed.nextDocument, revision: document.revision + 1 }
    }
    // Check the resulting effective object, not the model summary or base-state
    // storage. These expectations come only from the accepted typed operation.
    if (value.operation === 'insert' || value.operation === 'edit-shape') {
      const actual = projectEffectiveLayers({ project: nextDocument, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === itemId)?.item
      const expected = value.operation === 'insert' ? value.template : { nativeType: 'shape', style: value.shapeStyle }
      if (actual?.kind !== 'native' || actual.content.nativeType !== expected.nativeType) throw new AuthoringToolFailure([{ code: 'result-mismatch', path: ['result', 'nativeType'], message: '准备结果未保留请求的独立 Native 类型，未提交。' }])
      const check = (want: unknown, got: unknown, path: string[]): void => {
        if (want === undefined) return
        if (want && typeof want === 'object' && !Array.isArray(want)) {
          for (const [key, value] of Object.entries(want)) check(value, got && typeof got === 'object' ? Reflect.get(got, key) : undefined, [...path, key])
        } else if (JSON.stringify(want) !== JSON.stringify(got)) throw new AuthoringToolFailure([{ code: 'result-mismatch', path, message: '准备结果未满足明确字段，未提交；请修正候选或使用完整文件结果。' }])
      }
      if ('style' in expected) check(expected.style, Reflect.get(actual.content.data, 'style'), ['result', 'style'])
      if (value.operation === 'insert') {
        for (const key of ['text', 'ast', 'accessibleText', 'shapeType', 'assetId', 'chartType', 'title', 'categories', 'series', 'columns', 'rows', 'headerRowCount', 'merges']) if (Object.hasOwn(value.template, key)) check(Reflect.get(value.template, key), Reflect.get(actual.content.data, key), ['result', key])
        for (const key of ['x', 'y', 'width', 'height']) if (Object.hasOwn(value.template, key)) check(Reflect.get(value.template, key), Reflect.get(actual.frame, key), ['result', 'frame', key])
      }
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
