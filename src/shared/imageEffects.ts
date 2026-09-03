import type { ImageNode } from './contracts/native-v1/types'

function roundedRectAlpha(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number {
  if (radius <= 0) return 1
  const clampedRadius = Math.min(radius, width / 2, height / 2)
  const nearestX = Math.max(clampedRadius, Math.min(width - clampedRadius, x))
  const nearestY = Math.max(clampedRadius, Math.min(height - clampedRadius, y))
  const distance = Math.hypot(x - nearestX, y - nearestY)
  return distance <= clampedRadius ? 1 : 0
}

function featherAlpha(
  x: number,
  y: number,
  width: number,
  height: number,
  amount: number,
  mode: ImageNode['feather']['mode'],
): number {
  if (amount <= 0) return 1
  const fraction = Math.max(0.001, Math.min(0.49, amount / 200))
  if (mode === 'ellipse') {
    const nx = (x + 0.5 - width / 2) / Math.max(1, width / 2)
    const ny = (y + 0.5 - height / 2) / Math.max(1, height / 2)
    const radius = Math.hypot(nx, ny)
    return Math.max(0, Math.min(1, (1 - radius) / fraction))
  }
  const distance = Math.min(x + 0.5, y + 0.5, width - x - 0.5, height - y - 0.5)
  const featherPixels = Math.max(1, Math.min(width, height) * fraction)
  return Math.max(0, Math.min(1, distance / featherPixels))
}

export function renderImageNodeCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  node: ImageNode,
  width = node.width,
  height = node.height,
  resolution = 1,
): HTMLCanvasElement {
  const outputWidth = Math.max(1, Math.round(width * resolution))
  const outputHeight = Math.max(1, Math.round(height * resolution))
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建图片处理画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const sx = Math.max(1, sourceWidth)
  const sy = Math.max(1, sourceHeight)
  const crop = node.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const cropLeft = Math.max(0, Math.min(0.98, crop.left))
  const cropTop = Math.max(0, Math.min(0.98, crop.top))
  const cropRight = Math.max(0, Math.min(0.98 - cropLeft, crop.right))
  const cropBottom = Math.max(0, Math.min(0.98 - cropTop, crop.bottom))
  const sourceX = sx * cropLeft
  const sourceY = sy * cropTop
  const sourceCropWidth = Math.max(1, sx * (1 - cropLeft - cropRight))
  const sourceCropHeight = Math.max(1, sy * (1 - cropTop - cropBottom))
  let drawWidth = outputWidth
  let drawHeight = outputHeight
  if (node.fit !== 'stretch') {
    const factor = node.fit === 'cover'
      ? Math.max(outputWidth / sourceCropWidth, outputHeight / sourceCropHeight)
      : Math.min(outputWidth / sourceCropWidth, outputHeight / sourceCropHeight)
    drawWidth = sourceCropWidth * factor
    drawHeight = sourceCropHeight * factor
  }
  const availableX = outputWidth - drawWidth
  const availableY = outputHeight - drawHeight
  const drawX = availableX * node.cropX
  const drawY = availableY * node.cropY

  context.save()
  context.translate(node.flipX ? outputWidth : 0, node.flipY ? outputHeight : 0)
  context.scale(node.flipX ? -1 : 1, node.flipY ? -1 : 1)
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceCropWidth,
    sourceCropHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  )
  context.restore()

  const radius = node.cornerRadius * resolution
  if (node.feather.amount > 0 || radius > 0) {
    const image = context.getImageData(0, 0, outputWidth, outputHeight)
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const offset = (y * outputWidth + x) * 4 + 3
        const mask =
          roundedRectAlpha(x + 0.5, y + 0.5, outputWidth, outputHeight, radius) *
          featherAlpha(
            x,
            y,
            outputWidth,
            outputHeight,
            node.feather.amount,
            node.feather.mode,
          )
        image.data[offset] = Math.round(image.data[offset] * mask)
      }
    }
    context.putImageData(image, 0, 0)
  }
  return canvas
}
