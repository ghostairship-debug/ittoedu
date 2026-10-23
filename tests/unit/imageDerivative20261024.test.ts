import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { imageDerivativePlan, imageDerivativeTraits } from '../../src/shared/imageDerivative'
import { createGeneratedImagePreparer } from '../../src/renderer/project/prepareGeneratedImage'

afterEach(() => { vi.unstubAllGlobals() })

const staticImage = { animated: false, alpha: false, lossy: false }
const source = { width: 4000, height: 3000 }
describe('runtime image demand keeps author geometry and originals', () => {
  it('uses actual CSS size and DPR without an unrelated longest-edge cap or upscale', () => {
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 1200, height: 900 })).toMatchObject({ width: 2400, height: 1800 })
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 100, height: 100 })).toMatchObject({ width: 200, height: 150 })
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 9000, height: 9000 })).toMatchObject({ width: 4000, height: 3000, resized: false })
  })
  it('budgets the visible cropped window while retaining the full carrier and normalized crop coordinates', () => {
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 400, height: 300,
      crop: { x: 0.5, y: 0.25, width: 0.25, height: 0.25 } })).toMatchObject({ width: 3200, height: 2400 })
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 400, height: 300,
      crop: { x: 0, y: 0, width: 0.1, height: 0.1 } })).toMatchObject({ width: 4000, height: 3000 })
  })
  it('distinguishes contain from cover/stretch and supports explicit display DPR', () => {
    const demand = { width: 100, height: 500, dpr: 1 }
    expect(imageDerivativePlan(source, 'image/jpeg', staticImage, demand)).toMatchObject({ width: 100, height: 75 })
    expect(imageDerivativePlan(source, 'image/jpeg', staticImage, { ...demand, fit: 'cover' })).toMatchObject({ width: 667, height: 500 })
    expect(imageDerivativePlan(source, 'image/jpeg', staticImage, { ...demand, fit: 'stretch' })).toMatchObject({ width: 667, height: 500 })
  })
  it('does not guess an unknown program use, flatten animation/vector or erase the high-quality exception', () => {
    for (const [mimeType, traits, demand] of [
      ['image/png', staticImage, undefined],
      ['image/svg+xml', staticImage, { width: 20, height: 20 }],
      ['image/png', { ...staticImage, animated: true }, { width: 20, height: 20 }],
      ['image/png', staticImage, { width: 20, height: 20, quality: 'original' }],
    ] as const) expect(imageDerivativePlan(source, mimeType, traits, demand)).toMatchObject({ ...source, resized: false })
  })
  it('retains fine-chart PNG losslessly and alpha at conservative quality', () => {
    expect(imageDerivativePlan(source, 'image/png', staticImage).outputMimeType).toBe('image/png')
    expect(imageDerivativePlan(source, 'image/png', staticImage).encode).toBe(false)
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 500, height: 400 }).outputMimeType).toBe('image/png')
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 500, height: 400, quality: 'photo' }).outputMimeType).toBe('image/webp')
    expect(imageDerivativePlan(source, 'image/png', staticImage, { width: 500, height: 400, quality: 'detail' }))
      .toMatchObject({ width: 1000, height: 750, outputMimeType: 'image/png' })
    expect(imageDerivativePlan(source, 'image/webp', staticImage, { width: 500, height: 400, quality: 'detail' }).outputMimeType).toBe('image/png')
    expect(imageDerivativePlan(source, 'image/png', { ...staticImage, alpha: true }, { width: 500, height: 400 }).quality).toBe(0.94)
    expect(imageDerivativePlan(source, 'image/jpeg', { ...staticImage, lossy: true }, { width: 500, height: 400, quality: 'photo' }).quality).toBe(0.84)
  })
  it('does not repeatedly encode a lossy WebP unless its actual required pixel count decreases', () => {
    const traits = { ...staticImage, lossy: true }
    expect(imageDerivativePlan(source, 'image/webp', traits).encode).toBe(false)
    expect(imageDerivativePlan(source, 'image/webp', traits, { width: 4000, height: 3000 }).encode).toBe(false)
    expect(imageDerivativePlan(source, 'image/webp', traits, { width: 500, height: 400 }).encode).toBe(true)
  })
  it('detects APNG, indexed transparency and truncated/animated WebP before rendering', () => {
    const png = new Uint8Array(45), view = new DataView(png.buffer)
    view.setUint32(8, 13); png[25] = 6
    png.set([...`acTL`].map(c => c.charCodeAt(0)), 37)
    expect(imageDerivativeTraits(png, 'image/png')).toMatchObject({ animated: true, alpha: true })
    expect(imageDerivativeTraits(new Uint8Array(12), 'image/webp').animated).toBe(true)
    expect(imageDerivativeTraits(new Uint8Array(), 'image/gif').animated).toBe(true)
  })
})

it('generated preparation shares work across byte copies/filenames and returns each untouched editing original', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const bytes = new Uint8Array(300); bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const derivative = bytes.slice(0, 100)
  const resize = vi.fn(async () => derivative)
  const dimensions = vi.fn(async (input: Uint8Array) => input.length === 300 ? { width: 2000, height: 1000 } : { width: 200, height: 100 })
  const prepare = createGeneratedImagePreparer({ resize, dimensions })
  const demand = { bytes, mimeType: 'image/png', filename: 'first.png', display: { width: 100, height: 50 }, quality: 'detail' as const }
  const [first, second] = await Promise.all([prepare(demand), prepare({ ...demand, filename: 'second.png', bytes: bytes.slice() })])
  expect(resize).toHaveBeenCalledTimes(1)
  expect(first.bytes).toBe(second.bytes)
  expect(first).toMatchObject({ width: 200, height: 100, filename: 'first.png', original: { filename: 'first.png', width: 2000, height: 1000 } })
  expect(second.original.filename).toBe('second.png')
  expect(first.original.bytes).toEqual(bytes)
  expect(first.original.bytes).not.toBe(bytes)
  expect(first.original.bytes).toBe(second.original.bytes)
  expect(await prepare(demand)).toBe(first)
})
