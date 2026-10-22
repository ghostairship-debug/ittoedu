import { z } from 'zod'
import type { LayerItem } from '../courseProjectTypes'
import type { AssetMeta } from '../contracts/media-v1/types'
import type { InteractionRule } from '../contracts/interaction-v1/types'
import type { SoundDefinition } from '../contracts/media-v1/types'
import type { DocumentModel } from './document'

export interface PptxImportIssue { page?: number; type: string; message: string }
export interface PptxSlideDraft { title: string; interactions?: InteractionRule[]; backgroundColor: string; items: LayerItem[]; sourcePage?: number; sharedKeys?: string[] }
export interface PptxImportDraft { slides: PptxSlideDraft[]; sounds?: Record<string, SoundDefinition>; assets: Array<{ readonly meta: AssetMeta; readonly bytes: Uint8Array }>; notes: string[]; issues: PptxImportIssue[]; shared?: { key: string; items: LayerItem[] }[] }
export interface PreparedPptxCourse { model: Extract<DocumentModel, { kind: 'course-v10' }>; suggestedName: string; issues: readonly PptxImportIssue[] }

const common = { requestId: z.uuid(), bytes: z.custom<Uint8Array>(value => value instanceof Uint8Array), filename: z.string().min(1) }
export const pptxImportBuildSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('course') }).strict(),
  z.object({ ...common, mode: z.literal('draft'), canvas: z.object({ width: z.number().finite().positive(), height: z.number().finite().positive() }).strict() }).strict(),
])
export type PptxImportBuildInput = z.infer<typeof pptxImportBuildSchema>
export const pptxImportCancelSchema = z.object({ requestId: z.uuid() }).strict()
export type PptxImportBuildResult = { mode: 'course'; course: PreparedPptxCourse } | { mode: 'draft'; draft: PptxImportDraft }
export type PptxImportConversionInput = PptxImportBuildInput
export type PptxImportConversionReply =
  | ({ requestId: string; status: 'converted' } & PptxImportBuildResult)
  | { requestId: string; status: 'failed'; reason: string }
