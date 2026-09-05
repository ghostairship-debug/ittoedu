import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  LAYER_REJECT_STALE_REVISION,
  rejectIfStaleDocument,
} from './globalLayerCommands'
import { commitSlideProjectMutation } from './slideEditorCommands'

/**
 * Course has no `backgroundMode`: per IMPLEMENTATION_CONTRACT.md §7.1/§7.2 it
 * is the effective-background chain's resolution root, not an inheriting
 * owner. `backgroundAssetId: null` clears the Course image; omitting a field
 * leaves it untouched.
 */
export interface CourseBackgroundPatch {
  readonly backgroundColor?: string
  readonly backgroundAssetId?: string | null
}

export interface CourseBackgroundCommandOptions {
  readonly expectedRevision?: number
  readonly now?: string
}

export type CourseBackgroundCommandResult =
  | { readonly ok: true; readonly project: CourseProjectDocument; readonly historyEntry: boolean }
  | { readonly ok: false; readonly reason: string; readonly project: CourseProjectDocument }

function failCourseBackground(
  reason: string,
  project: CourseProjectDocument,
): CourseBackgroundCommandResult {
  return { ok: false, reason, project }
}

/**
 * Typed, validated write for the Course-wide background. One commit per
 * call; a stale revision, an invalid color, or a patch that changes nothing
 * writes zero history entries. Mirrors the Flow/Spatial surface background
 * commands' staleness check, `#RRGGBB` validation, and noop short-circuit.
 */
export function updateCourseBackground(
  project: CourseProjectDocument,
  patch: CourseBackgroundPatch,
  options: CourseBackgroundCommandOptions = {},
): CourseBackgroundCommandResult {
  const stale = rejectIfStaleDocument(project, options.expectedRevision)
  if (stale) return failCourseBackground(stale.reason ?? LAYER_REJECT_STALE_REVISION, project)
  if (
    patch.backgroundColor !== undefined
    && (typeof patch.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(patch.backgroundColor.trim()))
  ) {
    return failCourseBackground('颜色格式无效', project)
  }
  const nextColor = patch.backgroundColor !== undefined
    ? patch.backgroundColor.trim().toLowerCase()
    : undefined
  const colorChanges = nextColor !== undefined && nextColor !== project.backgroundColor
  const assetChanges = patch.backgroundAssetId !== undefined
    && patch.backgroundAssetId !== (project.backgroundAssetId ?? null)
  if (!colorChanges && !assetChanges) {
    return { ok: true, project, historyEntry: false }
  }
  const next = commitSlideProjectMutation(project, (draft) => {
    if (colorChanges) draft.backgroundColor = nextColor
    if (assetChanges) draft.backgroundAssetId = patch.backgroundAssetId ?? null
  }, options.now)
  return { ok: true, project: next, historyEntry: true }
}
