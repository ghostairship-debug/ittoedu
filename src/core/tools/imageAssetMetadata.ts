import { nanoid } from 'nanoid'
import { SUPPORTED_IMAGE_MIME_TYPES } from '../../shared/constants'
import { UserFacingError } from '../../shared/errors'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
export interface ImageMetadataOptions { id?: string; idFactory?: () => string; dimensions?: { width: number; height: number } }
export interface ImageAssetResource { meta: AssetMeta; bytes: Uint8Array }
const MIME_EXTENSION: Record<(typeof SUPPORTED_IMAGE_MIME_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

function isSupportedImageMimeType(
  mimeType: string,
): mimeType is (typeof SUPPORTED_IMAGE_MIME_TYPES)[number] {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function safeOriginalFilename(filename: string): string {
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

export function createImageAssetMetadata(
  input: { name: string; mimeType: string; bytes: Uint8Array },
  options: ImageMetadataOptions = {},
): ImageAssetResource {
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

  return { meta, bytes }
}
