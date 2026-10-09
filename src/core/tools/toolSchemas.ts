import { z } from 'zod'
import { componentBackgroundSchema, componentFlowAuthoringSchema, componentFlowBodyLayoutSchema, componentFlowPlacementSchema, componentFrameSchema, componentVisibilitySchema, componentBuiltinImplementationSchema, jsonValueSchema } from '../../shared/contracts/component-platform/schema'
import { courseProjectDesignTokensSchema } from '../../shared/contracts/design-v1/schema'
import { projectPresenterSettingsSchema } from '../../shared/contracts/playback-v1/schema'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1/schema'
import { documentTextContentSchema } from '../../shared/document/content'
import { chartDataSchema, chartTableDataSchema } from '../../components/chart/data'
import { interactionActionSchema, interactionActionStepSchema, interactionRuleContentSchema } from '../../shared/interactionSchema'
import { courseStateDeclarationSchema } from '../../shared/contracts/course-state/schema'
import { courseProjectLogicSchema } from '../../shared/contracts/component-platform/schema'
import { courseProjectAudioSettingsSchema, courseProjectSoundDefinitionSchema } from '../../shared/contracts/media-v1/schema'
import { RECIPE_CATALOG } from '../course/courseRecipeEdits'
import { shapeDataSchema } from '../../components/shape/data'

const semanticId = z.string().min(1)
export const objectLayoutInputSchema = z.object({ targets: z.array(semanticId).min(1), intent: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('align'), alignment: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']) }).strict(),
  z.object({ kind: z.literal('distribute'), axis: z.enum(['horizontal', 'vertical']) }).strict(),
]) }).strict()
export const teacherEnsureInputSchema = z.object({ target: semanticId }).strict()
export const surfaceRecipeInputSchema = z.object({ target: semanticId, recipeId: z.enum(RECIPE_CATALOG.map(recipe => recipe.id)),
  slots: z.record(z.string(), z.string()), accentTokenId: semanticId.optional() }).strict()
export const courseProductivityInputSchema = z.object({ target: semanticId, request: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), scope: z.enum(['page', 'surface', 'course']), find: z.string().min(1), replacement: z.string() }).strict(),
  z.object({ kind: z.literal('color'), scope: z.enum(['page', 'surface', 'course']), tokenId: semanticId,
    property: z.enum(['text', 'fill', 'stroke', 'background', 'all']) }).strict(),
]) }).strict()
export const surfaceRemixInputSchema = z.object({ target: semanticId, replacements: z.record(z.string(), z.string()) }).strict()
export const objectInsertInputSchema = z.object({ target: semanticId, kind: z.enum(['text', 'formula', 'shape', 'table', 'chart', 'input']),
  text: z.string().optional(), shapeType: shapeDataSchema.shape.shapeType.optional(), chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(),
  x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(),
  center: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(), index: z.number().int().nonnegative().optional(),
  destination: z.enum(['document', 'paper']).optional(),
}).strict()
const tableShape = tableNativeContentObjectSchema.shape
const tableEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell-text'), cellId: semanticId, text: z.string() }).strict(),
  z.object({ kind: z.enum(['cell-content', 'last-cell-append']), cellId: semanticId, content: documentTextContentSchema }).strict(),
  z.object({ kind: z.literal('cell-style'), cellId: semanticId, stylePatch: tableShape.rows.element.shape.cells.element.shape.style.unwrap().partial() }).strict(),
  z.object({ kind: z.literal('table-style'), stylePatch: tableShape.style.partial() }).strict(),
  z.object({ kind: z.literal('row-height'), rowId: semanticId, height: z.number().positive() }).strict(),
  z.object({ kind: z.literal('column-width'), columnId: semanticId, width: z.number().positive() }).strict(),
  z.object({ kind: z.literal('merge'), region: z.object({ rowIds: z.array(semanticId).min(1), columnIds: z.array(semanticId).min(1) }).strict() }).strict(),
  z.object({ kind: z.literal('split'), rowId: semanticId, columnId: semanticId }).strict(),
  z.object({ kind: z.literal('insert-row'), referenceRowId: semanticId, position: z.enum(['before', 'after']) }).strict(),
  z.object({ kind: z.literal('delete-row'), rowId: semanticId }).strict(),
  z.object({ kind: z.literal('reorder-rows'), orderedRowIds: z.array(semanticId).min(1) }).strict(),
  z.object({ kind: z.literal('move-row'), rowId: semanticId, direction: z.enum(['up', 'down']) }).strict(),
  z.object({ kind: z.literal('insert-column'), referenceColumnId: semanticId, position: z.enum(['before', 'after']), width: z.number().positive().optional() }).strict(),
  z.object({ kind: z.literal('delete-column'), columnId: semanticId }).strict(),
  z.object({ kind: z.literal('reorder-columns'), orderedColumnIds: z.array(semanticId).min(1) }).strict(),
  z.object({ kind: z.literal('move-column'), columnId: semanticId, direction: z.enum(['left', 'right']) }).strict(),
])
const chartShape = chartDataSchema.options[0].shape
const chartEditSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), value: z.string() }).strict(),
  z.object({ type: z.literal('category'), categoryId: semanticId, label: z.string() }).strict(),
  z.object({ type: z.literal('series'), seriesId: semanticId, name: z.string().optional(), color: z.string().optional() }).strict(),
  z.object({ type: z.literal('point'), seriesId: semanticId, categoryId: semanticId, value: z.number().finite() }).strict(),
  z.object({ type: z.literal('style'), patch: chartShape.style.partial().extend({ holeSize: z.number().min(10).max(90).optional() }) }).strict(),
  chartTableDataSchema.extend({ type: z.literal('data') }).strict(),
  z.object({ type: z.literal('chart-type'), chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']), retainedSeriesId: semanticId.optional() }).strict(),
])
const inputRuleConfigSchema = z.discriminatedUnion('answerType', [
  z.object({ answerType: z.literal('text'), answers: z.array(z.string()).min(1), correct: z.array(interactionActionSchema).min(1), error: z.array(interactionActionSchema).min(1) }).strict(),
  z.object({ answerType: z.literal('number'), min: z.number().finite(), max: z.number().finite(), correct: z.array(interactionActionSchema).min(1), error: z.array(interactionActionSchema).min(1) }).strict(),
])
export const objectAuthorInputSchema = z.object({ target: semanticId, change: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), edit: tableEditSchema }).strict(),
  z.object({ kind: z.literal('chart'), edit: chartEditSchema }).strict(),
  z.object({ kind: z.literal('input-rules'), request: z.discriminatedUnion('mode', [
    z.object({ mode: z.enum(['apply', 'rebuild']), config: inputRuleConfigSchema }).strict(), z.object({ mode: z.literal('unmanage') }).strict(),
  ]) }).strict(),
]) }).strict()

