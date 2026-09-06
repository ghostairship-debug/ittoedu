import { z } from 'zod'
import { workspaceIdentityV1Schema } from './workspaceIdentity'

export const MAX_MATERIAL_TEXT_LENGTH = 2 * 1024 * 1024
export const materialSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), locator: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('file'), locator: z.string().min(1).max(32_767) }).strict(),
])
export const materialInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().min(1).max(MAX_MATERIAL_TEXT_LENGTH),
  source: materialSourceSchema,
}).strict()
export const materialRecordV1Schema = materialInputSchema.extend({
  version: z.literal(1),
  id: z.uuid(),
  workspace: workspaceIdentityV1Schema,
  createdAt: z.number().int().nonnegative(),
}).strict()
export type MaterialInput = z.infer<typeof materialInputSchema>
export type MaterialRecordV1 = z.infer<typeof materialRecordV1Schema>

const workspaceRequest = z.object({ projectId: z.string().min(1).max(200), projectPath: z.string().min(1).max(32_767) }).strict()
export const materialRequestSchema = z.discriminatedUnion('operation', [
  workspaceRequest.extend({ operation: z.literal('search'), query: z.string().max(4096) }).strict(),
  workspaceRequest.extend({ operation: z.literal('import-text'), input: materialInputSchema }).strict(),
  workspaceRequest.extend({ operation: z.literal('import-file') }).strict(),
  workspaceRequest.extend({ operation: z.literal('locate'), id: z.uuid() }).strict(),
  workspaceRequest.extend({ operation: z.literal('delete'), id: z.uuid() }).strict(),
  workspaceRequest.extend({ operation: z.literal('clear') }).strict(),
])
export type MaterialRequest = z.infer<typeof materialRequestSchema>

/** The text and locator become ordinary visible course text, independent of this cache. */
export function materialCitationText(material: MaterialRecordV1): string {
  const parsed = materialRecordV1Schema.parse(material)
  return `${parsed.text}\n\n来源：${parsed.title}（${parsed.source.locator}）`
}
