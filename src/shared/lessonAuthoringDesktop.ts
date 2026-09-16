import { parse } from 'acorn'
import { z } from 'zod'
import { lessonIdentitySchema, lessonRelativePathSchema } from './lessonWorkspace'
import { localAgentIdSchema } from './localAgentContract'
import { lessonAuthoringMaterialSelectionSchema, lessonDocumentVersionSchema, lessonAuthoringTicketSchema, type LessonAuthoringView, type LessonAuthoringTicket } from './lessonAuthoring'
import { lessonDocumentRoleSchema } from './lessonWorkspace'
export const lessonBuildTargetSchema = z.object({ projectId: z.string().min(1), revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative() }).strict()
export type LessonBuildTarget = z.infer<typeof lessonBuildTargetSchema>
export const lessonBuildFailureSchema = z.object({ target: lessonBuildTargetSchema.optional(), committedStepCount: z.number().int().nonnegative(),
  message: z.string().max(20000).optional(), tool: z.string().max(200).optional(), diagnostics: z.array(z.unknown()).max(100).optional() }).strict()
export type LessonBuildFailure = z.infer<typeof lessonBuildFailureSchema>
const context = { lesson: lessonIdentitySchema, conversationId: z.uuid() }
export const lessonAuthoringDesktopRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read'), ...context }).strict(),
  z.object({ operation: z.literal('validate'), ...context, ticket: lessonAuthoringTicketSchema }).strict(),
  z.object({ operation: z.literal('read-asset'), ...context, ticket: lessonAuthoringTicketSchema, relativePath: lessonRelativePathSchema }).strict(),
  z.object({ operation: z.literal('set-mode'), ...context, mode: z.enum(['manual', 'automatic']), materials: z.array(lessonAuthoringMaterialSelectionSchema).default([]) }).strict(),
  z.object({ operation: z.literal('confirm'), ...context, role: lessonDocumentRoleSchema, expectedVersion: lessonDocumentVersionSchema }).strict(),
  z.object({ operation: z.literal('start'), ...context, adapter: localAgentIdSchema, instruction: z.string().trim().min(1).max(20000) }).strict(),
  z.object({ operation: z.literal('poll'), ...context }).strict(),
  z.object({ operation: z.literal('stop'), ...context }).strict(),
  z.object({ operation: z.literal('begin-document-repair'), ...context, role: lessonDocumentRoleSchema }).strict(),
  z.object({ operation: z.literal('cancel-document-repair'), ...context, ticketId: z.uuid() }).strict(),
  z.object({ operation: z.literal('complete-document-repair'), ...context, ticket: lessonAuthoringTicketSchema, expectedVersion: lessonDocumentVersionSchema }).strict(),
  z.object({ operation: z.literal('reprepare-existing-build'), ...context }).strict(),
  z.object({ operation: z.literal('repair-build'), ...context, ticketId: z.uuid(), instruction: z.string().trim().min(1).max(20000), currentTarget: lessonBuildTargetSchema }).strict(),
  z.object({ operation: z.literal('begin-application'), ...context, ticketId: z.uuid(), currentTarget: lessonBuildTargetSchema.optional() }).strict(),
  z.object({ operation: z.literal('fail-application'), ...context, ticketId: z.uuid(), hasCommittedChanges: z.boolean(), failure: lessonBuildFailureSchema.optional() }).strict(),
  z.object({ operation: z.literal('continue-application'), ...context, ticketId: z.uuid(), currentTarget: lessonBuildTargetSchema.optional() }).strict(),
  z.object({ operation: z.literal('accept-build'), ...context, ticketId: z.uuid(), projectPath: z.string().min(1) }).strict(),
])
export type LessonAuthoringDesktopRequest = z.input<typeof lessonAuthoringDesktopRequestSchema>
export interface LessonAssemblyInput {
  expectedInitialTarget?: LessonBuildTarget
  resumeTarget?: LessonBuildTarget
  ticket: LessonAuthoringTicket
  modulePath: string
  moduleSource: string
  documents: { teachingPlan: { path: string; content: string }; presentationScript: { path: string; content: string } }
}
export interface LessonAuthoringDesktopResult {
  view: LessonAuthoringView
  run?: { ticketId: string; stage: LessonAuthoringTicket['stage']; sessionId: string; status: 'running' | 'waiting-confirmation' | 'ready-to-build' | 'completed' | 'failed' | 'stopped'; message: string }
  failure?: LessonBuildFailure
  repairTarget?: LessonBuildTarget
  repairTicket?: LessonAuthoringTicket
  application?: 'applying' | 'retryable' | 'has-changes'
  assembly?: LessonAssemblyInput
  validation?: { allowed: boolean; issues: string[] }
  asset?: Uint8Array
  projectPath?: string
}
export type LessonAuthoringDesktopOperation = (request: LessonAuthoringDesktopRequest) => Promise<LessonAuthoringDesktopResult>

/** Builder modules receive a bounded product API; module dependencies are supplied by the host. */
export function validateLessonBuilderModule(source: string): void {
  const syntax = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    const value = node as Record<string, unknown>
    if (value.type === 'ImportDeclaration' || value.type === 'ImportExpression' || ((value.type === 'ExportNamedDeclaration' || value.type === 'ExportAllDeclaration') && value.source)) throw new Error('构建模块只能使用产品注入的 API，不能导入其他模块')
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child)
  }
  visit(syntax)
}
