import { hostToolCatalog, type HostToolCoordinator } from './HostToolServices'
import { officeContentSchemas, officeContentTools } from './OfficeContentTools'
import { materialToolRegistrations } from './MaterialTools'
import { hostArtifactSaveRegistration } from './HostArtifactTools'
import { htmlActionToolRegistrations } from './HtmlActionTools'
import { pptxImportRegistration } from './CourseImportTools'
import { workbenchServiceToolCatalog } from './WorkbenchServiceTools'
import { agentFileRegistrations } from './AgentFileTools'
import { skillReadTool, skillListTool } from './SkillTools'
import { projectFileRegistrations } from './ProjectFileTools'
import { documentDeliveryTools } from './DocumentDeliveryTools'
import { viewObserveTool } from './ViewObserveTools'
import bundledSkills from '../../shared/generated/bundledSkills.json'
import { nativeContentInputSchemaByType } from '../../shared/contracts/native-v1/schema'
import { z } from 'zod'
import type { ModelToolCall, ToolDefinition, ToolResult } from '../../shared/workbench/tools'
import { objectUpdateInputSchema, objectConvertInputSchema, courseConfigureInputSchema, surfaceConfigureInputSchema, objectStructureInputSchema, objectPlaceInputSchema, objectAuthorInputSchema, interactionUpdateInputSchema, courseLogicInputSchema, courseMediaInputSchema, surfaceRecipeInputSchema, courseProductivityInputSchema, surfaceRemixInputSchema, objectInsertInputSchema, objectLayoutInputSchema, teacherEnsureInputSchema } from './toolSchemas'
import { coursePresentationInputSchema } from './coursePresentationEdits'
import { componentFrameSchema } from '../../shared/contracts/component-platform/schema'
import { handleToolTarget, hasRunDocument, hasRunWrite, projectToolTarget, registeredEffectNames,
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
  registerCanonical({ name: 'text.replace', description: '替换已授权文字字段或精确范围；保留范围外文字及富文本格式。Project V10 使用宿主捕获的组件文字字段句柄，展示状态仍固定在原目标。对象样式使用 object.update；纯文本文档保持纯文本。',
    inputSchema: z.object({ target: target.optional().describe('省略时使用本次文字卡由宿主固定的默认目标；其它任务必须提供。'), content: z.string(), format: z.enum(['text', 'html']).optional() }).strict(), manual: { label: '替换正文', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance', 'text-selection'] } },
  { capability: 'write', effect: 'document-edit', supports: context => hasRunWrite(context, ['markdown-range', 'html-author-field', 'course-instance', 'text-selection']), targets: (input, resolver) => input.target ? handleToolTarget({ target: input.target }, resolver) : undefined,
    handler: (context, input) => context.mutate({ name: 'text.replace', input }) }),
  registerCanonical({ name: 'object.update', description: '修改获授权整对象的公开属性。使用 target 句柄，或使用 project.list/read 返回的对象 path；project 可选。data/style 只修改提供字段，省略字段和人工位置保持；专业 appearance/style 等子记录可局部修改，数组和正文仍使用该字段完整值。implementation 是实例源码覆盖或 null 恢复默认，不能充当专业类型转换；frame 可局部调位置尺寸。文字范围授权不能扩大为整对象。',
    inputSchema: objectUpdateInputSchema, manual: { label: '修改属性', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.update', input }) }),
  registerCanonical({ name: 'media.apply', description: '使用来源返回的 source 或已授权文件路径，原位替换同类型图片、音频或视频；软件读取实际字节并登记资源。保留对象身份、frame、专业效果与未指定字段；asset 可引用当前文档已有图片句柄。',
    inputSchema: mediaApplyInputSchema, manual: { label: '替换媒体', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'media', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'media.apply', input }) }),
  registerCanonical({ name: 'media.insert', description: '把来源返回的 source 或已授权文件路径插入已授权页面，支持图片、音频和视频；target 为页面句柄，或用 project.list/read 返回的页面 path（project 可选）。软件读取字节、登记资源并分配组件身份。frame 可省略，由宿主按媒体尺寸放置；一次正式事务可撤销。',
    inputSchema: z.union([
      z.object({ target, source: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ target, resource: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ path: z.string().min(1), project: z.string().min(1).optional(), source: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
      z.object({ path: z.string().min(1), project: z.string().min(1).optional(), resource: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
    ]),
    manual: { label: '插入媒体', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'media', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'),
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
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.structure', input }) }),
  registerCanonical({ name: 'object.place', description: '调整全局对象平面/显隐范围，或讲义正文/浮层载体。正文保留阅读顺序、宽度、环绕和题注；浮层保留space/plane/段落锚与frame。parent使用已观察容器句柄；null回到当前页。只更改提供字段。',
    inputSchema: objectPlaceInputSchema, manual: { label: '对象归属与讲义排版', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.place', input }) }),
  registerCanonical({ name: 'object.author', description: '按专业语义修改表格、图表或填空判题。table 支持单元格、行列、合并拆分和样式；chart 支持数据、样式和图型切换；input-rules 同步答案、状态和反馈规则。使用已观察对象/行列身份，新增身份由软件维护，与人工编辑共享算法和一次撤销。',
    inputSchema: objectAuthorInputSchema, manual: { label: '专业内容编辑', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.author', input }) }),
  registerCanonical({ name: 'interaction.update', description: '编辑页面或全局互动规则：add/update/remove/duplicate；reveal 同时设置依次出现的初始隐藏。节点、页面和命名状态引用可使用已观察句柄；规则和动作新身份由软件生成，更新引用使用已观察 ruleId/动作id。click 可在对象上设置播放声音或跳转页面。命名状态须使用该状态的页面句柄。',
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
  registerCanonical({ name: 'surface.recipe', description: '在已观察页面后应用现有教学配方，创建可编辑页面。course.recipes 返回模板和正文槽位；只提供配方与文案，分类/排序使用项目文字和正确顺序，软件装配组件、规则和身份。需要整课写入授权。',
    inputSchema: surfaceRecipeInputSchema, manual: { label: '应用教学配方', group: 'edit', targetKinds: ['course-surface'] } },
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
  registerCanonical({ name: 'object.insert', description: '在已观察页面或容器内插入文字、公式、图形、表格、图表或填空。只提供类型、正文及所需位置尺寸；软件复用人工插入默认、准备容器、专业数据和身份，正式事务可撤销。Flow destination=document 为正文，paper 为纸张浮层。',
    inputSchema: objectInsertInputSchema, manual: { label: '插入专业元素', group: 'edit', targetKinds: ['course-surface', 'course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'content', supports: context => hasRunWrite(context, ['course-surface', 'course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'object.insert', input }) }),
  registerCanonical({ name: 'object.layout', description: '对同页同展示状态的已观察对象做对齐或等距分布。targets 使用对象句柄；软件复用人工世界坐标、父级逆变换与锁定规则，不需计算每个 frame，一次事务可撤销。',
    inputSchema: objectLayoutInputSchema, manual: { label: '对齐与分布', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
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
const mutationSchemas = [canonicalMutationTools[0].callSchema, canonicalMutationTools[1].callSchema, canonicalMutationTools[2].callSchema, canonicalMutationTools[3].callSchema, canonicalMutationTools[4].callSchema, canonicalMutationTools[5].callSchema, canonicalMutationTools[6].callSchema, canonicalMutationTools[7].callSchema, canonicalMutationTools[8].callSchema, canonicalMutationTools[9].callSchema, canonicalMutationTools[10].callSchema, canonicalMutationTools[11].callSchema, canonicalMutationTools[12].callSchema, canonicalMutationTools[13].callSchema, canonicalMutationTools[14].callSchema, canonicalMutationTools[15].callSchema, canonicalMutationTools[16].callSchema, canonicalMutationTools[17].callSchema, canonicalMutationTools[18].callSchema, canonicalMutationTools[19].callSchema, canonicalMutationTools[20].callSchema] as const
export const mutationCallSchema = z.discriminatedUnion('name', mutationSchemas)
export type MutationCall = z.infer<typeof mutationCallSchema>
export const batchMutationCallSchema = mutationCallSchema
export type BatchMutationCall = z.infer<typeof batchMutationCallSchema>
const batchInputSchema = z.object({ operations: z.array(batchMutationCallSchema).min(1) }).strict()
const batchDescription = '同文档两项及以上普通编辑可放进 batch，一次校验提交与撤销；单项正文请直接调用 text.replace，才能逐步显示生成内容。'
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
}
/** Describe only capabilities actually allowed by this run's frozen grant. */
export function describeToolFamily(family: ToolFamily, allowedNames: readonly string[]): string {
  if (family === 'layout' && allowedNames.includes('object.update'))
    return '对象属性（object.update 修改专业数据、视觉样式与 frame 位置尺寸）、图层与空间布局'
  return toolFamilyDescriptions[family]
}
export function familyOfTool(name: string): ToolFamily | null { return toolRegistration(name)?.family ?? null }
export function visibleRunToolNames(allowed: readonly string[], loadedFamilies: ReadonlySet<ToolFamily>): string[] {
  const coreFamilies = new Set<ToolFamily>(['content', 'layout', 'navigation', 'interaction', 'media', 'build', 'jobs', 'office'])
  const direct = allowed.filter(name => name !== 'batch' && (!familyOfTool(name) || coreFamilies.has(familyOfTool(name)!) || loadedFamilies.has(familyOfTool(name)!)))
  const canBatch = allowed.includes('batch') && mutationNamesIn(direct).length > 0
  return allowed.filter(name => direct.includes(name) || name === 'batch' && canBatch)
}
const page = { target, state: z.string().min(1).nullable().optional().describe('页面或对象的展示状态名称或身份；null读取母版。返回句柄固定此状态，不改变编辑器选择。'), cursor: z.string().min(1).optional(), limit: z.number().int().min(1).optional() }
const readableKinds: ToolDefinition['manual']['targetKinds'] = ['document', 'markdown-range', 'html-author-field', 'course-instance', 'text-selection', 'course-surface', 'course-asset']
/** These callbacks bind the existing Gateway readers, service owners and single batch transaction. */
export interface GatewayToolHandlers {
  readTarget(name: 'read' | 'inspect' | 'listChildren', input: { target: string; state?: string | null; cursor?: string; limit?: number }): Promise<ToolResult>
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
  registerGateway({ name: 'read', description: '分页读取目标文字或属性；返回 data.target 是当前内容的新短句柄，后续编辑应使用它。nextCursor 续读仍配原调用的 target；外部修改目标时明确冲突。', inputSchema: z.object(page).strict(), manual: { label: '读取', group: 'read', targetKinds: readableKinds } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('read', input) }),
  registerGateway({ name: 'inspect', description: '读取目标类型、可用操作及小范围摘要；返回 data.target 是当前内容的新短句柄，后续编辑应使用它；外部修改目标时明确冲突。', inputSchema: z.object({ target, state: page.state }).strict(), manual: { label: '检查目标', group: 'read', targetKinds: readableKinds } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('inspect', input) }),
  registerGateway({ name: 'listChildren', description: '分页列出文档、表面或组件的直接子项，并取得短句柄；写权限仍按冻结目标逐项判定。', inputSchema: z.object(page).strict(), manual: { label: '列出子项', group: 'read', targetKinds: ['document', 'course-surface', 'course-instance'] } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('listChildren', input) }),
  registerGateway(skillReadTool(bundledSkills.manifest.skills), { capability: 'read', effect: null, supports: context => context.skills !== false,
    targets: () => [], handler: (context, input) => context.readSkill(input) }),
  registerGateway(skillListTool, { capability: 'read', effect: null, supports: context => context.skills !== false,
    targets: () => [], handler: (context, input) => context.listSkills(input) }),
  registerGateway(viewObserveTool, { capability: 'read', effect: null, supports: context => context.observations !== false && hasRunDocument(context, 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver), handler: (context, input) => context.observe(input) }),
  ...documentDeliveryTools.map(tool => registerGateway(tool, {
    capability: 'save', effect: tool.name === 'file.save' ? 'document-save' : 'document-export', family: tool.name === 'document.export' ? 'build' : null,
    supports: context => context.deliveries !== false && (tool.name === 'document.export' ? hasRunWrite(context, [], 'course-v10') : hasRunWrite(context)),
    targets: handleToolTarget, handler: (context, input) => context.deliverDocument(tool.name, input),
  })),
  registerGateway({ name: 'batch', description: batchDescription + batchEndDescription, inputSchema: batchInputSchema, manual: { label: '批量修改', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance', 'text-selection'] } },
    { capability: 'write', effect: 'document-edit', supports: context => canonicalMutationTools.some(tool => tool.supports(context)),
      targets: (input, resolver) => toolEffectTargets({ name: 'batch', input }, resolver), handler: (context, input) => context.batch(input.operations) }),
] as const
export function gatewayToolRegistration(name: string) { return gatewayToolRegistrations.find(tool => tool.name === name) }
/** One item owns each current tool's parser, support, effects, targets and actual owner handler. */
export const toolCatalog = [...hostToolCatalog, ...workbenchServiceToolCatalog, ...projectFileRegistrations, ...gatewayToolRegistrations, ...canonicalMutationTools,
  ...officeToolRegistrations, ...materialToolRegistrations, ...htmlActionToolRegistrations, hostArtifactSaveRegistration, pptxImportRegistration]
export const toolRegistrations = [...toolCatalog, ...agentFileRegistrations]
export function toolRegistration(name: string) { return toolRegistrations.find(tool => tool.name === name) }
/** Model and MCP schemas are projected from the actual canonical parsers. */
function describeInput(inputSchema: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(inputSchema, { io: 'input', reused: 'ref' })
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
    name: tool.name, description: tool.name === 'batch' && options ? batchDescription + batchEndDescription : tool.description,
    schema: describeInput(tool.name === 'batch' && options ? batchInputSchemaFor(options.batchMutationNames) : tool.inputSchema),
    manual: structuredClone(tool.manual),
  }))
}
