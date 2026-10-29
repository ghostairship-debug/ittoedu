import { z } from 'zod'
import { componentBackgroundSchema, componentFlowAuthoringSchema, componentFlowBodyLayoutSchema, componentFlowPlacementSchema, componentFrameSchema, componentVisibilitySchema, componentBuiltinImplementationSchema, jsonValueSchema } from '../../shared/contracts/component-platform/schema'
import { courseProjectDesignTokensSchema } from '../../shared/contracts/design-v1/schema'
import { projectPresenterSettingsSchema } from '../../shared/contracts/playback-v1/schema'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1/schema'
import { documentTextContentSchema, documentTextStyleSchema } from '../../shared/document/content'
import { chartDataSchema, chartTableDataSchema } from '../../components/chart/data'
import { interactionActionSchema, interactionActionStepSchema, interactionRuleContentSchema } from '../../shared/interactionSchema'
import { courseStateDeclarationSchema } from '../../shared/contracts/course-state/schema'
import { courseProjectLogicSchema } from '../../shared/contracts/component-platform/schema'
import { courseProjectAudioSettingsSchema, courseProjectSoundDefinitionSchema } from '../../shared/contracts/media-v1/schema'
import { RECIPE_CATALOG } from '../course/courseRecipeEdits'
import { shapeDataSchema } from '../../components/shape/data'
import { tableContentInputSchema } from '../../components/table/data'

const semanticId = z.string().min(1)
const clickInteractionInputSchema = z.object({
  action: z.enum(['audio-play', 'location-go', 'scene.next', 'scene.previous']), value: semanticId.optional(),
}).strict().superRefine((value, context) => {
  if ((value.action === 'audio-play' || value.action === 'location-go') && !value.value)
    context.addIssue({ code: 'custom', path: ['value'], message: '播放声音或跳转指定页面需要目标引用' })
})
const professionalAppearanceInputSchema = z.record(z.string(), jsonValueSchema)
export const textFormatInputSchema = z.object({ target: semanticId, style: documentTextStyleSchema }).strict()
export const objectLayoutInputSchema = z.object({ targets: z.array(semanticId).min(1), intent: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('align'), alignment: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']) }).strict(),
  z.object({ kind: z.literal('distribute'), axis: z.enum(['horizontal', 'vertical']) }).strict(),
  z.object({ kind: z.literal('group') }).strict(),
  z.object({ kind: z.literal('ungroup') }).strict(),
  z.object({kind:z.literal('reflow'),html:z.string().min(1).describe('临时HTML/CSS构图，按targets顺序使用空div data-layout-ref="0"、"1"等，每个恰好一次。软件注入当前内容，只应用几何，不保存包装、不改正文。'),viewport:z.object({width:z.number().int().positive(),height:z.number().int().positive()}).strict().optional()}).strict(),
  z.object({ kind: z.literal('columns'), columns: z.array(z.array(semanticId)).min(2).optional(),
    ratios: z.array(z.number().positive()).min(2).optional(), gap: z.number().nonnegative().optional() }).strict(),
]) }).strict()
export const teacherEnsureInputSchema = z.object({target:semanticId,placement:z.enum(['global','content']).optional(),presentation:z.enum(['console','directory','top','side','progress']).optional()}).strict()
export const surfaceRecipeInputSchema = z.object({ target: semanticId, recipeId: z.enum(RECIPE_CATALOG.map(recipe => recipe.id)),
  slots: z.record(z.string(), z.string()), accentTokenId: semanticId.optional() }).strict()
