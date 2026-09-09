import { z } from 'zod'

export const MAX_IMAGE_TRANSFORM_PIXELS = 16_000_000
export const DEFAULT_IMAGE_REPLACEMENT_GREEN = '#22c55e'
const dimension = z.number().int().positive().max(MAX_IMAGE_TRANSFORM_PIXELS)
const coordinate = z.number().int().nonnegative().max(MAX_IMAGE_TRANSFORM_PIXELS)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需要 #RRGGBB')
const rectangle = z.object({ x: coordinate, y: coordinate, width: dimension, height: dimension }).strict()
const mask = z.object({
  width: dimension, height: dimension,
  bits: z.string().min(1).max(MAX_IMAGE_TRANSFORM_PIXELS).regex(/^[01]+$/, 'mask 只能使用逐行排列的 0/1'),
}).strict().superRefine((value, context) => {
  if (value.width * value.height !== value.bits.length) context.addIssue({ code: 'custom', path: ['bits'], message: 'mask 位数必须等于 width × height' })
  if (!value.bits.includes('1')) context.addIssue({ code: 'custom', path: ['bits'], message: 'mask 没有选中像素，请明确需要修改的区域' })
})

/** Input intent only: no V9 fields, image bytes, generated asset IDs or writers. */
export const imageTransformOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace-color'), sourceColor: color,
    targetColor: color.default(DEFAULT_IMAGE_REPLACEMENT_GREEN), tolerance: z.number().finite().min(0).max(441).default(32),
    region: rectangle.optional(), mask: mask.optional(),
  }).strict(),
  z.object({ kind: z.literal('crop'), region: rectangle }).strict(),
  z.object({ kind: z.literal('resize'), width: dimension, height: dimension,
    method: z.literal('nearest-neighbor').default('nearest-neighbor'),
  }).strict().superRefine((value, context) => {
    if (value.width * value.height > MAX_IMAGE_TRANSFORM_PIXELS) context.addIssue({ code: 'custom', message: '输出图片不能超过 1600 万像素' })
  }),
])

export const imageTransformInputSchema = z.object({
  sourceAssetId: z.string().min(1).max(500),
  operations: z.array(imageTransformOperationSchema).min(1).max(16),
  outputFormat: z.literal('png').default('png'), alpha: z.literal('preserve').default('preserve'),
}).strict()

export type ImageTransformOperation = z.infer<typeof imageTransformOperationSchema>
export type ImageTransformInput = z.infer<typeof imageTransformInputSchema>
