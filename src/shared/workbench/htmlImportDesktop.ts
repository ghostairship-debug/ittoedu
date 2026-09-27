import { z } from 'zod'
import type { DocumentOperationResult } from './document'

const id = z.string().min(1).max(512)
const filePath = z.string().min(1).max(32767)

/** Both UI entry points use this single host-owned operation. Flow is not yet a supported target. */
export const htmlImportDesktopRequestSchema = z.object({
  documentId: id,
  epoch: id,
  revision: z.number().int().nonnegative(),
  locationId: id,
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
}
export interface HtmlImportDesktopAPI {
  import(input: HtmlImportDesktopRequest): Promise<HtmlImportDesktopResult | null>
}
