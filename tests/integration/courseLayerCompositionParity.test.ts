import { describe, expect, it } from 'vitest'
import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
  type CourseLayerCompositionEntry,
} from '@/shared/courseLayerComposition'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, LayerItem } from '@/shared/courseProjectTypes'
import type { PublishedLayerItem } from '@/shared/publishedCourseTypes'
import {
  composeEffectiveLayerLocation,
  projectEffectiveLayers,
} from '@/renderer/course/effectiveLayerProjection'
import {
  buildSlideEditorView,
  composeSlideEditorLocation,
} from '@/renderer/course/slideEditorView'
import {
  buildFlowEditorView,
  composeFlowEditorLocation,
} from '@/renderer/course/flowEditorView'
import {
  buildSpatialEditorView,
  composeSpatialEditorLocation,
} from '@/renderer/course/spatialEditorView'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  composePublishedSlideLocation,
} from '@/player/surfaces/slide/SlidePublishedAdapter'
import {
  composePublishedFlowLocation,
  publishedFlowOverlayEntries,
} from '@/player/surfaces/flow/FlowSurfaceHost'
import { toFlowPublishedPlayback } from '@/player/surfaces/flow/flowModel'
import {
  collectSpatialPlaybackEntries,
  composePublishedSpatialLocation,
  publishedSpatialInputFromCourse,
} from '@/player/surfaces/spatial/spatialModel'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

type AnyItem = LayerItem | PublishedLayerItem

