import type { CourseProjectDocument, LayerItem } from '../courseProjectTypes'
import {
  finalizeCourseProjectHealthFindings,
  visitCourseLayerItems,
} from './internal'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
} from './types'

function visitLayerItems(
  project: CourseProjectDocument,
  visit: (item: LayerItem, path: Array<string | number>) => void,
): void {
  visitCourseLayerItems(project, ({ item, path }) => visit(item, path))
}

/**
 * Project-wide stable-id collisions that V9 Schema still permits across
 * disjoint surface owners. Per-owner uniqueness remains a Schema concern.
 */
export function collectCourseProjectStableIdHealth(
  project: CourseProjectDocument,
  _archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const seen = new Map<string, Array<string | number>>()
  const remember = (id: string, path: Array<string | number>): void => {
    if (seen.has(id)) {
      drafts.push({
        severity: 'error',
        code: 'duplicate-stable-id',
        message: `稳定 ID 重复：${id}`,
        path,
      })
      return
    }
    seen.set(id, path)
  }
  remember(`project:${project.id}`, ['id'])
  project.locations.forEach((location, index) => {
    remember(`location:${location.id}`, ['locations', index, 'id'])
  })
  project.surfaces.forEach((surface, surfaceIndex) => {
    remember(`surface:${surface.id}`, ['surfaces', surfaceIndex, 'id'])
  })
  visitLayerItems(project, (item, path) => {
    remember(`layer:${item.layerItemId}`, [...path, 'layerItemId'])
  })
  return finalizeCourseProjectHealthFindings(project, drafts)
}
