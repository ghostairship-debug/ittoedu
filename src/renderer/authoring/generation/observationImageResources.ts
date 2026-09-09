import { readImageDimensions, type ImageDimensions } from '../../project/assetManager'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'

export type ObservationImageResourceDiagnosticCode =
  | 'image-asset-missing'
  | 'image-bytes-missing'
  | 'image-byte-length-mismatch'
  | 'image-decode-failed'
  | 'image-rasterization-failed'
  | 'image-derived-byte-budget-exceeded'

/** Kept in the observation JSON when a referenced original cannot safely be sent as an image. */
export interface ObservationImageResourceDiagnostic {
  readonly assetId: string
  readonly code: ObservationImageResourceDiagnosticCode
  readonly message: string
  readonly mimeType: string | null
  readonly expectedByteLength: number | null
  readonly actualByteLength: number | null
}

/**
 * An original is always retained in the observation when it decoded. SVG is
 * structure evidence; its visual attachment, when available, is derived PNG.
 */
export interface ObservationOriginalImageResource {
  readonly assetId: string
  readonly fileId: string
  readonly relativePath: string
  readonly mediaType: string
  readonly attachmentRole: 'structure' | 'image'
  readonly bytes: Uint8Array
}

/** A browser-produced visual attachment derived from a retained original. */
export interface ObservationDerivedImageResource {
  readonly assetId: string
  readonly fileId: string
  readonly relativePath: string
  readonly mediaType: 'image/png'
  readonly derivedFrom: string
  readonly bytes: Uint8Array
}

export interface ObservationImageResourceInput {
  readonly document: CourseProjectDocument
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly assetIds: readonly string[]
}

export interface ObservationImageResourceResult {
  readonly originalImages: readonly ObservationOriginalImageResource[]
  readonly derivedImages: readonly ObservationDerivedImageResource[]
  readonly unavailableOriginalImages: readonly ObservationImageResourceDiagnostic[]
  readonly unavailableDerivedImages: readonly ObservationImageResourceDiagnostic[]
}

export type ObservationImageDecoder = (bytes: Uint8Array, mimeType: string) => Promise<ImageDimensions>
export type ObservationSvgRasterizer = (bytes: Uint8Array, dimensions: ImageDimensions) => Promise<Uint8Array>

type DecodeOutcome = { readonly ok: true; readonly dimensions: ImageDimensions } | { readonly ok: false }
type RasterizationOutcome = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false }

const CANONICAL_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

function imageExtension(mimeType: string, filename: string): string {
  return CANONICAL_IMAGE_EXTENSIONS[mimeType]
    ?? (filename.split('.').at(-1)?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'image')
}

/** Turn a decoded SVG into an ordinary PNG before any native CLI sees it. */
export async function rasterizeSvgObservationImage(bytes: Uint8Array, dimensions: ImageDimensions): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof Image === 'undefined'
    || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前运行环境不能将 SVG 转为 PNG')
  }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/svg+xml' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('浏览器无法渲染 SVG'))
      element.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前运行环境不能绘制 SVG')
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    const png = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('浏览器未生成 PNG')), 'image/png')
      } catch (error) { reject(error) }
    })
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Original images are optional evidence, not a reason to reject an otherwise
 * valid current-host observation. The cache is keyed by the immutable resource
 * object and its declared MIME type: a resource replacement gets a new decode,
 * while a repeated capture does not repeatedly decode the same broken bytes.
 */
