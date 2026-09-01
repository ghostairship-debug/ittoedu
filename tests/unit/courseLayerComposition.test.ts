import { describe, expect, it } from 'vitest'
import { composeCourseProjectLocation } from '@/shared/courseLayerComposition'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

function slideStateFixture(): CourseProjectDocument {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => (
    candidate.id === 'slide-presentation-state'
  ))
  if (!fixture) throw new Error('missing slide-presentation-state fixture')
  const project = structuredClone(fixture.data.project)
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide fixture')
  const scene = surface.scenes[0]!
  const [title, hint] = scene.layerItems
  if (!title || !hint) throw new Error('expected Slide fixture items')

  const cloneItem = (
    source: LayerItem,
    layerItemId: string,
    order: number,
    patch: Partial<Pick<LayerItem, 'visible' | 'playbackInitialVisibility'>> = {},
  ): LayerItem => ({
    ...structuredClone(source),
    ...patch,
    layerItemId,
    label: layerItemId,
    order,
  })
  const scoped = (
    item: LayerItem,
    visibility: ScopedLayerItem['visibility'],
  ): ScopedLayerItem => ({ item, visibility })

  project.globalLayerItems = [
    scoped(cloneItem(title, 'global-scope-out', 100), {
      mode: 'include',
      locationIds: ['location-hidden'],
    }),
    scoped(cloneItem(title, 'global-hard-hidden', 110, { visible: false }), {
      mode: 'all',
      locationIds: [],
    }),
  ]
  surface.surfaceLayerItems = [
    scoped(cloneItem(hint, 'surface-playback-hidden', 120, {
      playbackInitialVisibility: 'hidden',
    }), {
      mode: 'all',
      locationIds: [],
    }),
  ]
  const success = scene.presentation?.states.find((state) => state.id === 'state-success')
  if (!success) throw new Error('expected state-success')
  success.layerItemOrder = ['slide-feedback', 'slide-title', 'slide-hint']
  success.layerItemOverrides['slide-feedback'] = {
    ...success.layerItemOverrides['slide-feedback'],
    label: '命名状态反馈',
    frame: { x: 96, y: 240, width: 680, height: 96 },
    locked: true,
    rotation: 3,
    opacity: 0.8,
    hitPolicy: 'pass-through',
    playbackInitialVisibility: 'hidden',
  }
  return courseProjectDocumentSchema.parse(project)
}

function entry(project: CourseProjectDocument, id: string) {
  const composition = composeCourseProjectLocation({
    project,
    locationId: 'location-success',
    stateId: 'state-success',
  })
  const found = composition.entries.find((candidate) => candidate.item.layerItemId === id)
  if (!found) throw new Error(`missing composition entry ${id}`)
  return found
}

