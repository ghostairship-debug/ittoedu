import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  type CourseProjectDocument,
  type FlowBlock,
  type SlideSceneDocument,
  type SlideSurfaceDocument,
} from '@/shared/courseProjectTypes'
import { createBlankFlowSurface, syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  buildCourseTreeView,
  collectCourseTreeNodeIds,
  GLOBAL_LAYER_ENTRY_ID,
  SHARED_CONTENT_SECTION_ID,
  SPATIAL_CAMERA_GROUP_LABEL,
} from '@/renderer/course/courseTreeView'
import { commitSlideProjectMutation } from '@/renderer/course/slideEditorCommands'
import {
  addSlideScene,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { addSpatialCameraFrameFromSession } from '@/renderer/course/spatialCameraCommands'
import { openSpatialAuthoringSession } from '@/renderer/course/spatialEditorCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'

const NOW = '2026-08-17T20:00:00.000Z'

function fixtureIdFactory(prefix = 'tree-fixture') {
  let seq = 0
  return () => `${prefix}-${++seq}`
}

function requireSession<TSession>(
  result: { ok: boolean; nextSession?: TSession },
): TSession {
  if (!result.ok || !result.nextSession) throw new Error('expected successful session command')
  return result.nextSession
}

function flowBlocksWithHeadingOnly(): FlowBlock[] {
  return [
    { id: 'block-h1', type: 'heading', level: 1, text: '第一章' },
    { id: 'block-paragraph', type: 'paragraph', text: '正文不上树' },
  ]
}

function flowProjectWithHeadingOnly(): CourseProjectDocument {
  const project = createBlankFlowCourseProject({ now: NOW, idFactory: fixtureIdFactory('flow') })
  const surfaceId = project.surfaces[0]!.id
  const next = commitSlideProjectMutation(project, (draft) => {
    const surface = draft.surfaces.find((candidate) => candidate.id === surfaceId)
    if (!surface || surface.type !== 'flow') throw new Error('missing flow surface')
    surface.blocks = flowBlocksWithHeadingOnly()
    syncFlowCourseLocations(draft, surfaceId)
  })
  return courseProjectDocumentSchema.parse(next)
}

function slideSurface(project: CourseProjectDocument): SlideSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface || surface.type !== 'slide') throw new Error('missing slide surface')
  return surface
}

function addSecondSlideSurface(project: CourseProjectDocument): CourseProjectDocument {
  const secondSurfaceId = 'surface-slide-b'
  const sceneId = 'scene-slide-b-1'
  const scene: SlideSceneDocument = {
    id: sceneId,
    name: '演示 B',
    backgroundColor: '#ffffff',
    layerItems: [],
    interactions: [],
  }
  const firstSurfaceId = slideSurface(project).id
  const firstSceneIds = slideSurface(project).scenes.map((candidate) => candidate.id)
  return courseProjectDocumentSchema.parse(commitSlideProjectMutation(project, (draft) => {
    draft.surfaces.push({
      id: secondSurfaceId,
      type: 'slide',
      title: '演示页面 B',
      canvas: { width: 1280, height: 720 },
      scenes: [scene],
      surfaceLayerItems: [],
    })
    draft.locations.push({
      id: sceneId,
      label: scene.name,
      kind: 'slide-scene',
      surfaceId: secondSurfaceId,
      sceneId,
    })
    draft.mixedPrintPlan = {
      pageSize: 'A4',
      orientation: 'auto',
      entries: [
        { id: 'print-slide-a', kind: 'slide-scenes', surfaceId: firstSurfaceId, sceneIds: firstSceneIds },
        { id: 'print-slide-b', kind: 'slide-scenes', surfaceId: secondSurfaceId, sceneIds: [sceneId] },
      ],
    }
  }))
}

