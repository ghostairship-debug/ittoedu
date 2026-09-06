import { z } from 'zod'

// Coordinates are fractions of the owning frame. Out-of-frame control points
// are intentional (for example a callout tail); they must not be clamped.
const coordinate = z.number().finite().min(-100).max(100)
const point = z.tuple([coordinate, coordinate])
const unit = z.number().finite().min(0).max(1)

export const nativePathCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), to: point }).strict(),
  z.object({ kind: z.literal('line'), to: point }).strict(),
  z.object({ kind: z.literal('quadratic'), control: point, to: point }).strict(),
  z.object({ kind: z.literal('cubic'), control1: point, control2: point, to: point }).strict(),
  z.object({ kind: z.literal('close') }).strict(),
])

const pathSchema = z.object({
  fill: z.boolean(),
  stroke: z.boolean(),
  commands: z.array(nativePathCommandSchema).min(2).max(4096),
}).strict().superRefine((path, context) => {
  let open = false
  path.commands.forEach((command, index) => {
    if (command.kind === 'move') open = true
    else if (!open) context.addIssue({ code: 'custom', path: ['commands', index], message: '路径必须先 move，再绘制或闭合' })
    if (command.kind === 'close') open = false
  })
})

export const nativePathGeometrySchema = z.object({
  paths: z.array(pathSchema).min(1).max(64),
}).strict()

export const nativeLinearGradientSchema = z.object({
  kind: z.literal('linear'),
  start: point,
  end: point,
  stops: z.array(z.object({
    offset: unit,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: unit,
  }).strict()).min(2).max(64),
}).strict().superRefine((gradient, context) => {
  if (gradient.start[0] === gradient.end[0] && gradient.start[1] === gradient.end[1]) {
    context.addIssue({ code: 'custom', path: ['end'], message: '渐变起点和终点不能相同' })
  }
  gradient.stops.forEach((stop, index) => {
    if (index > 0 && stop.offset < gradient.stops[index - 1].offset) {
      context.addIssue({ code: 'custom', path: ['stops', index, 'offset'], message: '渐变色标必须按位置升序排列' })
    }
  })
})

export type NativePathGeometry = z.infer<typeof nativePathGeometrySchema>
export type NativePathCommand = z.infer<typeof nativePathCommandSchema>
export type NativeLinearGradient = z.infer<typeof nativeLinearGradientSchema>

export const nativeBraceGeometrySchema = z.object({
  curvatureRatio: z.number().finite().min(0).max(100),
  midpoint: unit,
}).strict()
export type NativeBraceGeometry = z.infer<typeof nativeBraceGeometrySchema>
