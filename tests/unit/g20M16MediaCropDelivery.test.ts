import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import sharp from 'sharp'
import type { PublishedFlowSurface } from '@/shared/contracts/published-course-v2/types'
import { encodeImageTransformPng } from '@/shared/imageTransform'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'

const bytes = encodeImageTransformPng({ width: 8, height: 4, data: new Uint8Array(8 * 4 * 4) })
const dataUrl = (source: Uint8Array, mimeType: string) => `data:${mimeType};base64,${btoa(String.fromCharCode(...source))}`
function surface(crop: boolean): PublishedFlowSurface {
  return { id: 'flow', type: 'flow', title: 'Media', layout: { readingWidth: 760, wideContentWidth: 960 }, surfaceLayerItems: [], blocks: [{
    id: 'photo', type: 'media', assetId: 'original', mediaKind: 'image', layout: 'content-width', altText: 'Original',
    ...(crop ? { crop: { left: 0.125, top: 0.25, right: 0.25, bottom: 0 }, cropX: 0.7, cropY: 0.4 } : {}),
  }] }
}

describe('M16 body media crop delivery', () => {
  it('uses cropped source aspect in print HTML and DOCX while embedding original PNG bytes', () => {
    const source = surface(true)
    const plan = buildFlowPrintPlan(source)
    expect(plan.includesFloatingLayers).toBe(false)
    expect(plan.nodes.find(node => node.type === 'media')).toMatchObject({ crop: { left: 0.125, top: 0.25, right: 0.25, bottom: 0 } })
    const html = renderFlowPrintBodyHtml(plan, { resolveAssetUrl: () => dataUrl(bytes, 'image/png') })
    const rendered = new DOMParser().parseFromString(html, 'text/html')
    const wrapper = rendered.querySelector('.flow-print-image-crop') as HTMLElement
    const image = wrapper.querySelector('img') as HTMLElement
    expect(wrapper.style.aspectRatio).toBe('5 / 3')
    expect(wrapper.style.overflow).toBe('hidden')
    expect(image.style.position).toBe('absolute')
    expect(image.style.width).toBe('160%')
    expect(image.style.left).toBe('-20%')
    const result = buildFlowDocx(source, { resolveAsset: () => ({ bytes, mimeType: 'image/png' }) })
    const files = unzipSync(result.bytes)
    const xml = new DOMParser().parseFromString(strFromU8(files['word/document.xml']!), 'application/xml')
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0)
    const drawing = xml.getElementsByTagNameNS('*', 'inline')[0]!
    const extent = drawing.getElementsByTagNameNS('*', 'extent')[0]!
    const ratio = Number(extent.getAttribute('cx')) / Number(extent.getAttribute('cy'))
    expect(ratio).toBeCloseTo(5 / 3, 2)
    const srcRect = drawing.getElementsByTagNameNS('*', 'srcRect')[0]!
    expect([srcRect.getAttribute('l'), srcRect.getAttribute('t'), srcRect.getAttribute('r'), srcRect.getAttribute('b')]).toEqual(['12500', '25000', '25000', '0'])
    expect(files['word/media/image1.png']).toEqual(bytes)
  })

  it.each(['image/webp', 'image/svg+xml'] as const)('prints valid cropped %s and reports the existing DOCX fallback', async mimeType => {
    const sourceBytes = mimeType === 'image/webp'
      ? new Uint8Array(await sharp({ create: { width: 12, height: 6, channels: 4, background: '#ff0000' } }).webp().toBuffer())
      : new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="red"/></svg>')
    const html = renderFlowPrintBodyHtml(buildFlowPrintPlan(surface(true)), { resolveAssetUrl: () => dataUrl(sourceBytes, mimeType) })
    const rendered = new DOMParser().parseFromString(html, 'text/html')
    const [width, height] = (rendered.querySelector('.flow-print-image-crop') as HTMLElement).style.aspectRatio.split(' / ').map(Number)
    expect(width / height).toBeCloseTo(5 / 3)
    const output = buildFlowDocx(surface(true), { resolveAsset: () => ({ bytes: sourceBytes, mimeType }) })
    expect(output.warnings).toEqual(expect.arrayContaining([expect.stringContaining('image crop could not be represented in DOCX')]))
    expect(strFromU8(unzipSync(output.bytes)['word/document.xml']!)).toContain('媒体后备')
  })

  it.each(['image/webp', 'image/svg+xml'] as const)('accepts valid zero-edge crop for %s in print HTML', async mimeType => {
    const sourceBytes = mimeType === 'image/webp'
      ? new Uint8Array(await sharp({ create: { width: 12, height: 6, channels: 4, background: '#ff0000' } }).webp().toBuffer())
      : new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>')
    const source = surface(true)
    const media = source.blocks[0]!
    if (media.type !== 'media') throw new Error('Expected media block')
    media.crop = { left: 0, top: 0, right: 0, bottom: 0 }
    const html = renderFlowPrintBodyHtml(buildFlowPrintPlan(source), { resolveAssetUrl: () => dataUrl(sourceBytes, mimeType) })
    const [width, height] = (new DOMParser().parseFromString(html, 'text/html').querySelector('.flow-print-image-crop') as HTMLElement).style.aspectRatio.split(' / ').map(Number)
    expect(width / height).toBeCloseTo(2)
  })

  it('keeps uncropped legacy image markup and extent', () => {
    const plan = buildFlowPrintPlan(surface(false))
    expect(renderFlowPrintBodyHtml(plan, { resolveAssetUrl: () => 'image.png' })).not.toContain('flow-print-image-crop')
    const result = buildFlowDocx(surface(false), { resolveAsset: () => ({ bytes, mimeType: 'image/png' }) })
    const xml = strFromU8(unzipSync(result.bytes)['word/document.xml']!)
    expect(xml).not.toContain('<a:srcRect')
    expect(xml).toContain('<wp:extent cx="5334000" cy="3000375"')
  })

  it('fails explicitly when cropped media has no readable intrinsic dimensions', () => {
    expect(() => renderFlowPrintBodyHtml(buildFlowPrintPlan(surface(true)), { resolveAssetUrl: () => 'image.png' })).toThrow('无法读取原图尺寸')
    expect(() => buildFlowDocx(surface(true), { resolveAsset: () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }) })).toThrow('无法读取原图尺寸')
  })
})

