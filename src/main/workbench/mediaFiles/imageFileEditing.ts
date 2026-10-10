import { getImageDecoder } from '../imageDecoder'
import type { MediaFileContent, MediaFileOperation, MediaRectangle } from '../../../shared/workbench/mediaFiles'

const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  avif: 'image/avif', heif: 'image/avif', tiff: 'image/tiff' }
const editableFormats = new Set(['png', 'jpeg', 'webp', 'avif'])

export async function inspectImageFile(bytes: Uint8Array): Promise<Extract<MediaFileContent, { kind: 'image' }>> {
  const sharp = getImageDecoder()
  const metadata = await sharp(bytes, { animated: true }).metadata()
  const format = metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format
  const mimeType = format && formats[format]
  if (!mimeType || !metadata.width || !metadata.height) throw new Error('当前图片格式无法查看')
  const animated = (metadata.pages ?? 1) > 1
  const editable = !animated && editableFormats.has(format!)
  return { kind: 'image', bytes, mimeType, width: metadata.autoOrient.width, height: animated ? metadata.pageHeight ?? metadata.height : metadata.autoOrient.height,
    editable, ...(!editable ? { editReason: animated ? '此图片包含多帧，目前仅查看；编辑不会把动画静默变成静态图。' : '此图片目前支持查看，原格式编辑尚未接入。' } : {}) }
}

function crop(rectangle: MediaRectangle, width: number, height: number) {
  const left = Math.min(width - 1, Math.floor(rectangle.x * width)), top = Math.min(height - 1, Math.floor(rectangle.y * height))
  return { left, top, width: Math.min(width, Math.ceil((rectangle.x + rectangle.width) * width)) - left,
    height: Math.min(height, Math.ceil((rectangle.y + rectangle.height) * height)) - top }
}

/** Lossless intermediates avoid accumulating JPEG/WebP loss for each gesture. */
export async function editImageFile(bytes: Uint8Array, operations: readonly MediaFileOperation[], signal?: AbortSignal): Promise<MediaFileContent> {
  const initial = await inspectImageFile(bytes)
  if (!operations.length) return initial
  if (!initial.editable) throw new Error(initial.editReason)
  const sharp = getImageDecoder()
  let working = await sharp(bytes).autoOrient().keepMetadata().png().toBuffer()
  let width = initial.width, height = initial.height
  for (const operation of operations) {
    signal?.throwIfAborted()
    let pipeline = sharp(working).keepMetadata()
    if (operation.type === 'image.crop') pipeline = pipeline.extract(crop(operation.rectangle, width, height))
    else if (operation.type === 'image.rotate') pipeline = pipeline.rotate(operation.degrees)
    else if (operation.type === 'image.rectangle' || operation.type === 'image.ink') {
      const stroke = operation.strokeWidth * Math.min(width, height)
      const shape = operation.type === 'image.rectangle'
        ? `<rect x="${operation.rectangle.x * width}" y="${operation.rectangle.y * height}" width="${operation.rectangle.width * width}" height="${operation.rectangle.height * height}"/>`
        : `<polyline points="${operation.points.map(point => `${point.x * width},${point.y * height}`).join(' ')}"/>`
      const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="none" stroke="${operation.color}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round">${shape}</g></svg>`)
      pipeline = pipeline.composite([{ input: overlay }])
    } else throw new Error('图片不能应用 PDF 编辑操作')
    const result = await pipeline.png().toBuffer({ resolveWithObject: true })
    working = result.data; width = result.info.width; height = result.info.height
  }
  signal?.throwIfAborted()
  const output = sharp(working).keepMetadata()
  const result = initial.mimeType === 'image/jpeg' ? await output.jpeg({ quality: 95 }).toBuffer()
    : initial.mimeType === 'image/webp' ? await output.webp({ lossless: true }).toBuffer()
      : initial.mimeType === 'image/avif' ? await output.avif({ lossless: true }).toBuffer() : await output.png().toBuffer()
  return inspectImageFile(result)
}
