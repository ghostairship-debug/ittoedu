import type { DocumentBlock } from './document/content'

export type FlowImageCrop = Pick<Extract<DocumentBlock, { type: 'media' }>, 'crop' | 'cropX' | 'cropY'>
export interface FlowImageSource { width: number; height: number }
export interface FlowCropRect { x: number; y: number; width: number; height: number }

const finitePositive = (value: number): number => Number.isFinite(value) && value > 0 ? value : 1
const fraction = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : fallback
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

/** Native image crop units: source-edge fractions and a 0–1 focal point. No frame is persisted for Flow media. */
export function flowMediaCropGeometry(source: FlowImageSource, fields: FlowImageCrop) {
  const width = finitePositive(source.width), height = finitePositive(source.height)
  const left = Math.min(0.98, fraction(fields.crop?.left, 0)), top = Math.min(0.98, fraction(fields.crop?.top, 0))
  const right = Math.min(fraction(fields.crop?.right, 0), Math.max(0, 0.98 - left))
  const bottom = Math.min(fraction(fields.crop?.bottom, 0), Math.max(0, 0.98 - top))
  const visibleX = round(1 - left - right), visibleY = round(1 - top - bottom)
  const sourceRect: FlowCropRect = { x: round(width * left), y: round(height * top), width: round(width * visibleX), height: round(height * visibleY) }
  return {
    sourceRect,
    visibleRatio: { x: visibleX, y: visibleY, area: round(visibleX * visibleY) },
    focalPoint: { x: fraction(fields.cropX, 0.5), y: fraction(fields.cropY, 0.5) },
    /** Apply to a clipped wrapper whose width is chosen by the Flow layout. */
    dom: {
      wrapperAspectRatio: `${sourceRect.width} / ${sourceRect.height}`,
      imageWidth: `${100 / visibleX}%`, imageHeight: `${100 / visibleY}%`,
      imageLeft: `${-left * 100 / visibleX}%`, imageTop: `${-top * 100 / visibleY}%`,
    },
  }
}

export function flowMediaCropPatch(crop: NonNullable<FlowImageCrop['crop']>, cropX = 0.5, cropY = 0.5): FlowImageCrop {
  const geometry = flowMediaCropGeometry({ width: 1, height: 1 }, { crop, cropX, cropY })
  const { sourceRect, focalPoint } = geometry
  return { crop: { left: sourceRect.x, top: sourceRect.y, right: round(1 - sourceRect.x - sourceRect.width), bottom: round(1 - sourceRect.y - sourceRect.height) }, cropX: focalPoint.x, cropY: focalPoint.y }
}
