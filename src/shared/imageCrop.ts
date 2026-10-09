/**
 * Cropping an image in place (M21): the geometry the canvas draws with (shared/imageEffects.ts), in canvas units and
 * relative to the image's frame. The teacher drags a box over the whole source image; committing makes that box the
 * new frame and the part of the source it shows the new crop, so the image stays exactly where it was seen.
 */
export interface CropRect { x: number; y: number; width: number; height: number }
export interface CropEdges { left: number; top: number; right: number; bottom: number }
export type CropFit = 'contain' | 'cover' | 'stretch'

export interface CropImage {
  frame: { width: number; height: number }
  crop: CropEdges
  fit: CropFit
  cropX: number
  cropY: number
  flipX: boolean
  flipY: boolean
  source: { width: number; height: number }
}

/** Crop edges as the canvas clamps them. */
export function clampCrop(crop: CropEdges): CropEdges {
  const left = Math.max(0, Math.min(0.98, crop.left)), top = Math.max(0, Math.min(0.98, crop.top))
  return { left, top, right: Math.max(0, Math.min(0.98 - left, crop.right)), bottom: Math.max(0, Math.min(0.98 - top, crop.bottom)) }
}

/**
 * Where the drawn part of the image (`shown`, clipped to the frame) and the whole source image (`whole`) lie,
 * relative to the frame's top-left, as seen (flips included).
 */
export function cropGeometry(image: CropImage): { shown: CropRect; whole: CropRect } {
  const crop = clampCrop(image.crop)
  const sourceWidth = Math.max(1, image.source.width), sourceHeight = Math.max(1, image.source.height)
  const croppedWidth = Math.max(1, sourceWidth * (1 - crop.left - crop.right)), croppedHeight = Math.max(1, sourceHeight * (1 - crop.top - crop.bottom))
  const { width, height } = image.frame
  let drawWidth = width, drawHeight = height
  if (image.fit !== 'stretch') {
    const factor = image.fit === 'cover' ? Math.max(width / croppedWidth, height / croppedHeight) : Math.min(width / croppedWidth, height / croppedHeight)
    drawWidth = croppedWidth * factor; drawHeight = croppedHeight * factor
  }
  const drawX = (width - drawWidth) * image.cropX, drawY = (height - drawHeight) * image.cropY
  const scaleX = drawWidth / croppedWidth, scaleY = drawHeight / croppedHeight
  let whole: CropRect = { x: drawX - crop.left * sourceWidth * scaleX, y: drawY - crop.top * sourceHeight * scaleY, width: sourceWidth * scaleX, height: sourceHeight * scaleY }
  let drawn: CropRect = { x: drawX, y: drawY, width: drawWidth, height: drawHeight }
  // A flip mirrors the drawing inside the frame.
  const mirror = (rect: CropRect): CropRect => ({
    x: image.flipX ? width - rect.x - rect.width : rect.x, y: image.flipY ? height - rect.y - rect.height : rect.y, width: rect.width, height: rect.height,
  })
  whole = mirror(whole); drawn = mirror(drawn)
  return { shown: intersect(drawn, { x: 0, y: 0, width, height }), whole }
}

function intersect(a: CropRect, b: CropRect): CropRect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}

/** The crop that makes `box` (relative to the old frame, as seen) show exactly what it covers of the whole image. */
export function cropForBox(image: CropImage, box: CropRect): CropEdges {
  const { whole } = cropGeometry(image)
  const left = (box.x - whole.x) / whole.width, right = (whole.x + whole.width - box.x - box.width) / whole.width
  const top = (box.y - whole.y) / whole.height, bottom = (whole.y + whole.height - box.y - box.height) / whole.height
  // Seen edges are source edges unless the image is flipped on that axis.
  return clampCrop({
    left: image.flipX ? right : left, right: image.flipX ? left : right,
    top: image.flipY ? bottom : top, bottom: image.flipY ? top : bottom,
  })
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Moves the box's edges named by `handle` by (dx, dy), kept inside the whole image and at least `minimum` wide and tall. */
export function dragCropBox(box: CropRect, handle: CropHandle, dx: number, dy: number, whole: CropRect, minimum: number): CropRect {
  let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height
  const min = Math.max(minimum, whole.width * 0.02), minHeight = Math.max(minimum, whole.height * 0.02)
  if (handle.includes('w')) left = Math.max(whole.x, Math.min(right - min, left + dx))
  if (handle.includes('e')) right = Math.min(whole.x + whole.width, Math.max(left + min, right + dx))
  if (handle.includes('n')) top = Math.max(whole.y, Math.min(bottom - minHeight, top + dy))
  if (handle.includes('s')) bottom = Math.min(whole.y + whole.height, Math.max(top + minHeight, bottom + dy))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const round = (value: number) => Math.round(value * 100) / 100

/** The frame and crop to commit for `box`: the box becomes the frame, so the kept part stays where it was seen. */
export function commitCrop(image: CropImage & { frame: CropRect }, box: CropRect): { frame: CropRect; crop: CropEdges } {
  const crop = cropForBox(image, box)
  return {
    frame: { x: round(image.frame.x + box.x), y: round(image.frame.y + box.y), width: round(box.width), height: round(box.height) },
    crop: { left: round4(crop.left), top: round4(crop.top), right: round4(crop.right), bottom: round4(crop.bottom) },
  }
}

const round4 = (value: number) => Math.round(value * 10000) / 10000
