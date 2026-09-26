import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { PublishedFlowSurface } from '@/shared/contracts/published-course-v2/types'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
function surface(crop: boolean): PublishedFlowSurface {
  return { id: 'flow', type: 'flow', title: 'Media', layout: { readingWidth: 760, wideContentWidth: 960 }, surfaceLayerItems: [], blocks: [{
    id: 'photo', type: 'media', assetId: 'original', mediaKind: 'image', layout: 'content-width', altText: 'Original',
    ...(crop ? { crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 }, cropX: 0.7, cropY: 0.4 } : {}),
  }] }
}

describe('M16 body media crop delivery', () => {
  it('carries crop into print HTML and DOCX DrawingML while embedding the original bytes', () => {
    const source = surface(true)
    const plan = buildFlowPrintPlan(source)
    expect(plan.includesFloatingLayers).toBe(false)
    expect(plan.nodes.find(node => node.type === 'media')).toMatchObject({ crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 } })
    const html = renderFlowPrintBodyHtml(plan, { resolveAssetUrl: () => 'data:image/png;base64,AA==' })
    expect(html).toContain('clip-path:inset(20% 30% 10% 10%)')
    const result = buildFlowDocx(source, { resolveAsset: () => ({ bytes, mimeType: 'image/png' }) })
    const files = unzipSync(result.bytes)
    const xml = strFromU8(files['word/document.xml']!)
    expect(xml).toContain('<a:srcRect l="10000" t="20000" r="30000" b="10000"/>')
    expect(files['word/media/image1.png']).toEqual(bytes)
  })

  it('keeps uncropped legacy image markup free of a crop rectangle', () => {
    const plan = buildFlowPrintPlan(surface(false))
    expect(renderFlowPrintBodyHtml(plan, { resolveAssetUrl: () => 'image.png' })).not.toContain('clip-path:')
    const result = buildFlowDocx(surface(false), { resolveAsset: () => ({ bytes, mimeType: 'image/png' }) })
    expect(strFromU8(unzipSync(result.bytes)['word/document.xml']!)).not.toContain('<a:srcRect')
  })
})
