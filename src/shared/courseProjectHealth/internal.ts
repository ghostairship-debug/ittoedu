import { componentManifestSchema } from '../componentSchema'
import type { ComponentManifest } from '../componentTypes'
import type { CourseLayerCompositionSource } from '../courseLayerComposition'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
  LayerItemOverride,
  SlideSceneDocument,
} from '../courseProjectTypes'
import {
  resolveSchemaValidCourseProjectDiagnosticTarget,
} from '../courseProjectValidationDiagnostics'
import { compareStableStrings } from '../stableOrder'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthContext,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
  CourseProjectHealthSeverity,
} from './types'

export interface CourseLayerVisit {
  item: LayerItem
  path: Array<string | number>
  owner:
    | { kind: 'global' }
    | { kind: 'surface'; surfaceId: string }
    | { kind: 'scene'; surfaceId: string; sceneId: string }
    | { kind: 'world'; surfaceId: string }
}

export interface CourseFlowBlockVisit {
  block: FlowBlock
  path: Array<string | number>
  surfaceId: string
}

const severityOrder: Record<CourseProjectHealthSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

function componentKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

function decodeComponentManifest(
  files: Readonly<Record<string, Uint8Array>>,
): ComponentManifest | undefined {
  const bytes = files['manifest.json']
  if (!bytes) return undefined
  try {
    return componentManifestSchema.parse(JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown)
  } catch {
    // openCourseProjectArchive already rejects this. Keeping the shared collector
    // defensive does not turn an archive failure into a second semantic finding.
    return undefined
  }
}

export function createCourseProjectHealthContext(
  project: CourseProjectDocument,
  archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthContext {
  const componentManifests = new Map<string, ComponentManifest>()
  Object.values(project.componentPackages).forEach((metadata) => {
    const key = componentKey(metadata.packageId, metadata.version)
    const files = archiveFiles.componentFiles[key]
    const manifest = files ? decodeComponentManifest(files) : undefined
    if (manifest) componentManifests.set(key, manifest)
  })
  return { project, archiveFiles, componentManifests }
}

export function manifestFor(
  context: CourseProjectHealthContext,
  packageId: string,
  version: string,
): ComponentManifest | undefined {
  return context.componentManifests.get(componentKey(packageId, version))
}

export function visitCourseLayerItems(
  project: CourseProjectDocument,
  visit: (entry: CourseLayerVisit) => void,
): void {
  project.globalLayerItems.forEach((entry, index) => visit({
    item: entry.item,
    path: ['globalLayerItems', index, 'item'],
    owner: { kind: 'global' },
  }))
  project.surfaces.forEach((surface, surfaceIndex) => {
    surface.surfaceLayerItems.forEach((entry, index) => visit({
      item: entry.item,
      path: ['surfaces', surfaceIndex, 'surfaceLayerItems', index, 'item'],
      owner: { kind: 'surface', surfaceId: surface.id },
    }))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        scene.layerItems.forEach((item, itemIndex) => visit({
          item,
          path: ['surfaces', surfaceIndex, 'scenes', sceneIndex, 'layerItems', itemIndex],
          owner: { kind: 'scene', surfaceId: surface.id, sceneId: scene.id },
        }))
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item, itemIndex) => visit({
        item,
        path: ['surfaces', surfaceIndex, 'world', 'layerItems', itemIndex],
        owner: { kind: 'world', surfaceId: surface.id },
      }))
    }
  })
}

function visitFlowBlockList(
  blocks: readonly FlowBlock[],
  path: Array<string | number>,
  surfaceId: string,
  visit: (entry: CourseFlowBlockVisit) => void,
): void {
  blocks.forEach((block, index) => {
    const blockPath = [...path, index]
    visit({ block, path: blockPath, surfaceId })
    if (block.type === 'section') {
      visitFlowBlockList(block.blocks, [...blockPath, 'blocks'], surfaceId, visit)
    }
  })
}

export function visitCourseFlowBlocks(
  project: CourseProjectDocument,
  visit: (entry: CourseFlowBlockVisit) => void,
): void {
  project.surfaces.forEach((surface, surfaceIndex) => {
    if (surface.type !== 'flow') return
    visitFlowBlockList(surface.blocks, ['surfaces', surfaceIndex, 'blocks'], surface.id, visit)
  })
}

export function allLayerVisits(project: CourseProjectDocument): CourseLayerVisit[] {
  const result: CourseLayerVisit[] = []
  visitCourseLayerItems(project, (entry) => result.push(entry))
  return result
}

