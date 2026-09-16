import { z } from 'zod'
export const flowDocumentRecoveryTargetSchema = z.object({
  projectId: z.string().min(1).max(240),
  surfaceId: z.string().min(1).max(240),
  projectPath: z.string().min(1).max(32768).nullable(),
  epoch: z.union([z.string().min(1).max(240), z.number().int().nonnegative()]),
}).strict()
const diagnostic = z.object({ message: z.string(), offset: z.number(), endOffset: z.number(), line: z.number(), column: z.number(), path: z.array(z.union([z.string(), z.number()])).optional() }).strict()
export const flowDocumentRecoverySchema = flowDocumentRecoveryTargetSchema.extend({ revision: z.number().int().nonnegative(), source: z.string().max(16 * 1024 * 1024), diagnostics: z.array(diagnostic).max(10000), composing: z.boolean() }).strict()
export type FlowDocumentRecoveryIdentity = z.infer<typeof flowDocumentRecoveryTargetSchema>
export type FlowDocumentRecoveryRecord = z.infer<typeof flowDocumentRecoverySchema>
export interface FlowDocumentRecoveryAPI {
  read(target: FlowDocumentRecoveryIdentity): Promise<FlowDocumentRecoveryRecord | null>
  write(record: FlowDocumentRecoveryRecord): Promise<void>
  clear(target: FlowDocumentRecoveryIdentity): Promise<void>
}
/** Project paths originate at the desktop file owner; normalize Windows lexical aliases. */
export function normalizedFlowRecoveryPath(value: string): string {
  const path = value.replace(/\\/g, '/')
  const prefix = path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length > 0 && !parts.at(-1)!.endsWith(':')) parts.pop()
    else if (part !== '..') parts.push(part)
  }
  return `${prefix}${parts.join('/')}`.toLowerCase()
}
export function flowRecoveryStorageIdentity(target: Pick<FlowDocumentRecoveryIdentity, 'projectId' | 'surfaceId' | 'projectPath'>): string {
  return JSON.stringify([target.projectId, target.surfaceId, target.projectPath === null ? `unsaved:${target.projectId}` : normalizedFlowRecoveryPath(target.projectPath)])
}
