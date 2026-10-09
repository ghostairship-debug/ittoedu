import type { ComponentBackground, ComponentFlowAuthoring, ComponentInstance, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { ProjectPlaybackSettings } from '../../shared/contracts/playback-v1'
import { resizeComponentSurfacesEdits } from '../drivers/courseV10Operations'
import { flowSettingsEdits } from './courseFlowEdits'

export const defaultCoursePlayback: ProjectPlaybackSettings = { controls: 'none', keyboardNavigation: true,
  presenter: { enabled: false, strategy: 'scene-navigation', additionalBindings: [] } }

export interface CourseSettingsPatch {
  title?: string
  background?: ComponentBackground | null
  designTokens?: CourseProjectV10['designTokens'] | null
  playback?: Partial<ProjectPlaybackSettings> | null
}

/** One setting planner serves manual controls and model calls; omitted fields retain author choices. */
export function courseSettingsEdits(project: CourseProjectV10, patch: CourseSettingsPatch): ComponentEdit[] {
  const edits: ComponentEdit[] = []
  if (patch.title !== undefined) edits.push({ type: 'project.title.set', title: patch.title })
  if (patch.background !== undefined) edits.push({ type: 'project.background.set',
    background: patch.background === null ? null : { ...project.background, ...patch.background } })
  if (patch.designTokens !== undefined) edits.push({ type: 'project.designTokens.set', designTokens: patch.designTokens })
  if (patch.playback !== undefined) edits.push({ type: 'project.playback.set',
    playback: patch.playback === null ? null : { ...defaultCoursePlayback, ...project.playback, ...patch.playback } })
  return edits
}

export interface SurfaceSettingsPatch {
  title?: string
  background?: ComponentBackground | null
  flowLayout?: Partial<ComponentFlowAuthoring['layout']>
  resize?: { designSize: { width: number; height: number } | null; mode?: 'preserve' | 'contain';
    surfaceIds?: readonly string[]; includeGlobal?: boolean }
}

export function surfaceSettingsEdits(project: CourseProjectV10, surfaceId: string, patch: SurfaceSettingsPatch): ComponentEdit[] {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface) throw new Error('页面已不存在')
  const edits: ComponentEdit[] = []
  if (patch.title !== undefined) edits.push({ type: 'surface.title.set', surfaceId, title: patch.title })
  if (patch.background !== undefined) edits.push({ type: 'surface.background.set', surfaceId,
    background: patch.background === null ? null : { ...surface.background, ...patch.background } })
  if (patch.flowLayout) edits.push(...flowSettingsEdits(project, surfaceId, patch.flowLayout))
  if (patch.resize) edits.push(...resizeComponentSurfacesEdits(project, {
    surfaceIds: patch.resize.surfaceIds ?? [surfaceId], designSize: patch.resize.designSize, mode: patch.resize.mode ?? 'preserve',
    ...(patch.resize.mode === 'contain' && patch.resize.includeGlobal ? { globalReferenceSurfaceId: surfaceId } : {}),
  }))
  return edits
}

/** Editing one page preserves an include list's restriction on future pages. */
export function globalVisibilityAtSurface(current: NonNullable<ComponentInstance['visibility']>, surfaceId: string, visible: boolean) {
  const ids = new Set(current.mode === 'all' ? [] : current.surfaceIds)
  if (current.mode === 'include') {
    if (visible) ids.add(surfaceId); else ids.delete(surfaceId)
    return { mode: 'include' as const, surfaceIds: [...ids] }
  }
  if (visible) ids.delete(surfaceId); else ids.add(surfaceId)
  return { mode: ids.size ? 'exclude' as const : 'all' as const, surfaceIds: [...ids] }
}
