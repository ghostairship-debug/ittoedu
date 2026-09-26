import { describe, expect, it } from 'vitest'
import { flowOverlayAnchorAfterDrag, resolveFlowOverlayAuthoredFrame } from '@/renderer/ui/flow/FlowOverlayAuthoringLayer'
import type { FlowEditorLayerView } from '@/renderer/course/flowEditorView'
import type { FlowParagraphBlockRect } from '@/shared/flowParagraphAnchors'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import { projectFlowUnifiedOverlays } from '@/renderer/course/flowOverlayProjection'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

const rects: FlowParagraphBlockRect[] = [
  { blockId: 'a', depth: 0, x: 0, y: 20, width: 500, height: 40 },
  { blockId: 'b', depth: 0, x: 0, y: 120, width: 500, height: 40 },
]
const storedFrame = { mode: 'absolute' as const, x: 200, y: 30, width: 100, height: 60 }

function layer(input: { owner?: 'surface' | 'global'; paperSpace?: 'paper' | 'viewport'; anchored?: boolean } = {}): FlowEditorLayerView {
  return {
    owner: input.owner ?? 'surface',
    item: { frame: storedFrame, paperSpace: input.paperSpace ?? 'paper' },
    ...(input.anchored ? { paragraphAnchor: { blockId: 'a', offsetY: 10, xRatio: 0.25 } } : {}),
  } as FlowEditorLayerView
}

describe('Flow authoring overlay placement', () => {
  it('carries the surface entry anchor through the read projections without adding it to LayerItem', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const item = sceneNodeToCourseLayerItem(createTextNode({ id: 'paper-text', name: '纸面文字', text: '说明' }), 1)
    item.paperSpace = 'paper'
    project.surfaces = [{ id: 'flow', type: 'flow', title: '讲义', layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks: [{ id: 'a', type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } }],
      surfaceLayerItems: [{ item, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: 'a', offsetY: 10, xRatio: 0.25 } }],
    }]
    project.locations = [{ id: 'location-a', kind: 'flow-block', surfaceId: 'flow', blockId: 'a', label: '正文' }]
    project.startLocationId = 'location-a'
    const parsed = courseProjectDocumentSchema.parse(project)
    const view = buildFlowEditorView({ project: parsed, locationId: 'location-a' })
    expect(view.overlayLayers[0]?.paragraphAnchor).toEqual({ blockId: 'a', offsetY: 10, xRatio: 0.25 })
    expect(projectFlowUnifiedOverlays(parsed, 'location-a').overlayRows[0]?.paragraphAnchor).toEqual(view.overlayLayers[0]?.paragraphAnchor)
    expect('paragraphAnchor' in view.overlayLayers[0]!.item).toBe(false)
  })

  it('uses the same live paragraph frame for visual, hit and gesture start while leaving persisted frame untouched', () => {
    const anchored = layer({ anchored: true })
    expect(resolveFlowOverlayAuthoredFrame(anchored, 1000, rects)).toEqual({ ...storedFrame, x: 250, y: 30 })
    expect(resolveFlowOverlayAuthoredFrame(anchored, 1000, rects.map(rect => rect.blockId === 'a' ? { ...rect, y: 90 } : rect)))
      .toEqual({ ...storedFrame, x: 250, y: 100 })
    expect(anchored.item.frame).toEqual(storedFrame)
    expect(resolveFlowOverlayAuthoredFrame(anchored, 0, [])).toEqual(storedFrame)
    expect(resolveFlowOverlayAuthoredFrame(anchored, 1000, [{ blockId: 'section', depth: 0, x: 0, y: 80, width: 500, height: 40 }], ['section']))
      .toEqual({ ...storedFrame, x: 250, y: 90 })
  })

  it('preserves legacy fixed paper, viewport and global positions', () => {
    for (const current of [layer(), layer({ paperSpace: 'viewport', anchored: true }), layer({ owner: 'global', anchored: true })]) {
      expect(resolveFlowOverlayAuthoredFrame(current, 1000, rects)).toEqual(storedFrame)
    }
  })

  it('computes a new anchor only for an already anchored paper layer after dragging', () => {
    const moved = { x: 300, y: 135, width: 100, height: 60 }
    expect(flowOverlayAnchorAfterDrag(layer({ anchored: true }), moved, 1000, rects))
      .toEqual({ blockId: 'b', offsetY: 15, xRatio: 0.3 })
    expect(flowOverlayAnchorAfterDrag(layer(), moved, 1000, rects)).toBeUndefined()
    expect(flowOverlayAnchorAfterDrag(layer({ anchored: true }), moved, 0, [])).toBeUndefined()
  })
})
