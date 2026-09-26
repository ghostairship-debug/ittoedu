import { describe, expect, it } from 'vitest'
import { createImageNode, createShapeNode, createTextNode, createVideoNode } from '@/core/tools/nativeNodeFactories'
import { appendFlowMenuPaperItem, insertFlowMenuPaperItem, type FlowMenuPaperItem } from '@/core/tools/flowMenuPaperInsertion'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION, type ComponentLayerItem, type CourseProjectDocument, type LayerFrame } from '@/shared/courseProjectTypes'

const frame: LayerFrame = { mode: 'absolute', x: 82, y: 120, width: 280, height: 140 }
const anchor = { blockId: 'p', offsetY: -15, xRatio: 1.2 }

function fixture(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION, id: 'm16-menu-paper', revision: 4, title: '纸面', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    assets: { photo: { id: 'photo', filename: 'photo.png', mimeType: 'image/png', kind: 'image', path: 'media/photo.png', byteLength: 128, width: 640, height: 360 } },
    componentPackages: { card: { packageId: 'card', version: '1.0.0', name: '卡片', manifestPath: 'packages/card/manifest.json', runtimePath: 'packages/card/runtime.js', contentSha256: 'a'.repeat(64) } },
    designTokens: { fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }], colors: [{ id: 'background', label: '背景', color: '#ffffff' }, { id: 'text', label: '文字', color: '#111111' }] },
    media: { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {}, narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 } } },
    playback: { controls: 'none', keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } },
    courseState: [], navigationGuards: [], globalLayerItems: [], globalInteractions: [], locations: [{ id: 'h', label: '标题', kind: 'flow-block', surfaceId: 'flow', blockId: 'h' }], startLocationId: 'h',
    surfaces: [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 760, wideContentWidth: 1120 }, surfaceLayerItems: [], blocks: [
      { id: 'h', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '标题' }] } },
      { id: 'p', type: 'paragraph', content: { inlines: [] } },
    ] }],
  })
}

function item(kind: 'text' | 'shape' | 'image' | 'component', id: string = kind): FlowMenuPaperItem {
  if (kind === 'component') return {
    kind: 'component', layerItemId: id, label: '卡片', frame, order: 1, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId: 'card', version: '1.0.0' }, props: {},
  } satisfies ComponentLayerItem
  const node = kind === 'text' ? createTextNode({ id, text: '文本' })
    : kind === 'shape' ? createShapeNode('rectangle', { id })
      : createImageNode({ id, name: '图片', assetId: 'photo', width: 640, height: 360 })
  return sceneNodeToCourseLayerItem(node) as FlowMenuPaperItem
}

