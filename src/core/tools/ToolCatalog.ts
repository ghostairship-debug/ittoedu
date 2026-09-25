import { audioSettingsPatchSchema, soundPropertiesSchema } from './audioSchema'
import { spatialGatewayInputSchema } from './spatialStructureSchema'
import { courseSurfaceTitleSchema } from '../../shared/courseProjectSchema'
import { courseNavigationInputSchema } from './courseNavigationSchema'
import { presentationStateNameSchema } from './presentationStateTools'
import { selectionReplacementSchema } from './selectionReplacement'
import { layerPositionSchema, layerPlacementSchema, layerAlignModeSchema, layerDistributeAxisSchema } from './layerEditSchema'
import { hostToolCatalog } from './HostToolServices'
import { inputAnswerSchema } from './inputInsertion'
import { composeInputSchema, updateComposedInteractionSchema } from './interactionCompose'
import { imageFitSchema } from './imageApplication'
import { basicNativeTemplateSchema, nativeTemplateSchema } from './nativeInsertionSchema'
import { z } from 'zod'
import type { DocumentKind } from '../../shared/workbench/document'
import type { ToolDefinition, ToolTarget } from '../../shared/workbench/tools'
import { backgroundToolInputSchema, objectUpdatePropertiesInputSchema, newFlowBlockInputSchema, flowTableStructureSchema } from './toolSchemas'
import { documentTextContentSchema } from '../../shared/document/content'
import { flowBlockSchema } from '../../shared/courseProjectSchema'

