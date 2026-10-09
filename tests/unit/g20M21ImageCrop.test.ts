import { expect, it } from 'vitest'
import { commitCrop, cropGeometry, dragCropBox, type CropImage, type CropRect } from '../../src/shared/imageCrop'

const image = (overrides: Partial<CropImage & { frame: CropRect }> = {}): CropImage & { frame: CropRect } => ({
  frame: { x: 100, y: 50, width: 320, height: 180 }, crop: { left: 0, top: 0, right: 0, bottom: 0 }, fit: 'contain', cropX: 0.5, cropY: 0.5,
  flipX: false, flipY: false, source: { width: 640, height: 360 }, ...overrides,
})
const absolute = (frame: CropRect, rect: CropRect) => ({ x: frame.x + rect.x, y: frame.y + rect.y, width: rect.width, height: rect.height })
const close = (a: CropRect, b: CropRect) => { for (const key of ['x', 'y', 'width', 'height'] as const) expect(a[key]).toBeCloseTo(b[key], 1) }

it('M21 crop keeps the kept part where it was seen: the box becomes the frame and the rest becomes crop', () => {
  const before = image()
  const { shown, whole } = cropGeometry(before)
  close(shown, { x: 0, y: 0, width: 320, height: 180 }); close(whole, shown)
  // Drag the west edge in by a fifth of the width.
  const box = dragCropBox(shown, 'w', 64, 0, whole, 8)
  const after = commitCrop(before, box)
  expect(after).toEqual({ frame: { x: 164, y: 50, width: 256, height: 180 }, crop: { left: 0.2, top: 0, right: 0, bottom: 0 } })
  // Drawn again from the committed values, the whole image lies exactly where it lay before.
  const again = cropGeometry({ ...before, frame: after.frame, crop: after.crop })
  close(absolute(after.frame, again.whole), absolute(before.frame, whole))
  close(again.shown, { x: 0, y: 0, width: 256, height: 180 })
})

it('M21 crop follows a flipped image: the seen left edge is the source right edge', () => {
  const flipped = image({ flipX: true })
  const { shown, whole } = cropGeometry(flipped)
  const after = commitCrop(flipped, dragCropBox(shown, 'w', 64, 0, whole, 8))
  expect(after.crop).toEqual({ left: 0, top: 0, right: 0.2, bottom: 0 })
})

it('M21 crop on a filled (cover) image starts from what is visible and can take back the hidden part', () => {
  const cover = image({ fit: 'cover', frame: { x: 0, y: 0, width: 400, height: 180 } })
  const { shown, whole } = cropGeometry(cover)
  close(shown, { x: 0, y: 0, width: 400, height: 180 })
  close(whole, { x: 0, y: -22.5, width: 400, height: 225 })
  // Committing the visible part turns the clipped overflow into crop; drawn again it fills the frame exactly.
  const kept = commitCrop(cover, shown)
  expect(kept.crop.top).toBeCloseTo(0.1, 4); expect(kept.crop.bottom).toBeCloseTo(0.1, 4)
  close(cropGeometry({ ...cover, frame: kept.frame, crop: kept.crop }).shown, { x: 0, y: 0, width: 400, height: 180 })
  // Dragging the north edge up reaches into the hidden part, never past the whole image.
  const taller = dragCropBox(shown, 'n', 0, -100, whole, 8)
  expect(taller.y).toBeCloseTo(-22.5, 4)
})

it('M21 crop box stays inside the whole image and keeps a minimum size', () => {
  const whole = { x: 0, y: 0, width: 320, height: 180 }
  const box = dragCropBox(whole, 'se', -400, -400, whole, 8)
  expect(box.width).toBeCloseTo(8, 4); expect(box.height).toBeCloseTo(8, 4)
  expect(dragCropBox(whole, 'nw', -50, -50, whole, 8)).toEqual(whole)
  // A stretched image crops on each axis by its own scale.
  const stretched = image({ fit: 'stretch', frame: { x: 0, y: 0, width: 300, height: 300 } })
  const geometry = cropGeometry(stretched)
  const after = commitCrop(stretched, dragCropBox(geometry.shown, 's', 0, -150, geometry.whole, 8))
  expect(after).toEqual({ frame: { x: 0, y: 0, width: 300, height: 150 }, crop: { left: 0, top: 0, right: 0, bottom: 0.5 } })
})
