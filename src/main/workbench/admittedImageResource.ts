import sharp from 'sharp'
import { assertSupportedImage, createImageAssetMetadata, type ImageAssetResource } from '../../core/tools/imageAssetMetadata'
import type { HostImageInput } from '../../core/tools/imageResource'

export async function prepareImageResource(input: HostImageInput, createId: () => string): Promise<ImageAssetResource> {
  input = { bytes: Uint8Array.from(input.bytes), mimeType: input.mimeType, filename: input.filename }
  const bytes = input.bytes
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('图片资源不能超过 64 MiB')
  assertSupportedImage(input.mimeType, bytes)
  const decoder = sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: 40_000_000 })
  const metadata = await decoder.metadata()
  const expected: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }
  if (!metadata.format || expected[metadata.format] !== input.mimeType) throw new Error('图片声明类型与真实字节不匹配')
  // metadata alone can accept damaged compressed pixels; decode the entire admitted image.
  await decoder.raw().toBuffer()
  const width = metadata.width, height = metadata.pageHeight ?? metadata.height
  if (!width || !height) throw new Error('图片没有有效尺寸')
  return createImageAssetMetadata({ name: input.filename, mimeType: input.mimeType, bytes }, { idFactory: createId, dimensions: { width, height } })
}
