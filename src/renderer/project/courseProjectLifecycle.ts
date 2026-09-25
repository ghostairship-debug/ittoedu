import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { CourseProjectArchiveIdentity } from '../../core/drivers/codecs/courseProjectArchive'

export type CourseProjectDirtyKind =
  | 'document'
  | 'selection'
  | 'location'
  | 'global-scope'

export type CloseDirtyDecision = 'save' | 'cancel' | 'abandon'

export interface CloseDirtyResolution {
  readonly allowClose: boolean
  readonly clearDirty: boolean
  readonly attemptSave: boolean
}

export type CourseProjectRecoveryOffer =
  | 'offer'
  | 'ignore-legacy-default'
  | 'ignore-stale-official'

/** Selection, location and global-scope switches never write history or dirty. */
export function shouldMarkCourseProjectDirty(kind: CourseProjectDirtyKind): boolean {
  return kind === 'document'
}

export function courseProjectRecoveryRevision(
  project: Pick<CourseProjectDocument, 'id' | 'revision'>,
): string {
  return `${project.id}:${project.revision}`
}

export function isCourseProjectRevisionDirty(input: {
  currentProjectId: string
  currentRevision: number
  savedProjectId: string | null
  savedRevision: number | null
}): boolean {
  if (input.savedProjectId === null || input.savedRevision === null) return true
  if (input.currentProjectId !== input.savedProjectId) return true
  return input.currentRevision !== input.savedRevision
}

/**
 * Close-before-save contract. Failed save must not clear dirty and must not close.
 * Pure data only: R1-B does not wire IPC or App.
 */
export function resolveCloseDirtyState(input: {
  dirty: boolean
  decision: CloseDirtyDecision
  saveSucceeded?: boolean
}): CloseDirtyResolution {
  if (!input.dirty) {
    return { allowClose: true, clearDirty: false, attemptSave: false }
  }
  if (input.decision === 'cancel') {
    return { allowClose: false, clearDirty: false, attemptSave: false }
  }
  if (input.decision === 'abandon') {
    return { allowClose: true, clearDirty: true, attemptSave: false }
  }
  if (input.saveSucceeded === true) {
    return { allowClose: true, clearDirty: true, attemptSave: true }
  }
  return { allowClose: false, clearDirty: false, attemptSave: true }
}

export function shouldOfferCourseProjectRecovery(input: {
  recovery: CourseProjectArchiveIdentity
  official: CourseProjectArchiveIdentity | null
}): CourseProjectRecoveryOffer {
  if (input.recovery.schemaVersion !== 9) return 'ignore-legacy-default'
  if (!input.official || input.official.schemaVersion !== 9) return 'offer'
  if (
    !input.recovery.projectId ||
    !input.official.projectId ||
    input.recovery.projectId !== input.official.projectId
  ) {
    return 'offer'
  }
  const recoveryRevision = input.recovery.revision
  const officialRevision = input.official.revision
  if (
    recoveryRevision !== null &&
    officialRevision !== null &&
    officialRevision > recoveryRevision
  ) {
    return 'ignore-stale-official'
  }
  if (
    recoveryRevision !== null &&
    officialRevision !== null &&
    officialRevision < recoveryRevision
  ) {
    return 'offer'
  }
  if (
    input.recovery.updatedAt &&
    input.official.updatedAt &&
    Date.parse(input.official.updatedAt) > Date.parse(input.recovery.updatedAt)
  ) {
    return 'ignore-stale-official'
  }
  return 'offer'
}
