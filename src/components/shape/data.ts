import { z } from 'zod'

// Professional author data only. Identity and placement belong to the V10 instance.
const point = z.tuple([z.number().finite(), z.number().finite()])
const opacity = z.number().min(0).max(1)
export const shapePathCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), to: point }),
  z.object({ kind: z.literal('line'), to: point }),
  z.object({ kind: z.literal('quadratic'), control: point, to: point }),
  z.object({ kind: z.literal('cubic'), control1: point, control2: point, to: point }),
  z.object({ kind: z.literal('close') }),
])
export const shapePathSchema = z.object({
  paths: z.array(z.object({ fill: z.boolean(), stroke: z.boolean(), commands: z.array(shapePathCommandSchema) })),
})
export const shapeLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('straight'), start: point, end: point }),
  z.object({ kind: z.literal('elbow'), start: point, end: point,
    axis: z.enum(['horizontal', 'vertical']), position: z.number().finite() }),
])
const arrow = z.enum(['none', 'triangle', 'stealth', 'circle', 'diamond'])
export const shapeStyleSchema = z.object({
  fillColor: z.string(), fillOpacity: opacity,
  fillGradient: z.object({ kind: z.literal('linear'), start: point, end: point,
    stops: z.array(z.object({ offset: opacity, color: z.string(), opacity })) }).optional(),
  borderColor: z.string(), borderOpacity: opacity, borderWidth: z.number().finite().nonnegative(),
  lineStyle: z.enum(['solid', 'dashed', 'dotted']), cornerRadius: z.number().finite().nonnegative(),
  startArrow: arrow, endArrow: arrow,
})
export const shapeDataSchema = z.object({
  shapeType: z.enum([
    'rectangle', 'rounded-rectangle', 'ellipse', 'triangle', 'diamond', 'line',
    'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'arrow-left-right', 'elbow-arrow',
    'brace-left', 'brace-right', 'brace-top', 'brace-bottom', 'brace-pair-horizontal',
    'brace-pair-vertical', 'bracket-left', 'bracket-right', 'emphasis-dot', 'emphasis-triangle',
  ]),
  pathGeometry: shapePathSchema.optional(),
  lineGeometry: shapeLineSchema.optional(),
  braceGeometry: z.object({ curvatureRatio: z.number().finite().nonnegative(), midpoint: opacity }).optional(),
  style: shapeStyleSchema,
})
export type ShapeData = z.infer<typeof shapeDataSchema>
export type ShapePath = z.infer<typeof shapePathSchema>
export type ShapeLine = z.infer<typeof shapeLineSchema>
export type ShapeStyle = z.infer<typeof shapeStyleSchema>

export function defaultShapeData(shapeType: ShapeData['shapeType'] = 'rectangle'): ShapeData {
  return { shapeType, style: {
    fillColor: '#ffffff', fillOpacity: 1, borderColor: '#222222', borderOpacity: 1,
    borderWidth: 2, lineStyle: 'solid', cornerRadius: 12, startArrow: 'none', endArrow: 'none',
  } }
}
