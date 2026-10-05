import type { CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { useEditorStore } from '../../store/editorStore'

export const WORKSPACE_ROUTE_CONFLICT_ERROR = '编辑表面状态冲突，请重新选择当前页面'
export type WorkspaceSurfaceRoute =
  | { readonly kind: 'slide' | 'flow' | 'spatial' }
  | { readonly kind: 'conflict'; readonly message: string }
export interface WorkspaceRouteSignals {
  readonly project: CourseProjectV10 | null
  readonly surfaceId: string | null
}

/** One formal view selects the projection; transient text drafts do not create another surface session. */
export function resolveWorkspaceRoute({ project, surfaceId }: WorkspaceRouteSignals): WorkspaceSurfaceRoute {
  const surface = project?.surfaces.find(surface => surface.id === surfaceId)
  return surface ? { kind: surface.kind } : { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
}
export function useWorkspaceRoute(): WorkspaceSurfaceRoute {
  const view = useEditorStore(state => state.courseView)
  return resolveWorkspaceRoute({ project: view.project, surfaceId: view.surfaceId })
}
