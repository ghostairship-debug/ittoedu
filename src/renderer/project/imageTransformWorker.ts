import { ImageTransformSourceError, transformDecodedImage, transformImageAsset } from './imageTransform'
import type { ImageTransformWorkerInput, ImageTransformWorkerReply } from './imageTransformWorkerPort'

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ImageTransformWorkerInput>) => void) | null
  postMessage(value: ImageTransformWorkerReply): void
}
worker.onmessage = ({ data }) => {
  worker.onmessage = null
  void (async () => {
    try {
      const result = data.source ? transformDecodedImage(data.source, data.bytes, data.input)
        : await transformImageAsset(data.bytes, data.mimeType, data.input)
      worker.postMessage({ ok: true, result })
    } catch (error) {
      worker.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ImageTransformSourceError ? { sourceStatus: error.status } : {}) })
    }
  })()
}
