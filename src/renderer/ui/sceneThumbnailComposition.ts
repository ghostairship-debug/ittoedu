import { composeCourseProjectLocation } from '../../shared/courseLayerComposition'
import type {
  CourseProjectDocument,
  LayerItem,
  RuntimeLayerItem,
} from '../../shared/courseProjectTypes'

export type SceneThumbnailCompositionSource = 'global' | 'surface' | 'scene' | 'world'

export type SceneThumbnailFallbackCoverage = NonNullable<
  RuntimeLayerItem['runtime']['staticFallback']
>['coverage']

export type SceneThumbnailCompositionEntry =
  | {
      kind: 'layer'
      source: SceneThumbnailCompositionSource
      item: LayerItem
    }
  | {
      kind: 'runtime-fallback'
      source: SceneThumbnailCompositionSource
      item: RuntimeLayerItem
      fallback: {
        assetId: string
        coverage: SceneThumbnailFallbackCoverage
      }
    }

export interface BuildSceneThumbnailCompositionInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly stateId: string | null
}

function isMountedRuntime(
  item: LayerItem,
): item is RuntimeLayerItem {
  return item.kind === 'runtime'
}

/**
 * Mirrors the Player's visual root order without executing author JavaScript:
 * background is painted by the caller, then global underlay → surface/scene
 * content → global overlay. V9 Runtime is a `kind:'runtime'` LayerItem; its
 * staticFallback is drawn at the item's composed slot.
 */
export function buildSceneThumbnailComposition(
  input: BuildSceneThumbnailCompositionInput,
): SceneThumbnailCompositionEntry[] {
  const composition = composeCourseProjectLocation(input)
  const entries: SceneThumbnailCompositionEntry[] = []
  for (const entry of composition.entries) {
    if (!entry.mounted) continue
    if (isMountedRuntime(entry.item)) {
      const fallback = entry.item.runtime.enabled
        ? entry.item.runtime.staticFallback
        : undefined
      if (!fallback) continue
      entries.push({
        kind: 'runtime-fallback',
        source: entry.source,
        item: entry.item,
        fallback: {
          assetId: fallback.assetId,
          coverage: fallback.coverage,
        },
      })
      continue
    }
    entries.push({
      kind: 'layer',
      source: entry.source,
      item: entry.item,
    })
  }
  return entries
}

export function hasUnrepresentedRuntime(
  input: BuildSceneThumbnailCompositionInput,
): boolean {
  const composition = composeCourseProjectLocation(input)
  return composition.entries.some((entry) => (
    entry.mounted &&
    entry.item.kind === 'runtime' &&
    entry.item.runtime.enabled &&
    !entry.item.runtime.staticFallback
  ))
}

export function hasEnabledRuntime(
  input: BuildSceneThumbnailCompositionInput,
): boolean {
  const composition = composeCourseProjectLocation(input)
  return composition.entries.some((entry) => (
    entry.mounted &&
    entry.item.kind === 'runtime' &&
    entry.item.runtime.enabled
  ))
}
