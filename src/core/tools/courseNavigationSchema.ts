import { z } from 'zod'
const title = z.string().trim().min(1).max(120)
export const courseNavigationInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('add-surface'), surfaceType: z.enum(['slide', 'flow', 'spatial-2d']), title: title.optional() }).strict(),
  z.object({ operation: z.literal('rename-location'), title }).strict(),
  z.object({ operation: z.literal('delete-location') }).strict(),
  z.object({ operation: z.literal('reorder-surfaces'), surfaceIds: z.array(z.string().min(1)).min(1) }).strict(),
])
