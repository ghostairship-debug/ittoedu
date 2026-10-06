import { z } from 'zod'
import { componentImplementationSchema, jsonValueSchema } from '../../shared/contracts/component-platform/schema'

const coordinate = z.number().finite()
/** Public component properties; the Gateway emits canonical ComponentEdit operations. */
export const objectUpdatePropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
  data: jsonValueSchema.optional(),
  style: z.record(z.string(), jsonValueSchema).optional(),
  implementation: componentImplementationSchema.nullable().optional(),
}).strict()

/** Paths bind the observed project file to its formal instance inside the Gateway. */
export const objectUpdateInputSchema = z.union([
  z.object({ target: z.string().min(1).max(100), properties: objectUpdatePropertiesInputSchema }).strict(),
  z.object({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1).max(500),
    properties: objectUpdatePropertiesInputSchema }).strict(),
])
