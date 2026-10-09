import { nanoid } from 'nanoid'
import { SUPPORTED_AUDIO_MIME_TYPES, SUPPORTED_VIDEO_MIME_TYPES } from '../../shared/constants'
import { UserFacingError } from '../../shared/errors'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
import { safeOriginalFilename } from './imageAssetMetadata'

/** Bytes are supplied by the current authorized file/resource owner, never read from a model path here. */
export interface HostMediaInput { bytes: Uint8Array; mimeType: string; filename: string }
export interface MediaMetadata { duration: number; width?: number; height?: number }
export interface MediaAssetResource { meta: AssetMeta; bytes: Uint8Array }
export type PrepareMediaResourcePort = (input: HostMediaInput, createId: () => string) => Promise<MediaAssetResource>
const MEDIA_EXTENSION: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm',
}

/** Shared with the human importer. Metadata is retained when observed, and is not a prerequisite for carrying bytes. */
export function createMediaAssetMetadata(input: { name: string; mimeType: string; bytes: Uint8Array }, kind: 'audio' | 'video',
  metadata?: MediaMetadata, options: { id?: string; idFactory?: () => string } = {}): MediaAssetResource {
  const supported: readonly string[] = kind === 'audio' ? SUPPORTED_AUDIO_MIME_TYPES : SUPPORTED_VIDEO_MIME_TYPES
  if (!supported.includes(input.mimeType) || input.bytes.byteLength === 0)
    throw new UserFacingError(`${kind === 'audio' ? '声音' : '视频'}导入失败`, '所选媒体类型不受支持或文件为空。',
      kind === 'audio' ? '请选择 MP3、OGG、WAV 或 M4A。' : '请选择 MP4 或 WebM。')
  if (metadata && (!Number.isFinite(metadata.duration) || metadata.duration < 0))
    throw new UserFacingError('媒体读取失败', '无法读取有效的媒体时长。', '请重新编码文件后再试。')
  const id = options.id ?? `asset_${(options.idFactory ?? nanoid)()}`, extension = MEDIA_EXTENSION[input.mimeType]
  if (!extension || !/^[A-Za-z0-9._-]+$/.test(id))
    throw new UserFacingError('媒体导入失败', '素材 ID 或媒体扩展名无效。', '请重新选择文件。')
  const bytes = Uint8Array.from(input.bytes)
  return { bytes, meta: { id, kind, filename: safeOriginalFilename(input.name), mimeType: input.mimeType,
    path: `assets/${id}.${extension}`, byteLength: bytes.byteLength,
    ...(metadata ? { duration: metadata.duration } : {}),
    ...(kind === 'video' && metadata?.width && metadata.height ? { width: metadata.width, height: metadata.height } : {}) } }
}
