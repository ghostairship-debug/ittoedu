import { z } from 'zod'
import { saveDirectoryContextSchema } from './desktop'
import type { DocumentBlock } from '../document/content'
import type { ComponentAsset } from '../contracts/component-platform'

export const flowImportRequestSchema = z.object({ directory: saveDirectoryContextSchema.optional(), sourceEntryId: z.string().min(1).optional() }).strict()
export interface FlowImportResult {
  name: string
  blocks: DocumentBlock[]
  assets: { asset: ComponentAsset; bytes: Uint8Array }[]
  issues: string[]
}
export interface FlowImportDesktopAPI {
  read(input?: z.infer<typeof flowImportRequestSchema>): Promise<FlowImportResult | null>
}
