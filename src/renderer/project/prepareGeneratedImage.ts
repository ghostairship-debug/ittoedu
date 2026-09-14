import { generatedImageFormat } from '../../shared/generatedImageFormat'
import { readImageDimensions, type ImageDimensions } from './assetManager'

export interface PrepareGeneratedImageInput {
  bytes: Uint8Array
  mimeType: string
  filename: string
  display: ImageDimensions
  fit?: 'contain' | 'cover' | 'stretch'
  /** Text-heavy illustrations and large teaching figures keep source resolution. */
  preserveResolution?: boolean
}
export interface PreparedGeneratedImage extends ImageDimensions {
  bytes: Uint8Array
  mimeType: string
  filename: string
}
export interface GeneratedImageCodec {
  dimensions(bytes: Uint8Array, mimeType: string): Promise<ImageDimensions>
  resize(bytes: Uint8Array, mimeType: string, dimensions: ImageDimensions, outputMimeType?: string): Promise<Uint8Array>
}

const browserCodec: GeneratedImageCodec = {
  dimensions: readImageDimensions,
  async resize(bytes, mimeType, dimensions, outputMimeType = mimeType) {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mimeType }), {
      resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: 'high',
    })
    try {
      const canvas = document.createElement('canvas')
      canvas.width = dimensions.width; canvas.height = dimensions.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前宿主不能准备图片副本')
      context.drawImage(bitmap, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value && value.type === outputMimeType ? resolve(value) : reject(new Error('宿主没有生成所需图片格式')), outputMimeType, 1,
      ))
      return new Uint8Array(await blob.arrayBuffer())
    } finally { bitmap.close() }
  },
}

/** This resource preparation service has no document, filesystem or history writer. */
export function createGeneratedImagePreparer(codec: GeneratedImageCodec = browserCodec) {
  const cache = new WeakMap<Uint8Array, Map<string, Promise<PreparedGeneratedImage>>>()
  return function prepare(input: PrepareGeneratedImageInput): Promise<PreparedGeneratedImage> {
    const key = JSON.stringify([input.mimeType, input.filename, input.display.width, input.display.height, input.fit ?? 'contain', input.preserveResolution === true])
    let entries = cache.get(input.bytes)
    if (!entries) { entries = new Map(); cache.set(input.bytes, entries) }
    let result = entries.get(key)
    if (!result) {
      result = (async () => {
        if (!input.bytes.length || input.bytes.length > 64 * 1024 * 1024) throw new Error('图片为空或超过 64 MiB')
        const format = generatedImageFormat(input.bytes)
        if (format.mimeType !== input.mimeType) throw new Error('图片声明格式与真实字节不一致')
        if (![input.display.width, input.display.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('图片显示区域尺寸无效')
        const original = await codec.dimensions(input.bytes, format.mimeType)
        if (![original.width, original.height].every(value => Number.isSafeInteger(value) && value > 0)
          || !Number.isSafeInteger(original.width * original.height)) throw new Error('图片完整解码尺寸无效')
        // A 2x display budget is capped for ordinary illustrations. No crop, upscale,
        // hard byte target or conversion of animation/vector content is implicit.
        const scaleX = input.display.width / original.width, scaleY = input.display.height / original.height
        const displayScale = input.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
        const displayedLongEdge = input.fit === 'stretch' ? Math.max(input.display.width, input.display.height)
          : Math.max(original.width, original.height) * displayScale
        const edge = Math.max(512, Math.min(1024, Math.ceil(2 * displayedLongEdge)))
        const keepOriginal = input.preserveResolution || format.animated || format.mimeType === 'image/svg+xml'
        const ratio = keepOriginal ? 1
          : Math.min(1, edge / Math.max(original.width, original.height))
        const dimensions = { width: Math.max(1, Math.round(original.width * ratio)), height: Math.max(1, Math.round(original.height * ratio)) }
        let mimeType = format.mimeType
        let bytes = ratio === 1 ? Uint8Array.from(input.bytes) : await codec.resize(input.bytes, mimeType, dimensions)
        // Already-small payloads retain their encoding. Large PNG illustrations
        // may use a maximum-quality WebP copy, but only for a material saving.
        // The explicit text/large-figure exception retains original bytes.
        if (!keepOriginal && mimeType === 'image/png' && bytes.length > 100 * 1024) {
          const webp = await codec.resize(input.bytes, mimeType, dimensions, 'image/webp')
          if (webp.length < bytes.length * 0.9) { bytes = webp; mimeType = 'image/webp' }
        }
        if (ratio !== 1 || mimeType !== format.mimeType) {
          if (generatedImageFormat(bytes).mimeType !== mimeType) throw new Error('图片副本格式不匹配')
          const decoded = await codec.dimensions(bytes, mimeType)
          if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error('图片副本尺寸与完整解码结果不一致')
        }
        const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' } as Record<string, string>)[mimeType]!
        const leaf = input.filename.replace(/\\/g, '/').split('/').at(-1)?.trim() || 'image'
        return { bytes, mimeType, filename: `${leaf.replace(/\.[^.]*$/, '') || 'image'}.${extension}`, ...dimensions }
      })()
      entries.set(key, result)
    }
    return result
  }
}

export const prepareGeneratedImage = createGeneratedImagePreparer()
