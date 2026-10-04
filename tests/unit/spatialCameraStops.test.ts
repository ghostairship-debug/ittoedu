import { describe, expect, it } from 'vitest'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { updateSpatialCameraFramePose } from '../../src/core/tools/spatialCamera'
import { renderPublishedSpatialFrameSvg } from '../../src/player/surfaces/spatial/publishedSpatialStaticRendering'
import {
  panSpatialRuntimeCamera,
  spatialRuntimeCameraFromPose,
  spatialScreenToWorld,
  spatialWorldGroupTransform,
  spatialWorldToScreen,
} from '../../src/player/surfaces/spatial/spatialModel'
import { SpatialSurfaceHost } from '../../src/player/surfaces/spatial/SpatialSurfaceHost'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { spatialStopsProject } from '../helpers/spatialStopsFixture'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument, SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'
import type { PublishedSpatialSurface } from '../../src/shared/publishedCourseTypes'

const spatialOf = (project: CourseProjectDocument) => project.surfaces[0] as SpatialSurfaceDocument
const frameOf = (project: CourseProjectDocument, id: string) => spatialOf(project).camera.frames.find(frame => frame.id === id)!

describe('Spatial stops: rotation and following a world item', () => {
  it('keeps a following stop on its item: center, rotation and a fitted zoom; a removed item frees it', () => {
    let project = spatialStopsProject()
    expect(frameOf(project, 'stop-a')).toMatchObject({ x: 200, y: 150, rotation: 30, targetLayerItemId: 'a' })
    expect(frameOf(project, 'stop-a').zoom).toBeCloseTo(Math.min(1280 * 0.9 / 400, 720 * 0.9 / 300))
    expect(frameOf(project, 'stop-b')).toMatchObject({ x: 1100, y: 50, targetLayerItemId: 'b' })
    expect(frameOf(project, 'stop-b')).not.toHaveProperty('rotation')

    const moved = structuredClone(project)
    const card = spatialOf(moved).world.layerItems.find(item => item.layerItemId === 'a')!
    card.frame = { ...card.frame, x: 100, width: 800 }
    card.rotation = 0
    project = normalizeCourseProject(moved)
    expect(frameOf(project, 'stop-a')).toMatchObject({ x: 500, y: 150 })
    expect(frameOf(project, 'stop-a').zoom).toBeCloseTo(1280 * 0.9 / 800)
    expect(frameOf(project, 'stop-a')).not.toHaveProperty('rotation')

    const removed = structuredClone(project)
    spatialOf(removed).world.layerItems = spatialOf(removed).world.layerItems.filter(item => item.layerItemId !== 'a')
    project = normalizeCourseProject(removed)
    expect(frameOf(project, 'stop-a')).toMatchObject({ x: 500, y: 150 })
    expect(frameOf(project, 'stop-a')).not.toHaveProperty('targetLayerItemId')
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)
  })

  it('rejects a stop that follows an item outside its world, and frees a stop set from the view', () => {
    const project = spatialStopsProject()
    const broken = structuredClone(project)
    frameOf(broken, 'stop-b').targetLayerItemId = 'missing'
    const result = courseProjectDocumentSchema.safeParse(broken)
    expect(result.success).toBe(false)
    expect(result.error?.issues.some(issue => issue.path.join('/').endsWith('camera/frames/2/targetLayerItemId'))).toBe(true)

    const freed = updateSpatialCameraFramePose(project, spatialOf(project).id, 'stop-a', { x: 10, y: 20, zoom: 2 })
    expect(frameOf(freed, 'stop-a')).toEqual({ id: 'stop-a', name: '甲卡', x: 10, y: 20, zoom: 2 })
  })

  it('turns the world against the stop rotation: the stop content stands upright on screen', () => {
    const camera = spatialRuntimeCameraFromPose({ x: 200, y: 150, zoom: 2, rotation: 30 }, { width: 1280, height: 720 })
    expect(spatialWorldGroupTransform(camera)).toBe('translate(640 360) rotate(-30) scale(2) translate(-200 -150)')
    expect(spatialWorldGroupTransform({ ...camera, rotation: 0 })).toBe('translate(640 360) scale(2) translate(-200 -150)')
    // The card's own x axis (turned 30°) runs left to right on screen.
    const angle = Math.PI / 6
    const along = spatialWorldToScreen(camera, { x: 200 + 100 * Math.cos(angle), y: 150 + 100 * Math.sin(angle) })
    expect(along.x).toBeCloseTo(640 + 200)
    expect(along.y).toBeCloseTo(360)
    const back = spatialScreenToWorld(camera, along)
    expect(back.x).toBeCloseTo(200 + 100 * Math.cos(angle))
    expect(back.y).toBeCloseTo(150 + 100 * Math.sin(angle))
    // Dragging 200px to the left brings the point 100 units along the card's x axis to the center.
    const panned = panSpatialRuntimeCamera(camera, { x: -200, y: 0 })
    expect(panned.x).toBeCloseTo(200 + 100 * Math.cos(angle))
    expect(panned.y).toBeCloseTo(150 + 100 * Math.sin(angle))
  })

  it('publishes rotation and follow targets; playback and the static frame render the turned world', async () => {
    const project = spatialStopsProject()
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const surface = payload.surfaces[0] as PublishedSpatialSurface
    expect(surface.camera.frames.find(frame => frame.id === 'stop-a')).toMatchObject({ rotation: 30, targetLayerItemId: 'a' })
    expect(renderPublishedSpatialFrameSvg(surface, 'stop-a', () => undefined).svg).toContain('rotate(-30)')

    const container = document.createElement('div')
    document.body.append(container)
    const host = SpatialSurfaceHost.fromPublishedCourse(payload, { width: 1280, height: 720 }, { locationId: 'stop-a' })
    try {
      await host.mount(container)
      await host.activate()
      await host.setLocationId('stop-a')
      expect(container.querySelector('[data-spatial-world]')!.getAttribute('transform')).toContain('rotate(-30)')
      expect(container.querySelector<HTMLElement>('.spatial-world-html')!.style.transform).toContain('rotate(-30deg)')
    } finally {
      await host.destroy()
      container.remove()
    }
  })
})
