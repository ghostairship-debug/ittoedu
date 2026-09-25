import { z } from 'zod'
export const documentSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), field: z.enum(['content', 'citation', 'caption', 'title', 'body']) }).strict(),
  z.object({ kind: z.literal('item'), itemId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('header'), columnId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('cell'), rowId: z.string().min(1), columnId: z.string().min(1) }).strict(),
])