function fixture(id: 'mixed' | 'slide-presentation-state') {
  const found = listCourseProjectV9Fixtures().find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing ${id} fixture`)
  return found
}

function publish(id: 'mixed' | 'slide-presentation-state') {
  const source = fixture(id).data
  return buildPublishedCourseV2Payload({
    project: source.project,
    assetFiles: source.assetFiles,
    components: {},
  })
}

function mixedParityProject(): CourseProjectDocument {
  const project = structuredClone(fixture('mixed').data.project)
  const donor = project.globalLayerItems[0]?.item
  if (!donor) throw new Error('mixed fixture global donor is missing')
  project.globalLayerItems[0]!.visibility = {
    mode: 'include',
    locationIds: ['location-slide'],
  }
  const flow = project.surfaces.find((candidate) => candidate.id === 'surface-flow')
  const spatial = project.surfaces.find((candidate) => candidate.id === 'surface-spatial')
  if (!flow || flow.type !== 'flow' || !spatial || spatial.type !== 'spatial-2d') {
    throw new Error('mixed fixture surfaces are missing')
  }
  flow.surfaceLayerItems = [{
    item: {
      ...structuredClone(donor),
      layerItemId: 'flow-playback-hidden',
      label: 'Flow playback hidden',
      order: 10,
      playbackInitialVisibility: 'hidden',
    },
    visibility: { mode: 'all', locationIds: [] },
  }]
  spatial.surfaceLayerItems = [{
    item: {
      ...structuredClone(donor),
      layerItemId: 'spatial-hard-hidden',
      label: 'Spatial hard hidden',
      order: 10,
      visible: false,
    },
    visibility: { mode: 'all', locationIds: [] },
  }]
  return courseProjectDocumentSchema.parse(project)
}

function publishMixedParityProject(project: CourseProjectDocument) {
  return buildPublishedCourseV2Payload({
    project,
    assetFiles: fixture('mixed').data.assetFiles,
    components: {},
  })
}

function facts(entries: readonly CourseLayerCompositionEntry<AnyItem>[]) {
  return entries.map((entry) => ({
    id: entry.item.layerItemId,
    source: entry.source,
    order: entry.item.order,
    stored: entry.stored,
    applicable: entry.applicable,
    mounted: entry.mounted,
    initiallyVisible: entry.initiallyVisible,
    visible: entry.item.visible,
    playbackInitialVisibility: entry.item.playbackInitialVisibility,
    frame: entry.item.frame,
    rotation: entry.item.rotation,
    opacity: entry.item.opacity,
    hitPolicy: entry.item.hitPolicy,
    kind: entry.item.kind,
    payload: entry.item.kind === 'native'
      ? entry.item.content
      : entry.item.kind === 'component'
        ? entry.item.props
        : entry.item.runtime.content,
  }))
}

function expectCompositionParity(
  shared: CourseLayerComposition<LayerItem>,
  adapter: CourseLayerComposition<LayerItem | PublishedLayerItem>,
): void {
  expect({
    locationId: adapter.locationId,
    surfaceId: adapter.surfaceId,
    surfaceType: adapter.surfaceType,
    sceneId: adapter.sceneId,
    stateId: adapter.stateId,
    background: adapter.background,
    entries: facts(adapter.entries),
  }).toEqual({
    locationId: shared.locationId,
    surfaceId: shared.surfaceId,
    surfaceType: shared.surfaceType,
    sceneId: shared.sceneId,
    stateId: shared.stateId,
    background: shared.background,
    entries: facts(shared.entries),
  })
}

describe('shared ↔ renderer ↔ raw Published V2 composition parity', () => {
  it.each([
    ['location-slide', 'slide'],
    ['location-flow', 'flow'],
    ['location-spatial', 'spatial'],
  ] as const)('has zero composition fact differences for mixed fixture %s', (locationId, kind) => {
    const project = mixedParityProject()
    const shared = composeCourseProjectLocation({ project, locationId, stateId: null })
    const effective = composeEffectiveLayerLocation({ project, locationId, stateId: null })
    expectCompositionParity(shared, effective)

    const projection = projectEffectiveLayers({ project, locationId, stateId: null })
    expect(projection.unifiedRows.map((row) => ({
      id: row.id,
      applicable: row.visibleAtLocation,
      mounted: row.effectiveVisible,
      item: row.item,
    }))).toEqual(shared.entries.map((entry) => ({
      id: entry.item.layerItemId,
      applicable: entry.applicable,
      mounted: entry.mounted,
      item: entry.item,
    })))

    const published = publishMixedParityProject(project)
    if (kind === 'slide') {
      expectCompositionParity(shared, composeSlideEditorLocation({ project, locationId, stateId: null }))
      const view = buildSlideEditorView({ project, locationId, stateId: null })
      expect(view.layers.map((layer) => layer.selectionId)).toEqual(
        shared.entries.map((entry) => entry.item.layerItemId),
      )
      expectCompositionParity(shared, composePublishedSlideLocation({
        payload: published,
        locationId,
        stateId: null,
      }))
    } else if (kind === 'flow') {
      expectCompositionParity(shared, composeFlowEditorLocation({ project, locationId }))
      const view = buildFlowEditorView({ project, locationId })
      expect(view.overlayLayers.map((layer) => layer.selectionId)).toEqual(
        shared.entries.filter((entry) => entry.applicable).map((entry) => entry.item.layerItemId),
      )
      const playback = toFlowPublishedPlayback(published)
      expectCompositionParity(shared, composePublishedFlowLocation({ playback, locationId }))
      const surface = playback.surfaces.find((candidate) => candidate.id === shared.surfaceId)!
      expect(publishedFlowOverlayEntries(playback, surface, locationId).map((entry) => entry.item.layerItemId)).toEqual(
        shared.entries.filter((entry) => entry.mounted).map((entry) => entry.item.layerItemId),
      )
      expect(shared.entries.find((entry) => entry.item.layerItemId === 'global-banner')).toMatchObject({
        stored: true,
        applicable: false,
        mounted: false,
        initiallyVisible: false,
      })
      expect(shared.entries.find((entry) => entry.item.layerItemId === 'flow-playback-hidden')).toMatchObject({
        applicable: true,
        mounted: true,
        initiallyVisible: false,
      })
    } else {
      expectCompositionParity(shared, composeSpatialEditorLocation({ project, locationId }))
      const view = buildSpatialEditorView({ project, locationId })
      expect(view.layers.map((layer) => layer.selectionId)).toEqual(
        shared.entries.map((entry) => entry.item.layerItemId),
      )
      const input = publishedSpatialInputFromCourse(published, { surfaceId: shared.surfaceId })
      expectCompositionParity(shared, composePublishedSpatialLocation({ input, locationId }))
      expect(collectSpatialPlaybackEntries(input, locationId).map((entry) => entry.item.layerItemId)).toEqual(
        shared.entries.filter((entry) => entry.mounted).map((entry) => entry.item.layerItemId),
      )
      expect(shared.entries.find((entry) => entry.item.layerItemId === 'spatial-hard-hidden')).toMatchObject({
        applicable: true,
        mounted: false,
        initiallyVisible: false,
      })
    }
  })

  it.each([
    ['state-hidden', '#ffffff', ['slide-title']],
    ['state-success', '#f0fdf4', ['slide-title', 'slide-hint', 'slide-feedback']],
  ] as const)('keeps exact Slide %s state in parity while V2 stays raw', (stateId, color, mountedIds) => {
    const project: CourseProjectDocument = fixture('slide-presentation-state').data.project
    const locationId = 'location-success'
    const shared = composeCourseProjectLocation({ project, locationId, stateId })
    expectCompositionParity(shared, composeSlideEditorLocation({ project, locationId, stateId }))
    expectCompositionParity(shared, composeEffectiveLayerLocation({ project, locationId, stateId }))
    const view = buildSlideEditorView({ project, locationId, stateId })
    expect({
      background: { color: view.backgroundColor, assetId: view.backgroundAssetId },
      entries: view.layers.map((layer) => ({
        id: layer.selectionId,
        applicable: layer.scopedVisible,
        mounted: layer.effectiveVisible,
        item: layer.item,
      })),
    }).toEqual({
      background: shared.background,
      entries: shared.entries.map((entry) => ({
        id: entry.item.layerItemId,
        applicable: entry.applicable,
        mounted: entry.mounted,
        item: entry.item,
      })),
    })
    const projection = projectEffectiveLayers({ project, locationId, stateId })
    expect(projection.unifiedRows.map((row) => ({
      id: row.id,
      applicable: row.visibleAtLocation,
      mounted: row.effectiveVisible,
      item: row.item,
    }))).toEqual(shared.entries.map((entry) => ({
      id: entry.item.layerItemId,
      applicable: entry.applicable,
      mounted: entry.mounted,
      item: entry.item,
    })))

    const published = publish('slide-presentation-state')
    const publishedComposition = composePublishedSlideLocation({ payload: published, locationId, stateId })
    expectCompositionParity(shared, publishedComposition)
    expect(publishedComposition.background).toEqual({ color, assetId: undefined })
    expect(publishedComposition.entries.filter((entry) => entry.mounted).map((entry) => entry.item.layerItemId))
      .toEqual(mountedIds)

    const slide = published.surfaces[0]
    if (!slide || slide.type !== 'slide') throw new Error('expected Published Slide')
    const rawFeedback = slide.scenes[0]?.layerItems.find((item) => item.layerItemId === 'slide-feedback')
    expect(rawFeedback?.visible).toBe(true)
    expect(rawFeedback?.kind === 'native' ? rawFeedback.content.data : null).toMatchObject({ text: '等待作答' })
    expect(slide.scenes[0]?.presentation?.states.find((state) => state.id === stateId)?.layerItemOverrides)
      .toHaveProperty('slide-feedback')
  })
})
