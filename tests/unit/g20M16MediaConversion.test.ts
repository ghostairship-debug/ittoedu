import { describe, expect, it } from 'vitest'
import { floatFlowMediaBlock, embedFlowNativeMedia } from '@/core/tools/flowMediaConversion'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION, type CourseProjectDocument } from '@/shared/courseProjectTypes'

function fixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION, id: 'm16-media', revision: 1, title: '媒体', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    assets: { photo: { id: 'photo', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'media/photo.png', byteLength: 128, width: 640, height: 360 } }, componentPackages: {},
    designTokens: { fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }], colors: [{ id: 'background', label: '背景', color: '#ffffff' }, { id: 'text', label: '文字', color: '#111111' }] },
    media: { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {}, narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 } } },
    playback: { controls: 'none', keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } },
    courseState: [], navigationGuards: [], globalLayerItems: [], globalInteractions: [], locations: [{ id: 'h', label: '标题', kind: 'flow-block', surfaceId: 'flow', blockId: 'h' }], startLocationId: 'h',
    surfaces: [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 760, wideContentWidth: 1120 }, surfaceLayerItems: [], blocks: [
      { id: 'h', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '标题' }] } },
      { id: 'media', type: 'media', assetId: 'photo', mediaKind: 'image', altText: '示意图', caption: { inlines: [{ type: 'text', text: '图一' }] }, layout: 'wide', wrap: 'right', crop: { left: 0.1, top: 0.05, right: 0.15, bottom: 0.02 }, cropX: 0.4, cropY: 0.6 },
    ] }],
  })
}

describe('Flow body and paper media conversion', () => {
  it('keeps the managed asset and crop, and leaves caption as an adjacent paragraph', () => {
    const original = fixture()
    const floated = floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', layerItemId: 'floating-photo', frame: { mode: 'absolute', x: 40, y: 100, width: 320, height: 180 }, anchor: { blockId: 'h', offsetY: 40, xRatio: 0.05 } })
    const surface = flowSurfaceIn(floated.nextDocument, 'flow')
    expect(floated.nextDocument.revision).toBe(2)
    expect(floated.nextDocument.assets).toEqual(original.assets)
    expect(surface.blocks[1]).toMatchObject({ id: floated.captionBlockId, type: 'paragraph', content: { inlines: [{ text: '图一' }] } })
    expect(surface.surfaceLayerItems[0]).toMatchObject({ paragraphAnchor: { blockId: 'h' }, item: { layerItemId: 'floating-photo', paperSpace: 'paper', content: { nativeType: 'image', data: { assetId: 'photo', crop: { left: 0.1, right: 0.15 }, cropX: 0.4, cropY: 0.6 } } } })
    const embedded = embedFlowNativeMedia(floated.nextDocument, { surfaceId: 'flow', layerItemId: 'floating-photo', parentId: null, index: 1, blockId: 'embedded', layout: 'wide', wrap: 'right', altText: '示意图' })
    const result = flowSurfaceIn(embedded.nextDocument, 'flow')
    expect(embedded.nextDocument.revision).toBe(3)
    expect(embedded.nextDocument.assets).toEqual(original.assets)
    expect(result.surfaceLayerItems).toHaveLength(0)
    expect(result.blocks[1]).toMatchObject({ id: 'embedded', assetId: 'photo', crop: { left: 0.1, right: 0.15 }, cropX: 0.4, cropY: 0.6, layout: 'wide', wrap: 'right' })
    expect(result.blocks[2]).toMatchObject({ id: floated.captionBlockId, type: 'paragraph' })
  })

  it('rejects stale commands without changing the project', () => {
    const original = fixture()
    expect(() => floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 }, expectedRevision: 0 })).toThrow('stale-revision')
    expect(original.revision).toBe(1)
  })
})