describe('Course Project V9 layer composition', () => {
  it('separates stored, applicable, mounted and initially-visible facts', () => {
    const project = slideStateFixture()
    expect(entry(project, 'global-scope-out')).toMatchObject({
      source: 'global',
      stored: true,
      applicable: false,
      mounted: false,
      initiallyVisible: false,
    })
    expect(entry(project, 'global-hard-hidden')).toMatchObject({
      source: 'global',
      stored: true,
      applicable: true,
      mounted: false,
      initiallyVisible: false,
    })
    expect(entry(project, 'surface-playback-hidden')).toMatchObject({
      source: 'surface',
      stored: true,
      applicable: true,
      mounted: true,
      initiallyVisible: false,
    })
    expect(entry(project, 'slide-feedback')).toMatchObject({
      source: 'scene',
      stored: true,
      applicable: true,
      mounted: true,
      initiallyVisible: false,
    })
  })

  it('fully materializes named-state item data, order and background without mutating V9', () => {
    const project = slideStateFixture()
    const before = structuredClone(project)
    const composition = composeCourseProjectLocation({
      project,
      locationId: 'location-success',
      stateId: 'state-success',
    })
    const sceneEntries = composition.entries.filter((candidate) => candidate.source === 'scene')
    expect(sceneEntries.map((candidate) => candidate.item.layerItemId)).toEqual([
      'slide-feedback',
      'slide-title',
      'slide-hint',
    ])
    expect(sceneEntries.map((candidate) => candidate.item.order)).toEqual([1, 2, 3])
    const feedback = sceneEntries[0]?.item
    expect(feedback?.kind).toBe('native')
    expect((feedback as NativeLayerItem).content.data).toMatchObject({
      text: '正确：Δ > 0，方程有两个不相等的实数根。',
    })
    expect(feedback?.playbackInitialVisibility).toBe('hidden')
    expect(feedback).toMatchObject({
      label: '命名状态反馈',
      frame: { mode: 'absolute', x: 96, y: 240, width: 680, height: 96 },
      locked: true,
      rotation: 3,
      opacity: 0.8,
      hitPolicy: 'pass-through',
    })
    expect(composition.background).toEqual({ color: '#f0fdf4', assetId: undefined })
    expect(project).toEqual(before)
  })

  it('requires exact state: null is base and never follows location or initial state', () => {
    const project = slideStateFixture()
    const base = composeCourseProjectLocation({
      project,
      locationId: 'location-hidden',
      stateId: null,
    })
    expect(base.stateId).toBeNull()
    expect(base.background).toEqual({ color: '#ffffff', assetId: undefined })
    expect(base.entries.find((candidate) => candidate.item.layerItemId === 'slide-hint')?.mounted).toBe(true)
    expect(() => composeCourseProjectLocation({
      project,
      locationId: 'location-hidden',
      stateId: 'missing-state',
    })).toThrow('Unknown Slide state: missing-state')
  })

  it('uses order plus layerItemId as the stable cross-owner tie-break', () => {
    const fixture = listCourseProjectV9Fixtures().find((candidate) => (
      candidate.id === 'slide-presentation-state'
    ))
    if (!fixture) throw new Error('missing slide-presentation-state fixture')
    const project = structuredClone(fixture.data.project)
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide fixture')
    const success = surface.scenes[0]?.presentation?.states.find((state) => state.id === 'state-success')
    if (!success) throw new Error('expected state-success')
    success.layerItemOverrides['slide-hint'] = {
      ...success.layerItemOverrides['slide-hint'],
      order: 1,
    }
    const parsed = courseProjectDocumentSchema.parse(project)
    const composition = composeCourseProjectLocation({
      project: parsed,
      locationId: 'location-success',
      stateId: 'state-success',
    })
    expect(composition.entries.map((candidate) => candidate.item.layerItemId)).toEqual([
      'slide-hint',
      'slide-title',
      'slide-feedback',
    ])
  })

  it('uses the global teacher controller as a stable Overlay boundary without rewriting authored order', () => {
    const fixture = listCourseProjectV9Fixtures().find((candidate) => (
      candidate.id === 'global-layer-teacher-controller'
    ))
    if (!fixture) throw new Error('missing global-layer-teacher-controller fixture')
    const project = structuredClone(fixture.data.project)
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide fixture')
    const scene = surface.scenes[0]
    if (!scene?.layerItems[0]) throw new Error('expected local Slide item')
    scene.layerItems[0].order = 900
    const banner = project.globalLayerItems.find((candidate) => (
      candidate.item.layerItemId === 'global-banner'
    ))
    if (!banner) throw new Error('expected global banner')
    project.globalLayerItems.push({
      item: {
        ...structuredClone(banner.item),
        layerItemId: 'global-overlay-after-controller',
        label: '控制器上方全局项',
        order: 2_000,
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    const before = structuredClone(project)

    const composition = composeCourseProjectLocation({
      project,
      locationId: 'location-scene-1',
      stateId: null,
    })

    expect(composition.entries.map((candidate) => candidate.item.layerItemId)).toEqual([
      'global-banner',
      'slide-title-1',
      'teacher-controller-main',
      'global-overlay-after-controller',
    ])
    expect(composition.entries.map((candidate) => candidate.stackOrder)).toEqual([0, 1, 2, 3])
    expect(composition.entries.map((candidate) => candidate.item.order)).toEqual([
      50,
      900,
      80,
      2_000,
    ])
    expect(project).toEqual(before)
  })
})
