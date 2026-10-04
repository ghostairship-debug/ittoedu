import { describe, expect, it } from 'vitest'
import { buildCoursePlaybackSequence, adjacentPlaybackTarget, playbackNavigationProgress } from '../../src/player/navigation/coursePlaybackSequence'
import { spatialFragmentNodeAttributes, spatialFragmentStepIndex, spatialSteppingStops } from '../../src/shared/composition/spatialStopSteps'
import { STEP_HIDDEN_ATTRIBUTE } from '../../src/shared/composition/stateNodes'
import type { SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'
import { spatialStopsProject } from '../helpers/spatialStopsFixture'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { DocumentModel } from '../../src/shared/workbench/document'

describe('Spatial fragment steps derived from stops and content', () => {
  it('canonical content edits and moved objects reopen with the same fragments, follow target and rotation', async () => {
    const driver = new CourseV9Driver()
    const initial: DocumentModel = { kind: 'course-v9', project: spatialStopsProject(), resources: { assets: {}, components: {} } }
    const edited = await driver.apply(initial, { type: 'composition.edit', layerItemId: 'a', edit: { type: 'attributes', nodeId: 'a-step-2', patch: { class: null } } })
    const moved = await driver.apply(edited, { type: 'course.object.patch', locationId: 'stop-a', itemId: 'a', patch: { frame: { x: 500, y: 600, width: 400, height: 300 }, rotation: 45 } })
    const reopened = driver.load(driver.serialize(moved))
    if (reopened.kind !== 'course-v9') throw new Error('Expected V9 course')
    const surface = reopened.project.surfaces[0] as SpatialSurfaceDocument
    expect(surface.camera.frames.find(frame => frame.id === 'stop-a')).toMatchObject({ x: 700, y: 750, rotation: 45, targetLayerItemId: 'a' })
    expect(buildCoursePlaybackSequence(reopened.project)[0]!.steps.filter(step => step.locationId === 'stop-a').map(step => step.stateId)).toEqual(['fragment_step_0', 'fragment_step_1'])
    expect(buildCoursePlaybackSequence(initial.project)[0]!.steps.filter(step => step.locationId === 'stop-a')).toHaveLength(3)
  })

  it('expands each introducing stop before advancing, reverses to its last fragment and keeps a later whole-card stop', () => {
    const project = spatialStopsProject()
    const scenes = buildCoursePlaybackSequence(project)
    const home = project.startLocationId
    expect(scenes.map(scene => scene.kind)).toEqual(['spatial'])
    expect(scenes[0]!.steps.map(step => [step.locationId, step.stateId])).toEqual([
      [home, undefined], ['stop-a', 'fragment_step_0'], ['stop-a', 'fragment_step_1'], ['stop-a', 'fragment_step_2'],
      ['stop-b', 'fragment_step_0'], ['stop-b', 'fragment_step_1'], ['stop-a2', undefined],
    ])
    expect(adjacentPlaybackTarget(scenes, playbackNavigationProgress(scenes, 'stop-a', 'fragment_step_0'), 'step', 'next')).toMatchObject({ locationId: 'stop-a', stateId: 'fragment_step_1' })
    expect(adjacentPlaybackTarget(scenes, playbackNavigationProgress(scenes, 'stop-b', 'fragment_step_0'), 'step', 'previous')).toMatchObject({ locationId: 'stop-a', stateId: 'fragment_step_2' })
    expect(adjacentPlaybackTarget(scenes, playbackNavigationProgress(scenes, 'stop-a2'), 'step', 'next')).toBeNull()
    expect(adjacentPlaybackTarget(scenes, playbackNavigationProgress(scenes, 'stop-a'), 'scene', 'next')).toBeNull()
  })

  it('derives reveal visibility from the destination, so backward navigation and exact reentry reset legally', () => {
    const project = spatialStopsProject()
    const surface = project.surfaces[0] as SpatialSurfaceDocument
    const hidden = (location: string, step: number, item: string, node: string) => STEP_HIDDEN_ATTRIBUTE in spatialFragmentNodeAttributes(surface, project.locations, location, step).get(item)!.get(node)!
    expect(hidden(project.startLocationId, 0, 'a', 'a-step-1')).toBe(true)
    expect(hidden('stop-a', 1, 'a', 'a-step-1')).toBe(false)
    expect(hidden('stop-a', 1, 'a', 'a-step-2')).toBe(true)
    expect(hidden('stop-b', 0, 'a', 'a-step-2')).toBe(false)
    expect(hidden('stop-b', 0, 'b', 'b-step-1')).toBe(true)
    expect(hidden('stop-a2', 0, 'b', 'b-step-1')).toBe(false)
    expect(hidden('stop-a', 0, 'a', 'a-step-1')).toBe(true)
    expect(hidden('stop-a', 2, 'b', 'b-step-1')).toBe(true)
    const plain = structuredClone(surface)
    delete plain.camera.frames.find(frame => frame.id === 'stop-a')!.targetLayerItemId
    delete plain.camera.frames.find(frame => frame.id === 'stop-a2')!.targetLayerItemId
    expect([...spatialSteppingStops(plain, project.locations).keys()]).toEqual(['stop-b'])
    expect(spatialFragmentStepIndex('fragment_step_01')).toBeUndefined()
    expect(spatialFragmentStepIndex('fragment_step_-1')).toBeUndefined()
    expect(spatialFragmentStepIndex('fragment_step_2')).toBe(2)
  })
})
