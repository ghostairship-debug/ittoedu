import { generatedImageFormat } from '../../shared/generatedImageFormat'
import { imageDerivativePlan, imageDerivativeTraits, type ImageDerivativeDemand } from '../../shared/imageDerivative'
import { assetBytesSha256, readImageDimensions, type ImageDimensions } from './assetManager'

export interface PrepareGeneratedImageInput {
  bytes: Uint8Array
  mimeType: string
  filename: string
  display: ImageDimensions
  fit?: 'contain' | 'cover' | 'stretch'
  dpr?: number
  crop?: ImageDerivativeDemand['crop']
  quality?: ImageDerivativeDemand['quality']
  /** Text-heavy illustrations and large teaching figures keep source resolution. */
  preserveResolution?: boolean
}
export interface PreparedGeneratedImage extends ImageDimensions {
  bytes: Uint8Array
  mimeType: string
  filename: string
  /** Import callers keep this resource for subsequent crop/edit/regeneration. */
  original: { bytes: Uint8Array; mimeType: string; filename: string; width: number; height: number }
}
export interface GeneratedImageCodec {
  dimensions(bytes: Uint8Array, mimeType: string): Promise<ImageDimensions>
  resize(bytes: Uint8Array, mimeType: string, dimensions: ImageDimensions, outputMimeType?: string, quality?: number): Promise<Uint8Array>
}

const browserCodec: GeneratedImageCodec = {
  dimensions: readImageDimensions,
  async resize(bytes, mimeType, dimensions, outputMimeType = mimeType, quality = 0.9) {
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
        value => value && value.type === outputMimeType ? resolve(value) : reject(new Error('宿主没有生成所需图片格式')), outputMimeType, quality,
      ))
      return new Uint8Array(await blob.arrayBuffer())
    } finally { bitmap.close() }
  },
}

/** This resource preparation service has no document, filesystem or history writer. */
export function createGeneratedImagePreparer(codec: GeneratedImageCodec = browserCodec) {
  type Prepared = Omit<PreparedGeneratedImage, 'filename' | 'original'> & { source: ImageDimensions; originalBytes: Uint8Array }
  const cache = new Map<string, Promise<Prepared>>()
  const named = new Map<string, Promise<PreparedGeneratedImage>>()
  return async function prepare(input: PrepareGeneratedImageInput): Promise<PreparedGeneratedImage> {
    const demand: ImageDerivativeDemand = { ...input.display, fit: input.fit, dpr: input.dpr, crop: input.crop,
      quality: input.preserveResolution ? 'original' : input.quality }
    const key = JSON.stringify([await assetBytesSha256(input.bytes), input.mimeType, demand])
    const namedKey = JSON.stringify([key, input.filename])
    const existing = named.get(namedKey)
    if (existing) return existing
    let result = cache.get(key)
    if (!result) {
      result = (async () => {
        if (!input.bytes.length) throw new Error('图片为空')
        const format = generatedImageFormat(input.bytes)
        if (format.mimeType !== input.mimeType) throw new Error('图片声明格式与真实字节不一致')
        if (![input.display.width, input.display.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('图片显示区域尺寸无效')
        const original = await codec.dimensions(input.bytes, format.mimeType)
        if (![original.width, original.height].every(value => Number.isSafeInteger(value) && value > 0)
          || !Number.isSafeInteger(original.width * original.height)) throw new Error('图片完整解码尺寸无效')
        const plan = imageDerivativePlan(original, format.mimeType, imageDerivativeTraits(input.bytes, format.mimeType), demand)
        const dimensions = { width: plan.width, height: plan.height }
        let mimeType = format.mimeType
        const originalBytes = Uint8Array.from(input.bytes)
        const resizeMimeType = demand.quality === 'detail' ? 'image/png' : mimeType
        let bytes = plan.resized ? await codec.resize(input.bytes, mimeType, dimensions, resizeMimeType, plan.quality) : originalBytes
        if (plan.resized) mimeType = resizeMimeType
        if (plan.encode && plan.outputMimeType !== mimeType) {
          const encoded = await codec.resize(input.bytes, mimeType, dimensions, plan.outputMimeType, plan.quality)
          if (encoded.length < bytes.length * 0.9) { bytes = encoded; mimeType = plan.outputMimeType }
        }
        if (plan.resized || mimeType !== format.mimeType) {
          if (generatedImageFormat(bytes).mimeType !== mimeType) throw new Error('图片副本格式不匹配')
          const decoded = await codec.dimensions(bytes, mimeType)
          if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error('图片副本尺寸与完整解码结果不一致')
        }
        return { bytes, mimeType, ...dimensions, source: original, originalBytes }
      })()
      cache.set(key, result)
      // This small preparation cache has no document owner; eviction only releases
      // reusable work, never the source or a document resource.
      if (cache.size > 32) cache.delete(cache.keys().next().value!)
      result.catch(() => { cache.delete(key); named.delete(namedKey) })
    }
    const prepared = result.then(({ originalBytes, source, ...derivative }) => {
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' } as Record<string, string>)[derivative.mimeType]!
      const leaf = input.filename.replace(/\\/g, '/').split('/').at(-1)?.trim() || 'image'
      return { ...derivative, filename: `${leaf.replace(/\.[^.]*$/, '') || 'image'}.${extension}`,
        original: { bytes: originalBytes, mimeType: input.mimeType, filename: input.filename, ...source } }
    })
    named.set(namedKey, prepared)
    prepared.catch(() => { named.delete(namedKey) })
    if (named.size > 32) named.delete(named.keys().next().value!)
    return prepared
  }
}

export const prepareGeneratedImage = createGeneratedImagePreparer()
