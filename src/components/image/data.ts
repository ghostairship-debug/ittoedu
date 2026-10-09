import { z } from 'zod'
import { clampCrop } from '../../shared/imageCrop'

const fraction = z.number().finite().min(0).max(1)
const nonnegative = z.number().finite().nonnegative()
const imageSafeAreasSchema = z.array(z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(80),
  x: fraction, y: fraction,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict()).max(16).superRefine((areas, context) => {
  const ids = new Set<string>()
  areas.forEach((area, index) => {
    if (ids.has(area.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: '同一图片的安全区 ID 不能重复' })
    ids.add(area.id)
    if (area.x + area.width > 1.000001 || area.y + area.height > 1.000001) {
      context.addIssue({ code: 'custom', path: [index], message: '图片安全区必须完整位于图片节点内' })
    }
  })
})

/** Professional instance data; identity, frame and resource storage belong to the host. */
export const imageDataSchema = z.object({
  originalAssetId: z.string().min(1),
  assetId: z.string().min(1),
  alt: z.string().default(''),
  /** Consumed by author frame resizing, not a replacement for fit or frame geometry. */
  preserveAspectRatio: z.boolean().default(true),
  /** Author-only editing guides; playback and export never draw these regions. */
  safeAreas: imageSafeAreasSchema.default([]),
  fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  crop: z.object({ left: fraction, top: fraction, right: fraction, bottom: fraction })
    .default({ left: 0, top: 0, right: 0, bottom: 0 }),
  cropX: fraction.default(0.5), cropY: fraction.default(0.5),
  flipX: z.boolean().default(false), flipY: z.boolean().default(false),
  cornerRadius: nonnegative.default(0),
  feather: z.object({ amount: z.number().finite().min(0).max(100), mode: z.enum(['rectangle', 'ellipse']) })
    .default({ amount: 0, mode: 'rectangle' }),
  filters: z.object({ brightness: nonnegative.default(1), contrast: nonnegative.default(1),
    saturation: nonnegative.default(1), grayscale: fraction.default(0), blur: nonnegative.default(0) })
    .default({ brightness: 1, contrast: 1, saturation: 1, grayscale: 0, blur: 0 }),
}).strict()

export type ImageData = z.infer<typeof imageDataSchema>
export type ImageDisplayPatch = Partial<Omit<ImageData, 'assetId' | 'originalAssetId'>>
const imageDisplayPatchSchema = imageDataSchema.omit({ assetId: true, originalAssetId: true }).partial().strict()

export function createImageData(assetId: string, alt = ''): ImageData {
  return imageDataSchema.parse({ originalAssetId: assetId, assetId, alt })
}

/** Manual and AI display edits return the same instance data replacement. */
export function editImageDisplay(data: ImageData, patch: ImageDisplayPatch): ImageData {
  const next = imageDataSchema.parse({ ...data, ...imageDisplayPatchSchema.parse(patch) })
  return { ...next, crop: clampCrop(next.crop) }
}

/** Original bytes are retained; restoring starts with an uncropped source. */
export function restoreImageOriginal(data: ImageData): ImageData {
  return { ...data, assetId: data.originalAssetId, crop: { left: 0, top: 0, right: 0, bottom: 0 } }
}

/** Replacement starts a new recoverable original while retaining authored display edits. */
export function replaceImageSource(data: ImageData, admittedAssetId: string): ImageData {
  return imageDataSchema.parse({ ...data, assetId: admittedAssetId, originalAssetId: admittedAssetId })
}

export function imageAssetReferences(data: ImageData): string[] {
  return [...new Set([data.originalAssetId, data.assetId])]
}
