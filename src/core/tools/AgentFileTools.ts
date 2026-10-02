import { z } from 'zod'
import type { ConversationHome } from '../../shared/workbench/conversations'
import type { ExecutionPermissionMode } from '../../shared/workbench/executionPermission'
import type { DocumentKind } from '../../shared/workbench/document'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'

const path = z.string().min(1).max(32767)
const version = z.string().min(1).max(256)
const content = z.string().max(4_000_000)
const paths = z.array(path).min(1).max(100)
export const agentFileSchemas = {
  'file.list': z.object({ path: path.optional(), cursor: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'file.search': z.object({ path: path.optional(), cursor: z.string().uuid().optional(), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'file.open': z.object({ path }).strict(),
  'file.create': z.object({ path: path.optional(), name: z.string().min(1).max(200), kind: z.enum(['markdown', 'text', 'html', 'course-v9']).optional() }).strict(),
  'file.read': z.object({ path, cursor: z.string().min(1).max(128).optional(), limit: z.number().int().min(1).max(64_000).optional() }).strict(),
  'file.grep': z.object({ path: path.optional(), query: z.string().min(1).max(500), cursor: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'file.write': z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('create'), path, content }).strict(),
    z.object({ mode: z.literal('replace'), path, content, expectedVersion: version.optional() }).strict(),
  ]),
  'file.patch': z.object({ path, expectedVersion: version.optional(), oldText: z.string().min(1).max(200_000), newText: content,
    range: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).strict().optional() }).strict(),
  'file.mkdir': z.object({ path: path.optional(), name: z.string().min(1).max(200) }).strict(),
  'file.copy': z.object({ sources: paths, destination: path, flushFirst: z.boolean().optional() }).strict(),
  'file.move': z.object({ sources: paths, destination: path }).strict(),
  'file.rename': z.object({ path, name: z.string().min(1).max(200) }).strict(),
  'file.trash': z.object({ paths }).strict(),
} as const
export type AgentFileToolName = keyof typeof agentFileSchemas
export type AgentFileMutationName = Extract<AgentFileToolName, 'file.create' | 'file.write' | 'file.patch' | 'file.mkdir' | 'file.copy' | 'file.move' | 'file.rename' | 'file.trash'>
export const agentFileMutationNames: readonly AgentFileMutationName[] = ['file.create', 'file.write', 'file.patch', 'file.mkdir', 'file.copy', 'file.move', 'file.rename', 'file.trash']
export const isAgentFileTool = (name: string): name is AgentFileToolName => Object.hasOwn(agentFileSchemas, name)
export const agentFileTools = (Object.keys(agentFileSchemas) as AgentFileToolName[]).map(name => ({
  name,
  description: ({
    'file.list': '列出文件夹内容。path 可用绝对路径或工作空间相对路径；省略时从会话所属位置开始。返回有界列表；截断时用同 path 和返回的 nextCursor 续页，目录变化需重读。',
    'file.search': '按文件名搜索文件夹及子文件夹，返回有界路径列表；截断时用同 path/query 和 nextCursor 继续，不把一页无匹配当整个目录无结果。path 省略时从会话所属位置开始。',
    'file.open': '打开 Markdown、UTF-8 源文件（含 JSON/CSV/代码/无后缀文件）、HTML 或 H5 演示并取得正式文档句柄；已有未保存稿和 History 保留，不执行源代码。二进制与办公压缩格式需相应入口。当前任务权限决定可否修改。',
    'file.create': '新建并打开正式文档。kind 可省略，按扩展名自动识别；kind=text 适用任意 UTF-8 数据/源文件（.json/.csv/.svg/.xml/.yaml/代码/无后缀），.md、.h5lesson 和二进制扩展名不可用此 kind。已有完整内容用 file.write mode=create 写入保存。path 省略时放在会话所属文件夹。',
    'file.read': '读取普通 UTF-8 文件的当前内容；已打开时读取未保存稿。整份回读可给 limit=64000。续页将回执的 nextCursor 传给 cursor；修改后旧游标失效，应省略 cursor 从当前版本重新读取。',
    'file.grep': '按字面量搜索文件或目录内的 UTF-8 正文，返回行、列、上下文及实际扫描/排除/失败范围；截断时用 cursor 续读。',
    'file.write': '直接写入完整普通 UTF-8 内容（含 Markdown、HTML 和代码）。mode=create 新建并保存文件，要求路径不存在，无需先 file.create。mode=replace 覆盖文件当前内容，无需先 file.read；如携带 expectedVersion 则校验版本一致后再写入，不一致时报版本冲突。替换已打开文件只提交文档事务，不自动保存。以返回的 saved 确认落盘。',
    'file.patch': '按唯一 oldText 或明确 range 局部修改 UTF-8 文件，expectedVersion 可省略；提供时仍校验版本。原文不存在、匹配不唯一或版本冲突时，先读当前内容修正，勿重复旧补丁。已打开文件只提交文档事务。',
    'file.mkdir': '在工作空间或已明确授权的位置新建文件夹，目标已存在时失败。',
    'file.copy': '把 sources 复制到 destination 文件夹，逐项返回成功或失败；不默认覆盖。GUI 打开且未保存的源默认按磁盘版本复制并在 outcome 中标记 copied=disk-version；需要复制当前草稿时显式传 flushFirst=true，模型应自行先 file.save 或接受失败。',
    'file.move': '把 sources 移动到 destination 文件夹，已打开文档的路径绑定由宿主协调；逐项返回结果。',
    'file.rename': '重命名文件或文件夹，已打开文档的路径绑定由宿主协调；不默认覆盖。',
    'file.trash': '把指定文件或文件夹移入系统回收站；逐项返回结果，不永久删除。',
  })[name],
  // Every file tool takes an object, including the create/replace union.
  inputSchema: { ...(z.toJSONSchema(agentFileSchemas[name]) as ModelJsonObject), type: 'object' },
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
}
export class AgentFileOutcomeUnknown extends Error {}
