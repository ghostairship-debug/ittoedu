import { nanoid } from 'nanoid'
import {
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from '@/shared/constants'
import { UserFacingError } from '@/shared/errors'
import type { SelectedImageResult, SelectedMediaResult } from '@/shared/ipcTypes'
import type {
  AssetKind,
  AssetMeta,
  RuntimeAssetMap,
} from '@/shared/contracts/media-v1/types'
import type { BlobUrlRegistry } from './blobUrlRegistry'

const MIME_EXTENSION: Record<(typeof SUPPORTED_IMAGE_MIME_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

const MEDIA_EXTENSION: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export interface ImageDimensions {
  width: number
  height: number
}

export interface ImportedImageAsset {
  meta: AssetMeta
  bytes: Uint8Array
  url?: string
}

export type ImportedMediaAsset = ImportedImageAsset

export interface MediaMetadata {
  duration: number
  width?: number
  height?: number
}

export async function assetBytesSha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new UserFacingError(
      '素材校验失败',
      '当前环境不支持 SHA-256 内容校验。',
      '请重新启动编辑器后再试。',
    )
  }
  const source = new Uint8Array(bytes.byteLength)
  source.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildAssetContentHashIndex(
  kind: AssetKind,
  assets: Readonly<Record<string, AssetMeta>>,
  assetFiles: Readonly<Record<string, Uint8Array>>,
): Promise<Map<string, ImportedImageAsset>> {
  const hashes = new Map<string, ImportedImageAsset>()
  for (const asset of Object.values(assets)) {
    if (asset.kind !== kind) continue
    const bytes = assetFiles[asset.id]
    if (!bytes) continue
    const hash = await assetBytesSha256(bytes)
    if (!hashes.has(hash)) hashes.set(hash, { meta: asset, bytes })
  }
  return hashes
}

export interface ImportImageOptions {
  id?: string
  idFactory?: () => string
  dimensions?: ImageDimensions
  blobUrlRegistry?: BlobUrlRegistry
}

function isSupportedImageMimeType(
  mimeType: string,
): mimeType is (typeof SUPPORTED_IMAGE_MIME_TYPES)[number] {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
}

function safeOriginalFilename(filename: string): string {
  const leaf = filename.replace(/\\/g, '/').split('/').pop()?.trim()
  if (!leaf) {
    throw new UserFacingError(
      '图片导入失败',
      '图片文件名无效。',
      '请重新选择 PNG、JPG、WebP、GIF 或 SVG 图片。',
    )
  }
  return leaf
}

export function assertSupportedImage(mimeType: string, bytes: Uint8Array): void {
  if (!isSupportedImageMimeType(mimeType)) {
    throw new UserFacingError(
      '图片类型不支持',
      `不支持图片类型“${mimeType || '未知'}”。`,
      '请选择 PNG、JPG、JPEG、WebP、GIF 或 SVG 图片。',
    )
  }
  if (bytes.byteLength === 0) {
    throw new UserFacingError(
      '图片读取失败',
      '所选图片没有可读取的内容。',
      '请确认图片文件未损坏，然后重新选择。',
    )
  }
}

export function createImageAssetImport(
  input: Pick<SelectedImageResult, 'name' | 'mimeType' | 'bytes'>,
  options: ImportImageOptions = {},
): ImportedImageAsset {
  assertSupportedImage(input.mimeType, input.bytes)
  const id = options.id ?? `asset_${(options.idFactory ?? nanoid)()}`
  if (
    !/^[A-Za-z0-9._-]+$/.test(id) ||
    id === '__proto__' ||
    id === 'prototype' ||
    id === 'constructor'
  ) {
    throw new UserFacingError(
      '图片导入失败',
      '生成的素材 ID 无效。',
      '请重新选择图片；如问题持续，请重新启动编辑器。',
    )
  }
  if (
    options.dimensions !== undefined &&
    (!Number.isFinite(options.dimensions.width) ||
      !Number.isFinite(options.dimensions.height) ||
      options.dimensions.width <= 0 ||
      options.dimensions.height <= 0)
  ) {
    throw new UserFacingError(
      '图片读取失败',
      '无法识别所选图片的有效尺寸。',
      '请使用图片软件重新保存后再导入。',
    )
  }
  const extension = MIME_EXTENSION[input.mimeType as keyof typeof MIME_EXTENSION]
  const bytes = Uint8Array.from(input.bytes)
  const meta: AssetMeta = {
    id,
    kind: 'image',
    filename: safeOriginalFilename(input.name),
    mimeType: input.mimeType,
    path: `assets/${id}.${extension}`,
    byteLength: bytes.byteLength,
    ...(options.dimensions === undefined
      ? {}
      : {
          width: options.dimensions.width,
          height: options.dimensions.height,
        }),
  }

  const url = options.blobUrlRegistry?.create(`asset:${id}`, bytes, input.mimeType)
  return { meta, bytes, ...(url === undefined ? {} : { url }) }
}

export const importImageAsset = createImageAssetImport

export function createMediaAssetImport(
  input: Pick<SelectedMediaResult, 'name' | 'mimeType' | 'bytes'>,
  kind: 'audio' | 'video',
  metadata: MediaMetadata,
  options: Pick<ImportImageOptions, 'id' | 'idFactory' | 'blobUrlRegistry'> = {},
): ImportedMediaAsset {
  const supported = kind === 'audio'
    ? (SUPPORTED_AUDIO_MIME_TYPES as readonly string[])
    : (SUPPORTED_VIDEO_MIME_TYPES as readonly string[])
  if (!supported.includes(input.mimeType) || input.bytes.byteLength === 0) {
    throw new UserFacingError(
      `${kind === 'audio' ? '声音' : '视频'}导入失败`,
      '所选媒体类型不受支持或文件为空。',
      kind === 'audio' ? '请选择 MP3、OGG、WAV 或 M4A。' : '请选择 MP4 或 WebM。',
    )
  }
  if (!Number.isFinite(metadata.duration) || metadata.duration < 0) {
    throw new UserFacingError(
      '媒体读取失败',
      '无法读取有效的媒体时长。',
      '请重新编码文件后再试。',
    )
  }
  const id = options.id ?? `asset_${(options.idFactory ?? nanoid)()}`
  const extension = MEDIA_EXTENSION[input.mimeType]
  if (!extension || !/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new UserFacingError('媒体导入失败', '素材 ID 或媒体扩展名无效。', '请重新选择文件。')
  }
  const bytes = Uint8Array.from(input.bytes)
  const meta: AssetMeta = {
    id,
    kind,
    filename: safeOriginalFilename(input.name),
    mimeType: input.mimeType,
    path: `assets/${id}.${extension}`,
    byteLength: bytes.byteLength,
    duration: metadata.duration,
    ...(kind === 'video' && metadata.width && metadata.height
      ? { width: metadata.width, height: metadata.height }
      : {}),
  }
  const url = options.blobUrlRegistry?.create(`asset:${id}`, bytes, input.mimeType)
  return { meta, bytes, ...(url === undefined ? {} : { url }) }
}

export async function readMediaMetadata(
  bytes: Uint8Array,
  mimeType: string,
  kind: 'audio' | 'video',
): Promise<MediaMetadata> {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new UserFacingError('媒体读取失败', '当前环境不能读取媒体元数据。', '请重新启动编辑器后再试。')
  }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  try {
    return await new Promise<MediaMetadata>((resolve, reject) => {
      const media = document.createElement(kind === 'video' ? 'video' : 'audio')
      media.preload = 'metadata'
      media.onloadedmetadata = () => {
        const duration = Number.isFinite(media.duration) ? media.duration : 0
        if (kind === 'video') {
          const video = media as HTMLVideoElement
          if (video.videoWidth <= 0 || video.videoHeight <= 0) {
            reject(new Error('视频尺寸无效'))
            return
          }
          resolve({ duration, width: video.videoWidth, height: video.videoHeight })
        } else {
          resolve({ duration })
        }
      }
      media.onerror = () => reject(new Error('浏览器无法解码媒体'))
      media.src = url
    })
  } catch (error) {
    throw new UserFacingError(
      '媒体读取失败',
      '无法读取媒体元数据；容器或编码可能不受浏览器支持。',
      '请重新编码为标准 MP4/WebM 或 MP3/OGG/WAV/M4A 后再试。',
      { cause: error },
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function createRuntimeAssetMap(
  project: { assets: Record<string, AssetMeta> },
  assetFiles: Readonly<Record<string, Uint8Array>>,
  blobUrlRegistry: BlobUrlRegistry,
): RuntimeAssetMap {
  const runtimeAssets: RuntimeAssetMap = Object.create(null) as RuntimeAssetMap
  for (const [assetId, meta] of Object.entries(project.assets)) {
    const sourceBytes = assetFiles[assetId]
    if (sourceBytes === undefined) {
      throw new UserFacingError(
        '素材加载失败',
        `工程缺少图片“${meta.filename}”的二进制内容。`,
        '请重新打开有效工程，或重新导入该图片。',
      )
    }
    if (sourceBytes.byteLength !== meta.byteLength) {
      throw new UserFacingError(
        '素材加载失败',
        `图片“${meta.filename}”的大小与工程记录不一致。`,
        '工程文件可能已损坏，请从备份恢复。',
      )
    }
    const bytes = Uint8Array.from(sourceBytes)
    runtimeAssets[assetId] = {
      meta: { ...meta },
      bytes,
      url: blobUrlRegistry.create(`asset:${assetId}`, bytes, meta.mimeType),
    }
  }
  return runtimeAssets
}

export function fitImageSize(
  dimensions: ImageDimensions,
  bounds: ImageDimensions = { width: 640, height: 480 },
): ImageDimensions {
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    return { width: 320, height: 180 }
  }
  const scale = Math.min(1, bounds.width / dimensions.width, bounds.height / dimensions.height)
  return {
    width: Math.max(16, dimensions.width * scale),
    height: Math.max(16, dimensions.height * scale),
  }
}

export async function readImageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ImageDimensions> {
  assertSupportedImage(mimeType, bytes)
  if (
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new UserFacingError(
      '图片读取失败',
      '当前运行环境不能读取图片尺寸。',
      '请重新启动编辑器后再试。',
    )
  }

  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mimeType }))
  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve({ width: image.naturalWidth, height: image.naturalHeight })
        } else {
          reject(new Error('图片尺寸为零'))
        }
      }
      image.onerror = () => reject(new Error('浏览器无法解码图片'))
      image.src = url
    })
  } catch (error) {
    throw new UserFacingError(
      '图片读取失败',
      '无法识别所选图片的尺寸，文件可能已损坏。',
      '请使用图片软件重新保存后再导入。',
      { cause: error },
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * V9 candidate helper: detect whether an incoming import can reuse an existing
 * asset id. V8 `createImageAssetImport` / `createMediaAssetImport` stay the
 * default factories and are not redirected.
 */
export function courseAssetMetaConflicts(
  existing: AssetMeta,
  candidate: Pick<AssetMeta, 'filename' | 'mimeType' | 'kind' | 'byteLength'>,
): boolean {
  return (
    existing.filename !== candidate.filename
    || existing.mimeType !== candidate.mimeType
    || existing.kind !== candidate.kind
    || existing.byteLength !== candidate.byteLength
  )
}

/** Detached copy for the V9 asset sidecar. Does not change V8 blob registries. */
export function cloneCourseAssetBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes)
}
