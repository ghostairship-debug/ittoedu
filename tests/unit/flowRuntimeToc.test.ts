import { describe, expect, it } from 'vitest'
import { teacherControllerHitBounds } from '@/player/teacherControllerRuntimeSession'
import type { FlowBlock } from '@/shared/courseProjectTypes'
import type { PublishedFlowSurface } from '@/shared/publishedCourseTypes'
import {
  flowPlaybackFromSurface,
  toFlowPublishedPlayback,
} from '@/player/surfaces/flow/flowModel'
import {
  buildFlowRuntimeToc,
  flowRuntimeTocAnchorId,
  flowRuntimeTocPageAnchorId,
  flowRuntimeTocShellLayout,
} from '@/player/surfaces/flow/flowRuntimeToc'

function flowSurface(): PublishedFlowSurface {
  return {
    id: 'flow-toc',
    type: 'flow',
    title: '工业化与城市',
    layout: { readingWidth: 760, wideContentWidth: 1120 },
    blocks: [
      { id: 'h1', type: 'heading', level: 1, text: '阅读任务' },
      { id: 'p1', type: 'paragraph', text: '普通段落不应出现在运行目录' },
      {
        id: 'sec-a',
        type: 'section',
        title: '材料 A',
        collapsedByDefault: false,
        blocks: [
          { id: 'h2', type: 'heading', level: 2, text: '人口与工厂' },
          {
            id: 'table-1',
            type: 'table',
            columns: [{ id: 'c1', header: '项' }],
            rows: [{ id: 'r1', cells: { c1: '值' } }],
          },
        ],
      },
      {
        id: 'list-1',
        type: 'list',
        ordered: true,
        items: [{ id: 'li-1', text: '列表项不上目录' }],
      },
    ],
    surfaceLayerItems: [],
  }
}

function secondSurface(): PublishedFlowSurface {
  return {
    id: 'flow-discuss',
    type: 'flow',
    title: '课堂讨论',
    layout: { readingWidth: 760, wideContentWidth: 1120 },
    blocks: [
      { id: 'h-discuss', type: 'heading', level: 1, text: '讨论题' },
      { id: 'p-discuss', type: 'paragraph', text: '另一页正文' },
    ],
    surfaceLayerItems: [],
  }
}

describe('Flow runtime TOC model', () => {
  it('insets the article and paper overlays without accumulating a viewport controller offset', () => {
    const sessionOffset = { dx: 0, dy: 0 }
    const controller = {
      title: '教师控制台',
      x: 190,
      y: 638,
      width: 900,
      height: 64,
      rotation: 0,
      compact: false,
      showSceneProgress: true,
      collapsible: true,
      buttons: [],
      style: {
        backgroundColor: '#172033',
        backgroundOpacity: 0.94,
        accentColor: '#e7b85c',
        textColor: '#f8fafc',
        cornerRadius: 16,
      },
    }
    const sequence = [false, true, false, true].map(flowRuntimeTocShellLayout)
    expect(sequence.map((layout) => layout.articleInsetPx)).toEqual([0, 260, 0, 260])
    expect(sequence.map((layout) => layout.paperOverlayInsetPx)).toEqual([0, 260, 0, 260])
    expect(sequence.map((layout) => layout.viewportOverlayInsetPx)).toEqual([0, 0, 0, 0])

    const pill = teacherControllerHitBounds(controller, sessionOffset, true)
    for (const layout of sequence) {
      expect(pill.left + layout.viewportOverlayInsetPx).toBeGreaterThanOrEqual(0)
      expect(pill.top).toBeGreaterThanOrEqual(0)
      expect(pill.right + layout.viewportOverlayInsetPx).toBeLessThanOrEqual(1280)
      expect(pill.bottom).toBeLessThanOrEqual(720)
    }
    expect(sessionOffset).toEqual({ dx: 0, dy: 0 })
  })

  it('lists Flow pages plus heading/section anchors and never paragraphs', () => {
    const playback = toFlowPublishedPlayback({
      ...flowPlaybackFromSurface(flowSurface(), {
        startBlockId: 'h1',
      }),
      locations: [
        { id: 'loc-h1', label: '阅读任务', kind: 'flow-block', surfaceId: 'flow-toc', blockId: 'h1' },
        { id: 'loc-sec', label: '材料 A', kind: 'flow-block', surfaceId: 'flow-toc', blockId: 'sec-a' },
        { id: 'loc-h2', label: '人口与工厂', kind: 'flow-block', surfaceId: 'flow-toc', blockId: 'h2' },
        { id: 'loc-discuss', label: '讨论题', kind: 'flow-block', surfaceId: 'flow-discuss', blockId: 'h-discuss' },
      ],
      startLocationId: 'loc-h1',
      surfaces: [flowSurface(), secondSurface()],
    })

    const toc = buildFlowRuntimeToc(playback)
    expect(toc.map((entry) => [entry.kind, entry.blockId ?? entry.surfaceId, entry.anchorId])).toEqual([
      ['page', 'flow-toc', flowRuntimeTocPageAnchorId('flow-toc')],
      ['heading', 'h1', flowRuntimeTocAnchorId('h1')],
      ['section', 'sec-a', flowRuntimeTocAnchorId('sec-a')],
      ['heading', 'h2', flowRuntimeTocAnchorId('h2')],
      ['page', 'flow-discuss', flowRuntimeTocPageAnchorId('flow-discuss')],
      ['heading', 'h-discuss', flowRuntimeTocAnchorId('h-discuss')],
    ])
    expect(toc.some((entry) => entry.blockId === 'p1')).toBe(false)
    expect(toc.some((entry) => entry.blockId === 'table-1')).toBe(false)
    expect(toc.some((entry) => entry.blockId === 'list-1')).toBe(false)
    expect(toc.some((entry) => entry.blockId === 'p-discuss')).toBe(false)
  })

  it('does not treat quote/formula/media as directory anchors', () => {
    const extra: FlowBlock[] = [
      { id: 'q1', type: 'quote', text: '引用' },
      { id: 'f1', type: 'formula', formulaId: 'f1', accessibleText: 'x', ast: { type: 'token', value: 'x' } },
      {
        id: 'm1',
        type: 'media',
        assetId: 'asset-image',
        mediaKind: 'image',
        layout: 'content-width',
      },
    ]
    const surface = flowSurface()
    surface.blocks.push(...extra)
    const toc = buildFlowRuntimeToc(flowPlaybackFromSurface(surface, { startBlockId: 'h1' }))
    expect(toc.some((entry) => entry.kind === 'heading' || entry.kind === 'section' || entry.kind === 'page')).toBe(true)
    expect(toc.some((entry) => extra.some((block) => block.id === entry.blockId))).toBe(false)
  })
})