export const courseProductivityInputSchema = z.object({ target: semanticId, request: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), scope: z.enum(['page', 'surface', 'course']), find: z.string().min(1), replacement: z.string() }).strict(),
  z.object({ kind: z.literal('color'), scope: z.enum(['page', 'surface', 'course']), tokenId: semanticId,
    property: z.enum(['text', 'fill', 'stroke', 'background', 'all']) }).strict(),
]) }).strict()
export const surfaceRemixInputSchema = z.object({ target: semanticId, replacements: z.record(z.string(), z.string()) }).strict()
const objectInsertOptionsSchema = z.object({ kind: z.enum(['text', 'formula', 'shape', 'table', 'chart', 'input']),
  click: clickInteractionInputSchema.optional().describe('同次绑定正式点击规则；location-go 的 value 使用已观察目的页面句柄或路径；scene.next/scene.previous无需value，audio-play 使用已配置声音。'),
  text: z.string().optional(), shapeType: shapeDataSchema.shape.shapeType.optional(), chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(),
  table: tableContentInputSchema.optional().describe('表格的完整可见文字矩阵 {rows:[[...]],headerRowCount?}；软件分配行列/单元格身份，仅 kind=table 使用。'),
  chart: chartTableDataSchema.optional().describe('图表分类与系列数值；软件分配分类、系列和点身份，仅 kind=chart 使用。'),
  appearance: professionalAppearanceInputSchema.optional().describe('可选初始专业外观，和 object.update 的 appearance 同义；只覆盖提供字段，省略时保留人工插入默认。文字/公式支持 fontSize、color、bold、lineHeight、shadows 等；图形、表格、图表使用其公开专业 style 字段，图形使用 fillColor、borderColor 等实际字段。input 当前不支持 appearance。'),
  x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(),
  center: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(), index: z.number().int().nonnegative().optional(),
  after: semanticId.optional().describe('同一插入容器内已观察的整对象句柄，在该对象之后插入。'),
  at: semanticId.optional().describe('已观察的Flow正文光标或文字选区句柄；保所选内容，在逻辑末端拆段插入。'),
  destination: z.enum(['document', 'paper']).optional(),
}).strict()
export const objectInsertInputSchema = z.union([
  objectInsertOptionsSchema.extend({ target: semanticId }).strict(),
  objectInsertOptionsSchema.extend({ project: semanticId.optional(), path: semanticId }).strict(),
]).superRefine((value, context) => {
  if (value.table && value.kind !== 'table') context.addIssue({ code: 'custom', path: ['table'], message: 'table 内容仅用于插入表格' })
  if (value.chart && value.kind !== 'chart') context.addIssue({ code: 'custom', path: ['chart'], message: 'chart 内容仅用于插入图表' })
  if ([value.index, value.after, value.at].filter(value => value !== undefined).length > 1)
    context.addIssue({ code: 'custom', message: 'index、after、at 只能指定一种插入位置' })
  if (value.at && value.destination === 'paper') context.addIssue({ code: 'custom', path: ['at'], message: '正文光标只能用于正文插入' })
})
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
  z.object({ kind: z.literal('text-interaction'), intent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('annotation'), content: z.string().min(1), label: z.string().optional() }).strict(),
    z.object({ kind: z.literal('input'), label: z.string().optional(), placeholder: z.string().optional(), acceptedAnswers: z.array(z.string()).optional() }).strict(),
  ]) }).strict(),
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
  clickInteractionInputSchema.safeExtend({ kind: z.literal('click') }).strict(),
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
  viewportPinned: z.boolean().optional().describe('全局对象是否固定在视口中；不授予教师导航权限'),
  playbackInitialVisibility: z.enum(['inherit', 'hidden']).optional(),
  stateBindings: z.record(z.string().min(1), z.string().min(1).nullable()).nullable().optional().describe('显式状态别名，值为已声明的 courseState.key。仅合并提供的别名，单个 null 删除该别名，整体 null 清除；Source 增强用 bindings.get/set/observe(alias)消费。普通同课复制继续共享，已有托管输入键复制映射时同步重绑；任意 JS 字符串不改写。'),
  appearance: professionalAppearanceInputSchema.optional().describe('目标真实专业外观的局部参数；文字可用 fontFamily、fontSize、color、shadows、lineHeight 等。shadows 是对象数组，每项使用 x、y、blur、color。表格、图表与图形使用其公开专业样式。只应用提供字段，不改变正文、位置或省略参数；实际适用键与类型由目标领域数据验证。复制已观察对象的外观优先 appearanceFrom；显式 appearance 字段覆盖来源同名字段。不支持项明确反馈，文字范围格式使用 text.format。'),
  appearanceFrom: z.object({
    target: semanticId.describe('已观察来源整对象的只读句柄；软件按该来源当前捕获内容读取外观。'),
    fields: z.array(z.string().min(1)).min(1).max(64)
      .refine(fields => new Set(fields).size === fields.length, '复制的外观字段不能重复')
      .meta({ uniqueItems: true }).describe('明确复制的外观字段，例如 color、shadows；不复制正文、位置、尺寸或未列出字段。'),
  }).strict().optional().describe('从已观察且可读的整对象确定性复制指定外观字段；不需要模型转抄 CSS，也不补默认值。可与 appearance 合并，显式字段覆盖来源字段。'),
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
