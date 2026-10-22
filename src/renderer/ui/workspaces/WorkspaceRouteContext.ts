import { componentSurface, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { useEditorStore } from '../../store/editorStore'

export const WORKSPACE_ROUTE_CONFLICT_ERROR = '编辑表面状态冲突，请重新选择当前页面'
export type WorkspaceSurfaceRoute =
  | { readonly kind: 'slide' | 'flow' | 'spatial' }
  | { readonly kind: 'program'; readonly rootInstanceId: string }
  | { readonly kind: 'conflict'; readonly message: string }
export interface WorkspaceRouteSignals {
  readonly project: CourseProjectV10 | null
  readonly surfaceId: string | null
  readonly rootInstanceId?: string | null
}

/** One formal view selects the projection; transient text drafts do not create another surface session. */
export function resolveWorkspaceRoute({ project, surfaceId, rootInstanceId }: WorkspaceRouteSignals): WorkspaceSurfaceRoute {
  const surface = project && surfaceId ? componentSurface(project, surfaceId) : undefined
  if (surface) return { kind: surface.kind }
  const rootId = rootInstanceId ?? project?.entry?.rootInstanceId
  if (!surfaceId && project && rootId && project.rootIds.includes(rootId) && project.instances[rootId] && !project.instances[rootId].container)
    return { kind: 'program', rootInstanceId: rootId }
  return { kind: 'conflict', message: WORKSPACE_ROUTE_CONFLICT_ERROR }
}
export function useWorkspaceRoute(): WorkspaceSurfaceRoute {
  const view = useEditorStore(state => state.courseView)
  return resolveWorkspaceRoute({ project: view.project, surfaceId: view.surfaceId, rootInstanceId: view.rootInstanceId })
}
