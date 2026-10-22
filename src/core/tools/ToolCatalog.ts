import { hostToolCatalog, type HostToolCoordinator } from './HostToolServices'
import { officeContentSchemas, officeContentTools } from './OfficeContentTools'
import { materialToolRegistrations } from './MaterialTools'
import { hostArtifactSaveRegistration } from './HostArtifactTools'
import { htmlActionToolRegistrations } from './HtmlActionTools'
import { pptxImportRegistration } from './CourseImportTools'
import { workbenchServiceToolCatalog } from './WorkbenchServiceTools'
import { agentFileRegistrations } from './AgentFileTools'
import { programmaticToolRegistrations } from './ProgrammaticTools'
import { skillReadTool, skillListTool } from './SkillTools'
import { projectFileRegistrations } from './ProjectFileTools'
import { documentDeliveryTools } from './DocumentDeliveryTools'
import { viewObserveTool } from './ViewObserveTools'
import { viewActionToolRegistrations } from './ViewActionTools'
import bundledSkills from '../../shared/generated/bundledSkills.json'
import { nativeContentInputSchemaByType } from '../../shared/contracts/native-v1/schema'
import { z } from 'zod'
import type { ModelToolCall, ToolDefinition, ToolResult } from '../../shared/workbench/tools'
import { textFormatInputSchema, objectUpdateInputSchema, objectConvertInputSchema, courseConfigureInputSchema, surfaceConfigureInputSchema, objectStructureInputSchema, objectPlaceInputSchema, objectAuthorInputSchema, interactionUpdateInputSchema, courseLogicInputSchema, courseMediaInputSchema, surfaceRecipeInputSchema, courseProductivityInputSchema, surfaceRemixInputSchema, objectInsertInputSchema, objectLayoutInputSchema, teacherEnsureInputSchema } from './toolSchemas'
import { coursePresentationInputSchema } from './coursePresentationEdits'
import { componentFrameSchema } from '../../shared/contracts/component-platform/schema'
import { handleToolTarget, hasRunDocument, hasRunWrite, hasRunDelivery, projectToolTarget, registeredEffectNames,
  toolRegistrationFor, type ResolvedToolTarget, type RunToolScope, type ToolFamily, type ToolSupportContext, type ToolTargetResolver } from './ToolRegistration'
export { toolFamilies } from './ToolRegistration'
export type { RunToolScope, ToolFamily } from './ToolRegistration'

