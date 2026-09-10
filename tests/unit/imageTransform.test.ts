// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { crc32, inflateSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import sharp from 'sharp'
import { buildArchitectureBaselineFixtureOutputs } from '../../scripts/build-architecture-baseline-fixtures'
import { imageTransformInputSchema, MAX_IMAGE_TRANSFORM_PIXELS } from '@/shared/imageTransformContract'
import { decodeImageTransformPng, encodeImageTransformPng, inspectImageTransformSource, transformImageAsset, transformImagePixels } from '@/renderer/project/imageTransform'

const intent = (operations: unknown[]) => imageTransformInputSchema.parse({ sourceAssetId: 'original', operations })
const redToGreen = () => intent([{ kind: 'replace-color', sourceColor: '#ff0000' }])
const pixels = (values: number[][], width = values.length) => ({ width, height: values.length / width, data: Uint8Array.from(values.flat()) })
const red = [255, 0, 0, 255], green = [34, 197, 94, 255]
const corruptBaselinePng = () => new Uint8Array(readFileSync(new URL('../fixtures/image-validation/architecture-baseline-corrupt-idat.png', import.meta.url)))

describe('deterministic original-image transforms', () => {
  it('generates decodable and recolorable PNG assets in every architecture baseline archive', async () => {
    const built = buildArchitectureBaselineFixtureOutputs()
    for (const fixture of built.manifest.fixtures) {
      const images = Object.entries(unzipSync(built.outputs[fixture.filename]!)).filter(([path]) => path.endsWith('.png'))
      expect(images.length, fixture.filename).toBeGreaterThan(0)
      for (const [path, bytes] of images) {
        const original = await sharp(bytes, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        expect(original.info, `${fixture.filename}/${path}`).toMatchObject({ width: 1, height: 1, channels: 4 })
        expect([...original.data]).toEqual(red)
        await expect(inspectImageTransformSource(bytes, 'image/png')).resolves.toEqual({ status: 'ready', width: 1, height: 1 })
        const transformed = await transformImageAsset(bytes, 'image/png', redToGreen())
        expect([...await sharp(transformed.bytes, { failOn: 'warning' }).ensureAlpha().raw().toBuffer()]).toEqual(green)
      }
    }
  })

  it('rejects the retained baseline PNG with its original corrupt IDAT checksum', async () => {
    const source = corruptBaselinePng(), original = source.slice()
    expect(() => decodeImageTransformPng(source)).toThrow('IDAT（偏移 33）')
    await expect(inspectImageTransformSource(source, 'image/png')).resolves.toMatchObject({
      status: 'failed', code: 'image-source-decode-failed', message: expect.stringContaining('IDAT（偏移 33）'),
    })
    expect(source).toEqual(original)
  })

  it('rejects the retained baseline zlib corruption even after the IDAT chunk CRC is repaired', async () => {
    const bytes = corruptBaselinePng(), view = new DataView(bytes.buffer)
    // Preserve the original bad zlib trailer; repair only its containing chunk.
    view.setUint32(53, crc32(bytes.subarray(37, 53)))
    expect(() => inflateSync(bytes.subarray(41, 53))).toThrow('incorrect data check')
    expect(() => decodeImageTransformPng(bytes)).toThrow('Adler-32')
    await expect(inspectImageTransformSource(bytes, 'image/png')).resolves.toMatchObject({
      status: 'failed', code: 'image-source-decode-failed', message: expect.stringContaining('Adler-32'),
    })
  })

  it('distinguishes unsupported source formats and 16-bit precision in preflight and execution', async () => {
    const highPrecision = await sharp(Uint8Array.from(red), { raw: { width: 1, height: 1, channels: 4 } }).toColourspace('rgb16').png().toBuffer()
    expect((await sharp(highPrecision).metadata()).bitsPerSample).toBe(16)
    const gif = await sharp(Uint8Array.from(red), { raw: { width: 1, height: 1, channels: 4 } }).gif().toBuffer()
    for (const [bytes, mimeType, message] of [[highPrecision, 'image/png', '16 位'], [gif, 'image/gif', '其他格式']] as const) {
      await expect(inspectImageTransformSource(bytes, mimeType)).resolves.toMatchObject({
        status: 'unsupported', code: 'image-source-unsupported', message: expect.stringContaining(message),
      })
      await expect(transformImageAsset(bytes, mimeType, redToGreen())).rejects.toMatchObject({
        status: 'unsupported', code: 'image-source-unsupported', message: expect.stringContaining(message),
      })
    }
  })

  it('does not report a cancelled source inspection as ready or decode failure', async () => {
    const stop = new AbortController(); stop.abort()
    await expect(inspectImageTransformSource(encodeImageTransformPng(pixels([red])), 'image/png', stop.signal)).rejects.toThrow('已停止')
  })

  it('changes a real 1×1 PNG from red to the declared default green and independently decodes output', async () => {
    const source = await sharp(Uint8Array.from(red), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer()
    const result = await transformImageAsset(source, 'image/png', redToGreen())
    const decoded = await sharp(result.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([...decoded.data]).toEqual(green)
    expect(decoded.info).toMatchObject({ width: 1, height: 1, channels: 4 })
    expect(result.effects).toEqual([{ kind: 'replace-color', changedPixels: 1, targetColor: '#22c55e' }])
    expect([...await sharp(source).ensureAlpha().raw().toBuffer()]).toEqual(red)
  })

  it('preserves text-like black/white detail, every non-target channel, and alpha including hidden RGB', async () => {
    const input = pixels([red, [0, 0, 0, 255], [255, 255, 255, 255], [3, 57, 201, 37], [255, 0, 0, 117], [213, 75, 29, 0]], 3)
    const source = encodeImageTransformPng(input)
    const result = await transformImageAsset(source, 'image/png', redToGreen())
    const expected = [...green, 0, 0, 0, 255, 255, 255, 255, 255, 3, 57, 201, 37, 34, 197, 94, 117, 213, 75, 29, 0]
    expect([...await sharp(result.bytes).ensureAlpha().raw().toBuffer()]).toEqual(expected)
    expect([...decodeImageTransformPng(source).data]).toEqual([...input.data])
  })

  it('keeps real text glyphs and transparent margins intact while recoloring one region of a multicolor original', async () => {
    const svg = `<svg width="240" height="100" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="56" height="60" fill="#ff0000"/>
      <rect x="170" y="8" width="56" height="60" fill="#ff0000" opacity=".5"/><text x="72" y="45" font-family="Arial" font-size="24" fill="#111111">KEEP</text>
      <circle cx="120" cy="76" r="8" fill="#125cdd"/></svg>`
    const source = await sharp(Buffer.from(svg)).png().toBuffer()
    const original = await sharp(source).ensureAlpha().raw().toBuffer()
    const result = await transformImageAsset(source, 'image/png', intent([{ kind: 'replace-color', sourceColor: '#ff0000',
      region: { x: 0, y: 0, width: 70, height: 100 } }]))
    const edited = await sharp(result.bytes).ensureAlpha().raw().toBuffer()
    let redPixels = 0, textPixels = 0
    for (let y = 0; y < 100; y++) for (let x = 0; x < 240; x++) {
      const i = (y * 240 + x) * 4
      if (x < 70 && original[i] === 255 && original[i + 3] !== 0) {
        redPixels++
        expect([...edited.subarray(i, i + 4)]).toEqual([34, 197, 94, original[i + 3]])
      } else expect([...edited.subarray(i, i + 4)]).toEqual([...original.subarray(i, i + 4)])
      if (x >= 72 && x < 170 && y < 60 && original[i + 3] !== 0) textPixels++
    }
    expect(redPixels).toBe(56 * 60)
    expect(textPixels).toBeGreaterThan(100)
  })

  it('applies RGB Euclidean tolerance only inside the intersection of region and an explicit binary mask', () => {
    const input = pixels([red, [255, 20, 20, 200], [255, 24, 24, 255], red, red, red], 3)
    const result = transformImagePixels(input, intent([{ kind: 'replace-color', sourceColor: '#ff0000',
      region: { x: 0, y: 0, width: 3, height: 1 }, mask: { width: 3, height: 2, bits: '011111' } }]))
    expect([...result.data]).toEqual([...red, 34, 197, 94, 200, 255, 24, 24, 255, ...red, ...red, ...red])
    expect(result.effects[0]?.changedPixels).toBe(1)
  })

  it('crops then resizes using declared nearest-neighbor coordinates without inventing alpha or colors', async () => {
    const input = pixels([red, [0, 20, 200, 93], [20, 0, 200, 0], [0, 0, 0, 255]], 2)
    const result = await transformImageAsset(encodeImageTransformPng(input), 'image/png', intent([
      { kind: 'crop', region: { x: 1, y: 0, width: 1, height: 2 } }, { kind: 'resize', width: 2, height: 4 },
    ]))
    expect(result).toMatchObject({ width: 2, height: 4 })
    expect([...await sharp(result.bytes).ensureAlpha().raw().toBuffer()]).toEqual([
      ...[0, 20, 200, 93], ...[0, 20, 200, 93], ...[0, 20, 200, 93], ...[0, 20, 200, 93],
      ...[0, 0, 0, 255], ...[0, 0, 0, 255], ...[0, 0, 0, 255], ...[0, 0, 0, 255],
    ])
  })

  it.each([{ palette: false, progressive: false }, { palette: false, progressive: true },
    { palette: true, progressive: false, colours: 4 }, { palette: true, progressive: true, colours: 4 }])(
    'decodes actual PNG filters, palettes and Adam7 without a Canvas conversion: %j', async options => {
      const input = pixels([red, [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 255, 128], red, red], 3)
      const source = await sharp(input.data, { raw: { width: input.width, height: input.height, channels: 4 } }).png(options).toBuffer()
      const expected = await sharp(source).ensureAlpha().raw().toBuffer()
      expect([...decodeImageTransformPng(source).data]).toEqual([...expected])
    })

  it('rejects malformed PNG, impossible size, empty mask, out-of-bounds region, absent color and cancellation', async () => {
    const input = pixels([red]), source = encodeImageTransformPng(input)
    const corrupt = source.slice(); corrupt[44] ^= 1
    await expect(transformImageAsset(corrupt, 'image/png', redToGreen())).rejects.toThrow('校验失败')
    expect(() => transformImagePixels({ width: MAX_IMAGE_TRANSFORM_PIXELS + 1, height: 1, data: new Uint8Array() }, redToGreen())).toThrow('1600 万')
    expect(() => intent([{ kind: 'replace-color', sourceColor: '#ff0000', mask: { width: 1, height: 1, bits: '0' } }])).toThrow('没有选中像素')
    expect(() => transformImagePixels(input, intent([{ kind: 'crop', region: { x: 1, y: 0, width: 1, height: 1 } }]))).toThrow('超出')
    expect(() => transformImagePixels(input, intent([{ kind: 'replace-color', sourceColor: '#0000ff' }]))).toThrow('没有匹配')
    expect(() => transformImagePixels(pixels([red, red], 2), intent([{ kind: 'replace-color', sourceColor: '#ff0000',
      region: { x: 0, y: 0, width: 1, height: 1 }, mask: { width: 2, height: 1, bits: '01' } }]))).toThrow('没有共同选中')
    const stop = new AbortController(); stop.abort()
    await expect(transformImageAsset(source, 'image/png', redToGreen(), stop.signal)).rejects.toThrow('已停止')
  })

  it('rejects missing source color, extra transform fields, lossy output and forged image bytes in the intent', () => {
    for (const value of [
      { sourceAssetId: 'original', operations: [{ kind: 'replace-color' }] },
      { ...redToGreen(), base64: 'AAAA' }, { ...redToGreen(), outputFormat: 'jpeg' },
      { ...redToGreen(), operations: [{ kind: 'resize', width: 3, height: 1.5 }] },
      { ...redToGreen(), operations: [{ kind: 'replace-color', sourceColor: '#ff0000', overlay: true }] },
    ]) expect(imageTransformInputSchema.safeParse(value).success).toBe(false)
  })
})
