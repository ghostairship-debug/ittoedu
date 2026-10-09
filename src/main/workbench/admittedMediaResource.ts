import { createMediaAssetMetadata, type HostMediaInput, type MediaAssetResource } from '../../core/tools/mediaResource'
import { prepareImageResource } from './admittedImageResource'
import { htmlPreviewContentType } from './htmlPreview/htmlPreviewResources'

/** FileService has already frozen authorized bytes. Existing MIME and asset rules are shared with human import. */
export function mediaFileInput(file: { name: string; bytes: Uint8Array }): HostMediaInput {
  const mimeType = htmlPreviewContentType(file.name)
  if (!mimeType || !/^(image|audio|video)\//.test(mimeType)) throw new Error('所选文件不是当前支持的图片、音频或视频')
  return { filename: file.name, bytes: file.bytes, mimeType }
}

export async function prepareMediaResource(input: HostMediaInput, createId: () => string): Promise<MediaAssetResource> {
  if (input.mimeType.startsWith('image/')) return prepareImageResource(input, createId)
  const kind = input.mimeType.startsWith('audio/') ? 'audio' : input.mimeType.startsWith('video/') ? 'video' : undefined
  if (!kind) throw new Error('所选来源不是图片、音频或视频')
  return createMediaAssetMetadata({ name: input.filename, mimeType: input.mimeType, bytes: input.bytes }, kind, undefined, { idFactory: createId })
}
