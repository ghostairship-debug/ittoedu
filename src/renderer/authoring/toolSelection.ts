import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { AuthoringToolSelectionV1 } from '../../shared/authoringToolContract'
import { selectSlideEditorLayers } from '../course/slideEditorCommands'
import { clearFlowEditorSelection, selectFlowEditorBlocks, selectFlowOverlay } from '../course/flowEditorSlice'
import { selectSpatialEditorLayers } from '../course/spatialEditorCommands'

/** Reuses each Surface's formal selector for both same-Surface and cross-Surface commits. */
export function selectSlideToolResult(project: CourseProjectDocument, hint: AuthoringToolSelectionV1) {
  if (hint.owner === 'world') throw new Error('Slide 不能选中 world owner')
  return { owner: hint.owner, selection: selectSlideEditorLayers({ project, locationId: hint.locationId, stateId: hint.stateId, selectionIds: hint.itemIds }) }
}
export function selectFlowToolResult(project: CourseProjectDocument, hint: AuthoringToolSelectionV1) {
  if (hint.stateId !== null || hint.owner !== 'global' && hint.owner !== 'surface') throw new Error('Flow 选区 owner / state 不匹配')
  return hint.itemIds.length > 0 ? hint.flowCarrier === 'overlay'
    ? selectFlowOverlay(project, hint.locationId, hint.itemIds, hint.owner === 'global' ? 'global' : 'page')
    : selectFlowEditorBlocks(project, hint.locationId, hint.itemIds)
    : clearFlowEditorSelection(project, hint.locationId, hint.owner === 'global' ? 'global' : 'page')
}
export function selectSpatialToolResult(project: CourseProjectDocument, hint: AuthoringToolSelectionV1) {
  if (hint.owner === 'scene' || hint.stateId !== null) throw new Error('Spatial 选区 owner / state 不匹配')
  return { owner: hint.owner, selection: selectSpatialEditorLayers({ project, locationId: hint.locationId, selectionIds: hint.itemIds }) }
}