const ruleDraftSchema = z.object({ ...interactionRuleContentSchema.shape,
  actions: z.array(interactionActionStepSchema.omit({ id: true }).extend({ id: semanticId.optional() })).min(1),
}).strict()
export const interactionUpdateInputSchema = z.object({ target: semanticId, change: z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['add', 'reveal']), rule: ruleDraftSchema }).strict(),
  z.object({ kind: z.literal('update'), ruleId: semanticId, rule: ruleDraftSchema }).strict(),
  z.object({ kind: z.enum(['remove', 'duplicate']), ruleId: semanticId }).strict(),
  z.object({ kind: z.literal('click'), action: z.enum(['audio-play', 'location-go']), value: semanticId }).strict(),
]) }).strict()
const guardSchema = courseProjectLogicSchema.shape.navigationGuards.element
export const courseLogicInputSchema = z.object({ target: semanticId, change: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course-state.add'), declaration: courseStateDeclarationSchema }).strict(),
  z.object({ kind: z.literal('course-state.update'), key: semanticId, declaration: courseStateDeclarationSchema }).strict(),
  z.object({ kind: z.literal('course-state.delete'), key: semanticId }).strict(),
  z.object({ kind: z.literal('navigation-guard.add'), guard: guardSchema.omit({ id: true }) }).strict(),
  z.object({ kind: z.literal('navigation-guard.update'), guardId: semanticId, guard: guardSchema.omit({ id: true }) }).strict(),
  z.object({ kind: z.literal('navigation-guard.delete'), guardId: semanticId }).strict(),
  z.object({ kind: z.literal('network'), network: courseProjectLogicSchema.shape.network.unwrap() }).strict(),
]) }).strict()
export const courseMediaInputSchema = z.object({ target: semanticId, change: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('audio'), settings: courseProjectAudioSettingsSchema.omit({ sounds: true, channelVolumes: true, narrationDucking: true }).partial().extend({
    channelVolumes: courseProjectAudioSettingsSchema.shape.channelVolumes.partial().optional(),
    narrationDucking: courseProjectAudioSettingsSchema.shape.narrationDucking.partial().optional(),
  }) }).strict(),
  z.object({ kind: z.literal('sound'), soundId: semanticId, settings: courseProjectSoundDefinitionSchema.omit({ id: true }).partial().nullable() }).strict(),
  z.object({ kind: z.literal('import-sounds'), assets: z.array(semanticId).min(1) }).strict(),
]) }).strict()

const backgroundInputSchema = componentBackgroundSchema.extend({ source: z.string().min(1).optional()
  .describe('来源返回的 source 或已授权图片路径；软件登记资源，不需要拼接 assetId。') })
