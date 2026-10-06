import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { applyComponentOperation, captureComponentOperation } from '../../core/drivers/courseV10Operations'

export interface BackgroundPreviewTarget {
  readonly documentId: string
  readonly epoch: string
  readonly surfaceId: string | null
  readonly stateId: string | null
  readonly owner: 'project' | 'surface' | 'state' | 'instance'
  readonly instanceId?: string
}

export interface BackgroundPreview {
  readonly target: BackgroundPreviewTarget
  readonly edits: ComponentEdit[]
}

export function sameBackgroundPreviewTarget(a: BackgroundPreviewTarget, b: BackgroundPreviewTarget): boolean {
  return a.documentId === b.documentId && a.epoch === b.epoch && a.surfaceId === b.surfaceId &&
    a.stateId === b.stateId && a.owner === b.owner && a.instanceId === b.instanceId
}

/** Apply transient edits to the resolved presentation; only confirmation reaches the Session. */
export function projectWithBackgroundPreview(
  project: CourseProjectV10,
  preview: BackgroundPreview | null,
  documentId: string | null,
  surfaceId: string | null,
  stateId: string | null,
  epoch?: string,
): CourseProjectV10 {
  if (!preview) return project
  const { target, edits } = preview
  if (target.documentId !== documentId || target.epoch !== epoch || target.surfaceId !== surfaceId || target.stateId !== stateId) return project
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (surfaceId !== null && !surface) return project
  if (stateId !== null && !surface?.presentation?.states.some(value => value.id === stateId)) return project
  if (target.owner === 'instance' && (!target.instanceId || !project.instances[target.instanceId])) return project
  if (!edits.length) return project
  try { return applyComponentOperation(project, captureComponentOperation(project, edits)) }
  catch { return project } // A retired subtarget must leave the current formal projection visible.
}
