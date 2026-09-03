import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  ScopedLayerItem,
} from './courseProjectTypes'
import type {
  TeacherControllerAction,
  TeacherControllerNode,
  NativeRenderableNode,
} from './contracts/native-v1/types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants'
import { rotatedRectangleAabb } from './geometry'

type LegacyGlobalLayerVisibility = {
  mode: 'all' | 'include' | 'exclude'
  sceneIds: string[]
}

type LegacyGlobalLayerNode =
  | NativeRenderableNode
  | {
      type: 'external-component'
      id: string
      x: number
      y: number
      width: number
      height: number
      rotation: number
    }

type LegacyGlobalLayerItem = {
  layer: 'underlay' | 'overlay'
  visibility: LegacyGlobalLayerVisibility
  node: LegacyGlobalLayerNode
}

const NAVIGATION_ACTIONS = new Set([
  'scene.previous',
  'scene.next',
  'scene.replay',
  'scene.open-picker',
  'scene.go',
  'course.restart',
])

export function isTeacherControllerNavigationAction(
  action: TeacherControllerAction,
): boolean {
  return NAVIGATION_ACTIONS.has(action.type)
}

function isTeacherControllerLayer(
  item: LegacyGlobalLayerItem,
): item is LegacyGlobalLayerItem & { node: TeacherControllerNode } {
  return item.node.type === 'teacher-controller'
}

function intersectsCanvas(item: LegacyGlobalLayerItem): boolean {
  const bounds = rotatedRectangleAabb(item.node)
  return bounds.right > 0 &&
    bounds.bottom > 0 &&
    bounds.left < CANVAS_WIDTH &&
    bounds.top < CANVAS_HEIGHT
}

function visibilityIncludesAnyScene(
  visibility: LegacyGlobalLayerVisibility,
  sceneIds: readonly string[],
): boolean {
  if (visibility.mode === 'all') return sceneIds.length > 0
  const configured = new Set(visibility.sceneIds)
  return visibility.mode === 'include'
    ? sceneIds.some((sceneId) => configured.has(sceneId))
    : sceneIds.some((sceneId) => !configured.has(sceneId))
}

/**
 * A delivery-visible controller is a global controller that can actually be
 * rendered in at least one authored scene when playback starts.
 */
export function isDeliveryVisibleTeacherController(
  item: LegacyGlobalLayerItem,
  sceneIds: readonly string[],
): boolean {
  if (!isTeacherControllerLayer(item)) return false
  const hasVisibleNavigationAction = item.node.buttons.some((button) =>
    button.visible && isTeacherControllerNavigationAction(button.action),
  )
  return item.layer === 'overlay' &&
    item.node.visible &&
    item.node.opacity > 0 &&
    item.node.playbackInitialVisibility !== 'hidden' &&
    intersectsCanvas(item) &&
    hasVisibleNavigationAction &&
    visibilityIncludesAnyScene(item.visibility, sceneIds)
}

/** Repairs one existing controller only after the user explicitly requests it. */
export function restoreTeacherControllerForDelivery(
  item: LegacyGlobalLayerItem,
): boolean {
  if (!isTeacherControllerLayer(item)) return false
  item.layer = 'overlay'
  item.visibility = { mode: 'all', sceneIds: [] }
  item.node.visible = true
  item.node.playbackInitialVisibility = 'inherit'
  if (item.node.opacity <= 0) item.node.opacity = 1
  if (!intersectsCanvas(item)) {
    item.node.x = (CANVAS_WIDTH - item.node.width) / 2
    item.node.y = (CANVAS_HEIGHT - item.node.height) / 2
  }

  const existingNavigation = item.node.buttons.find((button) =>
    isTeacherControllerNavigationAction(button.action),
  )
  if (existingNavigation) {
    existingNavigation.visible = true
  } else if (item.node.buttons[0]) {
    item.node.buttons[0].action = { type: 'scene.next' }
    item.node.buttons[0].label = '下一场景'
    item.node.buttons[0].visible = true
  } else {
    item.node.buttons.push({
      id: `${item.node.id}_navigation`,
      action: { type: 'scene.next' },
      label: '下一场景',
      visible: true,
    })
  }
  return true
}

export function hasDeliveryVisibleTeacherController(
  project: {
    globalLayer: LegacyGlobalLayerItem[]
    scenes: Array<{ id: string }>
  },
): boolean {
  const sceneIds = project.scenes.map((scene) => scene.id)
  return project.globalLayer.some((item) =>
    isDeliveryVisibleTeacherController(item, sceneIds),
  )
}

/** Keeps editor mutations on the same invariant enforced at the schema edge. */
export function synchronizeTeacherControllerControls(
  project: {
    globalLayer: LegacyGlobalLayerItem[]
    scenes: Array<{ id: string }>
    playback: { controls: 'canvas' | 'none' }
  },
): void {
  project.playback.controls = hasDeliveryVisibleTeacherController(project)
    ? 'canvas'
    : 'none'
}

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

export function isCourseTeacherControllerLayerItem(
  item: LayerItem | undefined | null,
): item is NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item?.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

export function teacherControllerOwnerIsGlobal(
  source: 'global' | 'surface' | 'scene',
): boolean {
  return source === 'global'
}

/** Restores one V9 global controller after an explicit author request. */
export function restoreCourseTeacherControllerLayer(entry: ScopedLayerItem): boolean {
  if (!isCourseTeacherControllerLayerItem(entry.item)) return false
  const item = entry.item
  entry.visibility = { mode: 'all', locationIds: [] }
  item.visible = true
  item.playbackInitialVisibility = 'inherit'
  if (item.opacity <= 0) item.opacity = 1
  if (!courseControllerIntersectsCanvas(item)) {
    item.frame.x = (CANVAS_WIDTH - item.frame.width) / 2
    item.frame.y = (CANVAS_HEIGHT - item.frame.height) / 2
  }
  const data = item.content.data
  const existingNavigation = data.buttons.find((button) =>
    isTeacherControllerNavigationAction(button.action),
  )
  if (existingNavigation) {
    existingNavigation.visible = true
  } else if (data.buttons[0]) {
    data.buttons[0].action = { type: 'scene.next' }
    data.buttons[0].label = '下一场景'
    data.buttons[0].visible = true
  } else {
    data.buttons.push({
      id: `${item.layerItemId}_navigation`,
      action: { type: 'scene.next' },
      label: '下一场景',
      visible: true,
    })
  }
  return true
}

export function isCourseDeliveryVisibleTeacherController(
  entry: ScopedLayerItem,
  locationIds: readonly string[],
): boolean {
  if (!isCourseTeacherControllerLayerItem(entry.item)) return false
  const item = entry.item
  const hasVisibleNavigationAction = item.content.data.buttons.some((button) =>
    button.visible && isTeacherControllerNavigationAction(button.action),
  )
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
    hasVisibleNavigationAction &&
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
