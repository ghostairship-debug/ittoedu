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
  buildCourseExportPageList,
  composePublishedSlideStaticPage,
  isPureSlidePublishedCourse,
} from './course/buildCoursePrintArtifacts'
import { capturePublishedCourseV2Stage } from './playerCapture'
import { isolatePublishedDynamicItemPayload } from './renderPptxComponentSnapshots'

export { PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR }

type PublishedRuntimeItem = Extract<PublishedLayerItem, { kind: 'runtime' }>

interface RuntimeSnapshotEntry {
  surface: PublishedSlideSurface
  scene: PublishedSlideScene
  locationId: string
  item: PublishedRuntimeItem
  snapshotKey: string
  global: boolean
}

export interface PptxRuntimeSnapshotFailure {
  entryKey: string
  snapshotKey: string
  scope: 'scene' | 'global'
  sceneId: string
  layerItemId: string
  /** Present only on the retired V8 underlay/overlay raster path. */
  layer?: 'underlay' | 'overlay'
  label: string
  error: unknown
}

export interface RenderPptxRuntimeSnapshotsOptions {
  includeGlobalLayerItems?: boolean
  onFailure?(failure: PptxRuntimeSnapshotFailure): void
}

export function pptxRuntimeSnapshotKey(
  sceneId: string,
  layerItemId: string,
  global = false,
): string {
  return global
    ? `runtime:global:${sceneId}:${layerItemId}`
    : `runtime:${sceneId}:${layerItemId}`
}

function isGlobalLayerItem(
  published: PublishedCourseV2Payload,
  layerItemId: string,
): boolean {
  return published.globalLayerItems.some((entry) => entry.item.layerItemId === layerItemId)
}

function listPublishedRuntimeEntries(
  published: PublishedCourseV2Payload,
  includeGlobalLayerItems: boolean,
): RuntimeSnapshotEntry[] {
  const entries: RuntimeSnapshotEntry[] = []
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
      if (item.kind !== 'runtime' || !item.visible) continue
      const global = isGlobalLayerItem(published, item.layerItemId)
      const snapshotKey = pptxRuntimeSnapshotKey(scene.id, item.layerItemId, global)
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
 * Runtime snapshots stay independent of native DrawingML objects. Capture each
 * visible runtime layer item through the Published V2 seam, preferring the real
 * instance over an authored static fallback. Retired V8 player export packages
 * fail before any host is created.
 */
export async function renderPptxRuntimeSnapshots(
  payload: unknown,
  options: RenderPptxRuntimeSnapshotsOptions = {},
): Promise<Map<string, string>> {
  assertParsedPublishedCourseV2(payload)
  const includeGlobalLayerItems = options.includeGlobalLayerItems
    ?? isPureSlidePublishedCourse(payload)
  const entries = listPublishedRuntimeEntries(payload, includeGlobalLayerItems)
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
        throw new Error('运行时捕获没有返回图片')
      }
      snapshots.set(entry.snapshotKey, captured)
    } catch (error) {
      const entryKey = pptxRuntimeSnapshotKey(entry.scene.id, entry.item.layerItemId, entry.global)
      options.onFailure?.({
        entryKey,
        snapshotKey: entry.snapshotKey,
        scope: entry.global ? 'global' : 'scene',
        sceneId: entry.scene.id,
        layerItemId: entry.item.layerItemId,
        label: entry.global
          ? `全局运行时“${entry.item.layerItemId}”`
          : `场景运行时“${entry.scene.name}”`,
        error,
      })
    }
  }
  return snapshots
}
