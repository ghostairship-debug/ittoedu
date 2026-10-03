// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { resizeCourseSlideCanvas, resizeSlideSceneCanvas } from '@/core/course/resizeSlideCanvas'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { buildSlideEditorView } from '@/core/tools/slideLayerView'
import { planSlideTextInsertion } from '@/core/tools/slideInsertion'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { publishedCourseV2Schema } from '@/shared/contracts/published-course-v2/schema'
import type { CompositionLayerItem, CourseProjectDocument, SlideSurfaceDocument } from '@/shared/courseProjectTypes'
import { effectiveSceneCanvas, mapSlideFrame, sharedSlideFrameMapping, unmapSlideFrame } from '@/shared/slideCanvas'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createResourceAwareAuthoringHistory } from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { transformSelectedSlideNativeLayers } from '@/renderer/course/slideEditorCommands'

function fixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces.find((candidate): candidate is SlideSurfaceDocument => candidate.type === 'slide')!
  const scene = surface.scenes[0]!
  scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'local-label', text: '正文', x: 100, y: 120, width: 300, height: 80 })))
  const composition: CompositionLayerItem = {
    layerItemId: 'web-region', kind: 'composition', label: '页面内容',
    frame: { mode: 'absolute', x: 0, y: 0, width: surface.canvas.width, height: surface.canvas.height },
    order: 2, rotation: 0, opacity: 1, visible: true, locked: false, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    content: { assets: {}, root: { id: 'web-body', kind: 'element', tagName: 'body', attributes: {}, children: [{ id: 'web-text', kind: 'text', text: '两列内容' }] } },
  }
  scene.layerItems.push(composition)
  const second = { ...structuredClone(scene), id: 'second-scene', name: '第二页', layerItems: [] }
  surface.scenes.push(second)
  project.locations.push({ id: second.id, kind: 'slide-scene', label: second.name, surfaceId: surface.id, sceneId: second.id })
  project.globalLayerItems.push({
    item: sceneNodeToCourseLayerItem(createTextNode({ id: 'shared-label', text: '统一页眉', x: 80, y: 40, width: 320, height: 60 })),
    visibility: { mode: 'all', locationIds: [] }, plane: 'overlay',
  })
  return { project: courseProjectDocumentSchema.parse(project), surfaceId: surface.id, sceneId: scene.id, secondId: second.id }
}

function slide(project: CourseProjectDocument): SlideSurfaceDocument {
  return project.surfaces.find((candidate): candidate is SlideSurfaceDocument => candidate.type === 'slide')!
}

