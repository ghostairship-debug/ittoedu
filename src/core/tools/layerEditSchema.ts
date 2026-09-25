import { z } from 'zod'

export const layerPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('front') }).strict(),
  z.object({ kind: z.literal('back') }).strict(),
  z.object({ kind: z.literal('before'), siblingId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('after'), siblingId: z.string().min(1) }).strict(),
])
export const layerPlacementSchema = z.object({ side: z.enum(['right', 'left', 'above', 'below']), gap: z.number().finite().min(0) }).strict()
export const layerAlignModeSchema = z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom'])
export const layerDistributeAxisSchema = z.enum(['horizontal', 'vertical'])
