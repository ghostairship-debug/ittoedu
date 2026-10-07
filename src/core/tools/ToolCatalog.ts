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
import { objectUpdateInputSchema, objectConvertInputSchema } from './toolSchemas'
import { coursePresentationInputSchema } from './coursePresentationEdits'
import { componentFrameSchema } from '../../shared/contracts/component-platform/schema'
import { handleToolTarget, hasRunDocument, hasRunWrite, projectToolTarget, registeredEffectNames,
  toolRegistrationFor, type ResolvedToolTarget, type RunToolScope, type ToolFamily, type ToolSupportContext, type ToolTargetResolver } from './ToolRegistration'
export { toolFamilies } from './ToolRegistration'
export type { RunToolScope, ToolFamily } from './ToolRegistration'

const target = z.string().min(1).max(100)
const imageFitSchema = nativeContentInputSchemaByType.image.shape.fit
const mediaApplyInputSchema = z.union([
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
    inputSchema: z.object({ target: target.optional().describe('省略时使用本次文字卡由宿主固定的默认目标；其它任务必须提供。'), content: z.string(), format: z.enum(['text', 'html']).optional() }).strict(), manual: { label: '替换正文', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance'] } },
  { capability: 'write', effect: 'document-edit', supports: context => hasRunWrite(context, ['markdown-range', 'html-author-field', 'course-instance']), targets: (input, resolver) => input.target ? handleToolTarget({ target: input.target }, resolver) : undefined,
    handler: (context, input) => context.mutate({ name: 'text.replace', input }) }),
  registerCanonical({ name: 'object.update', description: '修改获授权整对象的公开属性。使用 target 句柄，或使用 project.list/read 返回的对象 path；project 可选。data/style 只修改提供字段，省略字段和人工位置保持；专业 appearance/style 等子记录可局部修改，数组和正文仍使用该字段完整值。implementation 是实例源码覆盖或 null 恢复默认，不能充当专业类型转换；frame 可局部调位置尺寸。文字范围授权不能扩大为整对象。',
    inputSchema: objectUpdateInputSchema, manual: { label: '修改属性', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.update', input }) }),
  registerCanonical({ name: 'media.apply', description: 'resource 使用宿主图片资源；asset 只读引用当前文档已有图片句柄。Project V10 的整张专业图片可原位替换，保留身份、frame、专业效果与未指定字段；可用于当前元素授权范围。',
    inputSchema: mediaApplyInputSchema, manual: { label: '替换媒体', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'media', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'media.apply', input }) }),
  registerCanonical({ name: 'media.insert', description: '把已准备的本任务图片资源插入已授权页面；软件登记资源和组件身份。frame 可省略，由宿主按图片比例放置；插入和撤销均经过正式文档事务。',
    inputSchema: z.object({ target, resource: z.string().min(1), fit: imageFitSchema.optional(), frame: componentFrameSchema.optional() }).strict(),
    manual: { label: '插入图片', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'media', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'media.insert', input }) }),
  registerCanonical({ name: 'object.convert', description: '将当前表格转换为可编辑专业图表，保留对象身份、位置、样式和其它对象。用已观察的 target 或 path，to=chart；chartType 可选 bar/line/area/pie/donut。categoryColumn/valueColumns 按列从1计数，默认首列类别、其余列数值。软件读取当前表格及声明表头、产生图表身份并一次提交；不要求复制原表格数据或内部编号。',
    inputSchema: objectConvertInputSchema, manual: { label: '转换对象类型', group: 'edit', targetKinds: ['course-instance'] } },
  { capability: 'write', effect: 'document-edit', family: 'layout', supports: context => hasRunWrite(context, ['course-instance'], 'course-v10'),
    targets: (input, resolver) => 'target' in input ? handleToolTarget(input, resolver) : projectToolTarget(input, resolver),
    handler: (context, input) => context.mutate({ name: 'object.convert', input }) }),
  registerCanonical({ name: 'presentation.update', description: '修改已授权演示页的命名状态：add、rename、duplicate、delete、set-initial、set-thumbnail、clear-overrides。target为页面句柄；state使用当前读取到的状态名称或身份，初始/缩略图可用null恢复母版。软件生成新状态身份；复制保留覆盖、顺序和背景，清除只作用于指定状态，一次事务可撤销。',
    inputSchema: coursePresentationInputSchema, manual: { label: '修改演示状态', group: 'edit', targetKinds: ['course-surface'] } },
  { capability: 'write', effect: 'document-edit', family: 'navigation', supports: context => hasRunWrite(context, ['course-surface'], 'course-v10'), targets: handleToolTarget,
    handler: (context, input) => context.mutate({ name: 'presentation.update', input }) }),
] as const
export const projectApplyTool = projectFileRegistrations.find(tool => tool.name === 'project.apply')!
export const canonicalToolRegistrations = [...canonicalMutationTools]
export function canonicalToolRegistration(name: string) { return canonicalToolRegistrations.find(tool => tool.name === name) }
const mutationSchemas = [canonicalMutationTools[0].callSchema, canonicalMutationTools[1].callSchema, canonicalMutationTools[2].callSchema, canonicalMutationTools[3].callSchema, canonicalMutationTools[4].callSchema, canonicalMutationTools[5].callSchema] as const
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
const page = { target, cursor: z.string().min(1).optional(), limit: z.number().int().min(1).optional() }
const readableKinds: ToolDefinition['manual']['targetKinds'] = ['document', 'markdown-range', 'html-author-field', 'course-instance', 'course-surface', 'course-asset']
/** These callbacks bind the existing Gateway readers, service owners and single batch transaction. */
export interface GatewayToolHandlers {
  readTarget(name: 'read' | 'inspect' | 'listChildren', input: { target: string; cursor?: string; limit?: number }): Promise<ToolResult>
  readSkill(input: unknown): Promise<ToolResult>
  listSkills(input: unknown): Promise<ToolResult>
  observe(input: unknown): Promise<ToolResult>
  deliverDocument(name: 'file.save' | 'document.export', input: unknown): Promise<ToolResult>
  batch(operations: BatchMutationCall[]): Promise<ToolResult>
}
const registerGateway = toolRegistrationFor<GatewayToolHandlers>()
export const gatewayToolRegistrations = [
  registerGateway({ name: 'read', description: '分页读取目标文字或属性；返回 data.target 是当前内容的新短句柄，后续编辑应使用它。nextCursor 续读仍配原调用的 target；外部修改目标时明确冲突。', inputSchema: z.object(page).strict(), manual: { label: '读取', group: 'read', targetKinds: readableKinds } },
    { capability: 'read', effect: null, supports: context => hasRunDocument(context), targets: handleToolTarget,
      handler: (context, input) => context.readTarget('read', input) }),
  registerGateway({ name: 'inspect', description: '读取目标类型、可用操作及小范围摘要；返回 data.target 是当前内容的新短句柄，后续编辑应使用它；外部修改目标时明确冲突。', inputSchema: z.object({ target }).strict(), manual: { label: '检查目标', group: 'read', targetKinds: readableKinds } },
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
  registerGateway({ name: 'batch', description: batchDescription + batchEndDescription, inputSchema: batchInputSchema, manual: { label: '批量修改', group: 'edit', targetKinds: ['markdown-range', 'html-author-field', 'course-instance'] } },
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
  const schema = z.toJSONSchema(inputSchema)
  const variants = schema.oneOf ?? schema.anyOf
  if (schema.type === undefined && Array.isArray(variants)
    && variants.every(variant => variant && typeof variant === 'object' && variant.type === 'object')) schema.type = 'object'
  return schema
}
export function describeTools(names?: readonly string[], options?: { batchMutationNames: readonly string[]; compactBatch?: boolean }): ToolDefinition[] {
  return toolCatalog.filter(tool => !names || names.includes(tool.name)).map(tool => ({
    name: tool.name, description: tool.name === 'batch' && options ? batchDescription + batchEndDescription : tool.description,
    schema: describeInput(tool.name === 'batch' && options ? batchInputSchemaFor(options.batchMutationNames) : tool.inputSchema),
    manual: structuredClone(tool.manual),
  }))
}
