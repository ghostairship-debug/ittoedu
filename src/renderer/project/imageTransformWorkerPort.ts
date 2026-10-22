import type { DecodedImage } from '../../shared/imageTransform'
import type { ImageTransformInput } from '../../shared/imageTransformContract'
import type { transformImageAsset } from './imageTransform'

export interface ImageTransformWorkerInput {
  bytes: Uint8Array
  mimeType: string
  input: ImageTransformInput
  /** Browser-decoded JPEG/WebP; PNG decoding stays in the worker to preserve hidden RGB. */
  source?: DecodedImage
}
export type ImageTransformWorkerReply =
  | { ok: true; result: Awaited<ReturnType<typeof transformImageAsset>> }
  | { ok: false; message: string; sourceStatus?: 'unsupported' | 'failed' }
