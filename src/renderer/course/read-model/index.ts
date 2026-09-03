export {
  courseLayerItemToEditorCanvasNode,
  projectV9ActiveScene,
  projectV9EditingNodes,
  projectV9SceneDocument,
  projectV9SlideScenes,
} from '../../store/slideEditorProjection'

export type {
  EditorCanvasDocument,
  EditorCanvasNode,
  EditorCanvasSceneView,
} from '../../phaser/editorCanvasNode'

export {
  EFFECTIVE_LAYER_LOCKED_WRITE_REASON,
  EFFECTIVE_LAYER_SOURCE_LABELS,
  authoringAddressScopeForOwner,
  carrierForLayerKind,
  commandTargetFromRow,
  composeEffectiveLayerLocation,
  courseAuthoringScopeFromLocation,
  createCourseAuthoringScope,
  createEffectiveLayerItemActionInput,
  createEffectiveLayerReorderInput,
  defaultOwnerForSurface,
  describeLayerImpact,
  isFlowDocumentBlockId,
  isTeacherControllerLayerItem,
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  projectEffectiveLayers,
  rowsForListKind,
  scopeTokenForSelectingRow,
  visualFrontToBackRows,
} from '../effectiveLayerProjection'

export { composeSlideEditorLocation } from '../slideEditorView'
export { composeFlowEditorLocation } from '../flowEditorView'
export { composeSpatialEditorLocation } from '../spatialEditorView'

export type {
  CourseAuthoringAddressScope,
  CourseAuthoringOwner,
  CourseAuthoringScopeToken,
  EffectiveLayerCommandTargetInput,
  EffectiveLayerImpact,
  EffectiveLayerItemAction,
  EffectiveLayerItemActionInput,
  EffectiveLayerListKind,
  EffectiveLayerProjection,
  EffectiveLayerProjectionRow,
  EffectiveLayerReorderInput,
  EffectiveLayerSource,
  ProjectEffectiveLayersInput,
} from '../effectiveLayerProjection'
