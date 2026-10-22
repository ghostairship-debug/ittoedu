// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeImageTransformPng, decodeImageTransformPng, transformImageAsset } from '../../src/renderer/project/imageTransform'
import { transformImageAssetOffThread } from '../../src/renderer/project/imageTransformWorkerClient'
import type { ImageTransformWorkerInput, ImageTransformWorkerReply } from '../../src/renderer/project/imageTransformWorkerPort'

afterEach(() => vi.unstubAllGlobals())
const input = { sourceAssetId: 'original', operations: [{ kind: 'replace-color', sourceColor: '#ff0000', targetColor: '#00ff00', tolerance: 0 }] }

describe('renderer image-transform worker boundary', () => {
  it('uses an isolated working message and preserves original bytes, alpha, and hidden PNG RGB', async () => {
    let sent!: ImageTransformWorkerInput
    const terminate = vi.fn()
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent<ImageTransformWorkerReply>) => void
      onerror?: (event: ErrorEvent) => void
      terminate = terminate
      postMessage(value: ImageTransformWorkerInput) {
        // A real Worker applies structured clone. Keep the same ownership boundary here.
        sent = structuredClone(value)
        void transformImageAsset(sent.bytes, sent.mimeType, sent.input).then(result => this.onmessage?.({ data: { ok: true, result } } as MessageEvent<ImageTransformWorkerReply>))
      }
    })
    const originalPixels = new Uint8Array([255, 0, 0, 255, 19, 31, 47, 0])
    const bytes = encodeImageTransformPng({ width: 2, height: 1, data: originalPixels }), original = bytes.slice()
    const result = await transformImageAssetOffThread(bytes, 'image/png', input)
    expect(sent.bytes).not.toBe(bytes)
    expect(bytes).toEqual(original)
    expect([...decodeImageTransformPng(result.bytes).data]).toEqual([0, 255, 0, 255, 19, 31, 47, 0])
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('terminates only the current worker when the authoring operation is stopped', async () => {
    const terminate = vi.fn()
    vi.stubGlobal('Worker', class { onmessage = null; onerror = null; terminate = terminate; postMessage() {} })
    const controller = new AbortController()
    const bytes = encodeImageTransformPng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) })
    const result = transformImageAssetOffThread(bytes, 'image/png', input, controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow('图片变换已停止')
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})
