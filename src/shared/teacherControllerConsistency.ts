import type {
  CourseProjectDocument,
  LayerItem,
  ScopedLayerItem,
} from './courseProjectTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants'
import { rotatedRectangleAabb } from './geometry'
import { isTeacherController } from './teacherControllerRole'
import { defaultTeacherControllerConfig } from './teacherControllerConfig'

function courseControllerIntersectsCanvas(item: LayerItem): boolean {
  const bounds = rotatedRectangleAabb({
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
  })
  return bounds.right > 0 &&
    bounds.bottom > 0 &&
    bounds.left < CANVAS_WIDTH &&
    bounds.top < CANVAS_HEIGHT
}

export function teacherControllerOwnerIsGlobal(
  source: 'global' | 'surface' | 'scene',
): boolean {
  return source === 'global'
}

/** Restores one V9 global controller after an explicit author request. */
export function restoreCourseTeacherControllerLayer(entry: ScopedLayerItem): boolean {
  if (entry.item.kind === 'component' && entry.item.role === 'teacher-controller') {
    entry.visibility = { mode: 'all', locationIds: [] }
    entry.item.visible = true
    entry.item.playbackInitialVisibility = 'inherit'
    if (entry.item.opacity <= 0) entry.item.opacity = 1
    const buttons = entry.item.props.buttons
    if (!Array.isArray(buttons) || !buttons.some(button => button.visible === true)) {
      entry.item.props.buttons = defaultTeacherControllerConfig().buttons
    }
    if (!courseControllerIntersectsCanvas(entry.item)) {
      entry.item.frame.x = 20
      entry.item.frame.y = 20
    }
    return true
  }
  return false
}

export function isCourseDeliveryVisibleTeacherController(
  entry: ScopedLayerItem,
  locationIds: readonly string[],
): boolean {
  if (!isTeacherController(entry.item)) return false
  const item = entry.item
  const visibleHere = locationIds.length === 0
    ? entry.visibility.mode === 'all'
    : locationIds.some((locationId) => {
      if (entry.visibility.mode === 'all') return true
      const listed = entry.visibility.locationIds.includes(locationId)
      return entry.visibility.mode === 'include' ? listed : !listed
    })
  return item.visible &&
    item.opacity > 0 &&
    item.playbackInitialVisibility !== 'hidden' &&
    courseControllerIntersectsCanvas(item) &&
    visibleHere
}

export function hasCourseDeliveryVisibleTeacherController(
  project: Pick<CourseProjectDocument, 'globalLayerItems' | 'locations'>,
): boolean {
  const locationIds = project.locations.map((location) => location.id)
  return project.globalLayerItems.some((entry) =>
    isCourseDeliveryVisibleTeacherController(entry, locationIds),
  )
}

export function synchronizeCourseTeacherControllerControls(
  project: Pick<CourseProjectDocument, 'globalLayerItems' | 'locations' | 'playback'>,
): void {
  project.playback.controls = hasCourseDeliveryVisibleTeacherController(project)
    ? 'canvas'
    : 'none'
}
