import type { CourseProjectDocument, LayerItem } from '../../../shared/courseProjectTypes'
import type { PlayerAuthoringPatch } from '../../../shared/playerAuthoringProtocol'

/** An edit a try-run page paused for editing takes in place: new text rules of one of its Runtimes or components. */
export type LiveScenePatch = Extract<PlayerAuthoringPatch, { kind: 'runtime-text-overrides' | 'component-light-edits' }>

/**
 * M15 运行现场: how a document change reaches a try-run page paused for editing. New text rules of the page's
 * Runtimes and components are applied in place, so the page keeps its state; a replaced picture or keyed text
 * needs the page loaded again. `null`: the change is about something else, and the live page ends.
 */
export interface LiveSceneChanges {
  readonly patches: readonly LiveScenePatch[]
  /** Items that need the page loaded again to show the change. */
  readonly reloads: ReadonlyArray<{ readonly itemId: string; readonly label: string }>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]))
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function sceneItems(project: CourseProjectDocument, sceneId: string): readonly LayerItem[] {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    const scene = surface.scenes.find(candidate => candidate.id === sceneId)
    if (scene) return scene.layerItems
  }
  return []
}

/** The document without what a live page can take: the light edits of its items, their fallbacks and new assets. */
function withoutLiveEdits(project: CourseProjectDocument, sceneId: string): unknown {
  const copy = structuredClone(project) as unknown as Record<string, unknown>
  delete copy.revision
  delete copy.updatedAt
  delete copy.assets
  for (const item of sceneItems(copy as unknown as CourseProjectDocument, sceneId)) {
    if (item.kind === 'runtime') {
      const runtime = item.runtime as unknown as Record<string, unknown>
      const content = { ...item.runtime.content } as Record<string, unknown>
      delete content.values
      delete content.overrides
      runtime.content = content
      delete runtime.assets
      delete runtime.staticFallback
    } else if (item.kind === 'component') {
      delete item.textOverrides
      delete item.assetOverrides
      delete item.staticFallbackAssetId
    }
  }
  return copy
}

export function liveSceneChanges(
  before: CourseProjectDocument,
  after: CourseProjectDocument,
  sceneId: string,
): LiveSceneChanges | null {
  if (before.id !== after.id) return null
  if (!same(withoutLiveEdits(before, sceneId), withoutLiveEdits(after, sceneId))) return null
  // Assets may be added (a replaced picture, a new static fallback) or dropped again by undo, never changed.
  for (const [id, asset] of Object.entries(after.assets)) {
    if (Object.hasOwn(before.assets, id) && !same(before.assets[id], asset)) return null
  }
  const previousItems = new Map(sceneItems(before, sceneId).map(item => [item.layerItemId, item]))
  const patches: LiveScenePatch[] = []
  const reloads: Array<{ itemId: string; label: string }> = []
  for (const item of sceneItems(after, sceneId)) {
    const previous = previousItems.get(item.layerItemId)
    if (item.kind === 'runtime' && previous?.kind === 'runtime') {
      if (!same(item.runtime.content.values, previous.runtime.content.values) || !same(item.runtime.assets, previous.runtime.assets)) {
        reloads.push({ itemId: item.layerItemId, label: item.label })
      } else if (!same(item.runtime.content.overrides ?? [], previous.runtime.content.overrides ?? [])) {
        patches.push({
          kind: 'runtime-text-overrides',
          target: { kind: 'runtime-text-overrides', scope: 'scene', nodeId: item.layerItemId },
          overrides: (item.runtime.content.overrides ?? []).map(rule => ({ ...rule })),
        })
      }
    } else if (item.kind === 'component' && previous?.kind === 'component') {
      if (!same(item.assetOverrides ?? {}, previous.assetOverrides ?? {})) {
        reloads.push({ itemId: item.layerItemId, label: item.label })
      } else if (!same(item.textOverrides ?? [], previous.textOverrides ?? [])) {
        patches.push({
          kind: 'component-light-edits',
          target: { kind: 'component-light-edits', scope: 'scene', nodeId: item.layerItemId },
          textOverrides: (item.textOverrides ?? []).map(rule => ({ ...rule })),
          assetOverrides: structuredClone(item.assetOverrides ?? {}),
        })
      }
    }
  }
  return { patches, reloads }
}

/**
 * What a paused page shows. The workspace keeps only this handle; the document behind it stays with the connector,
 * which reads the project (the workspace works from its read model).
 */
export interface LiveSceneBaseline {
  /** The try-run mount key of the document it was taken from. */
  readonly key: string | null
}
const baselines = new WeakMap<LiveSceneBaseline, CourseProjectDocument>()

export function captureLiveSceneBaseline(project: CourseProjectDocument, key: string | null): LiveSceneBaseline {
  const baseline: LiveSceneBaseline = Object.freeze({ key })
  baselines.set(baseline, project)
  return baseline
}

/** How `project` changed since the page showed `baseline`; `null` also when the baseline is unknown. */
export function liveSceneChangesSince(baseline: LiveSceneBaseline, project: CourseProjectDocument, sceneId: string): LiveSceneChanges | null {
  const before = baselines.get(baseline)
  return before ? liveSceneChanges(before, project, sceneId) : null
}

/** Only a Slide page with a Runtime or component is edited where the try-run is; its scene, or null. */
export function sceneWithLiveCarriers(project: CourseProjectDocument, locationId: string): string | null {
  const location = project.locations.find(candidate => candidate.id === locationId)
  if (location?.kind !== 'slide-scene') return null
  const surface = project.surfaces.find(candidate => candidate.id === location.surfaceId)
  const scene = surface?.type === 'slide' ? surface.scenes.find(candidate => candidate.id === location.sceneId) : undefined
  return scene?.layerItems.some(item => item.kind === 'runtime' || item.kind === 'component') ? scene.id : null
}

export function liveSceneItemLabel(project: CourseProjectDocument, sceneId: string, itemId: string): string {
  return sceneItems(project, sceneId).find(item => item.layerItemId === itemId)?.label ?? '这个对象'
}
