import { z } from 'zod'
import { componentImplementationSchema, jsonValueSchema } from '../../shared/contracts/component-platform/schema'

const coordinate = z.number().finite()
/** Public component properties; the Gateway emits canonical ComponentEdit operations. */
export const objectUpdatePropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
  data: jsonValueSchema.describe('Only supplied data properties change; omitted properties are preserved. Professional appearance, sizing, style, crop, feather, filters and poster records accept partial properties. Arrays and content values use their existing complete-value format.').optional(),
  style: z.record(z.string(), jsonValueSchema).describe('Only supplied style properties change; omitted properties are preserved. Use null to explicitly clear a CSS value.').optional(),
  implementation: componentImplementationSchema.nullable().optional(),
}).strict()

/** Paths bind the observed project file to its formal instance inside the Gateway. */
export const objectUpdateInputSchema = z.union([
  z.object({ target: z.string().min(1).max(100), properties: objectUpdatePropertiesInputSchema }).strict(),
  z.object({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1).max(500),
    properties: objectUpdatePropertiesInputSchema }).strict(),
])

export const objectConvertOptionsInputSchema = z.object({
  to: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(),
  title: z.string().optional(),
  categoryColumn: z.number().int().positive().describe('Category column, counted from 1. Defaults to the first column.').optional(),
  valueColumns: z.array(z.number().int().positive()).min(1).describe('Numeric series columns, counted from 1. Defaults to all columns except the category column.').optional(),
}).strict()
export const objectConvertInputSchema = z.union([
  objectConvertOptionsInputSchema.extend({ target: z.string().min(1).max(100) }).strict(),
  objectConvertOptionsInputSchema.extend({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1).max(500) }).strict(),
])
