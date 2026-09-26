import { describe, expect, it } from 'vitest'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { reconcileFlowParagraphAnchors, setFlowParagraphPlacement } from '@/core/tools/flowParagraphPlacement'
import { planDeleteFlowBlocks } from '@/core/tools/flowContent'
import { insertFlowOverlayShape, insertFlowOverlayText } from '@/core/tools/flowNativeInsertion'
import { flowSurfaceIn } from '@/core/tools/flowDocumentModel'
import { replaceFlowDocumentContent } from '@/renderer/course/flowEditorCommands'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION, type CourseProjectDocument, type FlowBlock } from '@/shared/courseProjectTypes'

const paragraph = (id: string): FlowBlock => ({ id, type: 'paragraph', content: { inlines: [{ type: 'text', text: id }] } })
const heading: FlowBlock = { id: 'h', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '标题' }] } }

function fixture(): CourseProjectDocument {
  const item = sceneNodeToCourseLayerItem(createTextNode({ id: 'text', text: 'note', x: 100, y: 100 }))
  item.paperSpace = 'paper'
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION, id: 'm16-placement', revision: 1, title: '挂靠', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    assets: {}, componentPackages: {}, designTokens: { fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }], colors: [{ id: 'background', label: '背景', color: '#ffffff' }, { id: 'text', label: '文字', color: '#111111' }] },
    media: { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {}, narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 } } },
    playback: { controls: 'none', keyboardNavigation: true, presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } },
    courseState: [], navigationGuards: [], globalLayerItems: [], globalInteractions: [], locations: [{ id: 'h', label: '标题', kind: 'flow-block', surfaceId: 'flow', blockId: 'h' }], startLocationId: 'h',
    surfaces: [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 760, wideContentWidth: 1120 }, blocks: [heading, paragraph('a'), paragraph('b'), paragraph('c')], surfaceLayerItems: [{ item, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: 'b', offsetY: 12, xRatio: 0.2 } }] }],
  })
}

describe('Flow paragraph placement transactions', () => {
  it('reconciles a deleted anchor to the previous surviving block without changing geometry', () => {
    const before = [heading, paragraph('a'), paragraph('b'), paragraph('c')]
    const entry = flowSurfaceIn(fixture(), 'flow').surfaceLayerItems[0]!
    const next = reconcileFlowParagraphAnchors(before, [heading, paragraph('a'), paragraph('c')], [entry])
    expect(next[0]?.paragraphAnchor).toEqual({ blockId: 'a', offsetY: 12, xRatio: 0.2 })
    expect(entry.paragraphAnchor?.blockId).toBe('b')
    expect(reconcileFlowParagraphAnchors(before, [heading, paragraph('a'), paragraph('b'), paragraph('c')], [entry])[0]).toBe(entry)
    expect(() => reconcileFlowParagraphAnchors(before, [heading, paragraph('a'), paragraph('c')], [{ ...entry, paragraphAnchor: { blockId: 'foreign', offsetY: 12, xRatio: 0.2 } }])).toThrow('挂靠段落不属于原正文')
  })

  it('reconciles delete and full replacement within one formal revision', () => {
    const original = fixture()
    const deleted = planDeleteFlowBlocks(original, [{ surfaceId: 'flow', parentId: null, blockId: 'b' }])
    expect(deleted.ok).toBe(true)
    expect(deleted.nextDocument?.revision).toBe(2)
    expect(flowSurfaceIn(deleted.nextDocument!, 'flow').surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe('a')
    const replaced = replaceFlowDocumentContent(original, 'flow', [heading, paragraph('c')])
    expect(replaced.ok).toBe(true)
    expect(replaced.nextDocument?.revision).toBe(2)
    expect(flowSurfaceIn(replaced.nextDocument!, 'flow').surfaceLayerItems[0]?.paragraphAnchor?.blockId).toBe('h')
  })

  it('keeps global Native coordinates while new surface Native uses paper space', () => {
    const project = fixture()
    insertFlowOverlayText(project, { source: 'global', surfaceId: 'flow' }, { id: 'global-text' })
    insertFlowOverlayShape(project, { source: 'global', surfaceId: 'flow' }, { id: 'global-shape', shapeType: 'rectangle' })
    insertFlowOverlayText(project, { source: 'surface', surfaceId: 'flow' }, { id: 'paper-text' })
    insertFlowOverlayShape(project, { source: 'surface', surfaceId: 'flow' }, { id: 'paper-shape', shapeType: 'rectangle' })
    expect(project.globalLayerItems.map(entry => entry.item.paperSpace)).toEqual([undefined, undefined])
    expect(flowSurfaceIn(project, 'flow').surfaceLayerItems.filter(entry => entry.item.layerItemId.startsWith('paper-')).map(entry => entry.item.paperSpace)).toEqual(['paper', 'paper'])
  })

  it('switches to fixed paper at the resolved position and back without a jump', () => {
    const original = fixture()
    const blocks = [{ blockId: 'h', depth: 0, x: 0, y: 0, width: 600, height: 30 }, { blockId: 'b', depth: 0, x: 0, y: 180, width: 600, height: 30 }]
    const fixed = setFlowParagraphPlacement(original, { surfaceId: 'flow', layerItemId: 'text', mode: 'paper', paperWidth: 600, blocks })
    expect(fixed.revision).toBe(2)
    expect(flowSurfaceIn(fixed, 'flow').surfaceLayerItems[0]?.paragraphAnchor).toBeUndefined()
    expect(fixed.surfaces[0]?.surfaceLayerItems[0]?.item.frame).toMatchObject({ x: 120, y: 192 })
    const followed = setFlowParagraphPlacement(fixed, { surfaceId: 'flow', layerItemId: 'text', mode: 'paragraph', paperWidth: 600, blocks })
    expect(flowSurfaceIn(followed, 'flow').surfaceLayerItems[0]?.paragraphAnchor).toEqual({ blockId: 'b', offsetY: 12, xRatio: 0.2 })
    expect(setFlowParagraphPlacement(followed, { surfaceId: 'flow', layerItemId: 'text', mode: 'paragraph', paperWidth: 600, blocks })).toBe(followed)
  })
})
