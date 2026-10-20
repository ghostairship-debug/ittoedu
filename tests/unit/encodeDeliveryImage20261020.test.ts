import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { encodeDeliveryImage } from '../../src/renderer/export/componentPlatform/encodeDeliveryImage'
import type { ComponentAsset } from '../../src/shared/contracts/component-platform'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const asset: ComponentAsset = { id: 'source', path: 'assets/source.png', mimeType: 'image/png', filename: 'source.png' }
const source = () => Uint8Array.from({ length: 100 }, (_, i) => i)

function webp(chunks: Array<[string, Uint8Array]>): Uint8Array {
  const bytes = new Uint8Array(12 + chunks.reduce((length, [, data]) => length + 8 + data.length + (data.length & 1), 0))
  const word = (offset: number, value: string) => bytes.set([...value].map(character => character.charCodeAt(0)), offset)
  const view = new DataView(bytes.buffer); word(0, 'RIFF'); word(8, 'WEBP'); view.setUint32(4, bytes.length - 8, true)
  let offset = 12
  for (const [type, data] of chunks) { word(offset, type); view.setUint32(offset + 4, data.length, true); bytes.set(data, offset + 8); offset += 8 + data.length + (data.length & 1) }
  return bytes
}

function canvasDocument(options: { size?: number; type?: string; failDecode?: boolean } = {}) {
  vi.stubGlobal('crypto', webcrypto)
  const create = vi.fn(() => 'blob:source'), revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const decode = vi.fn(async () => { if (options.failDecode) throw new Error('decode failed') })
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((resolve: (blob: unknown) => void) => resolve({ size: options.size ?? 10, type: options.type ?? 'image/webp', arrayBuffer: async () => new ArrayBuffer(options.size ?? 10) })) }
  const dom = { defaultView: { Image: class { src = ''; naturalWidth = 1234; naturalHeight = 567; decode = decode } }, createElement: vi.fn(() => canvas) } as unknown as Document
  return { dom, canvas, decode, create, revoke, options }
}

it('uses production q0.9 at intrinsic pixels and reuses content across concurrent exports and filenames', async () => {
  const h = canvasDocument(), original = source()
  const [first, renamed] = await Promise.all([
    encodeDeliveryImage(asset, original, h.dom),
    encodeDeliveryImage({ ...asset, id: 'duplicate', filename: 'renamed.jpeg' }, original.slice(), h.dom),
  ])
  expect(first).toMatchObject({ mimeType: 'image/webp', filename: 'source.webp' })
  expect(renamed?.filename).toBe('renamed.webp')
  expect(h.canvas).toMatchObject({ width: 1234, height: 567 })
  expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
  expect(h.decode).toHaveBeenCalledTimes(1)
  await encodeDeliveryImage(asset, original.slice(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(1)
  expect(original).toEqual(source())
  expect(h.revoke).toHaveBeenCalledWith('blob:source')
})

it('content changes invalidate the derivative and document lifetime owns the cache', async () => {
  const h = canvasDocument(), changed = source(); changed[99] = 0
  await encodeDeliveryImage(asset, source(), h.dom)
  await encodeDeliveryImage(asset, changed, h.dom)
  expect(h.decode).toHaveBeenCalledTimes(2)
  const second = canvasDocument()
  await encodeDeliveryImage(asset, source(), second.dom)
  expect(second.decode).toHaveBeenCalledTimes(1)
})

it('retains smaller sources and unsupported Canvas output without recompressing on retry', async () => {
  for (const options of [{ size: 100 }, { size: 120 }, { type: 'image/png' }]) {
    const h = canvasDocument(options)
    expect(await encodeDeliveryImage(asset, source(), h.dom)).toBeUndefined()
    expect(await encodeDeliveryImage(asset, source(), h.dom)).toBeUndefined()
    expect(h.decode).toHaveBeenCalledTimes(1)
  }
})

it('preserves animation in APNG and other formats without decoding a single frame', async () => {
  const h = canvasDocument(), apng = new Uint8Array(24)
  apng.set([97, 99, 84, 76], 12)
  expect(await encodeDeliveryImage(asset, apng, h.dom)).toBeUndefined()
  for (const mimeType of ['image/gif', 'image/webp', 'image/avif', 'image/svg+xml']) {
    expect(await encodeDeliveryImage({ ...asset, mimeType }, source(), h.dom)).toBeUndefined()
  }
  expect(h.create).not.toHaveBeenCalled()
})

it('encodes static lossless WebP through the same q0.9 cache while preserving lossy and animated WebP', async () => {
  const h = canvasDocument(), metadata = new Uint8Array(10), image = { ...asset, mimeType: 'image/webp', filename: 'source.webp' }
  const original = webp([['VP8X', metadata], ['ICCP', new Uint8Array(5)], ['VP8L', source()]])
  const before = original.slice()
  expect(await encodeDeliveryImage(image, original, h.dom)).toMatchObject({ mimeType: 'image/webp', filename: 'source.webp' })
  await encodeDeliveryImage(image, original.slice(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(1)
  expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
  expect(original).toEqual(before)
  metadata[0] = 2
  for (const input of [webp([['VP8 ', source()]]), webp([['VP8X', metadata], ['VP8L', source()]]),
    webp([['ANIM', new Uint8Array(6)], ['VP8L', source()]]), webp([['ANMF', source()]]), original.subarray(0, original.length - 2)]) {
    expect(await encodeDeliveryImage(image, input, h.dom)).toBeUndefined()
  }
  expect(h.decode).toHaveBeenCalledTimes(1)
})

it('retries a failed decode and does not poison shared derivatives when one export is cancelled', async () => {
  const h = canvasDocument({ failDecode: true })
  await expect(encodeDeliveryImage(asset, source(), h.dom)).rejects.toThrow('decode failed')
  h.options.failDecode = false
  await encodeDeliveryImage(asset, source(), h.dom)
  expect(h.decode).toHaveBeenCalledTimes(2)
  const controller = new AbortController(); controller.abort()
  await expect(encodeDeliveryImage(asset, source(), h.dom, controller.signal)).rejects.toThrow()
  expect(await encodeDeliveryImage(asset, source(), h.dom)).toBeDefined()
  expect(h.decode).toHaveBeenCalledTimes(2)
})
