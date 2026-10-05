import { createImageAssetMetadata, type ImageAssetResource } from '../../core/tools/imageAssetMetadata'
import type { PrepareImageResourcePort } from '../../core/tools/imageResource'
import { imageTransformInputSchema, type ImageTransformOperation } from '../../shared/imageTransformContract'
import { transformImageAsset } from '../../renderer/project/imageTransform'
import type { ImageData } from './data'
import { nanoid } from 'nanoid'

export interface ImageSourceResource {
  assetId: string
  filename: string
  mimeType: string
  bytes: Uint8Array
}

export interface ImageTransformPlan {
  data: ImageData
  resource?: ImageAssetResource
  sourceAssetId: string
  changed: boolean
}

/** Resource producer can be supplied by L03; the default reuses the existing metadata owner. */
export async function planImageTransform(
  data: ImageData,
  source: ImageSourceResource,
  operations: readonly ImageTransformOperation[],
  options: { signal?: AbortSignal; createId?: () => string; prepareResource?: PrepareImageResourcePort } = {},
): Promise<ImageTransformPlan> {
  if (source.assetId !== data.assetId) throw new Error('所选图片已不再引用本次源资源，请重新观察')
  const input = imageTransformInputSchema.parse({ sourceAssetId: source.assetId, operations })
  const transformed = await transformImageAsset(source.bytes, source.mimeType, input, options.signal)
  if (!transformed.changed) return { data, sourceAssetId: source.assetId, changed: false }
  const filename = `${source.filename.replace(/\.[^.]+$/, '')}-edited.png`
  const resource = options.prepareResource
    ? await options.prepareResource({ bytes: transformed.bytes, mimeType: 'image/png', filename }, options.createId ?? nanoid)
    : createImageAssetMetadata({ name: filename, mimeType: 'image/png', bytes: transformed.bytes }, {
      idFactory: options.createId, dimensions: { width: transformed.width, height: transformed.height },
    })
  options.signal?.throwIfAborted()
  if (resource.meta.id === data.assetId || resource.meta.id === data.originalAssetId) {
    throw new Error('派生图片必须使用新资源身份，不能覆盖原件或当前共享图片')
  }
  return { sourceAssetId: source.assetId, changed: true, resource,
    data: { ...data, assetId: resource.meta.id,
      // Pixel crop changes the coordinate system. A previous display crop must not crop it twice.
      ...(operations.some(operation => operation.kind === 'crop')
        ? { crop: { left: 0, top: 0, right: 0, bottom: 0 } } : {}),
    } }
}
