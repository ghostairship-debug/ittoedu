import { z } from 'zod'
import type { ConversationHome } from '../../shared/workbench/conversations'
import type { ExecutionPermissionMode } from '../../shared/workbench/executionPermission'
import type { DocumentKind } from '../../shared/workbench/document'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'
import type { OfficeContentToolName } from './OfficeContentTools'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

const path = z.string().min(1).max(32767)
const version = z.string().min(1)
const content = z.string()
const paths = z.array(path).min(1)
export const agentFileSchemas = {
  'file.list': z.object({ path: path.optional(), cursor: z.string().uuid().optional(), limit: z.number().int().min(1).optional() }).strict(),
  'file.search': z.object({ path: path.optional(), cursor: z.string().uuid().optional(), query: z.string().min(1), limit: z.number().int().min(1).optional() }).strict(),
  'file.open': z.object({ path }).strict(),
  'file.observe': z.object({ path, limit: z.number().int().min(1).optional() }).strict(),
  'file.reconcile': z.object({ path, choice: z.enum(['disk', 'local']), expectedVersion: version.nullable().optional() }).strict(),
  'file.create': z.object({ path: path.optional(), name: z.string().min(1), kind: z.enum(['markdown', 'text', 'html', 'course-v10']).optional() }).strict(),
  'file.read': z.object({ path, cursor: z.string().min(1).optional(), limit: z.number().int().min(1).optional() }).strict(),
  'file.grep': z.object({ path: path.optional(), query: z.string().min(1), cursor: z.string().uuid().optional(), limit: z.number().int().min(1).optional() }).strict(),
  'file.write': z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('create'), path, content }).strict(),
    z.object({ mode: z.literal('replace'), path, content, expectedVersion: version.optional() }).strict(),
  ]),
  'file.patch': z.object({ path, expectedVersion: version.optional(), oldText: z.string().min(1), newText: content,
    range: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).strict().optional() }).strict(),
  'file.mkdir': z.object({ path: path.optional(), name: z.string().min(1) }).strict(),
  'file.copy': z.object({ sources: paths, destination: path, sourceVersion: z.enum(['disk', 'current']).optional(), flushFirst: z.boolean().optional() }).strict(),
  'file.move': z.object({ sources: paths, destination: path }).strict(),
  'file.rename': z.object({ path, name: z.string().min(1) }).strict(),
  'file.trash': z.object({ paths }).strict(),
} as const
export type AgentFileToolName = keyof typeof agentFileSchemas
const fileCapabilities = {
  'file.list': 'read', 'file.search': 'read', 'file.open': 'read', 'file.observe': 'read', 'file.reconcile': 'write', 'file.create': 'write', 'file.read': 'read', 'file.grep': 'read',
  'file.write': 'write', 'file.patch': 'write', 'file.mkdir': 'write', 'file.copy': 'write', 'file.move': 'write', 'file.rename': 'write', 'file.trash': 'write',
} as const satisfies Record<AgentFileToolName, 'read' | 'write'>
export type AgentFileMutationName = { [Name in AgentFileToolName]: typeof fileCapabilities[Name] extends 'write' ? Name : never }[AgentFileToolName]
export const isAgentFileTool = (name: string): name is AgentFileToolName => Object.hasOwn(agentFileSchemas, name)
const fileDescriptors = (Object.keys(agentFileSchemas) as AgentFileToolName[]).map(name => ({
  name,
  description: ({
    'file.list': '列出文件夹内容。path 可用绝对路径或工作空间相对路径；省略时从会话所属位置开始。返回有界列表；截断时用同 path 和返回的 nextCursor 续页，目录变化需重读。',
    'file.search': '按文件名搜索文件夹及子文件夹，返回有界路径列表；截断时用同 path/query 和 nextCursor 继续，不把一页无匹配当整个目录无结果。path 省略时从会话所属位置开始。',
    'file.open': '打开 Markdown、UTF-8 源文件（含 JSON/CSV/代码/无后缀文件）、HTML 或 H5 演示并取得正式文档句柄；已有未保存稿和 History 保留，不执行源代码。二进制与办公压缩格式需相应入口。当前任务权限决定可否修改。',
    'file.observe': '比较正式文档当前稿与磁盘版本，返回真实版本差异、可选处理及正文片段；软件固定本次比较的文档、当前位置与版本。limit 可扩大文本显示范围，不执行源文件。file.read 仍读当前稿。外部修改造成保存冲突时，先查看此比较，再用 file.reconcile 采纳磁盘或保留当前稿。',
    'file.reconcile': '处理 file.observe 已比较的文件变化。choice=disk 采纳磁盘内容，保留正式撤回历史；choice=local 保留当前稿，并允许后续 file.save 保存覆盖刚比较的磁盘版本。软件沿用同任务最近比较的版本，无需抄文档 ID；expectedVersion 可省略，提供时必须与该比较一致。只协调当前文档，未执行保存。正文、文件位置或磁盘再次变化时重新比较；只读权限不能执行。',
    'file.create': '新建并打开正式文档。kind 可省略，按扩展名自动识别；kind=text 适用任意 UTF-8 数据/源文件（.json/.csv/.svg/.xml/.yaml/代码/无后缀），.md、.h5lesson 和二进制扩展名不可用此 kind。已有完整内容用 file.write mode=create 写入保存。path 省略时放在会话所属文件夹。',
    'file.read': '读取磁盘/工作区路径上的普通 UTF-8 文件，不读取 project.list 返回的工程虚拟路径；已打开时读取未保存稿。整份回读可给 limit=64000。续页将回执的 nextCursor 传给 cursor，不使用 offset；修改后旧游标失效，应省略 cursor 从当前版本重新读取。',
    'file.grep': '按字面量搜索文件或目录内的 UTF-8 正文，返回行、列、上下文及实际扫描/排除/失败范围；截断时用 cursor 续读。',
    'file.write': '直接写入完整普通 UTF-8 内容（含 Markdown、HTML 和代码）。mode=create 新建并保存文件，要求路径不存在，无需先 file.create。mode=replace 覆盖文件当前内容，无需先 file.read；如携带 expectedVersion 则校验版本一致后再写入，不一致时报版本冲突。替换已打开文件只提交文档事务，不自动保存。以返回的 saved 确认落盘。',
    'file.patch': '按唯一 oldText 或明确 range 局部修改 UTF-8 文件，expectedVersion 可省略；提供时仍校验版本。原文不存在、匹配不唯一或版本冲突时，先读当前内容修正，勿重复旧补丁。已打开文件只提交文档事务。',
    'file.mkdir': '在工作空间或已明确授权的位置新建文件夹，目标已存在时失败。',
    'file.copy': '把 sources 复制到 destination 文件夹，逐项返回成功或失败；不默认覆盖。sourceVersion=disk（默认）复制磁盘版本，未保存的源在 outcome 标记 copied=disk-version；sourceVersion=current 序列化当前已提交的编辑草稿，源文件保持未保存，不先保存源文件。flushFirst=true 等价 current。',
    'file.move': '把 sources 移动到 destination 文件夹，已打开文档的路径绑定由宿主协调；逐项返回结果。',
    'file.rename': '重命名文件或文件夹，已打开文档的路径绑定由宿主协调；不默认覆盖。',
    'file.trash': '把指定文件或文件夹移入系统回收站；逐项返回结果，不永久删除。',
  })[name],
  inputSchema: agentFileSchemas[name],
}))

