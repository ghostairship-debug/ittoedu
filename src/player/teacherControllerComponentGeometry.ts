import type { PublishedLayerItem, PublishedComponentLayerItem } from '../shared/publishedCourseTypes'
import { isTeacherController } from '../shared/teacherControllerRole'
import { readTeacherControllerConfig } from '../shared/teacherControllerConfig'
export type PublishedTeacherControllerItem = PublishedComponentLayerItem & { role: 'teacher-controller' }
export function isControllerItem(item: PublishedLayerItem): item is PublishedTeacherControllerItem { return isTeacherController(item) }
export function controllerGeometryItem(item: PublishedTeacherControllerItem) {
  return { ...item, config: readTeacherControllerConfig(item.props) }
}
export function controllerHostInput(item: PublishedTeacherControllerItem) {
  return { ...readTeacherControllerConfig(item.props), ...item.frame, rotation: item.rotation, id: item.layerItemId }
}