function mixedManyLocationProject(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: NOW, idFactory: fixtureIdFactory('many-loc') })
  let session = openSlideAuthoringSession(project)
  for (let index = 0; index < 21; index += 1) {
    session = requireSession(addSlideScene(session, {
      now: NOW,
      expectedRevision: session.history.present.revision,
      name: `场景 ${index + 2}`,
    }))
  }
  return courseProjectDocumentSchema.parse(session.history.present)
}

describe('buildCourseTreeView', () => {
  it('exposes fixed shared content and global layer entry that is not a location', () => {
    const view = buildCourseTreeView(createBlankCourseProject({ now: NOW }))
    expect(view.shared).toMatchObject({
      id: SHARED_CONTENT_SECTION_ID,
      kind: 'shared-content',
      label: '共享内容',
      globalEntry: {
        id: GLOBAL_LAYER_ENTRY_ID,
        kind: 'global-layer',
        label: '全局层',
        rangeLabel: '全课',
        isLocation: false,
        writesHistory: false,
      },
    })
    expect(view.shared.entries).toEqual([view.shared.globalEntry])
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.pages)).toBe(true)
  })

  it('projects a pure Slide surface with two scene locations under the surface parent', () => {
    let session = openSlideAuthoringSession(createBlankCourseProject({ now: NOW }))
    session = requireSession(addSlideScene(session, {
      now: NOW,
      expectedRevision: session.history.present.revision,
      name: '第二页',
    }))
    const project = session.history.present
    const surface = slideSurface(project)
    const view = buildCourseTreeView(project)

    expect(view.pages).toHaveLength(1)
    expect(view.pages[0]).toMatchObject({
      id: surface.id,
      kind: 'slide-page',
      surfaceId: surface.id,
      surfaceType: 'slide',
      isLocation: false,
      writesHistory: false,
    })
    expect(view.pages[0]?.children.map((child) => child.id)).toEqual(
      surface.scenes.map((scene) => scene.id),
    )
    expect(view.pages[0]?.children.every((child) => (
      child.kind === 'slide-scene'
      && child.isLocation
      && child.writesHistory
      && child.locationId === child.id
    ))).toBe(true)
    expect(view.pages[0]?.children.map((child) => child.label)).toEqual(
      surface.scenes.map((scene) => scene.name),
    )
  })

  it('projects Flow headings from listFlowCourseTreePages and omits paragraphs', () => {
    const project = flowProjectWithHeadingOnly()
    const surfaceId = project.surfaces[0]!.id
    const view = buildCourseTreeView(project)
    const flowPage = view.pages.find((page) => page.surfaceId === surfaceId)

    expect(flowPage).toMatchObject({
      id: surfaceId,
      kind: 'flow-page',
      surfaceType: 'flow',
    })
    expect(flowPage?.children.map((child) => [child.id, child.kind, child.label])).toEqual([
      ['block-h1', 'flow-heading', '第一章'],
    ])
    expect(flowPage?.children.every((child) => (
      child.locationId === child.id
      && child.isLocation
      && child.surfaceId === surfaceId
      && !/^\d+$/.test(child.id)
    ))).toBe(true)
    expect(project.locations.some((location) => (
      location.kind === 'flow-block'
      && location.id === 'block-h1'
      && location.blockId === 'block-h1'
    ))).toBe(true)
    expect(flowPage?.children.some((child) => child.label.includes('正文'))).toBe(false)
  })

  it('projects Spatial page with a camera group and at least two camera frames', () => {
    let session = openSpatialAuthoringSession(
      createBlankSpatialCourseProject({ now: NOW, idFactory: fixtureIdFactory('spatial') }),
    )
    session = requireSession(addSpatialCameraFrameFromSession(session, {
      name: '特写',
      now: NOW,
    }))
    const project = session.history.present
    const surfaceId = project.surfaces[0]!.id
    const view = buildCourseTreeView(project)
    const spatialPage = view.pages.find((page) => page.surfaceId === surfaceId)

    expect(spatialPage).toMatchObject({
      id: surfaceId,
      kind: 'spatial-page',
      surfaceType: 'spatial-2d',
    })
    expect(spatialPage?.children).toHaveLength(1)
    expect(spatialPage?.children[0]).toMatchObject({
      id: `cameras:${surfaceId}`,
      kind: 'spatial-camera-group',
      label: SPATIAL_CAMERA_GROUP_LABEL,
      isLocation: false,
      writesHistory: false,
    })
    expect(spatialPage?.children[0]?.children.length).toBeGreaterThanOrEqual(2)
    expect(spatialPage?.children[0]?.children.every((child) => (
      child.kind === 'spatial-camera'
      && child.isLocation
      && child.locationId === child.id
    ))).toBe(true)
  })

  it('lists every Slide surface parent when a project contains two Slide surfaces', () => {
    const project = addSecondSlideSurface(createBlankCourseProject({ now: NOW }))
    const slideSurfaceIds = project.surfaces
      .filter((surface) => surface.type === 'slide')
      .map((surface) => surface.id)
    const view = buildCourseTreeView(project)

    expect(slideSurfaceIds).toHaveLength(2)
    expect(view.pages.filter((page) => page.surfaceType === 'slide').map((page) => page.id))
      .toEqual(slideSurfaceIds)
    expect(view.pages.filter((page) => page.kind === 'slide-page')).toHaveLength(2)
  })

  it('navigates Mixed Slide+Flow pages by stable surface and location identity', () => {
    const slide = createBlankCourseProject({ now: NOW, idFactory: fixtureIdFactory('mixed-nav') })
    const slideSurfaceId = slideSurface(slide).id
    const slideSceneIds = slideSurface(slide).scenes.map((scene) => scene.id)
    const flow = createBlankFlowSurface({
      id: 'surface-flow-mixed',
      title: '流式讲义',
      headingId: 'flow-heading-mixed',
    })
    const project = courseProjectDocumentSchema.parse(commitSlideProjectMutation(slide, (draft) => {
      draft.surfaces.push(flow.surface)
      draft.locations.push(flow.location)
      draft.mixedPrintPlan = {
        pageSize: 'A4',
        orientation: 'auto',
        entries: [
          { id: 'print-slide', kind: 'slide-scenes', surfaceId: slideSurfaceId, sceneIds: slideSceneIds },
          { id: 'print-flow', kind: 'flow-document', surfaceId: flow.surface.id },
        ],
      }
    }))
    const view = buildCourseTreeView(project)
    const flowPage = view.pages.find((page) => page.kind === 'flow-page')
    const heading = flowPage?.children[0]
    const headingLocation = project.locations.find((location) => location.id === heading?.id)

    expect(view.pages.map((page) => [page.kind, page.id])).toEqual([
      ['slide-page', slideSurfaceId],
      ['flow-page', flow.surface.id],
    ])
    expect(heading).toMatchObject({
      id: 'flow-heading-mixed',
      kind: 'flow-heading',
      locationId: 'flow-heading-mixed',
      surfaceId: flow.surface.id,
      isLocation: true,
    })
    expect(headingLocation).toMatchObject({
      kind: 'flow-block',
      blockId: 'flow-heading-mixed',
      surfaceId: flow.surface.id,
    })
    expect(heading?.id).not.toBe('0')
    expect(flowPage?.id).toBe(flow.surface.id)
  })

  it('keeps stable unique ids across 20+ locations in one mixed fixture', () => {
    const project = mixedManyLocationProject()
    const view = buildCourseTreeView(project)
    const ids = collectCourseTreeNodeIds(view)
    const sceneCount = project.locations.filter((location) => location.kind === 'slide-scene').length

    expect(sceneCount).toBeGreaterThanOrEqual(20)
    expect(view.pages).toHaveLength(1)
    expect(ids.length).toBeGreaterThanOrEqual(20)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(SHARED_CONTENT_SECTION_ID)
    expect(ids).toContain(GLOBAL_LAYER_ENTRY_ID)
    expect(view.pages.some((page) => page.kind === 'slide-page' && page.children.length >= 20)).toBe(true)
  })
})
