import {
  assertParsedPublishedCourseV2,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
} from '../../player/surfaces/CoursePlayer'
import type {
  PublishedCourseV2Payload,
  PublishedLayerItem,
  PublishedSlideScene,
  PublishedSlideSurface,
} from '../../shared/publishedCourseTypes'
import {
  composePublishedSlideStaticPage,
  isPureSlidePublishedCourse,
  buildCourseExportPageList,
} from './course/buildCoursePrintArtifacts'
import { capturePublishedCourseV2Stage } from './playerCapture'
import {
  pptxComponentSnapshotKey,
  pptxGlobalComponentSnapshotKey,
} from './pptxShared'

export { PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR }

type PublishedComponentItem = Extract<PublishedLayerItem, { kind: 'component' }>

interface ComponentSnapshotEntry {
  surface: PublishedSlideSurface
  scene: PublishedSlideScene
  locationId: string
  item: PublishedComponentItem
  snapshotKey: string
  global: boolean
}

export interface PptxComponentSnapshotFailure {
  snapshotKey: string
  sceneId: string
  nodeId: string
  label: string
  error: unknown
}

export interface RenderPptxComponentSnapshotsOptions {
  includeGlobalLayerItems?: boolean
  onFailure?(failure: PptxComponentSnapshotFailure): void
}

function isGlobalLayerItem(
  published: PublishedCourseV2Payload,
  layerItemId: string,
): boolean {
  return published.globalLayerItems.some((entry) => entry.item.layerItemId === layerItemId)
}

/** Isolate one component instance so capture cannot inherit sibling side effects. */
export function isolatePublishedDynamicItemPayload(
  published: PublishedCourseV2Payload,
  input: {
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
    layerItemId: string
    includeGlobalLayerItems: boolean
  },
): PublishedCourseV2Payload {
  const location = published.locations.find((candidate) => (
    candidate.id === input.locationId
    && candidate.kind === 'slide-scene'
    && candidate.surfaceId === input.surface.id
    && candidate.sceneId === input.scene.id
  ))
  if (!location) {
    throw new Error(`Published 静态捕获找不到 Slide 位置“${input.locationId}”`)
  }
  const scene = structuredClone(input.scene)
  const surface = structuredClone(input.surface)
  surface.scenes = [scene]
  const globalLayerItems = input.includeGlobalLayerItems
    ? structuredClone(published.globalLayerItems)
    : []
  const { layerItemId } = input
  const sceneMatches = scene.layerItems.filter((item) => item.layerItemId === layerItemId)
  const surfaceMatches = surface.surfaceLayerItems.filter((entry) => (
    entry.item.layerItemId === layerItemId
  ))
  const globalMatches = globalLayerItems.filter((entry) => (
    entry.item.layerItemId === layerItemId
  ))
  const matches = sceneMatches.length + surfaceMatches.length + globalMatches.length
  if (matches !== 1) {
    throw new Error(matches === 0
      ? `Published 静态捕获找不到动态图层“${layerItemId}”`
      : `Published 静态捕获发现重复动态图层“${layerItemId}”`)
  }
  const target = sceneMatches[0]
    ?? surfaceMatches[0]?.item
    ?? globalMatches[0]?.item
  if (!target || (target.kind !== 'component' && target.kind !== 'runtime')) {
    throw new Error(`Published 图层“${layerItemId}”不是可实例捕获的动态图层`)
  }
  scene.layerItems = sceneMatches
  surface.surfaceLayerItems = surfaceMatches
  return {
    ...structuredClone(published),
    surfaces: [surface],
    locations: [structuredClone(location)],
    startLocationId: location.id,
    globalLayerItems: globalMatches,
  }
}

function listPublishedComponentEntries(
  published: PublishedCourseV2Payload,
  includeGlobalLayerItems: boolean,
): ComponentSnapshotEntry[] {
  const entries: ComponentSnapshotEntry[] = []
  const seen = new Set<string>()
  for (const page of buildCourseExportPageList(published)) {
    if (page.kind !== 'slide-scene' || !page.sceneId || !page.locationId) continue
    const surface = published.surfaces.find((candidate): candidate is PublishedSlideSurface => (
      candidate.id === page.surfaceId && candidate.type === 'slide'
    ))
    if (!surface) continue
    const scene = surface.scenes.find((candidate) => candidate.id === page.sceneId)
    if (!scene) continue
    const composition = composePublishedSlideStaticPage(
      published,
      surface,
      scene,
      { includeGlobalLayerItems, locationId: page.locationId },
    )
    for (const item of composition.items) {
      if (item.kind !== 'component' || !item.visible) continue
      const global = isGlobalLayerItem(published, item.layerItemId)
      const snapshotKey = global
        ? pptxGlobalComponentSnapshotKey(scene.id, item.layerItemId)
        : pptxComponentSnapshotKey(scene.id, item.layerItemId)
      if (seen.has(snapshotKey)) continue
      seen.add(snapshotKey)
      entries.push({
        surface,
        scene,
        locationId: page.locationId,
        item,
        snapshotKey,
        global,
      })
    }
  }
  return entries
}

/**
 * External components cannot be represented as editable DrawingML. Capture each
 * visible instance through the Published V2 CoursePlayer seam so it remains an
 * independent PowerPoint picture. Retired V8 player export packages fail loud.
 */
export async function renderPptxComponentSnapshots(
  payload: unknown,
  options: RenderPptxComponentSnapshotsOptions = {},
): Promise<Map<string, string>> {
  assertParsedPublishedCourseV2(payload)
  const includeGlobalLayerItems = options.includeGlobalLayerItems
    ?? isPureSlidePublishedCourse(payload)
  const entries = listPublishedComponentEntries(payload, includeGlobalLayerItems)
  const snapshots = new Map<string, string>()
  for (const entry of entries) {
    try {
      const isolated = isolatePublishedDynamicItemPayload(payload, {
        surface: entry.surface,
        scene: entry.scene,
        locationId: entry.locationId,
        layerItemId: entry.item.layerItemId,
        includeGlobalLayerItems: entry.global,
      })
      const captured = await capturePublishedCourseV2Stage({
        payload: isolated,
        locationId: entry.locationId,
        surfaceId: entry.surface.id,
        layerItemId: entry.item.layerItemId,
        includeGlobalLayerItems: entry.global,
      })
      if (!captured.startsWith('data:image/')) {
        throw new Error('组件捕获没有返回图片')
      }
      snapshots.set(entry.snapshotKey, captured)
    } catch (error) {
      options.onFailure?.({
        snapshotKey: entry.snapshotKey,
        sceneId: entry.scene.id,
        nodeId: entry.item.layerItemId,
        label: entry.item.layerItemId,
        error,
      })
    }
  }
  return snapshots
}
