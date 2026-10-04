import type { CourseProjectDocument, LayerItem, SpatialCameraFrame, SpatialSurfaceDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { addCourseSpatialPage, deleteCourseSurface, renameCourseSurface } from '../tools/courseLocations'
import { controllerTargetIdsForLocations, repairRemovedCourseReferences } from '../tools/courseReferenceCleanup'
import { spatialGraphValuesEqual } from '../tools/spatialPath'
import { fileStem } from './projectFileView'
import { ProjectFileError, type PlannedChange } from './slidePages'
import type { PageDiagnostic } from './pageHtml'
import { compositionElementNodeIds } from '../../shared/composition/content'

const SPACE_PATH = /^spaces\/([^/]+)\.html$/
export interface SpaceFile { path: string; surface: SpatialSurfaceDocument }

/** One virtual file per Spatial surface; duplicate display titles still address separate surfaces. */
export function spaceFiles(project: CourseProjectDocument): SpaceFile[] {
  const used = new Set<string>()
  return project.surfaces.filter((surface): surface is SpatialSurfaceDocument => surface.type === 'spatial-2d').map(surface => {
    const stem = fileStem(surface.title)
    let name = stem
    for (let suffix = 2; used.has(name.normalize('NFC').toLowerCase()); suffix++) name = `${stem} ${suffix}`
    used.add(name.normalize('NFC').toLowerCase())
    return { path: `spaces/${name}.html`, surface }
  })
}

function spaceName(path: string): string {
  const name = SPACE_PATH.exec(path)?.[1]
  if (name === undefined || fileStem(name) !== name)
    throw new ProjectFileError('invalid-path', '空间路径须为 spaces/<名称>.html，名称不能含路径分隔符、保留字符或首尾空格和点')
  return name
}

export const isSpacePath = (path: string) => SPACE_PATH.test(path)

export function targetSpace(project: CourseProjectDocument, path: string): { project: CourseProjectDocument; surface: SpatialSurfaceDocument } {
  const existing = spaceFiles(project).find(file => file.path === path)
  if (existing) return { project, surface: existing.surface }
  const added = addCourseSpatialPage(project, { title: spaceName(path) })
  if (!added.ok) throw new ProjectFileError('invalid-path', added.reason)
  const surfaceId = added.project.locations.find(location => location.id === added.activatedLocationId)!.surfaceId
  return { project: added.project, surface: added.project.surfaces.find((surface): surface is SpatialSurfaceDocument => surface.id === surfaceId && surface.type === 'spatial-2d')! }
}

/** The HTML projection supplies formal items/stops; this boundary owns locations and reference cleanup. */
export function planSpaceContentWrite(input: {
  project: CourseProjectDocument; resources: DocumentResources; surfaceId: string
  layerItems: LayerItem[]; frames: SpatialCameraFrame[]; diagnostics: readonly PageDiagnostic[]
}): PlannedChange {
  const project = structuredClone(input.project)
  const surface = project.surfaces.find((value): value is SpatialSurfaceDocument => value.id === input.surfaceId && value.type === 'spatial-2d')
  if (!surface) throw new ProjectFileError('not-found', '空间表面已不存在，请重新列出工程文件')
  for (const item of surface.world.layerItems) {
    if (item.locked && !spatialGraphValuesEqual(item, input.layerItems.find(value => value.layerItemId === item.layerItemId)))
      throw new ProjectFileError('locked', `空间对象“${item.label}”已锁定，解锁后再修改或删除`)
  }
  const itemIds = new Set(input.layerItems.map(item => item.layerItemId))
  const removedItems = new Set(surface.world.layerItems.filter(item => !itemIds.has(item.layerItemId)).map(item => item.layerItemId))
  const nextNodes = new Set(input.layerItems.flatMap(compositionElementNodeIds))
  const removedNodes = surface.world.layerItems.flatMap(compositionElementNodeIds).filter(id => !nextNodes.has(id))
  const frameIds = new Set(input.frames.map(frame => frame.id))
  const removed = project.locations.filter(location => location.kind === 'spatial-camera' && location.surfaceId === surface.id && !frameIds.has(location.cameraFrameId))
  const beforeLocations = project.locations.filter(location => location.surfaceId === surface.id)
  surface.world.layerItems = structuredClone(input.layerItems).sort((a, b) => a.order - b.order)
  surface.camera.frames = structuredClone(input.frames)
  surface.world.paths = surface.world.paths?.flatMap(path => {
    const layerItemIds = path.layerItemIds.filter(id => itemIds.has(id))
    return layerItemIds.length ? [{ ...path, layerItemIds }] : []
  })
  surface.world.relations = surface.world.relations?.filter(relation => itemIds.has(relation.sourceLayerItemId) && itemIds.has(relation.targetLayerItemId))
  surface.semanticZoom = surface.semanticZoom.flatMap(rule => {
    const layerItemIds = rule.layerItemIds.filter(id => itemIds.has(id))
    return layerItemIds.length ? [{ ...rule, layerItemIds }] : []
  })
  const locations = input.frames.map(frame => {
    const previous = beforeLocations.find(location => location.kind === 'spatial-camera' && location.cameraFrameId === frame.id)
    return { id: previous?.id ?? frame.id, label: `${surface.title} · ${frame.name}`, kind: 'spatial-camera' as const, surfaceId: surface.id, cameraFrameId: frame.id }
  })
  // Keep the surface's place in the course, and the authored start while its stop survives.
  project.locations = project.surfaces.flatMap(value => value.id === surface.id ? locations : project.locations.filter(location => location.surfaceId === value.id))
  if (!project.locations.some(location => location.id === project.startLocationId)) project.startLocationId = locations[0]?.id ?? project.locations[0]!.id
  repairRemovedCourseReferences(project, { removedLocationIds: new Set(removed.map(location => location.id)),
    removedControllerTargetIds: controllerTargetIdsForLocations(removed), removedLayerItemIds: new Set([...removedItems, ...removedNodes]) })
  const printEntry = project.mixedPrintPlan?.entries.find(entry => entry.kind === 'spatial-frames' && entry.surfaceId === surface.id)
  if (printEntry?.kind === 'spatial-frames') printEntry.cameraFrameIds = input.frames.map(frame => frame.id)
  return { project, resources: input.resources, identity: `space:${surface.id}`, diagnostics: input.diagnostics }
}

export function planSpaceMove(project: CourseProjectDocument, resources: DocumentResources, from: string, to: string): PlannedChange {
  const file = spaceFiles(project).find(value => value.path === from)
  if (!file) throw new ProjectFileError('not-found', `没有这个空间：${from}`)
  const name = spaceName(to)
  if (spaceFiles(project).some(value => value.path.normalize('NFC').toLowerCase() === to.normalize('NFC').toLowerCase() && value.surface.id !== file.surface.id))
    throw new ProjectFileError('exists', `${to} 已存在`)
  const next = structuredClone(renameCourseSurface(project, file.surface.id, name))
  next.locations.forEach(location => {
    if (location.kind !== 'spatial-camera' || location.surfaceId !== file.surface.id) return
    const frame = file.surface.camera.frames.find(value => value.id === location.cameraFrameId)
    if (frame) location.label = `${name} · ${frame.name}`
  })
  return { project: next, resources, identity: `space:${file.surface.id}`, diagnostics: [] }
}

export function planSpaceDelete(project: CourseProjectDocument, resources: DocumentResources, path: string): PlannedChange {
  const file = spaceFiles(project).find(value => value.path === path)
  if (!file) throw new ProjectFileError('not-found', `没有这个空间：${path}`)
  const prepared = structuredClone(project)
  repairRemovedCourseReferences(prepared, { removedLocationIds: new Set(), removedLayerItemIds: new Set([
    ...file.surface.world.layerItems, ...file.surface.surfaceLayerItems.map(entry => entry.item),
  ].flatMap(compositionElementNodeIds)) })
  const deleted = deleteCourseSurface(prepared, file.surface.id)
  if (!deleted.ok) throw new ProjectFileError('delete-refused', deleted.reason)
  return { project: deleted.project, resources, identity: `space:${file.surface.id}`, diagnostics: [] }
}
