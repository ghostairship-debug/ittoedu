import { courseNavigationInputSchema } from '../../../core/tools/courseNavigationSchema'
import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { courseAuthoringScopeFromLocation } from '../courseAuthoringScope'
import { addCourseSlidePage, addCourseFlowPage, addCourseSpatialPage, deleteCourseLocation, renameCourseLocation, reorderCourseSurfaces, type CourseLocationCommandResult } from '../../../core/tools/courseLocations'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

export { courseNavigationInputSchema } from '../../../core/tools/courseNavigationSchema'
export const courseNavigationAddress = (projectId: string, itemId: string) => makeAuthoringAddress({ projectId, scope: 'global', carrier: 'native', layerItemId: itemId, field: 'courseLocations' })

export const courseNavigationTool: AuthoringToolDefinition<z.infer<typeof courseNavigationInputSchema>> = {
  name: 'course.navigation', inputSchema: courseNavigationInputSchema,
  description: 'add-surface 使用 global owner + create parent:course-locations append，创建 Slide/Flow/Spatial 表面及起始页。后续内容用 created-scope 指向返回位置的默认 owner。其余操作用当前课程位置的正式 update target。',
  plan({ document, destination, value }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (target.owner !== 'global') throw new Error('课程导航工具需要 global owner')
    const creating = value.operation === 'add-surface'
    const itemId = destination.kind === 'update' ? destination.target.itemId : ''
    if (creating) {
      if (destination.kind !== 'create' || destination.scope.parent.kind !== 'course-locations' || destination.scope.insertion.kind !== 'append') throw new Error('新增表面需要课程位置追加 scope')
    } else if (destination.kind !== 'update' || destination.target.authoringAddress !== courseNavigationAddress(document.id, itemId)
      || (value.operation === 'reorder-surfaces' ? itemId !== document.id : !document.locations.some((entry) => entry.id === itemId))) throw new Error('课程位置 target 已失效')
    const options = { expectedRevision: document.revision, activeLocationId: target.locationId }
    let result: CourseLocationCommandResult
    switch (value.operation) {
      case 'add-surface': result = (value.surfaceType === 'slide' ? addCourseSlidePage : value.surfaceType === 'flow' ? addCourseFlowPage : addCourseSpatialPage)(document, { ...options, title: value.title }); break
      case 'rename-location': result = renameCourseLocation(document, itemId, value.title, options); break
      case 'delete-location': result = deleteCourseLocation(document, itemId, options); break
      case 'reorder-surfaces': result = reorderCourseSurfaces(document, value.surfaceIds, options); break
    }
    if (!result.ok) throw new Error(result.reason)
    const next = courseAuthoringScopeFromLocation({ project: result.project, locationId: result.activatedLocationId })
    const affectedId = creating ? result.activatedLocationId : itemId
    return {
      transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: result.project, resourceChanges: {},
        selectionHint: { kind: 'authoring-tool-selection', locationId: next.locationId, stateId: null, owner: next.owner, itemIds: [] } },
      affected: [{ id: affectedId, operation: creating ? 'created' : value.operation === 'delete-location' ? 'deleted' : 'updated', ownerKey: 'global', authoringAddress: courseNavigationAddress(document.id, affectedId) }],
    }
  },
}
