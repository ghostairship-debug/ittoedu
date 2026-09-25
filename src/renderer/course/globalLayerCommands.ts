import { CONTROLLER_DUPLICATE_REASON, LayerCommandOptions, LayerCommandResult, isTeacherControllerLayerItem, findGlobalTeacherController, failLayerCommand, succeedLayerNoop, rejectIfStaleDocument, runDocumentMutation } from '../../core/tools/globalLayers'
import { sortLayerItemList, sortAllCourseLayerLists } from '../../core/tools/layerOrder'
export { sortLayerItemList, sortAllCourseLayerLists } from '../../core/tools/layerOrder'
import { sortScopedLayerList, visitAllCourseLayerItems, allocateCourseLayerOrder } from '../../core/tools/layerOrder'
export { sortScopedLayerList, visitAllCourseLayerItems, allocateCourseLayerOrder } from '../../core/tools/layerOrder'
import { nanoid } from 'nanoid'
import { isTeacherController } from '../../shared/teacherControllerRole'

import type { CourseProjectDocument, ScopedLayerItem } from '../../shared/courseProjectTypes'
import type { ProjectPlaybackSettings } from '../../shared/contracts/playback-v1'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'

import { createTeacherControllerTemplate } from '../components/teacherControllerComponent'
import { createTeacherControllerComponentItem } from '../../shared/teacherControllerItem'

import { componentPackageMeta } from '../../shared/componentPackageMeta'
import { restoreCourseTeacherControllerLayer, synchronizeCourseTeacherControllerControls } from '../../shared/teacherControllerConsistency'

function nextFrontGlobalOrder(project: CourseProjectDocument): number {
  let max = -1
  visitAllCourseLayerItems(project, (item) => {
    if (item.order > max) max = item.order
  })
  return max + 1
}

function appendDefaultTeacherController(
  project: CourseProjectDocument,
  item = createTeacherControllerComponentItem(`teacher-controller-${nanoid(8)}`),
): string {
  if (findGlobalTeacherController(project)) {
    throw new Error(CONTROLLER_DUPLICATE_REASON)
  }
  item.order = nextFrontGlobalOrder(project)
  const baseId = item.component.packageId
  let packageId = baseId, sequence = 2
  while (project.componentPackages[packageId]) packageId = `${baseId}.${sequence++}`
  const pkg = createTeacherControllerTemplate(packageId)
  item.component = { packageId, version: pkg.manifest.version }
  project.componentPackages[pkg.manifest.id] = componentPackageMeta(pkg, { editableCopy: true })
  project.globalLayerItems.push({
    item,
    plane: 'overlay',
    visibility: { mode: 'all', locationIds: [] },
  })
  project.playback.controls = 'canvas'
  sortScopedLayerList(project.globalLayerItems)
  return item.layerItemId
}

function applyCoursePlaybackPatch(
  project: CourseProjectDocument,
  patch: Partial<ProjectPlaybackSettings>,
): void {
  if (patch.controls !== undefined) project.playback.controls = patch.controls
  if (patch.keyboardNavigation !== undefined) {
    project.playback.keyboardNavigation = patch.keyboardNavigation
  }
  if (patch.presenter !== undefined) {
    project.playback.presenter = structuredClone(patch.presenter)
  }

  if (patch.controls === 'none') {
    for (const entry of project.globalLayerItems) {
      if (isTeacherController(entry.item)) {
        entry.item.playbackInitialVisibility = 'hidden'
      }
    }
  } else if (patch.controls === 'canvas') {
    const controller = findGlobalTeacherController(project)
    if (controller) restoreCourseTeacherControllerLayer(controller)
    else appendDefaultTeacherController(project)
  }

  if (patch.controls !== undefined) {
    synchronizeCourseTeacherControllerControls(project)
    project.playback.controls = patch.controls
  }
}

/**
 * Updates course-wide playback settings without choosing a Surface history.
 * Store integrations persist the returned document through the active Slide,
 * Flow or Spatial adapter, so one invocation creates at most one history step.
 */
export function updateCoursePlaybackSettings(
  document: CourseProjectDocument,
  patch: Partial<ProjectPlaybackSettings>,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const candidate = structuredClone(document)
    applyCoursePlaybackPatch(candidate, patch)
    const unchanged = JSON.stringify(candidate.playback) === JSON.stringify(document.playback) &&
      JSON.stringify(candidate.globalLayerItems) === JSON.stringify(document.globalLayerItems)
    if (unchanged) return succeedLayerNoop(document, '成品控制设置未变化')
    return runDocumentMutation(
      document,
      (draft) => applyCoursePlaybackPatch(draft, patch),
      '成品控制设置已更新',
      options,
    )
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新成品控制设置')
  }
}

interface TeacherControllerRestoreOptions extends LayerCommandOptions {
  /** Slide authoring locks are ownership state and must survive a delivery repair. */
  readonly preserveAuthoringLock?: boolean
}

function resetCourseTeacherControllerAuthoringFrame(entry: ScopedLayerItem): void {
  if (!isTeacherControllerLayerItem(entry.item)) return
  if (entry.item.kind === 'component') {
    if (entry.item.frame.x < 0 || entry.item.frame.y < 0 || entry.item.frame.x + entry.item.frame.width > CANVAS_WIDTH || entry.item.frame.y + entry.item.frame.height > CANVAS_HEIGHT) {
      entry.item.frame.x = 16; entry.item.frame.y = 16
    }
    return
  }

}

/**
 * Restores the one global teacher controller to delivery-visible consistency.
 * It never writes a scene or Surface-local item.
 */
export function restoreDefaultTeacherController(
  document: CourseProjectDocument,
  options: TeacherControllerRestoreOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  const existing = findGlobalTeacherController(document)
  try {
    if (existing) {
      const candidate = structuredClone(existing)
      if (!options.preserveAuthoringLock) candidate.item.locked = false
      restoreCourseTeacherControllerLayer(candidate)
      resetCourseTeacherControllerAuthoringFrame(candidate)
      const unchanged = JSON.stringify(candidate) === JSON.stringify(existing) &&
        document.playback.controls === 'canvas'
      if (unchanged) return succeedLayerNoop(document, '教师控制器已可用')
      return runDocumentMutation(document, (draft) => {
        const entry = findGlobalTeacherController(draft)
        if (!entry || !isTeacherController(entry.item)) {
          throw new Error('全课控制器已失效，请重新选择。')
        }
        if (!options.preserveAuthoringLock) entry.item.locked = false
        restoreCourseTeacherControllerLayer(entry)
        resetCourseTeacherControllerAuthoringFrame(entry)
        draft.playback.controls = 'canvas'
        synchronizeCourseTeacherControllerControls(draft)
      }, '已恢复教师控制器', options, existing.item.layerItemId)
    }
    const item = createTeacherControllerComponentItem(`teacher-controller-${nanoid(8)}`)
    const createdId = item.layerItemId
    return runDocumentMutation(document, (draft) => {
      appendDefaultTeacherController(draft, item)
    }, '已恢复教师控制器', options, createdId)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法恢复教师控制器')
  }
}
