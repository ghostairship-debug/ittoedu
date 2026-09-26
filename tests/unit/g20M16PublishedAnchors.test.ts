import { expect, it } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'

it('publishes a Flow paragraph anchor without changing its frame, plane, or source project', () => {
  const project = createBlankCourseProject({ id: 'anchor-course', controls: 'none', includeDefaultController: false, now: '2026-09-27T00:00:00.000Z' })
  const text = createTextNode({ id: 'text-node', text: 'Floating text' })
  const paragraphAnchor = { blockId: 'nested-paragraph', offsetY: -16, xRatio: 1.1 }
  project.surfaces.push({
    id: 'flow', type: 'flow', title: 'Flow', layout: { readingWidth: 760, wideContentWidth: 960 },
    blocks: [{ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: 'Section' }] }, collapsedByDefault: false,
      blocks: [{ id: 'nested-paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Body' }] } }] }],
    surfaceLayerItems: [{ bodyPlane: 'underlay', visibility: { mode: 'all', locationIds: [] }, paragraphAnchor,
      item: { kind: 'native', layerItemId: 'floating-text', label: 'Floating text', frame: { mode: 'absolute', x: 800, y: 300, width: 120, height: 50 },
        paperSpace: 'paper', order: 1, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
        content: { nativeType: 'text', data: { text: text.text, runs: text.runs, style: text.style } },
      },
    }],
  })
  project.locations.push({ id: 'flow-location', label: 'Flow', kind: 'flow-block', surfaceId: 'flow', blockId: 'nested-paragraph' })
  const slide = project.surfaces[0]!
  if (slide.type !== 'slide') throw new Error('Expected Slide')
  project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: [
    { id: 'print-slide', kind: 'slide-scenes', surfaceId: slide.id, sceneIds: slide.scenes.map(scene => scene.id) },
    { id: 'print-flow', kind: 'flow-document', surfaceId: 'flow' },
  ] }
  const before = structuredClone(project)
  const published = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
  const surface = published.surfaces.find(surface => surface.id === 'flow')!
  if (surface.type !== 'flow') throw new Error('Expected Flow')
  expect(surface.surfaceLayerItems[0]).toMatchObject({ bodyPlane: 'underlay', paragraphAnchor,
    item: { frame: { x: 800, y: 300, width: 120, height: 50 } },
  })
  expect(project).toEqual(before)
})

