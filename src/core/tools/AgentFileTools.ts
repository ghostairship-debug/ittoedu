import { z } from 'zod'
import type { ConversationHome } from '../../shared/workbench/conversations'
import type { ExecutionPermissionMode } from '../../shared/workbench/executionPermission'

const path = z.string().min(1).max(32767)
export const agentFileSchemas = {
  'file.list': z.object({ path: path.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'file.search': z.object({ path: path.optional(), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'file.open': z.object({ path }).strict(),
  'file.create': z.object({ path: path.optional(), name: z.string().min(1).max(200), kind: z.enum(['markdown', 'course-v9']).default('markdown') }).strict(),
} as const
export type AgentFileToolName = keyof typeof agentFileSchemas
export const isAgentFileTool = (name: string): name is AgentFileToolName => Object.hasOwn(agentFileSchemas, name)
export const agentFileTools = (Object.keys(agentFileSchemas) as AgentFileToolName[]).map(name => ({
  name,
  description: ({
    'file.list': '列出文件夹内容。path 可用绝对路径或工作空间相对路径；省略时从会话所属位置开始。返回有界列表。',
    'file.search': '按文件名搜索文件夹及子文件夹，返回有界路径列表。path 省略时从会话所属位置开始。',
    'file.open': '打开 Markdown 或 V9 课件并取得当前任务的正式文档句柄；当前任务权限档决定可否修改。',
    'file.create': '通过文件服务新建 Markdown 或 V9 课件，并打开为正式文档。path 省略时放在会话所属文件夹；文件归属取父目录。',
  })[name],
  inputSchema: z.toJSONSchema(agentFileSchemas[name]),
}))

export interface AgentFileContext {
  runId: string
  workspaceRoot: string
  conversationHomeRoot?: string
  conversationHome?: ConversationHome
  permission: ExecutionPermissionMode
  approvedOutsideDirectory?: string
}
export interface AgentFileOutcome {
  data: unknown
  opened?: { documentId: string; kind: 'markdown' | 'course-v9'; name: string; writable: boolean }
}
export interface AgentFileService {
  preflightCreate(context: AgentFileContext, input: unknown): Promise<{ directory: string; outside: boolean }>
  execute(context: AgentFileContext, name: AgentFileToolName, input: unknown, operationId: string): Promise<AgentFileOutcome>
}
export class AgentFileOutcomeUnknown extends Error {}
