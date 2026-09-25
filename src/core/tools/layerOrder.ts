import type { CourseProjectDocument, LayerItem, ScopedLayerItem } from '../../shared/courseProjectTypes'

export function sortScopedLayerList(entries: ScopedLayerItem[]): void {
  entries.sort((left, right) =>
    left.item.order - right.item.order ||
    left.item.layerItemId.localeCompare(right.item.layerItemId),
  )
}

export function visitAllCourseLayerItems(
  project: CourseProjectDocument,
  visit: (item: LayerItem) => void,
): void {
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(visit)
    }
  }
}

export function allocateCourseLayerOrder(
  project: CourseProjectDocument,
  preferred: number,
): number {
  const used = new Set<number>()
  visitAllCourseLayerItems(project, (item) => {
    used.add(item.order)
  })
  let order = preferred
  while (used.has(order)) order += 1
  return order
}

export function sortLayerItemList(items: LayerItem[]): void {
  items.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

export function sortAllCourseLayerLists(project: CourseProjectDocument): void {
  sortScopedLayerList(project.globalLayerItems)
  for (const surface of project.surfaces) {
    sortScopedLayerList(surface.surfaceLayerItems)
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) sortLayerItemList(scene.layerItems)
    } else if (surface.type === 'spatial-2d') {
      sortLayerItemList(surface.world.layerItems)
    }
  }
}