export function slideScenes(project: CourseProjectDocument): Array<{
  surface: Extract<CourseSurfaceDocument, { type: 'slide' }>
  surfaceIndex: number
  scene: SlideSceneDocument
  sceneIndex: number
  path: Array<string | number>
}> {
  return project.surfaces.flatMap((surface, surfaceIndex) => (
    surface.type === 'slide'
      ? surface.scenes.map((scene, sceneIndex) => ({
          surface,
          surfaceIndex,
          scene,
          sceneIndex,
          path: ['surfaces', surfaceIndex, 'scenes', sceneIndex],
        }))
      : []
  ))
}

export function courseProjectComposedLayerPath(
  project: CourseProjectDocument,
  surfaceIndex: number,
  sceneIndex: number | undefined,
  source: CourseLayerCompositionSource,
  layerItemId: string,
): Array<string | number> {
  const itemIndex = (items: readonly LayerItem[]): number => {
    const index = items.findIndex((item) => item.layerItemId === layerItemId)
    if (index < 0) throw new Error(`Composed layer item has no canonical owner: ${layerItemId}`)
    return index
  }
  if (source === 'global') {
    return [
      'globalLayerItems',
      itemIndex(project.globalLayerItems.map((entry) => entry.item)),
      'item',
    ]
  }
  const surface = project.surfaces[surfaceIndex]
  if (!surface) throw new Error(`Unknown Course Project surface index: ${surfaceIndex}`)
  if (source === 'surface') {
    return [
      'surfaces',
      surfaceIndex,
      'surfaceLayerItems',
      itemIndex(surface.surfaceLayerItems.map((entry) => entry.item)),
      'item',
    ]
  }
  if (source === 'scene') {
    if (surface.type !== 'slide' || sceneIndex === undefined) {
      throw new Error(`Unknown Slide scene index: ${sceneIndex ?? 'none'}`)
    }
    const scene = surface.scenes[sceneIndex]
    if (!scene) throw new Error(`Unknown Slide scene index: ${sceneIndex}`)
    return [
      'surfaces',
      surfaceIndex,
      'scenes',
      sceneIndex,
      'layerItems',
      itemIndex(scene.layerItems),
    ]
  }
  if (surface.type !== 'spatial-2d') {
    throw new Error('World composition requires a Spatial surface')
  }
  return [
    'surfaces',
    surfaceIndex,
    'world',
    'layerItems',
    itemIndex(surface.world.layerItems),
  ]
}

export function courseProjectLayerItemIds(
  project: CourseProjectDocument,
): Set<string> {
  const result = new Set<string>()
  visitCourseLayerItems(project, ({ item }) => result.add(item.layerItemId))
  return result
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeCourseProjectHealthProps(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = structuredClone(base) as Record<string, unknown>
  Object.entries(patch).forEach(([key, value]) => {
    const previous = result[key]
    result[key] = isPlainRecord(previous) && isPlainRecord(value)
      ? mergeCourseProjectHealthProps(previous, value)
      : structuredClone(value)
  })
  return result
}

export function effectiveLayerItem(
  item: LayerItem,
  override: LayerItemOverride | undefined,
): LayerItem {
  const effective = structuredClone(item)
  if (!override) return effective
  if (override.visible !== undefined) effective.visible = override.visible
  if (override.playbackInitialVisibility !== undefined) {
    effective.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (effective.kind === 'native' && override.nativeData) {
    effective.content.data = mergeCourseProjectHealthProps(
      effective.content.data as Readonly<Record<string, unknown>>,
      override.nativeData,
    ) as typeof effective.content.data
  } else if (effective.kind === 'component' && override.componentProps) {
    effective.props = mergeCourseProjectHealthProps(effective.props, override.componentProps)
  }
  return effective
}

export function finalizeCourseProjectHealthFindings(
  project: CourseProjectDocument,
  drafts: readonly CourseProjectHealthFindingDraft[],
): CourseProjectHealthFinding[] {
  const deduped = new Map<string, CourseProjectHealthFinding>()
  drafts.forEach((draft) => {
    const finding: CourseProjectHealthFinding = {
      ...draft,
      path: [...draft.path],
      target: resolveSchemaValidCourseProjectDiagnosticTarget(project, draft),
    }
    const key = JSON.stringify([
      finding.severity,
      finding.code,
      finding.path,
      finding.surfaceId,
      finding.layerItemId,
      finding.target,
      finding.message,
    ])
    if (!deduped.has(key)) deduped.set(key, finding)
  })
  return [...deduped.values()].sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity]
    || compareStableStrings(JSON.stringify(left.path), JSON.stringify(right.path))
    || compareStableStrings(left.code, right.code)
    || compareStableStrings(left.message, right.message)
  ))
}
