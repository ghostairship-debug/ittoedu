import type { CompositionLayerItem, CourseProjectDocument, LayerItem } from '../../shared/courseProjectTypes'
import { walkComposition } from '../../shared/composition/content'
import { docFiles } from './flowDocs'
import { isHtmlInteraction, mapHtmlInteractions, projectLinkTarget, replaceHtmlInteractionState, type HtmlInteractionPage } from './htmlInteractions'
import { slidePageFiles } from './projectFileView'
import { spaceFiles } from './spaceFiles'

const compositions = (items: readonly LayerItem[]) => items.filter((item): item is CompositionLayerItem => item.kind === 'composition')

export function projectInteractionPages(project: CourseProjectDocument): HtmlInteractionPage[] {
  const pages: HtmlInteractionPage[] = slidePageFiles(project).map(page => ({ path: page.path, locationId: page.locationId,
    sceneId: page.sceneId, items: compositions(page.scene.layerItems) }))
  for (const { path, surface } of spaceFiles(project)) {
    const locations = project.locations.filter(location => location.kind === 'spatial-camera' && location.surfaceId === surface.id)
    if (!locations.length) continue
    const anchors = new Map<string, string>()
    for (const frame of surface.camera.frames) {
      const item = surface.world.layerItems.find(item => item.layerItemId === frame.targetLayerItemId)
      const location = locations.find(location => location.kind === 'spatial-camera' && location.cameraFrameId === frame.id)
      if (item?.kind !== 'composition' || !location) continue
      walkComposition(item.content.root, node => {
        if (node.kind === 'element' && node.attributes.id && (node.attributes.class ?? '').split(/\s+/).includes('step')) anchors.set(node.attributes.id, location.id)
      })
    }
    pages.push({ path, locationId: locations[0]!.id, items: compositions(surface.world.layerItems), anchors })
  }
  for (const { path, surface } of docFiles(project)) {
    const location = project.locations.find(location => location.surfaceId === surface.id)
    if (location) pages.push({ path, locationId: location.id, items: [] })
  }
  return pages
}

/** Rebuild derived rules after any project-file mutation, so forward links bind when their target arrives. */
export function synchronizeProjectHtmlInteractions(project: CourseProjectDocument, nodeAddress: (layerItemId: string, nodeId: string) => string) {
  const pages = projectInteractionPages(project)
  const mapped = pages.map(page => mapHtmlInteractions({ page, pages, nodeAddress }))
  project.globalInteractions = project.globalInteractions.filter(rule => !isHtmlInteraction(rule))
  project.surfaces.forEach(surface => {
    if (surface.type === 'slide') surface.scenes.forEach(scene => { scene.interactions = scene.interactions.filter(rule => !isHtmlInteraction(rule)) })
  })
  pages.forEach((page, index) => {
    const rules = mapped[index]!.rules
    if (page.sceneId) {
      for (const surface of project.surfaces) {
        if (surface.type !== 'slide') continue
        const scene = surface.scenes.find(scene => scene.id === page.sceneId)
        if (scene) scene.interactions.push(...rules)
      }
    } else project.globalInteractions.push(...rules)
  })
  replaceHtmlInteractionState(project, mapped)
  return mapped.flatMap((value, index) => value.diagnostics.map(diagnostic => ({ ...diagnostic, message: `${pages[index]!.path}：${diagnostic.message}` })))
}

/** Rename/reorder updates ordinary source links by location identity, as well as formal navigation. */
export function rewriteMovedProjectLinks(before: CourseProjectDocument, after: CourseProjectDocument): void {
  const oldPages = projectInteractionPages(before), pages = projectInteractionPages(after)
  for (const page of pages) {
    const previous = oldPages.find(candidate => candidate.locationId === page.locationId)
    const sourcePath = previous?.path ?? page.path
    for (const item of page.items) walkComposition(item.content.root, node => {
      if (node.kind !== 'element' || node.tagName !== 'a' || !node.attributes.href || node.attributes.href.startsWith('#')) return
      const target = projectLinkTarget(sourcePath, node.attributes.href)
      const oldTarget = target && oldPages.find(candidate => candidate.path === target.path)
      const newTarget = oldTarget && pages.find(candidate => candidate.locationId === oldTarget.locationId)
      if (newTarget && newTarget.path !== oldTarget!.path)
        node.attributes.href = `../${newTarget.path}${target!.anchor === undefined ? '' : `#${target!.anchor}`}`
    })
  }
}
