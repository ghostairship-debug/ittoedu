import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSlidePage,
  addCourseSpatialPage,
  COURSE_LAST_LOCATION_REASON,
  deleteCourseLocation,
  deleteCourseSurface,
  moveCourseSlideScene,
  reorderCourseSurfaces,
} from '@/renderer/course/courseLocationCommands'
import { insertFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'

const NOW = '2026-08-17T12:00:00.000Z'

function slideSurfaceId(project: CourseProjectDocument): string {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface) throw new Error('expected slide surface')
  return surface.id
}

function slideSceneLocationIds(project: CourseProjectDocument): string[] {
  return project.locations.flatMap((location) =>
    location.kind === 'slide-scene' ? [location.id] : [],
  )
}

describe('courseLocationCommands', () => {
  it('keeps old scene locations when addCourseScene runs twice on the same Slide surface', () => {
    let project = createBlankCourseProject({ now: NOW })
    const surfaceId = slideSurfaceId(project)
    const firstSceneLocationId = project.startLocationId

    const first = addCourseScene(project, { surfaceId, now: NOW, expectedRevision: project.revision })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.reason)
    project = first.project
    expect(slideSceneLocationIds(project)).toEqual([
      firstSceneLocationId,
      first.activatedLocationId,
    ])

    const second = addCourseScene(project, {
      surfaceId,
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.reason)
    project = second.project

    expect(slideSceneLocationIds(project)).toEqual([
      firstSceneLocationId,
      first.activatedLocationId,
      second.activatedLocationId,
    ])
    expect(project.locations.some((location) => location.id === firstSceneLocationId)).toBe(true)
    expect(second.activatedLocationId).not.toBe(firstSceneLocationId)
    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
  })

  it('preserves existing locations after adding Flow and Spatial pages', () => {
    let project = createBlankCourseProject({ now: NOW })
    const originalLocationIds = project.locations.map((location) => location.id)

    const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
    expect(flowAdded.ok).toBe(true)
    if (!flowAdded.ok) throw new Error(flowAdded.reason)
    project = flowAdded.project
    expect(project.locations.map((location) => location.id)).toEqual([
      ...originalLocationIds,
      flowAdded.activatedLocationId,
    ])

    const spatialAdded = addCourseSpatialPage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(spatialAdded.ok).toBe(true)
    if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
    project = spatialAdded.project
    expect(project.locations.map((location) => location.id)).toEqual([
      ...originalLocationIds,
      flowAdded.activatedLocationId,
      spatialAdded.activatedLocationId,
    ])
    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
  })

  it('rejects deleting the last reachable location', () => {
    const project = createBlankSpatialCourseProject({ now: NOW })
    expect(project.locations).toHaveLength(1)

    const deleted = deleteCourseLocation(project, project.startLocationId, {
      expectedRevision: project.revision,
    })
    expect(deleted.ok).toBe(false)
    if (deleted.ok) throw new Error('expected delete failure')
    expect(deleted.reason).toContain('不能删除最后')
    expect(deleted.project).toBe(project)
  })

  it('rejects stale expectedRevision', () => {
    const project = createBlankCourseProject({ now: NOW })
    const result = addCourseScene(project, {
      surfaceId: slideSurfaceId(project),
      expectedRevision: project.revision + 1,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected stale failure')
    expect(result.reason).toBe('stale-revision')
  })

  it('adds a Flow page and synchronizes the mixed print plan', () => {
    const flow = createBlankFlowCourseProject({ now: NOW })

    const added = addCourseFlowPage(flow, { now: NOW, expectedRevision: flow.revision })
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error(added.reason)
    expect(added.project.surfaces.filter((surface) => surface.type === 'flow')).toHaveLength(2)
    expect(added.project.mixedPrintPlan?.entries).toHaveLength(2)
    expect(courseProjectDocumentSchema.parse(added.project)).toEqual(added.project)
  })

  it('uses Chinese reason for last-location guard constant', () => {
    expect(COURSE_LAST_LOCATION_REASON).toMatch(/不能删除最后/)
  })

  it('reorders mixed surfaces, grouped locations, and mixedPrintPlan in one revision', () => {
    let project = createBlankCourseProject({ now: NOW })
    const startLocationId = project.startLocationId
    const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
    expect(flowAdded.ok).toBe(true)
    if (!flowAdded.ok) throw new Error(flowAdded.reason)
    project = flowAdded.project
    const spatialAdded = addCourseSpatialPage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(spatialAdded.ok).toBe(true)
    if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
    project = spatialAdded.project

    const originalSurfaceIds = project.surfaces.map((surface) => surface.id)
    expect(originalSurfaceIds).toHaveLength(3)
    const reversed = [...originalSurfaceIds].reverse()
    const groupedBefore = new Map<string, string[]>()
    for (const location of project.locations) {
      const entries = groupedBefore.get(location.surfaceId) ?? []
      entries.push(location.id)
      groupedBefore.set(location.surfaceId, entries)
    }

    const reordered = reorderCourseSurfaces(project, reversed, {
      now: NOW,
      expectedRevision: project.revision,
      activeLocationId: startLocationId,
    })
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) throw new Error(reordered.reason)
    expect(reordered.project.revision).toBe(project.revision + 1)
    expect(reordered.activatedLocationId).toBe(startLocationId)
    expect(reordered.project.startLocationId).toBe(reordered.project.locations[0]!.id)
    expect(reordered.project.startLocationId).not.toBe(startLocationId)
    expect(reordered.project.surfaces.map((surface) => surface.id)).toEqual(reversed)
    expect(reordered.project.locations.map((location) => location.id)).toEqual(
      reversed.flatMap((surfaceId) => groupedBefore.get(surfaceId) ?? []),
    )
    expect(reordered.project.mixedPrintPlan?.entries.map((entry) => entry.surfaceId)).toEqual(reversed)
    expect(courseProjectDocumentSchema.parse(reordered.project)).toEqual(reordered.project)

    const originalStartSurfaceId = project.locations.find(
      (location) => location.id === startLocationId,
    )?.surfaceId
    expect(originalStartSurfaceId).toBeTruthy()
    const deletedOriginal = deleteCourseSurface(reordered.project, originalStartSurfaceId!, {
      now: NOW,
      expectedRevision: reordered.project.revision,
    })
    expect(deletedOriginal.ok).toBe(true)
    if (!deletedOriginal.ok) throw new Error(deletedOriginal.reason)
    expect(deletedOriginal.project.locations.some((location) => location.id === startLocationId)).toBe(false)
    expect(deletedOriginal.project.startLocationId).toBe(deletedOriginal.project.locations[0]!.id)
  })

  it('rejects incomplete or unknown surface reorder lists', () => {
    const project = createBlankCourseProject({ now: NOW })
    const empty = reorderCourseSurfaces(project, [], { expectedRevision: project.revision })
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error('expected empty reorder failure')
    expect(empty.reason).toBe('页面排序必须包含全部页面')
    expect(empty.project).toBe(project)

    const unknown = reorderCourseSurfaces(project, ['missing-surface'], {
      expectedRevision: project.revision,
    })
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('expected unknown reorder failure')
    expect(unknown.reason).toBe('页面排序包含未知页面')
  })

  it('deletes a whole Flow/Slide/Spatial group and refuses the last course location', () => {
    let project = createBlankCourseProject({ now: NOW })
    const slideId = slideSurfaceId(project)
    const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
    expect(flowAdded.ok).toBe(true)
    if (!flowAdded.ok) throw new Error(flowAdded.reason)
    project = flowAdded.project
    const flowId = project.surfaces.find((surface) => surface.type === 'flow')?.id
    expect(flowId).toBeTruthy()

    const spatialAdded = addCourseSpatialPage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(spatialAdded.ok).toBe(true)
    if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
    project = spatialAdded.project
    const spatialId = project.surfaces.find((surface) => surface.type === 'spatial-2d')?.id
    expect(spatialId).toBeTruthy()

    const deletedFlow = deleteCourseSurface(project, flowId!, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(deletedFlow.ok).toBe(true)
    if (!deletedFlow.ok) throw new Error(deletedFlow.reason)
    project = deletedFlow.project
    expect(project.surfaces.some((surface) => surface.id === flowId)).toBe(false)
    expect(project.locations.some((location) => location.surfaceId === flowId)).toBe(false)

    const deletedSpatial = deleteCourseSurface(project, spatialId!, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(deletedSpatial.ok).toBe(true)
    if (!deletedSpatial.ok) throw new Error(deletedSpatial.reason)
    project = deletedSpatial.project
    expect(project.surfaces.some((surface) => surface.id === spatialId)).toBe(false)

    const last = deleteCourseSurface(project, slideId, { expectedRevision: project.revision })
    expect(last.ok).toBe(false)
    if (last.ok) throw new Error('expected last-location failure')
    expect(last.reason).toBe(COURSE_LAST_LOCATION_REASON)
    expect(last.project).toBe(project)
    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
  })

  it('repairs scene and layer references when deleting an entire Slide surface', () => {
    let project = createBlankCourseProject({ now: NOW })
    const slideId = slideSurfaceId(project)
    const slide = project.surfaces.find((surface) => surface.id === slideId)
    const scene = slide?.type === 'slide' ? slide.scenes[0] : undefined
    if (!scene) throw new Error('expected Slide scene')
    const removedSceneId = scene.id
    scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({
      id: 'removed-slide-node',
      name: '待删元素',
      text: '待删元素',
    }), 10))
    project.globalInteractions = [
      {
        id: 'drop-deleted-scene',
        enabled: true,
        trigger: { type: 'presenter.command', command: 'next' },
        conditions: [{ type: 'scene.in', sceneIds: [removedSceneId] }],
        actions: [{
          id: 'drop-deleted-scene-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'drop-deleted-node',
        enabled: true,
        trigger: { type: 'node.click', nodeId: 'removed-slide-node' },
        conditions: [],
        actions: [{
          id: 'drop-deleted-node-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    ]
    project = courseProjectDocumentSchema.parse(project)
    const flowAdded = addCourseFlowPage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(flowAdded.ok).toBe(true)
    if (!flowAdded.ok) throw new Error(flowAdded.reason)

    const deleted = deleteCourseSurface(flowAdded.project, slideId, {
      now: NOW,
      expectedRevision: flowAdded.project.revision,
    })

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) throw new Error(deleted.reason)
    expect(deleted.project.globalInteractions).toEqual([])
    expect(deleted.project.surfaces.some((surface) => surface.id === slideId)).toBe(false)
    expect(courseProjectDocumentSchema.parse(deleted.project)).toEqual(deleted.project)
  })

  it('does not delete a whole Flow page through deleteCourseLocation on a heading', () => {
    let project = createBlankFlowCourseProject({ now: NOW })
    const flow = project.surfaces.find((surface) => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('expected flow surface')
    const inserted = insertFlowEditorBlock(project, {
      surfaceId: flow.id,
      parentId: null,
      index: flow.blocks.length,
      block: { type: 'heading', level: 1, text: '第二节' },
    }, { now: NOW, expectedRevision: project.revision })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok || !inserted.nextDocument) throw new Error(inserted.reason ?? 'insert failed')
    project = inserted.nextDocument
    const headings = project.locations.filter((location) =>
      location.kind === 'flow-block' && location.surfaceId === flow.id,
    )
    expect(headings.length).toBeGreaterThan(1)

    const refused = deleteCourseLocation(project, headings[1]!.id, {
      expectedRevision: project.revision,
    })
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('expected flow-block delete refusal')
    expect(refused.reason).toBe('请通过 Flow 编辑器删除本页内的标题块')
    expect(refused.project).toBe(project)
    expect(project.surfaces.some((surface) => surface.id === flow.id)).toBe(true)
  })

  it('moves a slide scene onto another slide surface and rewrites print-plan refs', () => {
    let project = createBlankCourseProject({ now: NOW })
    const firstSlideId = slideSurfaceId(project)
    const secondPage = addCourseSlidePage(project, { now: NOW, expectedRevision: project.revision })
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) throw new Error(secondPage.reason)
    project = secondPage.project
    const secondSlide = project.surfaces.find((surface) =>
      surface.type === 'slide' && surface.id !== firstSlideId,
    )
    if (!secondSlide || secondSlide.type !== 'slide') throw new Error('expected second slide surface')
    const extraScene = addCourseScene(project, {
      surfaceId: secondSlide.id,
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(extraScene.ok).toBe(true)
    if (!extraScene.ok) throw new Error(extraScene.reason)
    project = extraScene.project

    const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
    expect(flowAdded.ok).toBe(true)
    if (!flowAdded.ok) throw new Error(flowAdded.reason)
    project = flowAdded.project
    const flowId = project.surfaces.find((surface) => surface.type === 'flow')!.id
    const spatialAdded = addCourseSpatialPage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(spatialAdded.ok).toBe(true)
    if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
    project = spatialAdded.project
    const spatialId = project.surfaces.find((surface) => surface.type === 'spatial-2d')!.id

    const moving = project.locations.find((location) =>
      location.kind === 'slide-scene' && location.surfaceId === secondSlide.id,
    )
    if (!moving || moving.kind !== 'slide-scene') throw new Error('expected scene to move')

    const rejectedFlow = moveCourseSlideScene(project, moving.id, flowId, {
      expectedRevision: project.revision,
    })
    expect(rejectedFlow.ok).toBe(false)
    if (rejectedFlow.ok) throw new Error('expected flow reject')
    expect(rejectedFlow.reason).toBe('只能把演示场景移到另一演示页面')

    const rejectedSpatial = moveCourseSlideScene(project, moving.id, spatialId, {
      expectedRevision: project.revision,
    })
    expect(rejectedSpatial.ok).toBe(false)
    if (rejectedSpatial.ok) throw new Error('expected spatial reject')
    expect(rejectedSpatial.reason).toBe('只能把演示场景移到另一演示页面')

    const moved = moveCourseSlideScene(project, moving.id, firstSlideId, {
      now: NOW,
      expectedRevision: project.revision,
      toIndex: 0,
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) throw new Error(moved.reason)
    const relocated = moved.project.locations.find((location) => location.id === moving.id)
    expect(relocated?.kind === 'slide-scene' && relocated.surfaceId).toBe(firstSlideId)
    expect(moved.project.surfaces.some((surface) => surface.id === secondSlide.id)).toBe(true)
    const target = moved.project.surfaces.find((surface) => surface.id === firstSlideId)
    if (!target || target.type !== 'slide') throw new Error('expected target slide')
    expect(target.scenes[0]?.id).toBe(moving.sceneId)
    const source = moved.project.surfaces.find((surface) => surface.id === secondSlide.id)
    if (!source || source.type !== 'slide') throw new Error('expected source slide')
    expect(source.scenes.map((scene) => scene.id)).not.toContain(moving.sceneId)
    const print = moved.project.mixedPrintPlan?.entries.find((entry) =>
      entry.kind === 'slide-scenes' && entry.surfaceId === firstSlideId,
    )
    expect(print?.kind === 'slide-scenes' && print.sceneIds[0]).toBe(moving.sceneId)
    const sourcePrint = moved.project.mixedPrintPlan?.entries.find((entry) =>
      entry.kind === 'slide-scenes' && entry.surfaceId === secondSlide.id,
    )
    expect(sourcePrint?.kind === 'slide-scenes' && sourcePrint.sceneIds).not.toContain(moving.sceneId)
    expect(courseProjectDocumentSchema.parse(moved.project)).toEqual(moved.project)
  })

  it('removes an emptied slide group after its last scene moves into another group', () => {
    let project = createBlankCourseProject({ now: NOW })
    const firstSlideId = slideSurfaceId(project)
    const secondPage = addCourseSlidePage(project, { now: NOW, expectedRevision: project.revision })
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) throw new Error(secondPage.reason)
    project = secondPage.project
    const secondSlideId = project.surfaces.find((surface) =>
      surface.type === 'slide' && surface.id !== firstSlideId,
    )?.id
    expect(secondSlideId).toBeTruthy()
    const moving = project.locations.find((location) =>
      location.kind === 'slide-scene' && location.surfaceId === secondSlideId,
    )
    if (!moving) throw new Error('expected second-group scene')

    const moved = moveCourseSlideScene(project, moving.id, firstSlideId, {
      now: NOW,
      expectedRevision: project.revision,
    })
    expect(moved.ok).toBe(true)
    if (!moved.ok) throw new Error(moved.reason)
    expect(moved.project.surfaces.some((surface) => surface.id === secondSlideId)).toBe(false)
    const relocated = moved.project.locations.find((location) => location.id === moving.id)
    expect(relocated?.kind === 'slide-scene' && relocated.surfaceId).toBe(firstSlideId)
    expect(moved.project.surfaces.filter((surface) => surface.type === 'slide')).toHaveLength(1)
    expect(courseProjectDocumentSchema.parse(moved.project)).toEqual(moved.project)
  })
})