const target = z.string().min(1).max(100)
const layerPosition = z.discriminatedUnion('kind', [layerPositionSchema.options[0], layerPositionSchema.options[1], layerPositionSchema.options[2].omit({ siblingId: true }).extend({ sibling: target }), layerPositionSchema.options[3].omit({ siblingId: true }).extend({ sibling: target })])
const nativeMediaProperties = nativeTemplateSchema.options[3].omit({ nativeType: true, assetId: true, paperSpace: true, placement: true })
const flowMediaProperties = z.object({ layout: z.enum(['content-width', 'wide', 'full-width']).optional(), altText: z.string().max(4000).optional(), caption: documentTextContentSchema.optional(), wrap: z.enum(['none', 'left', 'right']).optional() }).strict()
const mediaInsertInputSchema = z.union([
  z.object({ target, resource: z.string().min(1), properties: nativeMediaProperties }).strict(),
  z.object({ target, asset: target, properties: nativeMediaProperties.optional(), flow: flowMediaProperties.optional() }).strict(),
])
const mediaApplyInputSchema = z.union([
  z.object({ target, resource: z.string().min(1), fit: imageFitSchema.optional() }).strict(),
  z.object({ target, asset: target, fit: imageFitSchema.optional() }).strict(),
])
const mutationSchemas = [
  z.object({ name: z.literal('text.replace'), input: z.object({ target, content: z.string() }).strict() }).strict(),
  z.object({ name: z.literal('object.update'), input: z.object({ target, properties: objectUpdatePropertiesInputSchema }).strict() }).strict(),
  z.object({ name: z.literal('owner.background'), input: z.object({ target, properties: backgroundToolInputSchema }).strict() }).strict(),
  z.object({ name: z.literal('flow.content'), input: z.object({ target, content: documentTextContentSchema }).strict() }).strict(),
  z.object({ name: z.literal('document.insert'), input: z.object({ target, block: newFlowBlockInputSchema }).strict() }).strict(),
  z.object({ name: z.literal('flow.delete'), input: z.object({ target }).strict() }).strict(),
  z.object({ name: z.literal('flow.move'), input: z.object({ target, destination: target }).strict() }).strict(),
  z.object({ name: z.literal('flow.table'), input: z.object({ target, change: flowTableStructureSchema }).strict() }).strict(),
  z.object({ name: z.literal('native.insert'), input: z.object({ target, template: basicNativeTemplateSchema }).strict() }).strict(),
  z.object({ name: z.literal('media.insert'), input: mediaInsertInputSchema }).strict(),
  z.object({ name: z.literal('media.apply'), input: mediaApplyInputSchema }).strict(),
  z.object({ name: z.literal('input.answer'), input: z.object({ target, answer: inputAnswerSchema }).strict() }).strict(),
  z.object({ name: z.literal('interaction.compose'), input: z.object({ target, interaction: composeInputSchema.omit({ operation: true }) }).strict() }).strict(),
  z.object({ name: z.literal('interaction.update'), input: z.object({ target, interaction: updateComposedInteractionSchema }).strict() }).strict(),
  z.object({ name: z.literal('interaction.delete'), input: z.object({ target }).strict() }).strict(),
  z.object({ name: z.literal('layer.delete'), input: z.object({ target }).strict() }).strict(),
  z.object({ name: z.literal('layer.duplicate'), input: z.object({ target, owner: target, placement: layerPlacementSchema }).strict() }).strict(),
  z.object({ name: z.literal('layer.reorder'), input: z.object({ target, owner: target, position: layerPosition }).strict() }).strict(),
  z.object({ name: z.literal('layer.align'), input: z.object({ target, targets: z.array(target).min(2).max(200), mode: layerAlignModeSchema, primary: target.optional() }).strict() }).strict(),
  z.object({ name: z.literal('layer.distribute'), input: z.object({ target, targets: z.array(target).min(3).max(200), axis: layerDistributeAxisSchema }).strict() }).strict(),
  z.object({ name: z.literal('selection.replace'), input: selectionReplacementSchema.omit({ replacementItemId: true }).extend({ target, replacement: target }).strict() }).strict(),
  z.object({ name: z.literal('state.create'), input: z.object({ target, name: presentationStateNameSchema.optional() }).strict() }).strict(),
  z.object({ name: z.literal('state.rename'), input: z.object({ target, name: presentationStateNameSchema }).strict() }).strict(),
  z.object({ name: z.literal('state.duplicate'), input: z.object({ target, owner: target }).strict() }).strict(),
  z.object({ name: z.literal('state.delete'), input: z.object({ target }).strict() }).strict(),
  z.object({ name: z.literal('state.reorder'), input: z.object({ target, states: z.array(target).min(1).max(200) }).strict() }).strict(),
  z.object({ name: z.literal('course.navigation'), input: z.discriminatedUnion('operation', [
    courseNavigationInputSchema.options[0].extend({ target }), courseNavigationInputSchema.options[1].extend({ target }), courseNavigationInputSchema.options[2].extend({ target }),
    courseNavigationInputSchema.options[3].omit({ surfaceIds: true }).extend({ target, surfaces: z.array(target).min(1) }),
  ]) }).strict(),
  z.object({ name: z.literal('slide.create'), input: z.object({ target, title: courseNavigationInputSchema.options[0].shape.title }).strict() }).strict(),
  z.object({ name: z.literal('slide.duplicate'), input: z.object({ target, surface: target }).strict() }).strict(),
  z.object({ name: z.literal('slide.reorder'), input: z.object({ target, locations: z.array(target).min(1) }).strict() }).strict(),
  z.object({ name: z.literal('surface.delete'), input: z.object({ target }).strict() }).strict(),
  z.object({ name: z.literal('surface.rename'), input: z.object({ target, name: courseSurfaceTitleSchema }).strict() }).strict(),
  z.object({ name: z.literal('slide.move'), input: z.object({ target, destination: target, index: z.number().int().min(0).optional() }).strict() }).strict(),
  z.object({ name: z.literal('spatial.structure'), input: spatialGatewayInputSchema }).strict(),
  z.object({ name: z.literal('audio.settings'), input: z.object({ target, properties: audioSettingsPatchSchema }).strict() }).strict(),
  z.object({ name: z.literal('sound.create'), input: z.object({ target, asset: target, properties: soundPropertiesSchema.optional() }).strict() }).strict(),
  z.object({ name: z.literal('sound.update'), input: z.object({ target, asset: target.optional(), properties: soundPropertiesSchema }).strict() }).strict(),
  z.object({ name: z.literal('sound.delete'), input: z.object({ target }).strict() }).strict(),
] as const
export const mutationCallSchema = z.discriminatedUnion('name', mutationSchemas)
export type MutationCall = z.infer<typeof mutationCallSchema>
/** Batch references address a previous host-created result, never an internal object ID. */
const batchCreatedResultSchema = z.object({ $result: z.object({ step: z.number().int().min(0).max(99) }).strict() }).strict()
const batchResultReferenceMutationSchema = mutationSchemas[20].extend({ input: mutationSchemas[20].shape.input.extend({ replacement: batchCreatedResultSchema }) })
export const batchMutationCallSchema = z.union([mutationCallSchema, batchResultReferenceMutationSchema])
export type BatchMutationCall = z.infer<typeof batchMutationCallSchema>
const batchResultReferenceDescription = 'selection.replace 的 replacement 可为 {$result:{step:0}}，step 从0计数，只能引用此前 native.insert/media.insert/document.insert/layer.duplicate 新建的主对象；不可前向引用或引用修改结果。创建与替换同次提交。'
const batchDescription = '同文档两项及以上普通编辑可放进 batch，一次校验提交与撤销；单项正文请直接调用 text.replace，才能逐步显示生成内容。'
const batchEndDescription = '跨文档须分别调用。'