const target = z.string().min(1).max(100)
const imageFitSchema = nativeContentInputSchemaByType.image.shape.fit
const mediaApplyInputSchema = z.union([
  z.object({ target, source: z.string().min(1), fit: imageFitSchema.optional() }).strict(),
  z.object({ target, resource: z.string().min(1), fit: imageFitSchema.optional() }).strict(),
  z.object({ target, asset: target, fit: imageFitSchema.optional() }).strict(),
])
/** Bind these to the existing Gateway transaction owner. */
export interface CanonicalToolHandlers {
  mutate(call: ModelToolCall): Promise<ToolResult>
}
const registerCanonical = toolRegistrationFor<CanonicalToolHandlers>()
const registerOffice = toolRegistrationFor<{ runId: string; operationId: string; host: HostToolCoordinator }>()
export const officeToolRegistrations = officeContentTools.map(tool => registerOffice({ name: tool.name,
  description: tool.description, inputSchema: officeContentSchemas[tool.name],
  manual: { label: tool.name, group: tool.name === 'office.inspect' ? 'read' : 'edit', targetKinds: [] },
}, { capability: tool.name === 'office.inspect' ? 'read' : 'write', effect: tool.name === 'office.inspect' ? null : 'office-write',
  family: 'office', supports: context => context.office !== false && context.workbenchServices !== false
    && (tool.name === 'office.inspect' || context.fileAccess !== 'read'), targets: () => [],
  handler: (context, input) => context.host.executeOffice(context.runId, context.operationId, tool.name, input),
}))
export function officeToolRegistration(name: string) { return officeToolRegistrations.find(tool => tool.name === name) }
export const canonicalMutationTools = [
  registerCanonical({ name: 'text.replace', description: '替换已授权文字字段或精确范围；保留范围外文字及富文本格式。Project V11 使用宿主捕获的组件文字字段句柄，展示状态仍固定在原目标。对象样式使用 object.update；纯文本文档保持纯文本。',
    inputSchema: z.object({ target: target.optional().describe('省略时使用本次文字卡由宿主固定的默认目标；其它任务必须提供。'), content: z.string(), format: z.enum(['text', 'html']).optional() }).strict(), manual: { label: '替换正文', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance', 'text-selection'] } },
  { capability: 'write', effect: 'document-edit', supports: context => hasRunWrite(context, ['markdown-range', 'html-author-field', 'course-instance', 'text-selection']), targets: (input, resolver) => input.target ? handleToolTarget({ target: input.target }, resolver) : undefined,
    handler: (context, input) => context.mutate({ name: 'text.replace', input }) }),
  registerCanonical({ name: 'text.format', description: '对已观察且获授权的 Markdown 或课件原生正文范围设置加粗、斜体、字号、字体、颜色等真实文字格式，保留原文、范围外格式和对象位置。style 只应用提供字段。纯文本文件没有格式；普通 HTML 源文件的范围格式当前不支持，不扩大为父元素样式。',
    inputSchema: textFormatInputSchema, manual: { label: '设置文字格式', group: 'edit', targetKinds: ['markdown-range', 'course-instance', 'text-selection'] } },
  { capability: 'write', effect: 'document-edit', supports: context => hasRunWrite(context, ['markdown-range', 'text-selection'], 'markdown')
      || hasRunWrite(context, ['course-instance', 'text-selection'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'text.format', input }) }),
  registerCanonical({ name: 'object.update', description: '修改获授权整对象的公开属性。使用 target 句柄，或使用 project.list/read 返回的对象 path；project 可选。复制 A 的颜色或阴影到 B 时优先 properties.appearanceFrom:{target:已观察来源整对象只读句柄,fields:["color","shadows"]}，软件确定性读取指定字段，此例保留正文、字号和位置。properties.appearance 直接修改专业外观，显式字段覆盖来源同名字段；文字阴影 shadows 是对象数组，每项 x/y/blur/color。不需要猜 data.appearance，不补省略项默认值。data/style 保留高级局部路径，数组和正文仍使用该字段完整值。implementation 是实例源码覆盖或 null 恢复默认，不能充当专业类型转换；frame 可局部调位置尺寸。文字范围格式使用 text.format，不能扩大为整对象。',
    inputSchema: objectUpdateInputSchema, manual: { label: '修改属性', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.update', input }) }),
  registerCanonical({ name: 'media.apply', description: '使用来源返回的 source 或已授权文件路径，原位替换同类型图片、音频或视频；软件读取实际字节并登记资源。保留对象身份、frame、专业效果与未指定字段；asset 可引用当前文档已有图片句柄。',
    inputSchema: mediaApplyInputSchema, manual: { label: '替换媒体', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'media', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'media.apply', input }) }),
  registerCanonical({ name: 'media.insert', description: '把来源返回的 source 或已授权文件路径插入已授权页面，支持图片、音频和视频；target 为页面句柄，或用 project.list/read 返回的页面 path（project 可选）。软件读取字节、登记资源并分配组件身份。frame 可省略，由宿主按媒体尺寸放置；一次正式事务可撤销。',
    inputSchema: z.union([
      z.object({ target, source: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ target, resource: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ path: z.string().min(1), project: z.string().min(1).optional(), source: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ path: z.string().min(1), project: z.string().min(1).optional(), resource: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
    ]),
    manual: { label: '插入媒体', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'media', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) ?? projectToolTarget({ path: input.target }, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'media.insert', input }) }),
  registerCanonical({ name: 'object.convert', description: '将当前表格转换为可编辑专业图表，保留对象身份、位置、样式和其它对象。用已观察的 target 或 path，to=chart；chartType 可选 bar/line/area/pie/donut。categoryColumn/valueColumns 按列从1计数，默认首列类别、其余列数值。软件读取当前表格及声明表头、产生图表身份并一次提交；不要求复制原表格数据或内部编号。',
    inputSchema: objectConvertInputSchema, manual: { label: '转换对象类型', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.convert', input }) }),
  registerCanonical({ name: 'presentation.update', description: '修改已授权演示页的命名状态：add、rename、duplicate、delete、set-initial、set-thumbnail、clear-overrides、clear-object-overrides、background。target为整页面句柄；state使用读取到的状态名称或身份，初始/缩略图可用null恢复母版。background可局部改颜色/图片，inherit恢复指定背景字段；objects只清指定对象覆盖。软件维护身份，一次事务可撤销。',
    inputSchema: coursePresentationInputSchema, manual: { label: '修改演示状态', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'navigation', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'presentation.update', input }) }),
  registerCanonical({ name: 'course.configure', description: '修改整课名称、背景、设计主题参数或播放与翻页笔设置。target 使用整文档句柄，settings 只更改提供的字段；背景和播放可用 null 恢复默认。人工设置与此工具使用同一语义规划和一次可撤销事务。',
    inputSchema: courseConfigureInputSchema, manual: { label: '整课设置', group: 'edit', targetKinds: ['document'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'course.configure', input }) }),
  registerCanonical({ name: 'surface.configure', description: '修改页面名称、背景、讲义宽度或演示画布尺寸。target 使用页面句柄；resize preserve 保留原几何，contain 等比适配并保留各展示状态和共享层语义。settings 只更改提供的字段。',
    inputSchema: surfaceConfigureInputSchema, manual: { label: '页面设置', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'surface.configure', input }) }),
  registerCanonical({ name: 'object.structure', description: '删除、复制、移动或调层序。target为整对象句柄；复制保持全部展示状态、局部规则、判题反馈和资源引用；移动调整当前页或全局平面内的父子归属，用已观察容器destination句柄并保持世界几何。软件维护对象身份、父子关系和一次撤销，不接受手写childIds。',
    inputSchema: objectStructureInputSchema, manual: { label: '对象结构', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.structure', input }) }),
  registerCanonical({ name: 'object.place', description: '调整全局对象平面/显隐范围，或讲义正文/浮层载体。正文保留阅读顺序、宽度、环绕和题注；浮层保留space/plane/段落锚与frame。parent使用已观察容器句柄；null回到当前页。只更改提供字段。',
    inputSchema: objectPlaceInputSchema, manual: { label: '对象归属与讲义排版', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.place', input }) }),
  registerCanonical({ name: 'object.author', description: '按专业语义修改表格、图表、正文范围互动或填空判题。table 支持单元格/行列/合并/样式；chart 支持数据/样式/图型；input-rules 同步答案/反馈。text-interaction 使用已观察正文选区target及intent:{kind:annotation,content,label?}添加范围注释，或{kind:input,label?,placeholder?,acceptedAnswers?}在选区/光标加入行内填空；软件生成范围与组件身份、保邻文并统一映射改字，一次撤销。不要手填范围编号或DOM地址。',
    inputSchema: objectAuthorInputSchema, manual: { label: '专业内容编辑', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.author', input }) }),
  registerCanonical({ name: 'interaction.update', description: '编辑页面或全局互动规则：add/update/remove/duplicate；reveal 同时设置依次出现的初始隐藏。节点、页面和命名状态引用可使用已观察句柄；规则和动作新身份由软件生成，更新引用使用已观察 ruleId/动作id。click 可在对象上设置播放声音、跳转已观察页面路径/句柄，或scene.next/scene.previous相对导航（无需value）。命名状态须使用该状态的页面句柄。',
    inputSchema: interactionUpdateInputSchema, manual: { label: '互动与动画', group: 'edit', targetKinds: ['document', 'course-surface', 'course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'interaction', supports: context => hasRunWrite(context, ['document', 'course-surface', 'course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'interaction.update', input }) }),
  registerCanonical({ name: 'course.logic', description: '编辑课程状态、导航守卫或课程网络声明。使用整文档句柄；状态改名同步当前规则和命名状态里的引用，删除被引用状态给出可修原因；软件维护新守卫身份。网络声明不赋予凭据或宿主权限。',
    inputSchema: courseLogicInputSchema, manual: { label: '课程逻辑', group: 'edit', targetKinds: ['document'] } },
  { capability: 'write', effect: 'document-edit', family: 'navigation', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'course.logic', input }) }),
  registerCanonical({ name: 'course.media', description: '修改整课音量、声道、旁白压低及声音库。import-sounds 使用工程已有音频素材身份，软件分配声音身份；sound 修改已有声音，settings=null 删除声音。资源字节继续由现有素材服务管理。',
    inputSchema: courseMediaInputSchema, manual: { label: '课程媒体', group: 'edit', targetKinds: ['document'] } },
  { capability: 'write', effect: 'document-edit', family: 'media', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'course.media', input }) }),
  registerCanonical({ name: 'surface.duplicate', description: '复制已观察页面及完整对象、展示状态、规则、判题、空间镜头和内部引用；共享素材/定义继续复用，全局可见范围继承原页。软件维护新页面和对象身份，一次可撤销事务；需要整课写入授权。',
    inputSchema: z.object({ target }).strict(), manual: { label: '复制页面', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'navigation', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'surface.duplicate', input }) }),
  registerCanonical({ name: 'surface.recipe', description: '应用 course.recipes 实际返回的可深改预置。选择反馈含单选/多选，揭示分步，拖拽匹配/排序，continuous-variable-v1连续变量联动；内容配方在已观察页后创建可编辑页面。static-background-v1/dynamic-background-v1仅添加单份全局底层，不新建页，可选current/include/exclude/all范围、图像/颜色/运动强度与内容联动，不抢前景输入。软件装配正式组件、配置、依赖和身份，一次撤销；需要整课写入授权。',
    inputSchema: surfaceRecipeInputSchema, manual: { label: '应用互动预置', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'content', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'surface.recipe', input }) }),
  registerCanonical({ name: 'course.productivity', description: '按普通查找替换或项目颜色意图修改内容，软件扫描并复用人工批量编辑算法；无需逐字段生成补丁。target 是已观察页面；page 只改本页，surface 包含全局层，course 扫描整课。后两种范围需要整课授权。',
    inputSchema: courseProductivityInputSchema, manual: { label: '批量内容与颜色', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'content', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'course.productivity', input }) }),
  registerCanonical({ name: 'surface.remix', description: '完整复制已观察参考页，再替换 surface.remix.inspect 返回的正文槽位。保留人工布局、富文本、互动、展示状态与内部引用，软件维护复制身份；需要整课写入授权。',
    inputSchema: surfaceRemixInputSchema, manual: { label: '参考页面改写', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'content', supports: context => hasRunWrite(context, ['document'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'surface.remix', input }) }),
  registerCanonical({ name: 'object.insert', description: '向已观察页面或容器的目标句柄插入文字、公式、图形、表格、图表或填空；也可提供 project.list/read 返回的已观察页面 path（project可选），target也接受该页面路径。提供类型、正文及所需位置尺寸，可用 appearance 同次设置文字/公式/图形/表格/图表的初始专业外观，语义同 object.update；省略时保留人工插入默认，input 当前不支持 appearance。可用 click:{action,value} 同次绑定正式点击规则；location-go 的 value 沿用已观察目的页句柄或路径，scene.next/scene.previous无需value，audio-play 沿用声音引用，无需先取新对象句柄再设置。软件准备容器、专业数据和身份，并续接本任务已回执的同一目标，无需每个对象重新遍历页面。正式事务可撤销。Flow destination=document 为正文，paper 为纸张浮层。',
    inputSchema: objectInsertInputSchema, manual: { label: '插入专业元素', group: 'edit', targetKinds: ['course-surface', 'course-instance'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'content', supports: context => hasRunWrite(context, ['course-surface', 'course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) ?? projectToolTarget({ path: input.target }, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.insert', input }) }),
  registerCanonical({ name: 'object.layout', description: '对同页同展示状态的已观察对象做对齐或等距分布。targets 使用对象句柄；软件复用人工世界坐标、父级逆变换与锁定规则，不需计算每个 frame，一次事务可撤销。',
    inputSchema: objectLayoutInputSchema, manual: { label: '对齐与分布', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', exposure: 'direct', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => { const resolved = input.targets.map(target => resolver.resolveHandle(target)); return resolved.every(value => value !== undefined) ? resolved : undefined },
    handler: (context, input) => context.mutate({ name: 'object.layout', input }) }),
  registerCanonical({ name: 'teacher.ensure', description: '为已观察演示页准备教师控制台；复用已有控制台，否则使用人工插入默认、共享层和软件身份创建。涉及全局层时需要整课授权，一次事务可撤销。',
    inputSchema: teacherEnsureInputSchema, manual: { label: '准备教师控制台', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'navigation', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'teacher.ensure', input }) }),
] as const
export const projectApplyTool = projectFileRegistrations.find(tool => tool.name === 'project.apply')!
export const canonicalToolRegistrations = [...canonicalMutationTools]
export function canonicalToolRegistration(name: string) { return canonicalToolRegistrations.find(tool => tool.name === name) }
type CallSchemas<T extends readonly { callSchema: z.ZodType }[]> = { [Index in keyof T]: T[Index]['callSchema'] }
const mutationSchemas = canonicalMutationTools.map(tool => tool.callSchema) as unknown as CallSchemas<typeof canonicalMutationTools>
export const mutationCallSchema = z.discriminatedUnion('name', mutationSchemas)
export type MutationCall = z.infer<typeof mutationCallSchema>
export const batchMutationCallSchema = mutationCallSchema
export type BatchMutationCall = z.infer<typeof batchMutationCallSchema>
export const batchInputSchema = z.object({ operations: z.array(batchMutationCallSchema).min(1) }).strict()
const batchDescription = '同一文档多项普通编辑可用 batch；课件已确定的跨页布局和对象插入成批提交，软件维护身份并一次校验提交与撤销。operations使用当前各工具的实际输入和已观察目标，目标沿本任务ACK续用，不逐对象重新遍历。单项正文直接调用 text.replace 可逐步显示生成内容。'
const batchEndDescription = '跨文档须分别调用。'

/** A run projects its batch from the same canonical mutation parsers. */
export function batchInputSchemaFor(mutationNames: readonly string[]): z.ZodType {
  const selected = mutationSchemas.filter(schema => mutationNames.includes(schema.shape.name.value))
  if (!selected.length) throw new Error('批量工具至少需要一项可用修改')
  const operation = selected.length === 1 ? selected[0] : z.union(selected as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
  return z.object({ operations: z.array(operation).min(1) }).strict()
}
export function mutationNamesIn(names: readonly string[]): string[] {
  return mutationSchemas.map(schema => schema.shape.name.value).filter(name => names.includes(name))
}
export function toolEffectNames(call: ModelToolCall): string[] {
  if (call.name !== 'batch') return registeredEffectNames(toolRegistrations, call)
  const parsed = batchInputSchema.safeParse(call.input)
  if (!parsed.success) return registeredEffectNames(toolRegistrations, { name: 'text.replace', input: {} })
  return [...new Set(parsed.data.operations.flatMap(operation => registeredEffectNames(toolRegistrations, operation)))]
}
/** Resolve captured targets for diagnostics/recovery; permissions and final CAS stay in the Gateway. */
export async function toolEffectTargets(call: ModelToolCall, resolver: ToolTargetResolver): Promise<ResolvedToolTarget[] | undefined> {
  const parsed = call.name === 'batch' ? batchInputSchema.safeParse(call.input) : null
  if (parsed && !parsed.success) return undefined
  const calls = parsed?.success ? parsed.data.operations : [call]
  const targets: ResolvedToolTarget[] = []
  for (const operation of calls) {
    const registration = toolRegistration(operation.name)
    if (!registration) return undefined
    try {
      const resolved = await registration.targets(operation.input, resolver)
      if (!resolved) return undefined
      targets.push(...resolved)
    } catch { return undefined }
  }
  return targets
}
/** Model discovery is a run projection; it never changes the canonical MCP catalog. */
export function selectRunToolNames(scopes: readonly RunToolScope[], options: { standaloneImage?: boolean; projectFiles?: 'read' | 'write' } = {},
  context: ToolSupportContext = {}): string[] {
  const frozenContext = { ...context, scopes, standaloneImage: options.standaloneImage, projectFilesAccess: options.projectFiles }
  return toolCatalog.filter(tool => tool.supports(frozenContext)).map(tool => tool.name)
}
/** Authoring uses project files; other tasks keep the canonical editing catalog. */
export function isCourseAuthoringTool(name: string): boolean {
  return toolRegistration(name)?.supports({ courseAuthoring: true }) ?? false
}
export const toolFamilyDescriptions: Record<ToolFamily, string> = {
  content: '组件专业内容与文档正文', layout: '组件属性与表面布局', navigation: '页面、表面、状态与位置结构',
  interaction: '交互规则、输入题和答案', media: '图片、视频、声音与图像生成', build: '文档导出',
  jobs: '受限计算、有限委派与作业状态、等待、日志和取消', office: 'Word、Excel、PowerPoint 原格式内容创建、读取和局部编辑；软件组装与保存',
  external: '公开网页搜索与读取、已授权外部 MCP 工具和资源；配置及调用权限以真实回执为准',
}
/** Describe only capabilities actually allowed by this run's frozen grant. */
export function describeToolFamily(family: ToolFamily, allowedNames: readonly string[], _scopes: readonly RunToolScope[] = []): string {
  const names = allowedNames.filter(name => toolRegistration(name)?.family === family)
  return `${toolFamilyDescriptions[family]}。可用工具：${names.join('、')}。具体参数见已加载的工具定义，所需正文、Source与共享API可直接按实际路径读取。`
}
export function familyOfTool(name: string): ToolFamily | null { return toolRegistration(name)?.family ?? null }
export type InitialToolProfile = 'general' | 'text' | 'content-edit'
export function visibleRunToolNames(allowed: readonly string[], loadedFamilies: ReadonlySet<ToolFamily>, profile: InitialToolProfile = 'general', loadedNames: ReadonlySet<string> = new Set()): string[] {
  const core = new Set(['read', 'inspect', 'listChildren', 'text.replace', 'text.format', 'batch', 'file.save',
    ...(profile === 'content-edit' ? ['project.read', 'project.apply'] : [])])
  const direct = allowed.filter(name => {
    if (name === 'batch') return false
    const registration = toolRegistration(name)
    return !!registration && (loadedNames.has(name) || registration.family && loadedFamilies.has(registration.family)
      || (profile === 'general' ? !registration.family || 'exposure' in registration && registration.exposure === 'direct' : core.has(name)))
  })
  const canBatch = allowed.includes('batch') && mutationNamesIn(direct).length > 0
  return allowed.filter(name => direct.includes(name) || name === 'batch' && canBatch)
}
const page = { target, state: z.string().min(1).nullable().optional().describe('页面或对象的展示状态名称或身份；null读取母版。返回句柄固定此状态，不改变编辑器选择。'), cursor: z.string().min(1).optional(), limit: z.number().int().min(1).optional() }
const readableKinds: ToolDefinition['manual']['targetKinds'] = ['document', 'markdown-range', 'html-author-field', 'course-instance', 'text-selection', 'course-surface', 'course-asset']
/** These callbacks bind the existing Gateway readers, service owners and single batch transaction. */
export interface GatewayToolHandlers {
  readTarget(name: 'read' | 'inspect' | 'listChildren', input: { target: string; detail?: 'semantic' | 'object'; state?: string | null; cursor?: string; limit?: number }): Promise<ToolResult>
  readRecipes(): Promise<ToolResult>
  inspectRemix(input: { target: string }): Promise<ToolResult>
  readSkill(input: unknown): Promise<ToolResult>
  listSkills(input: unknown): Promise<ToolResult>
  observe(input: unknown): Promise<ToolResult>
  deliverDocument(name: 'file.save' | 'document.export', input: unknown): Promise<ToolResult>
  batch(operations: BatchMutationCall[]): Promise<ToolResult>
}
const registerGateway = toolRegistrationFor<GatewayToolHandlers>()
export const gatewayToolRegistrations = [
  registerGateway({ name: 'course.recipes', description: '读取现有教学配方及各正文槽位的名称、说明和默认示例；与人工界面共用同一目录。', inputSchema: z.object({}).strict(), manual: { label: '教学配方目录', group: 'read', targetKinds: ['document'] } },
    { capability: 'read', effect: null, family: 'content', supports: context => hasRunDocument(context, 'course-v10'), targets: () => [],
      handler: context => context.readRecipes() }),
  registerGateway({ name: 'surface.remix.inspect', description: '读取参考页可替换的正文槽位、原文及局部问题。后续 surface.remix 使用返回的槽位引用，不需提供对象身份或字段路径。', inputSchema: z.object({ target }).strict(), manual: { label: '读取参考页槽位', group: 'read', targetKinds: ['course-surface'] } },
    { capability: 'read', effect: null, family: 'content', supports: context => hasRunDocument(context, 'course-v10'), targets: handleToolTarget,
      handler: (context, input) => context.inspectRemix(input) }),
  registerGateway({ name: 'read', description: '直接读取已知目标的语义正文，省略detail不附工程目录或源码；detail=object显式读取完整目标属性。返回 data.target 对应本次读取的当前基线。nextCursor 续读仍配原调用的 target。本任务已回执的修改由软件续接既有目标，目标未改变、未冲突时不需为每次操作重读或刷新句柄；外部修改仍明确冲突。', inputSchema: z.object({ ...page, detail: z.enum(['semantic', 'object']).optional() }).strict(), manual: { label: '读取', group: 'read', targetKinds: readableKinds } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('read', input) }),
  registerGateway({ name: 'inspect', description: '读取目标类型、可用操作及小范围摘要；返回 data.target 对应本次读取的当前基线。本任务已回执的修改由软件续接既有目标，目标未改变、未冲突时不需逐对象重新遍历或刷新句柄；外部修改仍明确冲突。', inputSchema: z.object({ target, state: page.state }).strict(), manual: { label: '检查目标', group: 'read', targetKinds: readableKinds } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('inspect', input) }),
  registerGateway({ name: 'listChildren', description: '分页列出文档、表面或组件的直接子项，并取得短句柄；写权限仍按冻结目标逐项判定。', inputSchema: z.object(page).strict(), manual: { label: '列出子项', group: 'read', targetKinds: ['document', 'course-surface', 'course-instance'] } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('listChildren', input) }),
  registerGateway(skillReadTool(bundledSkills.manifest.skills), { capability: 'read', effect: null, supports: context => context.skills !== false,
    targets: () => [], handler: (context, input) => context.readSkill(input) }),
  registerGateway(skillListTool, { capability: 'read', effect: null, supports: context => context.skills !== false,
    targets: () => [], handler: (context, input) => context.listSkills(input) }),
  registerGateway(viewObserveTool, { capability: 'read', effect: null, supports: context => context.observations !== false || context.htmlActions !== false,
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : 'path' in input ? projectToolTarget(input, resolver) : [], handler: (context, input) => context.observe(input) }),
  ...documentDeliveryTools.map(tool => registerGateway(tool, {
    capability: 'save', effect: tool.name === 'file.save' ? 'document-save' : 'document-export', exposure: 'direct', family: tool.name === 'document.export' ? 'build' : null,
    supports: context => context.deliveries !== false && hasRunDelivery(context, tool.name === 'document.export' ? 'course-v10' : undefined),
    targets: handleToolTarget, handler: (context, input) => context.deliverDocument(tool.name, input),
  })),
  registerGateway({ name: 'batch', description: batchDescription + batchEndDescription, inputSchema: batchInputSchema, manual: { label: '批量修改', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance', 'text-selection'] } },
    { capability: 'write', effect: 'document-edit', supports: context => canonicalMutationTools.some(tool => tool.supports(context)),
      targets: (input, resolver) => toolEffectTargets({ name: 'batch', input }, resolver), handler: (context, input) => context.batch(input.operations) }),
] as const
export function gatewayToolRegistration(name: string) { return gatewayToolRegistrations.find(tool => tool.name === name) }
/** One item owns each current tool's parser, support, effects, targets and actual owner handler. */
export const toolCatalog = [...hostToolCatalog, ...workbenchServiceToolCatalog, ...projectFileRegistrations, ...gatewayToolRegistrations, ...canonicalMutationTools,
  ...officeToolRegistrations, ...materialToolRegistrations, ...htmlActionToolRegistrations, ...viewActionToolRegistrations, hostArtifactSaveRegistration, pptxImportRegistration]
export const toolRegistrations = [...toolCatalog, ...agentFileRegistrations, ...programmaticToolRegistrations]
export function toolRegistration(name: string) { return toolRegistrations.find(tool => tool.name === name) }
/** Model and MCP schemas are projected from the actual canonical parsers. */
function compactSchemaUnions(schema: Record<string, any>): void {
  // Merge only disjoint literal-tagged variants with otherwise identical
  // constraints. Runtime Zod parsers and the accepted parameter set stay intact.
  for (const key of ['properties', 'patternProperties', '$defs', 'dependentSchemas'])
    for (const child of Object.values(schema[key] ?? {}))
      if (child && typeof child === 'object') compactSchemaUnions(child as Record<string, any>)
  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) for (const child of schema[key] ?? [])
    if (child && typeof child === 'object') compactSchemaUnions(child)
  for (const key of ['items', 'additionalProperties', 'unevaluatedProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'])
    if (schema[key] && typeof schema[key] === 'object') compactSchemaUnions(schema[key])
  for (const union of ['oneOf', 'anyOf']) {
    if (!Array.isArray(schema[union])) continue
    const groups = new Map<string, { discriminator: string; items: Record<string, any>[] }>()
    for (const variant of schema[union]) {
      if (variant.type !== 'object') continue
      for (const discriminator of ['type', 'kind']) {
        const value = variant.properties?.[discriminator]
        if (value?.type !== 'string' || typeof value.const !== 'string' || !variant.required?.includes(discriminator)
          || Object.keys(value).some(key => key !== 'type' && key !== 'const')) continue
        const shape = { ...variant, properties: { ...variant.properties, [discriminator]: { type: 'string' } } }
        const key = discriminator + JSON.stringify(shape), group = groups.get(key) ?? { discriminator, items: [] }
        group.items.push(variant); groups.set(key, group)
        break
      }
    }
    for (const { discriminator, items } of groups.values()) {
      const values = items.map(item => item.properties[discriminator].const)
      if (items.length < 2 || new Set(values).size !== values.length) continue
      const first = items[0]!
      first.properties[discriminator] = { type: 'string', enum: values }
      schema[union] = schema[union].filter((item: Record<string, any>) => item === first || !items.includes(item))
    }
  }
}
function describeInput(inputSchema: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(inputSchema, { io: 'input', reused: 'ref' })
  compactSchemaUnions(schema)
  const variants = schema.oneOf ?? schema.anyOf
  const isObject = (value: unknown) => {
    if (!value || typeof value !== 'object') return false
    const variant = value as { type?: string; $ref?: string }
    if (variant.type === 'object') return true
    const name = variant.$ref?.startsWith('#/$defs/') ? variant.$ref.slice('#/$defs/'.length) : undefined
    return name !== undefined && schema.$defs?.[name]?.type === 'object'
  }
  if (schema.type === undefined && Array.isArray(variants)
    && variants.every(isObject)) schema.type = 'object'
  return schema
}
export function describeTools(names?: readonly string[], options?: { batchMutationNames: readonly string[]; compactBatch?: boolean }): ToolDefinition[] {
  return toolCatalog.filter(tool => !names || names.includes(tool.name)).map(tool => ({
    name: tool.name, description: tool.name === 'batch' ? batchDescription + '条目的 name 使用下列规范工具名，input 使用该工具定义的实际参数；执行时每项仍经规范解析器校验。' + batchEndDescription : tool.description,
    schema: tool.name === 'batch' ? {
      type: 'object', properties: { operations: { type: 'array', minItems: 1, items: {
        type: 'object', properties: {
          name: { type: 'string', enum: options?.batchMutationNames ?? mutationNamesIn(toolCatalog.map(tool => tool.name)) },
          input: { type: 'object', additionalProperties: true, description: '对应 name 的规范工具输入。' },
        }, required: ['name', 'input'], additionalProperties: false,
      } } }, required: ['operations'], additionalProperties: false,
    } : describeInput(tool.inputSchema),
    manual: structuredClone(tool.manual),
  }))
}
