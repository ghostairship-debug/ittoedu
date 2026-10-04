// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { planSpaceContentWrite, planSpaceDelete, planSpaceMove, spaceFiles, targetSpace } from '../../src/core/projectFiles/spaceFiles'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { projectFileToolSchemas } from '../../src/core/tools/ProjectFileTools'
import { projectFileLocationId, type CourseModel } from '../../src/core/projectFiles/ProjectFileCoordinator'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { slidePageFiles } from '../../src/core/projectFiles/projectFileView'
import { docFiles } from '../../src/core/projectFiles/flowDocs'

const resources = { assets: {}, components: {} }
const blank = () => createBlankCourseProject({ includeDefaultController: false, controls: 'none' })

describe('space file identity and transactions', () => {
  it('projects page, handout and space files to their formal first location, with no location for a stopless space', () => {
    const { project, surface } = targetSpace(blank(), 'spaces/地图.html')
    const flow = addCourseFlowPage(project, { title: '讲义' })
    if (!flow.ok) throw new Error(flow.reason)
    const model: CourseModel = { kind: 'course-v9', project: flow.project, resources }
    const page = slidePageFiles(model.project)[0]!, doc = docFiles(model.project)[0]!
    expect(projectFileLocationId(model, page.path)).toBe(page.locationId)
    expect(projectFileLocationId(model, doc.path)).toBe(model.project.locations.find(value => value.surfaceId === doc.surface.id)!.id)
    expect(projectFileLocationId(model, 'spaces/地图.html')).toBe(model.project.locations.find(value => value.surfaceId === surface.id)!.id)
    expect(projectFileLocationId(model, 'theme.css')).toBeUndefined()
    model.project.locations = model.project.locations.filter(value => value.surfaceId !== surface.id)
    const space = model.project.surfaces.find(value => value.id === surface.id)!
    if (space.type !== 'spatial-2d') throw new Error('spatial')
    space.camera.frames = []
    expect(projectFileLocationId(model, 'spaces/地图.html')).toBeUndefined()
  })

  it('lists colliding titles without aliasing surfaces; renames keep stops and location labels; deletion cleans references', () => {
    let { project, surface } = targetSpace(blank(), 'spaces/地图.html')
    const id = surface.id, frame = surface.camera.frames[0]!, location = project.locations.find(value => value.surfaceId === id)!
    const second = targetSpace(project, 'spaces/地图 2.html')
    project = second.project
    project.surfaces.find(value => value.id === second.surface.id)!.title = '地图'
    const third = targetSpace(project, 'spaces/地图 3.html')
    project = third.project
    expect(spaceFiles(project).map(file => file.path)).toEqual(['spaces/地图.html', 'spaces/地图 2.html', 'spaces/地图 3.html'])
    project.globalInteractions.push({ id: 'go-map', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
      actions: [{ id: 'go-map-step', start: 'after-previous', delayMs: 0, action: { type: 'location.go', locationId: location.id } }] })
    const moved = planSpaceMove(project, resources, 'spaces/地图.html', 'spaces/知识空间.html').project
    expect(spaceFiles(moved)[0]!.surface.id).toBe(id)
    expect(spaceFiles(moved)[0]!.surface.camera.frames).toEqual(surface.camera.frames)
    expect(moved.locations.find(value => value.id === location.id)).toMatchObject({ label: `知识空间 · ${frame.name}` })
    expect(moved.globalInteractions).toEqual(project.globalInteractions)
    expect(() => planSpaceMove(moved, resources, 'spaces/知识空间.html', 'spaces/地图.html')).toThrow('已存在')
    const deleted = planSpaceDelete(moved, resources, 'spaces/知识空间.html').project
    expect(deleted.globalInteractions).toEqual([])
    expect(deleted.locations.some(value => value.id === location.id)).toBe(false)
    expect(courseProjectDocumentSchema.safeParse(deleted).success).toBe(true)
  })

  it('reconciles camera locations by frame identity, including renamed and reordered stops and removed targets', () => {
    const { project, surface } = targetSpace(blank(), 'spaces/旅程.html')
    const first = surface.camera.frames[0]!
    const frames = [{ ...first, name: '起点', rotation: 30 }, { id: 'camera-second', name: '终点', x: 200, y: -100, zoom: 0.5, rotation: -45 }]
    const written = planSpaceContentWrite({ project, resources, surfaceId: surface.id, layerItems: [], frames, diagnostics: [] }).project
    const firstLocation = written.locations.find(value => value.surfaceId === surface.id && value.id === first.id)!
    const changed = planSpaceContentWrite({ project: written, resources, surfaceId: surface.id, layerItems: [], frames: [frames[1]!, { ...frames[0]!, name: '新起点' }], diagnostics: [] }).project
    expect(changed.locations.filter(value => value.surfaceId === surface.id).map(value => value.id)).toEqual(['camera-second', firstLocation.id])
    expect(changed.locations.find(value => value.id === firstLocation.id)!.label).toBe('旅程 · 新起点')
    expect(courseProjectDocumentSchema.safeParse(changed).success).toBe(true)
  })

  it('keeps write size and edit count governed by actual carrier support', () => {
    expect(projectFileToolSchemas['project.write'].safeParse({ path: 'spaces/内容.html', content: 'x'.repeat(4_000_001) }).success).toBe(true)
    expect(projectFileToolSchemas['project.edit'].safeParse({ path: 'spaces/内容.html', edits: Array.from({ length: 51 }, () => ({ old: 'x', new: 'y' })) }).success).toBe(true)
  })
})
