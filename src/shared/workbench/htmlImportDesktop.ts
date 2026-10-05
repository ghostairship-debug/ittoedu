import { z } from 'zod'
import type { DocumentOperationResult } from './document'

const id = z.string().min(1).max(512)
const filePath = z.string().min(1).max(32767)

/** Both UI entry points use this single host-owned operation. */
export const htmlImportDesktopRequestSchema = z.object({
  documentId: id,
  epoch: id,
  revision: z.number().int().nonnegative(),
  surfaceId: id,
  anchorInstanceId: id.optional(),
  stateId: id.nullable().optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('file'), path: filePath }).strict(),
    z.object({ kind: z.literal('choose') }).strict(),
  ]),
}).strict()

export type HtmlImportDesktopRequest = z.infer<typeof htmlImportDesktopRequestSchema>
export interface HtmlImportDesktopResult {
  operationId: string
  runId: string
  receipt: DocumentOperationResult
  notices: string[]
}
export interface HtmlImportDesktopAPI {
  import(input: HtmlImportDesktopRequest): Promise<HtmlImportDesktopResult | null>
}
