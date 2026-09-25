import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createObservationImageResourcePreparer } from '@/renderer/authoring/generation/observationImageResources'

function projectWithImage(assetId: string, mimeType: string, byteLength: number) {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  project.assets[assetId] = {
    id: assetId, kind: 'image', filename: `${assetId}.png`, path: `assets/${assetId}.png`, mimeType, byteLength,
  }
  return project
}

describe('observation original-image resources', () => {
  it('caches successful and failed full decodes by the actual bytes and MIME type, then re-decodes replacement bytes', async () => {
    const valid = Uint8Array.from([1, 2, 3]), damaged = Uint8Array.from([4, 5, 6])
    const decoder = vi.fn(async (bytes: Uint8Array) => {
      if (bytes === damaged) throw new Error('damaged pixels')
      return { width: 1, height: 1 }
    })
    const prepare = createObservationImageResourcePreparer(decoder)
    const project = projectWithImage('valid', 'image/png', valid.byteLength)
    project.assets.damaged = {
      id: 'damaged', kind: 'image', filename: 'damaged.png', path: 'assets/damaged.png', mimeType: 'image/png', byteLength: damaged.byteLength,
    }
    const input = { document: project, assetFiles: { valid, damaged }, assetIds: ['valid', 'damaged'] }

    const first = await prepare(input)
    const repeat = await prepare(input)
    expect(first.originalImages).toMatchObject([{ assetId: 'valid', fileId: 'original-image-0', relativePath: 'observation/images/0.png' }])
    expect(first.unavailableOriginalImages).toMatchObject([{ assetId: 'damaged', code: 'image-decode-failed' }])
    expect(repeat).toEqual(first)
    expect(decoder).toHaveBeenCalledTimes(2)

    const replacement = Uint8Array.from(valid)
    const afterReplacement = await prepare({ ...input, assetFiles: { valid: replacement, damaged } })
    expect(afterReplacement.originalImages[0]?.bytes).toBe(replacement)
    expect(decoder).toHaveBeenCalledTimes(3)

    project.assets.valid = { ...project.assets.valid!, mimeType: 'image/webp' }
    await prepare({ ...input, assetFiles: { valid: replacement, damaged } })
    expect(decoder).toHaveBeenCalledTimes(4)
  })

  it('checks declared byte length on every capture before consulting the decode cache', async () => {
    const bytes = Uint8Array.from([7, 8, 9])
    const decoder = vi.fn(async () => ({ width: 1, height: 1 }))
    const prepare = createObservationImageResourcePreparer(decoder)
    const project = projectWithImage('length-check', 'image/png', bytes.byteLength)
    const input = { document: project, assetFiles: { 'length-check': bytes }, assetIds: ['length-check'] }

    await expect(prepare(input)).resolves.toMatchObject({ originalImages: [{ assetId: 'length-check' }] })
    expect(decoder).toHaveBeenCalledTimes(1)
    project.assets['length-check'] = { ...project.assets['length-check']!, byteLength: bytes.byteLength + 1 }
    await expect(prepare(input)).resolves.toMatchObject({
      originalImages: [],
      unavailableOriginalImages: [{ assetId: 'length-check', code: 'image-byte-length-mismatch', expectedByteLength: 4, actualByteLength: 3 }],
    })
    expect(decoder).toHaveBeenCalledTimes(1)
  })

  it('keeps a valid SVG as structure and derives a verified PNG image attachment', async () => {
    const vector = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#2563eb"/></svg>')
    const png = Uint8Array.from([137, 80, 78, 71])
    const decoder = vi.fn(async (_bytes: Uint8Array, mimeType: string) => {
      if (mimeType === 'image/svg+xml') return { width: 4, height: 3 }
      if (mimeType === 'image/png') return { width: 4, height: 3 }
      throw new Error(`unexpected ${mimeType}`)
    })
    const rasterizer = vi.fn(async () => png)
    const prepare = createObservationImageResourcePreparer(decoder, rasterizer)
    const project = projectWithImage('vector', 'image/svg+xml', vector.byteLength)
    project.assets.vector = { ...project.assets.vector!, filename: 'vector-is-not-a-png.jpg' }

    const result = await prepare({ document: project, assetFiles: { vector }, assetIds: ['vector'] })

    expect(result.originalImages).toMatchObject([{
      assetId: 'vector', fileId: 'original-image-0', relativePath: 'observation/original-images/0.svg',
      mediaType: 'image/svg+xml', attachmentRole: 'structure', bytes: vector,
    }])
    expect(result.derivedImages).toMatchObject([{
      assetId: 'vector', fileId: 'derived-image-0', relativePath: 'observation/images/0.png',
      mediaType: 'image/png', derivedFrom: 'original-image-0', bytes: png,
    }])
    expect(result.unavailableOriginalImages).toEqual([])
    expect(result.unavailableDerivedImages).toEqual([])
    expect(rasterizer).toHaveBeenCalledWith(vector, { width: 4, height: 3 })
    expect(decoder).toHaveBeenCalledTimes(2)
  })

  it('retains a decoded SVG original when its optional PNG conversion fails, and uses MIME rather than filename for raster paths', async () => {
    const vector = Uint8Array.from([1, 2, 3]), raster = Uint8Array.from([4, 5, 6])
    const decoder = vi.fn(async () => ({ width: 2, height: 2 }))
    const prepare = createObservationImageResourcePreparer(decoder, vi.fn(async () => { throw new Error('canvas unavailable') }))
    const project = projectWithImage('vector', 'image/svg+xml', vector.byteLength)
    project.assets.vector = { ...project.assets.vector!, filename: 'vector.jpg' }
    project.assets.raster = {
      id: 'raster', kind: 'image', filename: 'raster.svg', path: 'assets/raster.svg', mimeType: 'image/png', byteLength: raster.byteLength,
    }

    const result = await prepare({ document: project, assetFiles: { vector, raster }, assetIds: ['vector', 'raster'] })

    expect(result.originalImages).toMatchObject([
      { assetId: 'vector', relativePath: 'observation/original-images/0.svg', attachmentRole: 'structure' },
      { assetId: 'raster', relativePath: 'observation/images/1.png', attachmentRole: 'image' },
    ])
    expect(result.derivedImages).toEqual([])
    expect(result.unavailableDerivedImages).toMatchObject([{ assetId: 'vector', code: 'image-rasterization-failed' }])
  })
})
