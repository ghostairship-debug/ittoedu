import { z } from 'zod'
import { documentContentSchema } from '../document/content'
import { webCompositionSchema } from '../courseProjectSchema'
import type { CompositionContentEdit, CompositionSingleContentEdit } from './edit'

const nodeId = z.string().min(1).max(240)
const fields = z.record(z.string(), z.string().nullable())
const singleCompositionContentEditSchema: z.ZodType<CompositionSingleContentEdit> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), nodeId, text: z.string() }).strict(),
  z.object({ type: z.literal('attributes'), nodeId, patch: fields }).strict(),
  z.object({ type: z.literal('style'), nodeId, patch: fields }).strict(),
  z.object({ type: z.literal('move'), nodeId, parentId: nodeId, index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('replace'), nodeId, node: z.custom<Extract<CompositionContentEdit, { type: 'replace' }>['node']>(value => webCompositionSchema.safeParse({ root: value, assets: {} }).success) }).strict(),
  z.object({ type: z.literal('remove'), nodeId }).strict(),
  z.object({ type: z.literal('document'), nodeId, content: documentContentSchema }).strict(),
  z.object({ type: z.literal('native'), nodeId, patch: z.record(z.string(), z.unknown()) }).strict(),
])

export const compositionContentEditSchema: z.ZodType<CompositionContentEdit> = z.union([
  singleCompositionContentEditSchema,
  z.object({ type: z.literal('batch'), nodeId, edits: z.array(singleCompositionContentEditSchema).min(1) }).strict(),
])