/** A built-in run projects its batch from the very same canonical mutation parsers. */
export function batchInputSchemaFor(mutationNames: readonly string[]): z.ZodType {
  const selected = mutationSchemas.filter(schema => mutationNames.includes(schema.shape.name.value))
  if (!selected.length) throw new Error('批量工具至少需要一项可用修改')
  const canonical = selected.length === 1 ? selected[0] : z.union(selected as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
  const canReferenceCreated = mutationNames.includes('selection.replace') &&
    ['native.insert', 'media.insert', 'document.insert', 'layer.duplicate'].some(name => mutationNames.includes(name))
  const operation = canReferenceCreated ? z.union([canonical, batchResultReferenceMutationSchema]) : canonical
  return z.object({ operations: z.array(operation).min(1).max(100) }).strict()
}

export function mutationNamesIn(names: readonly string[]): string[] {
  return mutationSchemas.map(schema => schema.shape.name.value).filter(name => names.includes(name))
}

export interface RunToolScope {
  kind: DocumentKind
  writableTargetKinds: readonly ToolTarget['kind'][]
  wholeDocumentWritable: boolean
  canInsertFlow: boolean
}

/** Model discovery is a run projection; it never changes the canonical MCP catalog. */
export function selectRunToolNames(scopes: readonly RunToolScope[]): string[] {
  if (!scopes.length) return []
  if (scopes.some(scope => scope.kind === 'course-v9' && scope.wholeDocumentWritable))
    return toolCatalog.filter(tool => tool.name !== 'document.insert' || scopes.some(scope => scope.canInsertFlow)).map(tool => tool.name)
  const writable = new Set(scopes.flatMap(scope => scope.writableTargetKinds))
  const hasV9Write = scopes.some(scope => scope.kind === 'course-v9' && scope.writableTargetKinds.length > 0)
  const eligible = (name: string) => {
    if (name === 'read' || name === 'inspect' || name === 'listChildren') return true
    if (name.startsWith('image.')) return hasV9Write
    if (name.startsWith('build.')) return false
    if (name === 'batch') return false
    if (name === 'document.insert' && !scopes.some(scope => scope.canInsertFlow)) return false
    const tool = toolCatalog.find(candidate => candidate.name === name)
    if (!tool || !tool.manual.targetKinds.some(kind => writable.has(kind))) return false
    // Several planners also require a distinct writable destination/owner handle.
    if (name === 'flow.move') return writable.has('flow-container')
    if (name === 'layer.duplicate' || name === 'layer.reorder') return writable.has('course-owner')
    if (name === 'state.duplicate') return writable.has('course-owner')
    if (name === 'slide.duplicate' || name === 'slide.move') return writable.has('course-surface')
    return true
  }
  const direct = toolCatalog.filter(tool => eligible(tool.name))
  const hasMutation = mutationNamesIn(direct.map(tool => tool.name)).length > 0
  return toolCatalog.filter(tool => direct.includes(tool) || tool.name === 'batch' && hasMutation).map(tool => tool.name)
}

export const toolFamilies = ['content', 'layout', 'navigation', 'interaction', 'media', 'build'] as const
export type ToolFamily = typeof toolFamilies[number]
export const toolFamilyDescriptions: Record<ToolFamily, string> = {
  content: 'Flow 讲义块、原生内容与正文结构',
  layout: '图层与空间布局',
  navigation: '页面、表面、状态与位置结构',
  interaction: '交互规则、输入题和答案',
  media: '图片、视频、声音与图像生成',
  build: '受控构建、检查与导入',
}
/** Describe only capabilities actually allowed by this run's frozen grant. */
export function describeToolFamily(family: ToolFamily, allowedNames: readonly string[]): string {
  if (family === 'layout' && allowedNames.includes('object.update'))
    return '对象属性（调用 object.update，properties.nativeTextStyle 调文字颜色、字体、样式，properties.frame 调位置）、图层与空间布局'
  return toolFamilyDescriptions[family]
}
const baselineTools = new Set(['read', 'inspect', 'listChildren', 'text.replace', 'flow.content'])
export function familyOfTool(name: string): ToolFamily | null {
  if (baselineTools.has(name) || name === 'batch') return null
  if (name.startsWith('build.')) return 'build'
  if (name.startsWith('image.') || name.startsWith('media.') || name.startsWith('audio.') || name.startsWith('sound.')) return 'media'
  if (name.startsWith('interaction.') || name.startsWith('input.')) return 'interaction'
  if (name.startsWith('course.') || name.startsWith('slide.') || name.startsWith('surface.') || name.startsWith('state.')) return 'navigation'
  if (name.startsWith('layer.') || name.startsWith('spatial.') || name === 'object.update') return 'layout'
  return 'content'
}
export function visibleRunToolNames(allowed: readonly string[], loadedFamilies: ReadonlySet<ToolFamily>): string[] {
  const direct = allowed.filter(name => name !== 'batch' && (!familyOfTool(name) || loadedFamilies.has(familyOfTool(name)!)))
  const canBatch = allowed.includes('batch') && mutationNamesIn(direct).length > 0
  return allowed.filter(name => direct.includes(name) || name === 'batch' && canBatch)
}
const page = { target, cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).optional() }
const readableKinds: ToolDefinition['manual']['targetKinds'] = ['course-audio', 'course-sound', 'course-asset', 'spatial-graph', 'document', 'markdown-range', 'course-owner', 'course-state', 'course-surface', 'course-location', 'course-interaction', 'course-object', 'course-background', 'flow-container', 'flow-block', 'flow-range']

