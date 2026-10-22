import { imageTransformInputSchema } from '../../shared/imageTransformContract'
import { ImageTransformSourceError, readImageTransformSource, transformImageAsset } from './imageTransform'
import type { ImageTransformWorkerInput, ImageTransformWorkerReply } from './imageTransformWorkerPort'

/** The renderer alone opts into a worker; universal Source consumers retain the pure implementation. */
export async function transformImageAssetOffThread(bytes: Uint8Array, mimeType: string, rawInput: unknown, signal?: AbortSignal) {
  if (typeof Worker === 'undefined') return transformImageAsset(bytes, mimeType, rawInput, signal)
  const input = imageTransformInputSchema.parse(rawInput)
  signal?.throwIfAborted()
  // JPEG/WebP use the existing browser decoder. The expensive pixel/PNG stages
  // use the same algorithms in the worker; PNG also decodes there losslessly.
  const source = mimeType === 'image/png' ? undefined : await readImageTransformSource(bytes, mimeType, signal)
  signal?.throwIfAborted()
  return new Promise<Awaited<ReturnType<typeof transformImageAsset>>>((resolve, reject) => {
    const worker = new Worker(new URL('./imageTransformWorker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (work: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      work()
    }
    const abort = () => finish(() => reject(new Error('图片变换已停止')))
    worker.onmessage = ({ data }: MessageEvent<ImageTransformWorkerReply>) => finish(() => {
      if (signal?.aborted) reject(new Error('图片变换已停止'))
      else if (data.ok) resolve(data.result)
      else reject(data.sourceStatus ? new ImageTransformSourceError(data.sourceStatus, data.message) : new Error(data.message))
    })
    worker.onerror = event => finish(() => reject(new Error(event.message || '图片变换 worker 未能完成')))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try {
      // Structured cloning copies working data. The Session's canonical buffer
      // remains usable for Undo, saving, and any other live image consumer.
      worker.postMessage({ bytes, mimeType, input, ...(source ? { source } : {}) } satisfies ImageTransformWorkerInput)
    } catch (error) { finish(() => reject(error)) }
  })
}
