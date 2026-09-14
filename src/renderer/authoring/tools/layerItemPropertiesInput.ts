import { z } from 'zod'

const coordinate = z.number().finite()
/** Shared wrapper fields still commit through patchEffectiveLayerPropertiesAtTarget. */
export const layerItemPropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
}).strict()

/** Flow-only coordinate semantics; other carriers keep the shared strict input. */
export const nativeLayerItemPropertiesInputSchema = layerItemPropertiesInputSchema.extend({
  paperSpace: z.enum(['paper', 'viewport']).optional(),
}).strict()