export const courseConfigureInputSchema = z.object({ target: z.string().min(1), settings: z.object({
  title: z.string().optional(), background: backgroundInputSchema.nullable().optional(),
  designTokens: courseProjectDesignTokensSchema.nullable().optional(),
  playback: z.object({ controls: z.enum(['canvas', 'none']).optional(), keyboardNavigation: z.boolean().optional(),
    presenter: projectPresenterSettingsSchema.optional() }).strict().nullable().optional(),
}).strict() }).strict()
export const surfaceConfigureInputSchema = z.object({ target: z.string().min(1), settings: z.object({
  title: z.string().optional(), background: backgroundInputSchema.nullable().optional(),
  flowLayout: componentFlowAuthoringSchema.shape.layout.partial().optional(),
  resize: z.object({ designSize: z.object({ width: z.number().positive(), height: z.number().positive() }).strict().nullable(),
    mode: z.enum(['preserve', 'contain']).optional(), surfaceIds: z.array(z.string().min(1)).optional(), includeGlobal: z.boolean().optional() }).strict().optional(),
}).strict() }).strict()

export const objectStructureInputSchema = z.object({ target: z.string().min(1),
  action: z.enum(['remove', 'duplicate', 'move', 'reorder']),
  destination: z.string().min(1).optional().describe('move/duplicate 的已观察页面或容器句柄；省略duplicate保留原归属。'),
  index: z.number().int().nonnegative().optional(),
  direction: z.enum(['front', 'back', 'forward', 'backward']).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'move' && !value.destination) context.addIssue({ code: 'custom', path: ['destination'], message: '移动需要目标容器' })
  if (value.action === 'reorder' && !value.direction) context.addIssue({ code: 'custom', path: ['direction'], message: '排序需要方向' })
})
export const objectPlaceInputSchema = z.object({ target: z.string().min(1), placement: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global'), plane: z.enum(['underlay', 'overlay']).optional(), visibility: componentVisibilitySchema.optional(),
    atSurface: z.object({ surfaceId: z.string().min(1), visible: z.boolean() }).strict().optional() }).strict(),
  z.object({ kind: z.literal('flow-body'), parent: z.string().min(1).nullable().optional(), index: z.number().int().nonnegative().optional(),
    layout: componentFlowBodyLayoutSchema.partial().optional() }).strict(),
  z.object({ kind: z.literal('flow-overlay'), placement: componentFlowPlacementSchema, frame: componentFrameSchema.optional(),
    index: z.number().int().nonnegative().optional() }).strict(),
]) }).strict()

const coordinate = z.number().finite()
const sourceAuthoringInputSchema = z.union([
  z.object({ kind: z.literal('source'), source: z.string(), language: z.enum(['javascript', 'typescript']).optional() }).strict(),
  z.object({ kind: z.literal('source'), from: z.string().min(1), language: z.enum(['javascript', 'typescript']).optional() }).strict(),
  componentBuiltinImplementationSchema,
])
/** Public component properties; the Gateway emits canonical ComponentEdit operations. */
export const objectUpdatePropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']).optional(),
  data: jsonValueSchema.describe('Only supplied data properties change; omitted properties are preserved. Professional appearance, sizing, style, crop, feather, filters and poster records accept partial properties. Arrays and content values use their existing complete-value format.').optional(),
  style: z.record(z.string(), jsonValueSchema).describe('Only supplied style properties change; omitted properties are preserved. Use null to explicitly clear a CSS value.').optional(),
  implementation: sourceAuthoringInputSchema.nullable().optional().describe('源码只需 source 正文或 from 文件路径；省略 language 保留现有语言。null 恢复定义实现。workspace、模块和资源绑定由软件维护。'),
}).strict()

/** Paths bind the observed project file to its formal instance inside the Gateway. */
export const objectUpdateInputSchema = z.union([
  z.object({ target: z.string().min(1).max(100), properties: objectUpdatePropertiesInputSchema }).strict(),
  z.object({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1),
    properties: objectUpdatePropertiesInputSchema }).strict(),
])

export const objectConvertOptionsInputSchema = z.object({
  to: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(),
  title: z.string().optional(),
  categoryColumn: z.number().int().positive().describe('Category column, counted from 1. Defaults to the first column.').optional(),
  valueColumns: z.array(z.number().int().positive()).min(1).describe('Numeric series columns, counted from 1. Defaults to all columns except the category column.').optional(),
}).strict()
export const objectConvertInputSchema = z.union([
  objectConvertOptionsInputSchema.extend({ target: z.string().min(1).max(100) }).strict(),
  objectConvertOptionsInputSchema.extend({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1) }).strict(),
])
