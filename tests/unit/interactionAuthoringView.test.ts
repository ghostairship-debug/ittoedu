import {
  selectGlobalInteractionAuthoringView,
  selectLocalInteractionAuthoringView,
} from '@/renderer/interactions/interactionAuthoringView'
import type { CourseProjectDocument, SlideSceneDocument } from '@/shared/courseProjectTypes'
import type { InteractionRule } from '@/shared/interactionTypes'
import { describe, expect, it } from 'vitest'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

function mixedProject(): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === 'mixed')
  if (!fixture) throw new Error('missing mixed fixture')
  return structuredClone(fixture.data.project)
}

function slideScene(project: CourseProjectDocument): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide' ? surface.scenes[0] : undefined
  if (!scene) throw new Error('missing slide scene')
  return scene
}

function revealRule(id: string, nodeId: string): InteractionRule {
  return {
    id,
    name: id,
    enabled: true,
    trigger: { type: 'scene.enter' },
    conditions: [],
    actions: [{
      id: `${id}-action`,
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'node.enter',
        nodeId,
        effect: 'fade',
        durationMs: 240,
        easing: 'ease-out',
      },
    }],
  }
}

describe('interaction authoring typed views', () => {
  it('reads a Slide local carrier without exposing a mutable V8 projection', () => {
    const project = mixedProject()
    const scene = slideScene(project)
    const detail = structuredClone(scene.layerItems[0]!)
    detail.layerItemId = 'slide-detail'
    detail.label = '基础详情'
    detail.order = 2
    detail.visible = false
    detail.locked = true
    scene.layerItems.push(detail)
    scene.presentation = {
      initialStateId: 'state-a',
      states: [{
        id: 'state-a',
        name: '状态 A',
        layerItemOverrides: {
          'slide-title': {
            label: '状态标题',
            visible: false,
            locked: true,
            playbackInitialVisibility: 'hidden',
          },
          'slide-detail': {
            label: '状态详情',
            visible: true,
            locked: false,
            playbackInitialVisibility: 'hidden',
          },
        },
      }],
    }
    const location = project.locations.find((candidate) => candidate.id === 'location-slide')
    if (!location || location.kind !== 'slide-scene') throw new Error('missing slide location')
    location.stateId = 'state-a'
    scene.interactions.push(revealRule('local-rule', 'slide-title'))

    const view = selectLocalInteractionAuthoringView(project, 'location-slide')

    expect(view).toMatchObject({
      availability: 'available',
      carrier: 'slide-scene',
      projectId: project.id,
      revision: project.revision,
      locationId: 'location-slide',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      activeStateId: 'state-a',
      ruleCapacity: { used: 1, limit: 1_000 },
    })
    if (view.availability !== 'available') throw new Error('expected available view')
    expect(view.nodes).toEqual([
      expect.objectContaining({
        id: 'slide-title',
        label: '状态标题',
        owner: 'scene',
        nativeType: 'text',
        visible: false,
        locked: true,
        playbackInitialVisibility: 'hidden',
      }),
      expect.objectContaining({
        id: 'slide-detail',
        label: '状态详情',
        owner: 'scene',
        visible: true,
        locked: false,
        playbackInitialVisibility: 'hidden',
      }),
    ])
    expect(view.states).toEqual([{ id: 'state-a', name: '状态 A' }])
    expect(view.rules).toEqual([expect.objectContaining({ id: 'local-rule' })])
    expect(view.sceneReferences.map((item) => item.id)).toEqual(['scene-1'])
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.rules[0])).toBe(true)
    expect(Object.isFrozen(view.nodes)).toBe(true)

    scene.interactions[0]!.name = '源文档后续修改'
    expect(view.rules[0]!.name).toBe('local-rule')
  })

  it('returns typed local unavailability for Flow and Spatial without writable rules', () => {
    const project = mixedProject()

    const flow = selectLocalInteractionAuthoringView(project, 'location-flow')
    const spatial = selectLocalInteractionAuthoringView(project, 'location-spatial')

    expect(flow).toMatchObject({
      availability: 'unavailable',
      reason: 'no-local-interaction-carrier',
      surfaceId: 'surface-flow',
      surfaceType: 'flow',
    })
    expect(spatial).toMatchObject({
      availability: 'unavailable',
      reason: 'no-local-interaction-carrier',
      surfaceId: 'surface-spatial',
      surfaceType: 'spatial-2d',
    })
    expect('rules' in flow).toBe(false)
    expect('rules' in spatial).toBe(false)
    expect(Object.isFrozen(flow)).toBe(true)
    expect(Object.isFrozen(spatial)).toBe(true)
  })

  it('keeps one global carrier available from every Surface and only lists Slide scenes', () => {
    const project = mixedProject()
    project.globalInteractions.push(revealRule('global-rule', 'global-banner'))

    const fromFlow = selectGlobalInteractionAuthoringView(project, 'location-flow')
    const fromSpatial = selectGlobalInteractionAuthoringView(project, 'location-spatial')

    expect(fromFlow).toMatchObject({
      availability: 'available',
      carrier: 'global',
      activeLocationId: 'location-flow',
      activeSurfaceType: 'flow',
      activeSlideSceneId: null,
      activeStateId: null,
      ruleCapacity: { used: 1, limit: 1_000 },
    })
    expect(fromSpatial.activeSurfaceType).toBe('spatial-2d')
    expect(fromSpatial.activeSlideSceneId).toBeNull()
    expect(fromFlow.nodes).toEqual([expect.objectContaining({
      id: 'global-banner',
      owner: 'global',
    })])
    expect(fromFlow.rules[0]).toMatchObject({ id: 'global-rule' })
    expect(fromFlow.sceneReferences).toEqual([{
      id: 'scene-1',
      name: '演示页',
      surfaceId: 'surface-slide',
    }])
    expect(fromFlow.sceneReferences.some((item) => (
      item.id === 'location-flow' || item.id === 'location-spatial'
    ))).toBe(false)
  })

  it('reports an invalid location without inventing an editable scene', () => {
    const view = selectLocalInteractionAuthoringView(mixedProject(), 'missing-location')
    expect(view).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid-location',
      locationId: 'missing-location',
      surfaceId: null,
      surfaceType: null,
    })
    expect('rules' in view).toBe(false)
  })
})
