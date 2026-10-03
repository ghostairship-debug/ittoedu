import type { CourseProjectDocument, LayerItem, SlideSurfaceDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { effectiveSceneCanvas } from '../../shared/slideCanvas'
import { addCourseSlidePage, deleteCourseLocation, renameCourseLocation } from '../tools/courseLocations'
import { allocateCourseLayerOrder } from '../tools/layerOrder'
import { mutateAddSlideScene, mutateReorderSlideScenes } from '../tools/slideStructure'
import { parsePageHtml, type PageDiagnostic, type PageParsePort } from './pageHtml'
import { slideFolder, slidePageFiles, type SlidePageFile } from './projectFileView'

export interface PlannedChange {
  project: CourseProjectDocument
  resources: DocumentResources
  /** Always admit (changed component package code); new or changed programs are detected after normalization. */
  admission?: boolean
  /** The same change saved disabled with the reason, when admission refuses it (components). */
  draft?: (reason: string) => PlannedChange
  /** Identity of the written file after the change (`page:<sceneId>`). */
  identity: string
  diagnostics: readonly PageDiagnostic[]
}
export class ProjectFileError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

const PAGE_PATH = /^(slides(?:-(\d+))?)\/(?:(\d{1,4})-)?(.+)\.html$/
export function parsePagePath(path: string): { surfaceIndex: number; number?: number; name: string } | undefined {
  const match = PAGE_PATH.exec(path)
  if (!match) return undefined
  const surfaceIndex = match[2] ? Number(match[2]) - 1 : 0
  if (match[2] && surfaceIndex < 1) return undefined
  return { surfaceIndex, ...(match[3] ? { number: Number(match[3]) } : {}), name: match[4]!.trim() }
}

function slideSurfaces(project: CourseProjectDocument): SlideSurfaceDocument[] {
  return project.surfaces.filter((surface): surface is SlideSurfaceDocument => surface.type === 'slide')
}

/** Locate or create the scene a page path names. A lone blank first page is reused, as HTML import does. */
function targetScene(project: CourseProjectDocument, path: string): { project: CourseProjectDocument; page: SlidePageFile; created: boolean } {
  const existing = slidePageFiles(project).find(page => page.path === path)
  if (existing) return { project, page: existing, created: false }
  const parsed = parsePagePath(path)
  if (!parsed) throw new ProjectFileError('invalid-path', '演示页路径须为 slides/<序号>-<名称>.html')
  let next = project
  let surfaces = slideSurfaces(next)
  if (!surfaces[parsed.surfaceIndex]) {
    if (parsed.surfaceIndex !== surfaces.length) throw new ProjectFileError('invalid-path', `没有 ${slideFolder(parsed.surfaceIndex - 1)}/ 之前的演示表面`)
    const added = addCourseSlidePage(next, { title: parsed.name })
    if (!added.ok) throw new ProjectFileError('invalid-path', added.reason)
    next = added.project
    surfaces = slideSurfaces(next)
  }
  const surface = surfaces[parsed.surfaceIndex]!
  const lone = surface.scenes.length === 1 && !surface.scenes[0]!.layerItems.length && !surface.scenes[0]!.interactions.length ? surface.scenes[0]! : undefined
  let sceneId: string
  if (lone) {
    sceneId = lone.id
    const location = next.locations.find(value => value.kind === 'slide-scene' && value.sceneId === lone.id && value.stateId === undefined)!
    if (lone.name !== parsed.name) {
      const renamed = renameCourseLocation(next, location.id, parsed.name)
      if (!renamed.ok) throw new ProjectFileError('invalid-path', renamed.reason)
      next = renamed.project
    }
  } else {
    const before = new Set(surface.scenes.map(scene => scene.id))
    next = mutateAddSlideScene(next, surface.id, { name: parsed.name })
    const scenes = slideSurfaces(next)[parsed.surfaceIndex]!.scenes
    sceneId = scenes.find(scene => !before.has(scene.id))!.id
    const position = parsed.number === undefined ? scenes.length - 1 : Math.min(Math.max(parsed.number - 1, 0), scenes.length - 1)
    if (position !== scenes.length - 1) {
      const order = scenes.map(scene => scene.id).filter(id => id !== sceneId)
      order.splice(position, 0, sceneId)
      next = mutateReorderSlideScenes(next, surface.id, order)
    }
  }
  return { project: next, page: slidePageFiles(next).find(page => page.sceneId === sceneId)!, created: true }
}

/** One page file -> the scene's page body. Other objects on the scene, its states and interactions stay as they are. */
export function planPageWrite(input: {
  project: CourseProjectDocument; resources: DocumentResources; path: string; html: string; parse: PageParsePort; createId(): string
}): PlannedChange {
  const located = targetScene(structuredClone(input.project), input.path)
  const project = structuredClone(located.project)
  const { page } = located
  const parsed = parsePageHtml(input.html, { parse: input.parse, assets: project.assets,
    ...(page.carrier ? { previous: page.carrier.kind === 'composition' ? page.carrier.item.content : page.carrier.item.runtime } : {}) })
  const surface = slideSurfaces(project).find(value => value.id === page.surfaceId)!
  const scene = surface.scenes.find(value => value.id === page.sceneId)!
  const carrierIndex = page.carrier ? scene.layerItems.findIndex(item => item.layerItemId === page.carrier!.item.layerItemId) : -1
  const base = carrierIndex >= 0 ? scene.layerItems[carrierIndex]! : undefined
  const orders = scene.layerItems.map(item => item.order)
  const layerBase = base ? {
    layerItemId: base.layerItemId, label: base.label, frame: base.frame, order: base.order, visible: base.visible, locked: base.locked,
    rotation: base.rotation, opacity: base.opacity, hitPolicy: base.hitPolicy, playbackInitialVisibility: base.playbackInitialVisibility,
    ...(base.paperSpace ? { paperSpace: base.paperSpace } : {}),
  } : {
    layerItemId: `page_${input.createId()}`, label: scene.name, frame: { mode: 'absolute' as const, x: 0, y: 0, ...effectiveSceneCanvas(surface, scene) },
    order: allocateCourseLayerOrder(project, orders.length && Math.min(...orders) > 0 ? Math.min(...orders) - 1 : 0),
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const,
  }
  if (base?.locked) throw new ProjectFileError('locked', '页面主体已锁定，解锁后再写入')
  const item: LayerItem = parsed.kind === 'composition' ? { ...layerBase, kind: 'composition', content: parsed.content }
    : { ...layerBase, kind: 'runtime', runtime: structuredClone(parsed.runtime) }
  if (carrierIndex >= 0) scene.layerItems[carrierIndex] = item
  else scene.layerItems.push(item)
  return { project, resources: input.resources, identity: `page:${page.sceneId}`, diagnostics: parsed.diagnostics }
}

/** Rename a page, or move it to another number within its surface; locations and navigation follow the formal rules. */
export function planPageMove(project: CourseProjectDocument, resources: DocumentResources, from: string, to: string): PlannedChange {
  const page = slidePageFiles(project).find(value => value.path === from)
  if (!page) throw new ProjectFileError('not-found', `没有这个页面：${from}`)
  const source = parsePagePath(from)!, target = parsePagePath(to)
  if (!target) throw new ProjectFileError('invalid-path', '演示页路径须为 slides/<序号>-<名称>.html')
  if (target.surfaceIndex !== source.surfaceIndex) throw new ProjectFileError('unsupported-move', '页面只能在同一演示表面内改名或调整顺序')
  let next = project
  if (target.name !== page.scene.name) {
    const renamed = renameCourseLocation(next, page.locationId, target.name)
    if (!renamed.ok) throw new ProjectFileError('invalid-path', renamed.reason)
    next = renamed.project
  }
  if (target.number !== undefined && target.number - 1 !== page.index) {
    const scenes = slideSurfaces(next).find(surface => surface.id === page.surfaceId)!.scenes.map(scene => scene.id).filter(id => id !== page.sceneId)
    scenes.splice(Math.min(Math.max(target.number - 1, 0), scenes.length), 0, page.sceneId)
    next = mutateReorderSlideScenes(next, page.surfaceId, scenes)
  }
  return { project: next, resources, identity: `page:${page.sceneId}`, diagnostics: [] }
}

/** Deleting a page deletes its scene with the existing location rules (navigation and print references follow). */
export function planPageDelete(project: CourseProjectDocument, resources: DocumentResources, path: string): PlannedChange {
  const page = slidePageFiles(project).find(value => value.path === path)
  if (!page) throw new ProjectFileError('not-found', `没有这个页面：${path}`)
  const deleted = deleteCourseLocation(project, page.locationId)
  if (!deleted.ok) throw new ProjectFileError('delete-refused', deleted.reason)
  return { project: deleted.project, resources, identity: `page:${page.sceneId}`, diagnostics: [] }
}