describe('per-scene canvas and shared reference frames', () => {
  it('uses one scene source and round-trips shared display edits to its original frame', () => {
    const reference = { width: 1280, height: 720 }
    const target = { width: 720, height: 1280 }
    expect(effectiveSceneCanvas({ canvas: reference }, {})).toEqual(reference)
    expect(effectiveSceneCanvas({ canvas: reference }, { canvas: target })).toEqual(target)
    const mapping = sharedSlideFrameMapping(reference, target)
    const source = { mode: 'absolute' as const, x: 80, y: 40, width: 320, height: 60 }
    const displayed = mapSlideFrame(source, mapping)
    expect(displayed).toEqual({ mode: 'absolute', x: 45, y: 460, width: 180, height: 33.75 })
    expect(unmapSlideFrame(displayed, mapping)).toEqual(source)
    expect(unmapSlideFrame({ x: displayed.x + 9 }, mapping)).toEqual({ x: 96 })
    expect(source.x).toBe(80)
  })

  it('resizes only the selected scene, reflows Web slots, and preserves shared identity', () => {
    const { project, surfaceId, sceneId, secondId } = fixture()
    const beforeShared = structuredClone(project.globalLayerItems)
    const beforeSecond = structuredClone(slide(project).scenes[1])
    const resized = resizeSlideSceneCanvas(project, surfaceId, sceneId, { width: 720, height: 1280 })
    const surface = slide(resized)
    const scene = surface.scenes[0]!
    expect(effectiveSceneCanvas(surface, scene)).toEqual({ width: 720, height: 1280 })
    expect(scene.layerItems.find(item => item.layerItemId === 'web-region')?.frame).toEqual({ mode: 'absolute', x: 0, y: 0, width: 720, height: 1280 })
    expect(surface.scenes.find(value => value.id === secondId)).toEqual(beforeSecond)
    expect(resized.globalLayerItems).toEqual(beforeShared)
    const locationId = resized.locations.find(location => location.kind === 'slide-scene' && location.sceneId === sceneId)!.id
    const view = buildSlideEditorView({ project: resized, locationId })
    expect(view.canvas).toEqual({ width: 720, height: 1280 })
    expect(view.referenceCanvas).toEqual({ width: 1280, height: 720 })
    expect(view.layers.find(value => value.selectionId === 'shared-label')?.item.frame).toEqual({ mode: 'absolute', x: 45, y: 460, width: 180, height: 33.75 })
    expect(view.layers.filter(value => value.selectionId === 'shared-label')).toHaveLength(1)
  })

  it('changes inherited pages with the default and restores a page override explicitly', () => {
    const { project, surfaceId, sceneId } = fixture()
    const overridden = resizeSlideSceneCanvas(project, surfaceId, sceneId, { width: 720, height: 1280 })
    const explicitScene = structuredClone(slide(overridden).scenes[0])
    const resizedDefault = resizeCourseSlideCanvas(overridden, { width: 1024, height: 768 })
    expect(slide(resizedDefault).scenes[0]).toEqual(explicitScene)
    expect(effectiveSceneCanvas(slide(resizedDefault), slide(resizedDefault).scenes[1])).toEqual({ width: 1024, height: 768 })
    const inherited = resizeSlideSceneCanvas(resizedDefault, surfaceId, sceneId, null)
    expect(slide(inherited).scenes[0]?.canvas).toBeUndefined()
    expect(slide(inherited).scenes[0]?.layerItems.find(value => value.layerItemId === 'web-region')?.frame).toMatchObject({ width: 1024, height: 768 })
  })

  it('commits a displayed shared-layer drag to one source and places new content on the actual page', () => {
    const { project, surfaceId, sceneId, secondId } = fixture()
    const resized = resizeSlideSceneCanvas(project, surfaceId, sceneId, { width: 720, height: 1280 })
    const locationId = resized.locations.find(location => location.kind === 'slide-scene' && location.sceneId === sceneId)!.id
    const view = buildSlideEditorView({ project: resized, locationId })
    const displayed = view.layers.find(layer => layer.selectionId === 'shared-label')!.item
    const history = transformSelectedSlideNativeLayers(createResourceAwareAuthoringHistory(resized), { locationId, stateId: null, selectionIds: ['shared-label'] }, {
      nodes: [{ nodeId: 'shared-label', ...displayed.frame, x: displayed.frame.x + 9, rotation: displayed.rotation }],
    }, 'global')
    expect(history.present.globalLayerItems[0]?.item.frame.x).toBe(96)
    expect(history.present.revision).toBe(resized.revision + 1)
    expect(history.past).toHaveLength(1)
    const secondLocationId = resized.locations.find(location => location.kind === 'slide-scene' && location.sceneId === secondId)!.id
    expect(buildSlideEditorView({ project: history.present, locationId: secondLocationId }).layers.find(layer => layer.selectionId === 'shared-label')?.item.frame.x).toBe(96)
    const inserted = planSlideTextInsertion(resized, { scope: 'scene', selection: { locationId, stateId: null } }, { id: 'new-page-text' })
    const newItem = slide(inserted.project).scenes[0]?.layerItems.find(item => item.layerItemId === inserted.itemId)!
    expect(newItem.frame.x + newItem.frame.width / 2).toBe(720 / 2 + 40)
    expect(newItem.frame.y + newItem.frame.height / 2).toBe(1280 / 2)
  })

  it('persists different page specifications in strict V9 and Published V2', () => {
    const { project, surfaceId, sceneId } = fixture()
    const resized = resizeSlideSceneCanvas(project, surfaceId, sceneId, { width: 720, height: 1280 })
    const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(resized)))
    expect(slide(reopened).scenes[0]?.canvas).toEqual({ width: 720, height: 1280 })
    const payload = publishedCourseV2Schema.parse(buildPublishedCourseV2Payload({ project: reopened, assetFiles: {}, components: {} }))
    const published = payload.surfaces.find(surface => surface.type === 'slide')!
    expect(published.type === 'slide' && published.scenes[0]?.canvas).toEqual({ width: 720, height: 1280 })
    expect(courseProjectDocumentSchema.safeParse({ ...resized, surfaces: [{ ...slide(resized), scenes: [{ ...slide(resized).scenes[0], canvas: { width: 10, height: 1280 } }, slide(resized).scenes[1]] }] }).success).toBe(false)
  })
})