export function createObservationImageResourcePreparer(
  decoder: ObservationImageDecoder = readImageDimensions,
  rasterizer: ObservationSvgRasterizer = rasterizeSvgObservationImage,
) {
  const decodedByBytes = new WeakMap<Uint8Array, Map<string, Promise<DecodeOutcome>>>()
  const rasterizedByBytes = new WeakMap<Uint8Array, Promise<RasterizationOutcome>>()

  const decode = (bytes: Uint8Array, mimeType: string): Promise<DecodeOutcome> => {
    let byMime = decodedByBytes.get(bytes)
    if (!byMime) {
      byMime = new Map()
      decodedByBytes.set(bytes, byMime)
    }
    let outcome = byMime.get(mimeType)
    if (!outcome) {
      outcome = Promise.resolve().then(async () => {
        const dimensions = await decoder(bytes, mimeType)
        if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
          || dimensions.width <= 0 || dimensions.height <= 0) throw new Error('完整解码后的图片尺寸无效')
        return { ok: true as const, dimensions }
      }).catch(() => ({ ok: false as const }))
      byMime.set(mimeType, outcome)
    }
    return outcome
  }

  const rasterize = (bytes: Uint8Array, dimensions: ImageDimensions): Promise<RasterizationOutcome> => {
    let outcome = rasterizedByBytes.get(bytes)
    if (!outcome) {
      outcome = Promise.resolve().then(async () => {
        const png = await rasterizer(bytes, dimensions)
        if (!(png instanceof Uint8Array) || png.byteLength === 0) throw new Error('SVG 转换没有返回 PNG 字节')
        return { ok: true as const, bytes: png }
      }).catch(() => ({ ok: false as const }))
      rasterizedByBytes.set(bytes, outcome)
    }
    return outcome
  }

  return async function prepareObservationImageResources(input: ObservationImageResourceInput): Promise<ObservationImageResourceResult> {
    const originalImages: ObservationOriginalImageResource[] = []
    const derivedImages: ObservationDerivedImageResource[] = []
    const unavailableOriginalImages: ObservationImageResourceDiagnostic[] = []
    const unavailableDerivedImages: ObservationImageResourceDiagnostic[] = []
    for (const [index, assetId] of input.assetIds.entries()) {
      const asset = input.document.assets[assetId]
      if (!asset || asset.kind !== 'image') {
        unavailableOriginalImages.push({
          assetId, code: 'image-asset-missing',
          message: '当前工程找不到这张图片的元数据，未作为 image 附件发送。',
          mimeType: null, expectedByteLength: null, actualByteLength: null,
        })
        continue
      }
      const bytes = input.assetFiles[assetId]
      if (!bytes) {
        unavailableOriginalImages.push({
          assetId, code: 'image-bytes-missing',
          message: '这张图片的当前原始字节缺失，未作为 image 附件发送。',
          mimeType: asset.mimeType, expectedByteLength: asset.byteLength, actualByteLength: null,
        })
        continue
      }
      // This check intentionally precedes the cache. Metadata can change even
      // while a sidecar still holds the same Uint8Array object.
      if (bytes.byteLength !== asset.byteLength) {
        unavailableOriginalImages.push({
          assetId, code: 'image-byte-length-mismatch',
          message: '这张图片的当前原始字节长度与工程元数据不一致，未作为 image 附件发送。',
          mimeType: asset.mimeType, expectedByteLength: asset.byteLength, actualByteLength: bytes.byteLength,
        })
        continue
      }
      const decoded = await decode(bytes, asset.mimeType)
      if (!decoded.ok) {
        unavailableOriginalImages.push({
          assetId, code: 'image-decode-failed',
          message: '这张图片无法完整解码，未作为 image 附件发送。',
          mimeType: asset.mimeType, expectedByteLength: asset.byteLength, actualByteLength: bytes.byteLength,
        })
        continue
      }
      const fileId = `original-image-${index}`
      if (asset.mimeType !== 'image/svg+xml') {
        originalImages.push({
          assetId, fileId,
          relativePath: `observation/images/${index}.${imageExtension(asset.mimeType, asset.filename)}`,
          mediaType: asset.mimeType, attachmentRole: 'image', bytes,
        })
        continue
      }
      originalImages.push({
        assetId, fileId, relativePath: `observation/original-images/${index}.svg`,
        mediaType: asset.mimeType, attachmentRole: 'structure', bytes,
      })
      const rasterized = await rasterize(bytes, decoded.dimensions)
      if (!rasterized.ok || !(await decode(rasterized.bytes, 'image/png')).ok) {
        unavailableDerivedImages.push({
          assetId, code: 'image-rasterization-failed',
          message: '这张 SVG 原图已作为结构证据保留，但无法转换为 PNG image 附件。',
          mimeType: asset.mimeType, expectedByteLength: asset.byteLength, actualByteLength: bytes.byteLength,
        })
        continue
      }
      derivedImages.push({
        assetId, fileId: `derived-image-${index}`, relativePath: `observation/images/${index}.png`,
        mediaType: 'image/png', derivedFrom: fileId, bytes: rasterized.bytes,
      })
    }
    return { originalImages, derivedImages, unavailableOriginalImages, unavailableDerivedImages }
  }
}

export const prepareObservationImageResources = createObservationImageResourcePreparer()