export interface AgentFileToolHandler {
  /** Engine retains file preflight, opened-document attachment and the existing physical writer. */
  execute(name: AgentFileToolName, input: unknown): Promise<ToolResult>
}
const registerFile = toolRegistrationFor<AgentFileToolHandler>()
export const agentFileRegistrations = fileDescriptors.map(tool => registerFile({ ...tool,
  manual: { label: tool.name, group: fileCapabilities[tool.name] === 'read' ? 'read' : 'edit', targetKinds: [] },
}, {
  capability: fileCapabilities[tool.name], effect: fileCapabilities[tool.name] === 'write' ? 'file-write' : null,
  supports: context => context.files === true,
  // Physical paths come from the existing file preflight, rather than model-supplied document identities.
  targets: () => undefined,
  handler: (context, input) => context.execute(tool.name, input),
}))
export function agentFileRegistration(name: string) { return agentFileRegistrations.find(tool => tool.name === name) }
export const isAgentFileMutation = (name: string): name is AgentFileMutationName => agentFileRegistration(name)?.capability === 'write'
export const agentFileMutationNames: readonly AgentFileMutationName[] = agentFileRegistrations.map(tool => tool.name).filter(isAgentFileMutation)
export const agentFileTools = agentFileRegistrations.map(tool => ({ name: tool.name, description: tool.description,
  // Every file tool takes an object, including the create/replace union.
  inputSchema: { ...(z.toJSONSchema(tool.inputSchema) as ModelJsonObject), type: 'object' },
}))

export interface AgentFileContext {
  runId: string
  workspaceRoot: string
  conversationHomeRoot?: string
  conversationHome?: ConversationHome
  permission: ExecutionPermissionMode
  approvedOutsideDirectory?: string
  /** Explicit, run-frozen outside read grants. These never authorize writes. */
  readOnlyRoots?: readonly string[]
  /** Exact outside paths approved for this one mutation after host preflight. */
  approvedOutsidePaths?: readonly string[]
  /** Main-owned stop barrier, checked again immediately before a physical or document commit. */
  assertActive?: () => void
}
export interface AgentFileOutcome {
  data: unknown
  opened?: { documentId: string; kind: DocumentKind; name: string; writable: boolean }
}
export interface AgentFileService {
  releaseRun?(runId: string): void
  preflightCreate(context: AgentFileContext, input: unknown): Promise<{ directory: string; outside: boolean }>
  preflightMutation(context: AgentFileContext, name: AgentFileMutationName, input: unknown): Promise<{ paths: string[]; outside: boolean }>
  execute(context: AgentFileContext, name: AgentFileToolName, input: unknown, operationId: string): Promise<AgentFileOutcome>
  preflightOffice?(context: AgentFileContext, name: OfficeContentToolName, input: unknown): Promise<{ paths: string[]; outside: boolean }>
  executeOffice?(context: AgentFileContext, name: OfficeContentToolName, input: unknown, operationId: string): Promise<AgentFileOutcome>
}
export class AgentFileOutcomeUnknown extends Error {}