describe('Flow menu paper insertion', () => {
  it.each(['text', 'shape', 'image', 'component'] as const)('inserts %s in one revision with paper anchor and immutable input', kind => {
    const original = fixture()
    const prepared = item(kind)
    const snapshot = structuredClone(prepared)
    const result = insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: prepared, frame, paragraphAnchor: anchor, expectedRevision: 4, now: '2026-09-27T01:00:00.000Z' })
    const entry = flowSurfaceIn(result.nextDocument, 'flow').surfaceLayerItems[0]!
    expect(result.nextDocument.revision).toBe(5)
    expect(result.nextDocument.updatedAt).toBe('2026-09-27T01:00:00.000Z')
    expect(entry).toMatchObject({ bodyPlane: 'overlay', paragraphAnchor: anchor, item: { kind: prepared.kind, layerItemId: prepared.layerItemId, frame, paperSpace: 'paper' } })
    expect(result.anchorBlockId).toBe('p')
    expect(original.revision).toBe(4)
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(0)
    expect(prepared).toEqual(snapshot)
  })

  it('appends to caller draft without incrementing revision', () => {
    const draft = fixture()
    appendFlowMenuPaperItem(draft, { surfaceId: 'flow', item: item('text'), frame, paragraphAnchor: anchor })
    expect(draft.revision).toBe(4)
    expect(flowSurfaceIn(draft, 'flow').surfaceLayerItems).toHaveLength(1)
  })

  it('rejects unsupported kinds, stale revision, foreign anchors and invalid geometry without writing original', () => {
    const original = fixture()
    const input = { surfaceId: 'flow', item: item('text'), frame, paragraphAnchor: anchor }
    expect(() => insertFlowMenuPaperItem(original, { ...input, expectedRevision: 3 })).toThrow('stale-revision')
    expect(() => insertFlowMenuPaperItem(original, { ...input, paragraphAnchor: { ...anchor, blockId: 'foreign' } })).toThrow()
    expect(() => insertFlowMenuPaperItem(original, { ...input, paragraphAnchor: { ...anchor, xRatio: Infinity } })).toThrow()
    expect(() => insertFlowMenuPaperItem(original, { ...input, frame: { ...frame, width: 0 } })).toThrow()
    const video = sceneNodeToCourseLayerItem(createVideoNode({ id: 'video', name: '视频', assetId: 'photo', width: 200, height: 100 })) as FlowMenuPaperItem
    expect(() => insertFlowMenuPaperItem(original, { ...input, item: video })).toThrow('不支持')
    expect(() => insertFlowMenuPaperItem(original, { ...input, item: { ...item('text'), kind: 'runtime' } as unknown as FlowMenuPaperItem })).toThrow('不支持')
    expect(() => insertFlowMenuPaperItem(original, { ...input, item: { ...(item('component') as ComponentLayerItem), role: 'teacher-controller' } })).toThrow('教师控制器')
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(0)
    expect(original.revision).toBe(4)
  })

  it('rejects duplicate ids and bad asset, component version or fallback references atomically', () => {
    const original = fixture()
    const first = insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: item('text', 'same'), frame, paragraphAnchor: anchor })
    expect(() => insertFlowMenuPaperItem(first.nextDocument, { surfaceId: 'flow', item: item('shape', 'same'), frame, paragraphAnchor: anchor })).toThrow('图层 ID 已存在')
    const badImage = item('image')
    if (badImage.kind === 'native' && badImage.content.nativeType === 'image') badImage.content.data.assetId = 'missing'
    expect(() => insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: badImage, frame, paragraphAnchor: anchor })).toThrow()
    const badComponent = item('component') as ComponentLayerItem
    badComponent.component.version = 'wrong'
    expect(() => insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: badComponent, frame, paragraphAnchor: anchor })).toThrow()
    badComponent.component.version = '1.0.0'
    badComponent.staticFallbackAssetId = 'missing'
    expect(() => insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: badComponent, frame, paragraphAnchor: anchor })).toThrow()
    expect(flowSurfaceIn(original, 'flow').surfaceLayerItems).toHaveLength(0)
  })

  it('creates an anchor paragraph only through the explicit empty-body branch', () => {
    const original = fixture()
    const empty = structuredClone(original)
    const spare = structuredClone(flowSurfaceIn(empty, 'flow'))
    spare.id = 'spare'
    spare.blocks = []
    empty.surfaces.push(spare)
    empty.mixedPrintPlan = { pageSize: 'A4', orientation: 'auto', entries: [{ id: 'print-flow', kind: 'flow-document', surfaceId: 'flow' }, { id: 'print-spare', kind: 'flow-document', surfaceId: 'spare' }] }
    expect(() => insertFlowMenuPaperItem(empty, { surfaceId: 'spare', item: item('text'), frame, paragraphAnchor: anchor })).toThrow()
    const result = insertFlowMenuPaperItem(empty, { surfaceId: 'spare', item: item('text'), frame, paragraphAnchor: { kind: 'empty-body', offsetY: 0, xRatio: 0.25 } })
    const surface = flowSurfaceIn(result.nextDocument, 'spare')
    expect(surface.blocks).toEqual([{ id: result.anchorBlockId, type: 'paragraph', content: { inlines: [] } }])
    expect(surface.surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe(result.anchorBlockId)
    expect(flowSurfaceIn(empty, 'spare').blocks).toHaveLength(0)
    expect(() => insertFlowMenuPaperItem(original, { surfaceId: 'flow', item: item('text'), frame, paragraphAnchor: { kind: 'empty-body', offsetY: 0, xRatio: 0.25 } })).toThrow()
  })
})
