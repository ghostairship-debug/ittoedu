import { z } from 'zod'

/** Temporary source positions, derived from the committed HTML revision. Never written into the user's HTML. */
export const htmlSourceAddressSchema = z.object({
  kind: z.enum(['document', 'element', 'text', 'stylesheet', 'data']),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
}).strict().refine(value => value.to >= value.from, '源码区间无效')
export type HtmlSourceAddress = z.infer<typeof htmlSourceAddressSchema>

const patch = z.record(z.string().min(1), z.string().nullable())
export const htmlSourceEditLeafCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), target: htmlSourceAddressSchema, text: z.string() }).strict(),
  z.object({ type: z.literal('attributes'), target: htmlSourceAddressSchema, patch }).strict(),
  z.object({ type: z.literal('style'), target: htmlSourceAddressSchema, patch }).strict(),
  z.object({ type: z.literal('stylesheet'), target: htmlSourceAddressSchema, patch }).strict(),
  z.object({ type: z.literal('move'), target: htmlSourceAddressSchema, parent: htmlSourceAddressSchema,
    index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('remove'), target: htmlSourceAddressSchema }).strict(),
  z.object({ type: z.literal('data'), target: htmlSourceAddressSchema,
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])), value: z.json() }).strict(),
])
/** A projection gesture commits its related source operations once; nested batches have no extra meaning. */
export const htmlSourceEditCommandSchema = z.union([htmlSourceEditLeafCommandSchema,
  z.object({ type: z.literal('batch'), commands: z.array(htmlSourceEditLeafCommandSchema).min(1) }).strict(),
])
export type HtmlSourceEditLeafCommand = z.infer<typeof htmlSourceEditLeafCommandSchema>
export type HtmlSourceEditCommand = z.infer<typeof htmlSourceEditCommandSchema>

export type HtmlSourceEditOutcome =
  | { status: 'applied'; revision: number; savedRevision: number | null; dirty: true; reload: true }
  | { status: 'unchanged'; revision: number }
  | { status: 'rejected'; reason: 'stale-epoch' | 'stale-revision' | 'stale-binding' | 'lease-released'
      | 'source-changed' | 'not-editable' | 'conflict'; message?: string }
