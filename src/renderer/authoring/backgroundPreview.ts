import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { EffectiveBackgroundOwner } from '../../shared/effectiveBackground'
import { previewNativeLayerData } from '../course/effectiveLayerCommands'
import { formatFlowAuthoringTextStyle, type FlowTextEditSession } from './flowTextEdit'
import type { FlowEditorSelection } from '../course/flowEditorSlice'

export interface BackgroundPreviewTarget {
  readonly projectId: string
  readonly revision: number
  readonly generation: number
  readonly locationId: string
  readonly stateId: string | null
  readonly owner: EffectiveBackgroundOwner | 'native' | 'flow-text'
  readonly authoringAddress?: string
}

export interface BackgroundPreview {
  readonly target: BackgroundPreviewTarget
  readonly color: string
  readonly nativeData?: Record<string, unknown>
  readonly flowText?: { selection: FlowEditorSelection; edit: FlowTextEditSession | null }
}

export function sameBackgroundPreviewTarget(a: BackgroundPreviewTarget, b: BackgroundPreviewTarget): boolean {
  return a.projectId === b.projectId && a.revision === b.revision && a.generation === b.generation &&
    a.locationId === b.locationId && a.stateId === b.stateId && a.owner === b.owner && a.authoringAddress === b.authoringAddress
}

export function flowTextColorPreview(project: CourseProjectDocument, preview: BackgroundPreview | null, generation: number, locationId: string) {
  if (preview?.target.owner !== 'flow-text' || !preview.flowText || preview.target.projectId !== project.id ||
    preview.target.revision !== project.revision || preview.target.generation !== generation || preview.target.locationId !== locationId) return null
  const result = formatFlowAuthoringTextStyle({ document: project, ...preview.flowText,
    style: { color: preview.color }, range: preview.flowText.edit?.range, expectedRevision: project.revision })
  return result.ok ? result : null
}

/** A transient owner patch, resolved by the normal background inheritance chain. */
export function projectWithBackgroundPreview(
  project: CourseProjectDocument,
  preview: BackgroundPreview | null,
  current: { locationId: string; stateId: string | null; generation: number },
): CourseProjectDocument {
  if (!preview) return project
  const { target, color } = preview
  if (target.projectId !== project.id || target.revision !== project.revision ||
    target.locationId !== current.locationId || target.stateId !== current.stateId ||
    target.generation !== current.generation) return project
  if (target.owner === 'native') return target.authoringAddress && preview.nativeData
    ? previewNativeLayerData(project, { authoringAddress: target.authoringAddress, locationId: target.locationId, stateId: target.stateId }, preview.nativeData)
    : project
  if (target.owner === 'course') return { ...project, backgroundColor: color }
  const location = project.locations.find(entry => entry.id === current.locationId)
  if (!location) return project
  return { ...project, surfaces: project.surfaces.map(surface => {
    if (surface.id !== location.surfaceId) return surface
    if ((target.owner === 'slide-surface' && surface.type === 'slide') ||
      (target.owner === 'flow-surface' && surface.type === 'flow') ||
      (target.owner === 'spatial-surface' && surface.type === 'spatial-2d')) {
      return { ...surface, backgroundColor: color }
    }
    if (surface.type !== 'slide' || location.kind !== 'slide-scene') return surface
    return { ...surface, scenes: surface.scenes.map(scene => {
      if (scene.id !== location.sceneId) return scene
      if (target.owner === 'slide-scene') return { ...scene, backgroundColor: color }
      if (target.owner !== 'slide-state' || !scene.presentation) return scene
      return { ...scene, presentation: { ...scene.presentation,
        states: scene.presentation.states.map(state => state.id === current.stateId
          ? { ...state, backgroundColor: color } : state),
      } }
    }) }
  }) }
}
