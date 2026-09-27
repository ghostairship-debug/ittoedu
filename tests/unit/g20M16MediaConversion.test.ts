import { describe, expect, it } from 'vitest'
import { floatFlowMediaBlock, embedFlowNativeMedia } from '@/core/tools/flowMediaConversion'
import { createBlankFlowSurface, flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { appendOverlayItem, insertFlowOverlayShape, nativeMediaOverlay } from '@/core/tools/flowNativeInsertion'
import { patchFlowOverlayPaperSpace } from '@/renderer/course/flowSharedAuthoringAdapters'
import { selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION, type CourseProjectDocument, type RuntimeLayerItem } from '@/shared/courseProjectTypes'

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

  it('clears the paragraph anchor in the same transaction when pinning floated media to the viewport', () => {
    const floated = floatFlowMediaBlock(fixture(), { surfaceId: 'flow', blockId: 'media', layerItemId: 'floating-photo',
      frame: { mode: 'absolute', x: 40, y: 100, width: 320, height: 180 }, anchor: { blockId: 'h', offsetY: 40, xRatio: 0.05 } })
    const before = floated.nextDocument
    const selection = selectFlowOverlay(before, 'h', ['floating-photo'])
    const result = patchFlowOverlayPaperSpace(before, selection, 'viewport', { expectedRevision: before.revision })
    expect(result.ok).toBe(true)
    expect(result.historyEntry).toBe(true)
    expect(result.nextDocument?.revision).toBe(before.revision + 1)
    const entry = flowSurfaceIn(result.nextDocument!, 'flow').surfaceLayerItems[0]
    expect(entry?.item.paperSpace).toBeUndefined()
    expect(entry?.paragraphAnchor).toBeUndefined()
    expect(() => courseProjectDocumentSchema.parse(result.nextDocument)).not.toThrow()
    expect(flowSurfaceIn(before, 'flow').surfaceLayerItems[0]?.paragraphAnchor).toEqual({ blockId: 'h', offsetY: 40, xRatio: 0.05 })
  })

  it('uses the original caption position when the media itself was selected as its anchor', () => {
    const original = fixture()
    const floated = floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', layerItemId: 'caption-anchored',
      frame: { mode: 'absolute', x: 80, y: 120, width: 320, height: 180 }, anchor: { blockId: 'media', offsetY: 0, xRatio: 0.1 } })
    const surface = flowSurfaceIn(floated.nextDocument, 'flow')
    expect(floated.nextDocument.revision).toBe(original.revision + 1)
    expect(surface.blocks.map(block => block.type)).toEqual(['heading', 'paragraph'])
    expect(surface.blocks[1]).toMatchObject({ id: floated.captionBlockId, content: { inlines: [{ text: '图一' }] } })
    expect(surface.surfaceLayerItems[0]?.paragraphAnchor).toEqual({ blockId: floated.captionBlockId, offsetY: 0, xRatio: 0.1 })
    expect(surface.surfaceLayerItems[0]?.item).toMatchObject({ content: { data: { assetId: 'photo', crop: { left: 0.1, right: 0.15 } } } })
    expect(floated.nextDocument.assets).toEqual(original.assets)
    expect(flowSurfaceIn(original, 'flow').blocks[1]?.type).toBe('media')
  })

  it('creates one empty paragraph at a first media block without a caption', () => {
    const original = fixture()
    const surface = flowSurfaceIn(original, 'flow')
    const [heading, media] = surface.blocks
    if (!heading || !media || media.type !== 'media') throw new Error('Expected media fixture')
    delete media.caption
    surface.blocks = [media, heading]
    const floated = floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', layerItemId: 'first-anchored',
      frame: { mode: 'absolute', x: 40, y: 10, width: 320, height: 180 }, anchor: { blockId: 'media', offsetY: 7, xRatio: 0.05 } })
    const next = flowSurfaceIn(floated.nextDocument, 'flow')
    expect(floated.captionBlockId).toBeUndefined()
    expect(floated.nextDocument.revision).toBe(original.revision + 1)
    expect(next.blocks[0]).toMatchObject({ type: 'paragraph', content: { inlines: [] } })
    expect(next.blocks[1]?.id).toBe('h')
    expect(next.surfaceLayerItems[0]?.paragraphAnchor).toEqual({ blockId: next.blocks[0]?.id, offsetY: 7, xRatio: 0.05 })
    expect(next.surfaceLayerItems[0]?.item).toMatchObject({ content: { data: { assetId: 'photo', crop: { left: 0.1, right: 0.15 } } } })
    expect(floated.nextDocument.assets).toEqual(original.assets)
  })

  it.each(['viewport', undefined] as const)('embeds same-surface legacy image with paperSpace=%s and retains crop', paperSpace => {
    const original = fixture()
    const image = nativeMediaOverlay(original, { assetId: 'photo', mediaKind: 'image', id: 'legacy-image' })
    if (paperSpace) image.paperSpace = paperSpace
    else delete image.paperSpace
    if (image.content.nativeType !== 'image') throw new Error('Expected Native image')
    image.content.data.crop = { left: 0.1, top: 0.05, right: 0.15, bottom: 0.02 }
    image.content.data.cropX = 0.4; image.content.data.cropY = 0.6
    appendOverlayItem(original, { source: 'surface', surfaceId: 'flow' }, image)
    const embedded = embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: 'legacy-image', parentId: null, index: 1, blockId: 'legacy-body' })
    expect(embedded.nextDocument.revision).toBe(original.revision + 1)
    expect(embedded.nextDocument.assets).toEqual(original.assets)
    expect(flowSurfaceIn(embedded.nextDocument, 'flow').surfaceLayerItems).toHaveLength(0)
    expect(flowSurfaceIn(embedded.nextDocument, 'flow').blocks[1]).toMatchObject({ id: 'legacy-body', type: 'media', mediaKind: 'image', assetId: 'photo',
      crop: { left: 0.1, top: 0.05, right: 0.15, bottom: 0.02 }, cropX: 0.4, cropY: 0.6 })
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(1)
  })

  it('embeds a same-surface legacy viewport video without changing the asset', () => {
    const original = fixture()
    original.assets.clip = { ...original.assets.photo!, id: 'clip', filename: 'clip.mp4', mimeType: 'video/mp4', kind: 'video', path: 'media/clip.mp4' }
    const video = nativeMediaOverlay(original, { assetId: 'clip', mediaKind: 'video', id: 'legacy-video' })
    video.paperSpace = 'viewport'
    appendOverlayItem(original, { source: 'surface', surfaceId: 'flow' }, video)
    const embedded = embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: 'legacy-video', parentId: null, index: 1 })
    expect(embedded.nextDocument.revision).toBe(original.revision + 1)
    expect(flowSurfaceIn(embedded.nextDocument, 'flow').blocks[1]).toMatchObject({ type: 'media', mediaKind: 'video', assetId: 'clip' })
    expect(embedded.nextDocument.assets.clip).toEqual(original.assets.clip)
  })

  it('rejects global, cross-surface, shape, and locked sources without a project write', () => {
    const original = fixture()
    const image = nativeMediaOverlay(original, { assetId: 'photo', mediaKind: 'image', id: 'surface-image' })
    image.paperSpace = 'viewport'
    appendOverlayItem(original, { source: 'surface', surfaceId: 'flow' }, image)
    const second = createBlankFlowSurface({ id: 'second', title: '第二页' })
    original.surfaces.push(second.surface); original.locations.push(second.location)
    expect(() => embedFlowNativeMedia(original, { surfaceId: 'second', layerItemId: 'surface-image', parentId: null, index: 1 })).toThrow('不是当前 Flow 表面')
    const global = nativeMediaOverlay(original, { assetId: 'photo', mediaKind: 'image', id: 'global-image' })
    global.paperSpace = 'viewport'
    appendOverlayItem(original, { source: 'global', surfaceId: 'flow' }, global)
    expect(() => embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: 'global-image', parentId: null, index: 1 })).toThrow('不是当前 Flow 表面')
    const [shapeId] = insertFlowOverlayShape(original, { source: 'surface', surfaceId: 'flow' }, { shapeType: 'rectangle', id: 'shape' })
    expect(() => embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: shapeId!, parentId: null, index: 1 })).toThrow('不是当前 Flow 表面')
    const { content: _content, kind: _kind, ...runtimeBase } = image
    const runtime: RuntimeLayerItem = { ...runtimeBase, layerItemId: 'runtime', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: 'export default {}', content: { values: {} }, assets: {} } }
    appendOverlayItem(original, { source: 'surface', surfaceId: 'flow' }, runtime)
    expect(() => embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: 'runtime', parentId: null, index: 1 })).toThrow('不是当前 Flow 表面')
    image.locked = true
    expect(() => embedFlowNativeMedia(original, { surfaceId: 'flow', layerItemId: 'surface-image', parentId: null, index: 1 })).toThrow('图层已锁定')
    expect(original.revision).toBe(1)
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(3)
  })

  it('rejects stale commands without changing the project', () => {
    const original = fixture()
    expect(() => floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 }, expectedRevision: 0 })).toThrow('stale-revision')
    expect(() => floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 } })).toThrow('找不到当前页的挂靠段落')
    expect(() => floatFlowMediaBlock(original, { surfaceId: 'flow', blockId: 'media', frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 }, anchor: { blockId: 'other-page', offsetY: 0, xRatio: 0.2 } })).toThrow('找不到当前页的挂靠段落')
    expect(original.revision).toBe(1)
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(0)
  })
})
