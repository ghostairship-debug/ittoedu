import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readImageDimensions } from '../../src/renderer/project/assetManager'

const close = vi.fn(), image = vi.fn(), createURL = vi.fn(() => 'blob:dimensions'), revoke = vi.fn()
const decode = vi.fn(async (source: Blob | HTMLImageElement) => {
  if (source instanceof NodeBlob && new Uint8Array(await source.arrayBuffer())[0] === 0) throw new Error('damaged compressed pixels')
  return { width: 220, height: 110, close }
})
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createURL; static revokeObjectURL = revoke })
  vi.stubGlobal('Image', class { naturalWidth = 220; naturalHeight = 110; onload: (() => void) | null = null
    constructor() { image() }; set src(_url: string) { queueMicrotask(() => this.onload?.()) } })
})
afterEach(() => vi.unstubAllGlobals())

it('gets raster dimensions from one full bitmap decode without an extra Image decode or URL', async () => {
  await expect(readImageDimensions(Uint8Array.of(1), 'image/jpeg')).resolves.toEqual({ width: 220, height: 110 })
  expect(decode).toHaveBeenCalledOnce(); expect(decode.mock.calls[0]![0]).toBeInstanceOf(NodeBlob)
  expect(image).not.toHaveBeenCalled(); expect(createURL).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
})
it('still rejects damaged compressed pixels before accepting raster dimensions', async () => {
  await expect(readImageDimensions(Uint8Array.of(0), 'image/png')).rejects.toThrow('无法完整解码')
  expect(decode).toHaveBeenCalledOnce(); expect(image).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
it('keeps the SVG document and Image route, closes the bitmap and revokes its URL', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"/>')
  await expect(readImageDimensions(svg, 'image/svg+xml')).resolves.toEqual({ width: 220, height: 110 })
  expect(image).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledWith(expect.anything(), { resizeWidth: 220, resizeHeight: 110 })
  expect(close).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce()
  await expect(readImageDimensions(Uint8Array.of(0), 'image/svg+xml')).rejects.toThrow('无法完整解码')
  expect(decode).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledTimes(2)
})
