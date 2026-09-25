import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { backgroundModeSchema } from '../../shared/courseProjectSchema'
import type { BackgroundMode } from '../../shared/courseProjectTypes'

import { commitCourseProjectMutation as commitSlideProjectMutation } from './courseProjectMutation'
import { resolveEffectiveBackground } from '../../shared/effectiveBackground'
import { BACKGROUND_MODES } from '../../shared/courseProjectTypes'

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
  const stale = options.expectedRevision !== undefined && options.expectedRevision !== project.revision
  if (stale) return failCourseBackground('stale-revision', project)
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

export interface SlideBackgroundOwnerPatch extends CourseBackgroundPatch {
  readonly backgroundMode?: BackgroundMode
}

/** Pure Flow/Spatial owner planner. Session/history adaptation stays with its caller. */
export function updateBodySurfaceBackground(
  project: CourseProjectDocument,
  surfaceId: string,
  expectedType: 'flow' | 'spatial-2d',
  patch: SlideBackgroundOwnerPatch,
  options: CourseBackgroundCommandOptions = {},
): CourseBackgroundCommandResult {
  if (options.expectedRevision !== undefined && options.expectedRevision !== project.revision) return failCourseBackground('stale-revision', project)
  if (patch.backgroundMode !== undefined && !BACKGROUND_MODES.includes(patch.backgroundMode)) return failCourseBackground(expectedType === 'flow' ? '背景模式无效' : 'invalid-background-mode', project)
  if (patch.backgroundColor !== undefined && (typeof patch.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(patch.backgroundColor.trim()))) return failCourseBackground(expectedType === 'flow' ? '颜色格式无效' : 'invalid-color', project)
  try {
    const surface = project.surfaces.find(value => value.id === surfaceId)
    if (!surface || surface.type !== expectedType) throw new Error(`找不到 ${expectedType} 表面：${surfaceId}`)
    const color = patch.backgroundColor?.trim().toLowerCase()
    const modeChanges = patch.backgroundMode !== undefined && patch.backgroundMode !== (surface.backgroundMode ?? 'own')
    const colorChanges = color !== undefined && color !== surface.backgroundColor
    const assetChanges = patch.backgroundAssetId !== undefined && patch.backgroundAssetId !== (surface.backgroundAssetId ?? null)
    if (!modeChanges && !colorChanges && !assetChanges) return { ok: true, project, historyEntry: false }
    const next = commitSlideProjectMutation(project, draft => {
      const target = draft.surfaces.find(value => value.id === surfaceId)!
      if (modeChanges) target.backgroundMode = patch.backgroundMode
      if (colorChanges) target.backgroundColor = color
      if (assetChanges) target.backgroundAssetId = patch.backgroundAssetId ?? null
    }, options.now)
    return { ok: true, project: next, historyEntry: true }
  } catch (error) { return failCourseBackground(error instanceof Error ? error.message : '无法更新页面背景', project) }
}

/** Shared owner command for the properties panel and versioned tools. */
export function updateSlideBackgroundOwner(
  project: CourseProjectDocument,
  target: { surfaceId: string; sceneId?: string; stateId?: string },
  patch: SlideBackgroundOwnerPatch,
  options: CourseBackgroundCommandOptions = {},
): CourseBackgroundCommandResult {
  const stale = options.expectedRevision !== undefined && options.expectedRevision !== project.revision
  if (stale) return failCourseBackground('stale-revision', project)
  try {
    if (patch.backgroundMode !== undefined) backgroundModeSchema.parse(patch.backgroundMode)
    if (target.stateId && patch.backgroundMode !== undefined) throw new Error('命名状态没有独立背景模式')
    const color = patch.backgroundColor?.trim().toLowerCase()
    if (color !== undefined && !/^#[0-9a-f]{6}$/.test(color)) throw new Error('颜色格式无效')
    const resolve = (document: CourseProjectDocument) => {
      const surface = document.surfaces.find((entry) => entry.id === target.surfaceId)
      if (surface?.type !== 'slide') throw new Error('找不到 Slide 表面')
      if (!target.sceneId) {
        if (target.stateId) throw new Error('状态必须归属场景')
        return { owner: surface, base: null }
      }
      const scene = surface.scenes.find((entry) => entry.id === target.sceneId)
      if (!scene) throw new Error('找不到当前场景')
      if (!target.stateId) return { owner: scene, base: null }
      const state = scene.presentation?.states.find((entry) => entry.id === target.stateId)
      if (!state) throw new Error('找不到当前状态')
      return { owner: state, base: resolveEffectiveBackground({ owner: 'slide-scene', course: document, surface, scene }) }
    }
    const { owner, base } = resolve(project)
    const nextColor = base && color === base.color ? undefined : color
    const nextAsset = base && patch.backgroundAssetId === base.assetId ? undefined : patch.backgroundAssetId
    const modeChanges = patch.backgroundMode !== undefined && patch.backgroundMode !== ('backgroundMode' in owner ? owner.backgroundMode ?? (target.sceneId ? 'own' : 'inherit') : 'inherit')
    const colorChanges = patch.backgroundColor !== undefined && nextColor !== owner.backgroundColor
    const assetChanges = patch.backgroundAssetId !== undefined && (base ? nextAsset !== owner.backgroundAssetId : nextAsset !== (owner.backgroundAssetId ?? null))
    if (!modeChanges && !colorChanges && !assetChanges) return { ok: true, project, historyEntry: false }
    const next = commitSlideProjectMutation(project, (draft) => {
      const { owner: destination } = resolve(draft)
      if (modeChanges && !target.stateId) (destination as { backgroundMode?: BackgroundMode }).backgroundMode = patch.backgroundMode
      if (colorChanges) destination.backgroundColor = nextColor
      if (assetChanges) destination.backgroundAssetId = nextAsset
    }, options.now)
    return { ok: true, project: next, historyEntry: true }
  } catch (error) {
    return failCourseBackground(error instanceof Error ? error.message : '无法修改 Slide 背景', project)
  }
}