/** One registry drives input validation, model/MCP JSON schema and manual action metadata. */
export const toolCatalog = [
  ...hostToolCatalog,
  { name: 'read', description: '分页读取目标文字或属性；返回 data.target 是当前内容的新短句柄，后续编辑应使用它。nextCursor 续读仍配原调用的 target；外部修改目标时明确冲突。', inputSchema: z.object(page).strict(), manual: { label: '读取', group: 'read', targetKinds: readableKinds } },
  { name: 'inspect', description: '读取目标类型、可用操作及小范围摘要；返回 data.target 是当前内容的新短句柄，后续编辑应使用它；外部修改目标时明确冲突。', inputSchema: z.object({ target }).strict(), manual: { label: '检查目标', group: 'read', targetKinds: readableKinds } },
  { name: 'listChildren', description: '分页列出文档、页面、owner、命名态的背景和内容子项，或 Flow 分节正文，并取得短句柄；写权限仍按冻结目标逐项判定。', inputSchema: z.object(page).strict(), manual: { label: '列出子项', group: 'read', targetKinds: ['course-audio', 'document', 'course-surface', 'course-location', 'course-owner', 'course-state', 'flow-container', 'flow-block'] } },
  { name: 'text.replace', description: '只替换已授权 Markdown 范围、Native 纯文本、Flow 正文或范围的文字内容；不修改对象字体、颜色等样式属性。若本任务授权 Native 对象样式，可用 tools.load 展开 layout，再用 object.update。保留范围外源文、公式、样式和可确定映射的 runs。', inputSchema: mutationSchemas[0].shape.input, manual: { label: '替换正文', group: 'edit', targetKinds: ['markdown-range', 'course-object', 'flow-block', 'flow-range'] } },
  { name: 'object.update', description: '修改对象公开属性；Native 文字整节点样式使用 nativeTextStyle，正文使用 text.replace。文字框需给字体和四边 padding 留足可读空间，shrink 会缩小字；设背景色时要同时明确 backgroundOpacity，默认 0 为透明。透明文字框在无遮挡的纯色场景中，须让文字颜色与有效 Slide 场景背景形成清晰对比；有背景图片或图层衬底时按实际画面判断。遵守锁定与正式 V9 校验。', inputSchema: mutationSchemas[1].shape.input, manual: { label: '修改属性', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'owner.background', description: '修改课程、Slide/Flow/Spatial Surface、场景或命名态的背景；省略字段保持原值。', inputSchema: mutationSchemas[2].shape.input, manual: { label: '修改背景', group: 'edit', targetKinds: ['course-background'] } },
  { name: 'flow.content', description: '替换 Flow 正文块内容或已冻结的精确正文范围，支持富文本与公式，范围之外的内容、样式、引用与身份保留。', inputSchema: mutationSchemas[3].shape.input, manual: { label: '修改讲义正文', group: 'edit', targetKinds: ['flow-block', 'flow-range'] } },
  { name: 'document.insert', description: '在 Flow 正文容器的宿主冻结位置插入正式 Flow block；仅省略根 id，由宿主生成。正文使用 content.inlines，全部字段遵守共享正文合同；成功返回新块句柄。', inputSchema: mutationSchemas[4].shape.input, manual: { label: '插入讲义块', group: 'edit', targetKinds: ['flow-container'] } },
  { name: 'flow.delete', description: '删除 Flow 块及其子块，清理被删除目录的导航/显示引用；每个 Flow 表面保留至少一个导航标题，素材仍由撤销历史持有。', inputSchema: mutationSchemas[5].shape.input, manual: { label: '删除讲义块', group: 'edit', targetKinds: ['flow-block'] } },
  { name: 'flow.move', description: '将 Flow 块移动到同表面已授权的目的容器位置。target 与 destination 都必须是本任务句柄；不可移入自身，不能通过移动绕过目的地权限。', inputSchema: mutationSchemas[6].shape.input, manual: { label: '移动讲义块', group: 'edit', targetKinds: ['flow-block'] } },
  { name: 'flow.table', description: '修改 Flow 表格行列与合并结构，复用正式表格规则；新行列身份由宿主生成，非法合并或结构变化不提交。', inputSchema: mutationSchemas[7].shape.input, manual: { label: '修改讲义表格', group: 'edit', targetKinds: ['flow-block'] } },
  { name: 'native.insert', description: '在宿主签发的owner创建Native：Slide场景基础类型，global不含image、chart、table，surface只支持chart/table；Flow surface/global只支持text/shape/image/video浮层；Spatial world支持基础类型及chart/table。同一轮多项插入或修改请用 batch 一次提交；单项提交后须 read/inspect owner 并使用新 data.target 再编辑。创建文字时按可读字号、行数及四边 padding 留足框高；shrink 会压小字体，背景色需配合 backgroundOpacity（默认 0 为透明）。透明文字框在无遮挡的纯色场景中，须让文字颜色与有效 Slide 场景背景形成清晰对比；有背景图片或图层衬底时按实际画面判断。图层及表格/图表子身份由宿主生成，paperSpace只适用于Flow，填空题仅Slide scene，会原子创建状态声明、正误反馈与托管判题规则。', inputSchema: mutationSchemas[8].shape.input, manual: { label: '插入原生对象', group: 'edit', targetKinds: ['course-owner'] } },
  { name: 'media.insert', description: 'resource 导入宿主已提供的图片并插入 Native；asset 引用当前文档已有素材短句柄，按 owner 创建 Native 图片/视频或在 Flow 正文容器插入图片/视频/音频块。Native 图片可明确 frame；先读取页面对象的位置和尺寸，给图像安排不遮挡文字的范围。二者互斥；音频不进入 Native 浮层。', inputSchema: mutationSchemas[9].shape.input, manual: { label: '插入媒体', group: 'edit', targetKinds: ['course-owner', 'flow-container'] } },
  { name: 'media.apply', description: 'resource 使用宿主图片资源；asset 只读引用当前文档已有素材。按原载体类型替换 Native 图片/视频、Flow 图片/视频/音频块或图片背景，保留身份、布局和未指定字段。背景与 Flow 图片只接受 contain 或省略 fit。', inputSchema: mutationSchemas[10].shape.input, manual: { label: '替换媒体', group: 'edit', targetKinds: ['course-object', 'flow-block', 'course-background'] } },
  { name: 'input.answer', description: '修改 Slide 输入题的文本答案或数值范围，保留原正确/错误反馈；归一化后重复或非法答案拒绝，规则被手改时明确冲突。', inputSchema: mutationSchemas[11].shape.input, manual: { label: '修改输入题答案', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'interaction.compose', description: '在 Slide scene 创建正式声明式互动规则。触发和效果引用使用本任务对象/页面短句柄或唯一可见名称；宿主生成规则与步骤身份。支持点击、输入提交、进入场景、演示器触发及显隐、呈现状态、课程状态、步骤、场景和跨表面导航；沿用 Published 支持与锁定校验。只创建，不替换已有规则。', inputSchema: mutationSchemas[12].shape.input, manual: { label: '创建互动规则', group: 'edit', targetKinds: ['course-owner'] } },
  { name: 'interaction.update', description: '修改规则句柄的名称、启用、触发、条件或效果；省略字段保留现值，rule 身份不变，引用/锁定/Published 支持与创建同源校验。', inputSchema: mutationSchemas[13].shape.input, manual: { label: '修改互动规则', group: 'edit', targetKinds: ['course-interaction'] } },
  { name: 'interaction.delete', description: '删除规则句柄对应规则；锁定关联对象时拒绝。删除托管输入题家族成员时同次释放该家族管理，保留其余规则和资源，支持一次撤销。', inputSchema: mutationSchemas[14].shape.input, manual: { label: '删除互动规则', group: 'edit', targetKinds: ['course-interaction'] } },
  { name: 'layer.delete', description: '删除对象并依正式规则清理交互与导航引用；素材仍由撤销历史保存。状态由宿主句柄精确冻结；基础态结构删除，命名态按正式规则隐藏继承对象或删除该态独有对象。', inputSchema: mutationSchemas[15].shape.input, manual: { label: '删除对象', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'layer.duplicate', description: '复制到相同 owner 并按 placement 放置，宿主生成独立对象及表格/图表内部身份。target 与 owner 均须可写短句柄；不跨 owner 或命名态；命名态副本只在该态可见。', inputSchema: mutationSchemas[16].shape.input, manual: { label: '复制对象', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'layer.reorder', description: '在相同 owner/平面与命名态内调整层级。owner 需可写，before/after 的 sibling 是另一个已读取对象短句柄。', inputSchema: mutationSchemas[17].shape.input, manual: { label: '调整层级', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'layer.align', description: '对齐同一 Slide owner/平面的同一状态的对象，按旋转后视觉包围盒计算，锁定对象不移动。target 必须属于 targets，可选 primary 也必须属于 targets。', inputSchema: mutationSchemas[18].shape.input, manual: { label: '对齐对象', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'layer.distribute', description: '均匀分布同一 Slide owner/平面的至少三个同一状态的对象，按旋转后视觉包围盒计算，锁定对象不移动。', inputSchema: mutationSchemas[19].shape.input, manual: { label: '分布对象', group: 'edit', targetKinds: ['course-object'] } },
  { name: 'selection.replace', description: '用另一个已创建且可写的同 owner、平面与状态对象完整替换目标，保留几何、层级与可映射引用；Flow 正文须在同一父分节，保留导航身份。不兼容引用整次拒绝。replacement 为短句柄，此调用不包含先前创建的 History。', inputSchema: mutationSchemas[20].shape.input, manual: { label: '替换对象', group: 'edit', targetKinds: ['course-object', 'flow-block'] } },
  { name: 'state.create', description: '在基础态场景 owner 新建命名状态，身份由宿主产生，沿用手工默认名称与归一化。', inputSchema: mutationSchemas[21].shape.input, manual: { label: '创建呈现状态', group: 'edit', targetKinds: ['course-owner'] } },
  { name: 'state.rename', description: '只重命名明确状态，沿用手工名称归一化，空白或相同名称不改变内容。', inputSchema: mutationSchemas[22].shape.input, manual: { label: '重命名呈现状态', group: 'edit', targetKinds: ['course-state'] } },
  { name: 'state.duplicate', description: '复制状态覆盖并扩展其状态范围条件；必须额外提供相同场景的可写基础态 owner。', inputSchema: mutationSchemas[23].shape.input, manual: { label: '复制呈现状态', group: 'edit', targetKinds: ['course-state'] } },
  { name: 'state.delete', description: '删除明确状态并清理派生交互、导航及教师控制器引用；保留至少一个状态。', inputSchema: mutationSchemas[24].shape.input, manual: { label: '删除呈现状态', group: 'edit', targetKinds: ['course-state'] } },
  { name: 'state.reorder', description: '使用基础态场景 owner 与该场景全部状态短句柄排序，不能跨场景或遗漏状态。', inputSchema: mutationSchemas[25].shape.input, manual: { label: '排序呈现状态', group: 'edit', targetKinds: ['course-owner'] } },
  { name: 'course.navigation', description: '新增Slide/Flow/Spatial表面需document句柄；重命名或删除位置需location句柄；重排表面需document及全部surface短句柄。使用正式课程导航规则，不能删除最后位置。', inputSchema: mutationSchemas[26].shape.input, manual: { label: '课程导航', group: 'edit', targetKinds: ['document', 'course-location'] } },
  { name: 'slide.create', description: '在明确Slide表面创建演示场景，宿主生成身份；需要surface写权限。', inputSchema: mutationSchemas[27].shape.input, manual: { label: '新增演示场景', group: 'edit', targetKinds: ['course-surface'] } },
  { name: 'slide.duplicate', description: '复制location对应演示场景及状态/引用，另需相同surface写权限。', inputSchema: mutationSchemas[28].shape.input, manual: { label: '复制演示场景', group: 'edit', targetKinds: ['course-location'] } },
  { name: 'slide.reorder', description: '用同表面全部场景location短句柄排序，维护导航和打印顺序。', inputSchema: mutationSchemas[29].shape.input, manual: { label: '排序演示场景', group: 'edit', targetKinds: ['course-surface'] } },
  { name: 'surface.delete', description: '删除明确表面及派生引用，至少保留一个课程位置。', inputSchema: mutationSchemas[30].shape.input, manual: { label: '删除表面', group: 'edit', targetKinds: ['course-surface'] } },
  { name: 'surface.rename', description: '重命名明确Surface，复用V9名称schema及手工页面planner；保留已有位置标签、内容、资源和身份。', inputSchema: mutationSchemas[31].shape.input, manual: { label: '重命名表面', group: 'edit', targetKinds: ['course-surface'] } },
  { name: 'slide.move', description: '将明确演示场景移动到另一个Slide表面，destination必须可写surface句柄；同步位置、打印顺序、启动位置及引用。index省略则追加。', inputSchema: mutationSchemas[32].shape.input, manual: { label: '跨表面移动场景', group: 'edit', targetKinds: ['course-location'] } },
  { name: 'spatial.structure', description: '编辑明确Spatial的镜头、home、路径与关系。新增和home需要surface，镜头更新/删除需要location，路径/关系更新/删除需要graph句柄。路径layerItemIds和关系端点必须为同surface world对象短句柄，可只读。fit-world-content需location及surface两个可写句柄，以固定1280×720设计视口更新home与该入口frame；无可见world内容unchanged，不改ViewState。', inputSchema: mutationSchemas[33].shape.input, manual: { label: '修改空间结构', group: 'edit', targetKinds: ['course-surface', 'course-location', 'spatial-graph'] } },
  { name: 'audio.settings', description: '修改课程总音量、默认静音、声道音量与旁白压低配置；仅需audio句柄，省略字段保留。', inputSchema: mutationSchemas[34].shape.input, manual: { label: '修改音频设置', group: 'edit', targetKinds: ['course-audio'] } },
  { name: 'sound.create', description: '从当前文档已存在的音频asset短句柄创建声音定义，需audio写权限；身份由宿主生成，不导入新字节。', inputSchema: mutationSchemas[35].shape.input, manual: { label: '创建声音', group: 'edit', targetKinds: ['course-audio'] } },
  { name: 'sound.update', description: '修改声音名称、声道、默认音量和循环；可用当前文档audio asset短句柄替换来源，保留声音身份及交互引用。', inputSchema: mutationSchemas[36].shape.input, manual: { label: '修改声音', group: 'edit', targetKinds: ['course-sound'] } },
  { name: 'sound.delete', description: '删除未被交互引用的声音定义；仍被引用则整次拒绝，底层资源保留，可单次撤销。', inputSchema: mutationSchemas[37].shape.input, manual: { label: '删除声音', group: 'edit', targetKinds: ['course-sound'] } },
  { name: 'batch', description: batchDescription + batchResultReferenceDescription + batchEndDescription, inputSchema: z.object({ operations: z.array(batchMutationCallSchema).min(1).max(100) }).strict(), manual: { label: '批量修改', group: 'edit', targetKinds: ['markdown-range', 'course-owner', 'course-state', 'course-interaction', 'course-object', 'course-background', 'flow-block', 'flow-range', 'flow-container'] } },
] satisfies { name: string; description: string; inputSchema: z.ZodType; manual: ToolDefinition['manual'] }[]

/** Existing capabilities stay explicit until their real planners move into this gateway. */
export const pendingToolMigrations = ['interaction:global-rules', 'interaction:raw-rule-insert', 'component.configure', 'component.package', 'runtime', 'asset.media.import', 'media.apply:shape-carrier-replacement'] as const

/** Input JSON schema is projected from the same formal Flow parser, including its recursive blocks. */
function describeInput(inputSchema: z.ZodType): Record<string, unknown> {
  let hasFlowInsertion = false
  const schema = z.toJSONSchema(inputSchema, { override(context) {
    if (context.zodSchema !== newFlowBlockInputSchema) return
    hasFlowInsertion = true
    for (const key of Object.keys(context.jsonSchema)) delete context.jsonSchema[key]
    context.jsonSchema.$ref = '#/$defs/flowInsertBlock'
  } })
  // Chat Completions tool parameters require an explicit object root. A union of
  // object variants is still an object, but Zod emits only oneOf/anyOf at root.
  const variants = schema.oneOf ?? schema.anyOf
  if (schema.type === undefined && Array.isArray(variants)
    && variants.every(variant => variant && typeof variant === 'object' && variant.type === 'object')) schema.type = 'object'
  if (!hasFlowInsertion) return schema
  const rewriteRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteRefs)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      key === '$ref' && typeof child === 'string' && child.startsWith('#') ? `#/$defs/flowBlock${child.slice(1)}` : rewriteRefs(child)]))
  }
  const block = rewriteRefs(z.toJSONSchema(flowBlockSchema)) as Record<string, unknown>
  delete block.$schema
  const insertion = structuredClone(block)
  for (const option of insertion.oneOf as { properties: Record<string, unknown>; required?: string[] }[]) {
    delete option.properties.id
    option.required = option.required?.filter(key => key !== 'id')
  }
  schema.$defs = { ...schema.$defs, flowBlock: block, flowInsertBlock: insertion }
  return schema
}

export function describeTools(names?: readonly string[], options?: { batchMutationNames: readonly string[]; compactBatch?: boolean }): ToolDefinition[] {
  return toolCatalog.filter(tool => !names || names.includes(tool.name)).map(tool => ({
    name: tool.name,
    description: tool.name === 'batch' && options
      ? batchDescription + (options.batchMutationNames.includes('selection.replace') && ['native.insert', 'media.insert', 'document.insert', 'layer.duplicate'].some(name => options.batchMutationNames.includes(name)) ? batchResultReferenceDescription : '') + batchEndDescription
      : tool.description,
    schema: tool.name === 'batch' && options?.compactBatch
      ? { type: 'object', properties: { operations: { type: 'array', minItems: 1, maxItems: 100, items: {
        type: 'object', properties: { name: { type: 'string', enum: [...options.batchMutationNames] },
          input: { type: 'object', additionalProperties: true } }, required: ['name', 'input'], additionalProperties: false,
      } } }, required: ['operations'], additionalProperties: false }
      : describeInput(tool.name === 'batch' && options ? batchInputSchemaFor(options.batchMutationNames) : tool.inputSchema),
    manual: structuredClone(tool.manual),
  }))
}
