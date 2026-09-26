import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { PublishedCourseV2Payload, PublishedFlowSurfaceLayerEntry } from '@/shared/contracts/published-course-v2/types'
import { buildFlowDocxProjection } from '@/renderer/export/course/flowDocxProjection'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import { createTextNode } from '@/core/tools/nativeNodeFactories'

function payload(anchor?: PublishedFlowSurfaceLayerEntry['paragraphAnchor']): PublishedCourseV2Payload {
  const text = createTextNode({ id: 'anchor-text', text: 'Anchor drawing' })
  const entry: PublishedFlowSurfaceLayerEntry = {
    visibility: { mode: 'all', locationIds: [] }, bodyPlane: 'underlay',
    ...(anchor ? { paragraphAnchor: anchor } : {}),
    item: {
      kind: 'native', layerItemId: 'anchored-text', visible: true, order: 2, rotation: 0, opacity: 1,
      hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
      frame: { mode: 'absolute', x: 20, y: 500, width: 120, height: 40 },
      content: { nativeType: 'text', data: { text: text.text, runs: text.runs, style: text.style } },
    },
  }
  return {
    format: 'h5course-published', formatVersion: 2, sourceSchemaVersion: 9,
    courseId: 'course', title: 'Course', assets: {}, components: {}, designTokens: { colors: [], fonts: [] },
    media: { audio: { defaultMuted: false, masterVolume: 1, channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 }, sounds: {}, narrationDucking: { enabled: false, musicVolume: 0.2, fadeMs: 300 } } },
    playback: { controls: 'canvas', keyboardNavigation: true, presenter: { enabled: false, strategy: 'scene-navigation', additionalBindings: [] } },
    courseState: [], navigationGuards: [], globalLayerItems: [], globalInteractions: [],
    locations: [{ id: 'location', label: 'Start', kind: 'flow-block', surfaceId: 'flow', blockId: 'outer' }],
    startLocationId: 'location',
    surfaces: [{ id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 760, wideContentWidth: 960 },
      blocks: [{ id: 'outer', type: 'section', title: { inlines: [{ type: 'text', text: 'Outer title' }] }, collapsedByDefault: false,
        blocks: [{ id: 'inner', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Inner body' }] } }] }],
      surfaceLayerItems: [entry],
    }],
  } as PublishedCourseV2Payload
}

function documentXml(source: PublishedCourseV2Payload): Document {
  const bytes = buildFlowDocx(source, 'flow').bytes
  return new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']!), 'application/xml')
}

describe('M16 anchored DOCX', () => {
  it('places a nested block anchor in its real paragraph with paragraph-relative offset', () => {
    const source = payload({ blockId: 'inner', offsetY: 26, xRatio: 0.4 })
    const projection = buildFlowDocxProjection(source, 'flow')
    expect(projection.anchoredGroups.map(group => group.blockId)).toEqual(['inner'])
    expect(projection.documentStartItems).toHaveLength(0)
    expect(projection.anchoredGroups[0]!.items[0]!.outputFrame.x).toBe(projection.pageBox.maxContentWidthPx * 0.4)
    const doc = documentXml(source)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const paragraphs = [...doc.getElementsByTagNameNS('*', 'p')]
    const bodyParagraph = paragraphs.find(paragraph => paragraph.textContent?.includes('Inner body'))!
    expect(bodyParagraph).toBeDefined()
    expect(bodyParagraph.getElementsByTagNameNS('*', 'anchor')).toHaveLength(1)
    expect(bodyParagraph.getElementsByTagNameNS('*', 'positionV')[0]!.getAttribute('relativeFrom')).toBe('paragraph')
    expect(bodyParagraph.getElementsByTagNameNS('*', 'positionV')[0]!.getElementsByTagNameNS('*', 'posOffset')[0]!.textContent).toBe(String(26 * 9525))
    expect(paragraphs.find(paragraph => paragraph.textContent?.includes('Outer title'))!.getElementsByTagNameNS('*', 'anchor')).toHaveLength(0)
  })

  it('keeps an explicit first-block anchor out of document-start placement', () => {
    const source = payload({ blockId: 'outer', offsetY: 12, xRatio: 0.2 })
    const projection = buildFlowDocxProjection(source, 'flow')
    expect(projection.documentStartItems).toHaveLength(0)
    expect(projection.anchoredGroups.map(group => group.blockId)).toEqual(['outer'])
    const doc = documentXml(source)
    const title = [...doc.getElementsByTagNameNS('*', 'p')].find(paragraph => paragraph.textContent?.includes('Outer title'))!
    expect(title.getElementsByTagNameNS('*', 'anchor')).toHaveLength(1)
  })
  it('keeps the old margin placement for an item without paragraphAnchor', () => {
    const source = payload()
    const projection = buildFlowDocxProjection(source, 'flow')
    expect(projection.documentStartItems).toHaveLength(1)
    const doc = documentXml(source)
    const anchor = doc.getElementsByTagNameNS('*', 'anchor')[0]!
    expect(anchor.getElementsByTagNameNS('*', 'positionV')[0]!.getAttribute('relativeFrom')).toBe('margin')
  })
})


