import type { ComponentProjectDiagnosticTarget, ComponentProjectHealthFinding } from '../../shared/componentProjectHealth'
import { componentSurface, owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { EditingScope, SidebarTab } from '../store/slices/editorShellSlice'
import type { EditorStoreKernel } from '../store/editorStoreKernel'

export type ProjectHealthRoute = {
  available: true
  scope: EditingScope
  tab: SidebarTab
  surfaceId?: string
  rootInstanceId?: string
  editingContainerId?: string
  instanceId?: string
} | { available: false; reason: string }

function findingTab(target: ComponentProjectDiagnosticTarget, code: string): SidebarTab {
  if (target.kind === 'asset') return 'elements'
  if (target.kind === 'definition') return 'components'
  if (code.includes('interaction-') || code.includes('information-release-')) return 'automation'
  return 'properties'
}

/** Resolve current V10 identities only; never substitute another object for a retired target. */
export function resolveCourseProjectHealthRoute(
  project: CourseProjectV10,
  finding: ComponentProjectHealthFinding,
): ProjectHealthRoute {
  return resolveCourseProjectDiagnosticTargetRoute(project, finding.target, finding.code, finding.path)
}

export function resolveCourseProjectDiagnosticTargetRoute(
  project: CourseProjectV10,
  target: ComponentProjectDiagnosticTarget,
  code = '',
  path: ReadonlyArray<string | number> = [],
): ProjectHealthRoute {
  if (target.projectId !== project.id) return { available: false, reason: '诊断目标属于另一工程，无法在当前工程定位。' }
  const base = { available: true as const, scope: target.kind === 'project' || path[0] === 'global' ? 'global' as const : 'scene' as const, tab: findingTab(target, code) }
  if (target.kind === 'project') return base
  if (target.kind === 'asset') return project.assets[target.assetId] ? base : { available: false, reason: '诊断素材已不存在。' }
  if (target.kind === 'definition') return project.definitions[target.definitionId] ? base : { available: false, reason: '诊断组件定义已不存在。' }
  const instanceId = target.kind === 'surface' ? target.surfaceId : target.instanceId
  if (target.kind === 'surface' && !componentSurface(project, instanceId) && !project.rootIds.includes(instanceId)) return { available: false, reason: '诊断页面已不存在。' }
  if (!project.instances[instanceId]) return { available: false, reason: '诊断实例已不存在。' }
  const selection = target.kind === 'instance' ? { instanceId } : {}
  let id = instanceId, containerId = target.kind === 'surface' && project.instances[instanceId].container ? instanceId : undefined
  const visited = new Set<string>()
  while (!visited.has(id)) {
    visited.add(id)
    if (project.rootIds.includes(id)) {
      const surfaceId = containerId ?? (project.instances[id]?.container ? id : undefined)
      return { ...base, ...selection, scope: 'scene', ...(surfaceId ? { surfaceId } : {}),
        ...(!surfaceId || surfaceId !== id ? { rootInstanceId: id } : {}),
        ...(containerId && containerId !== id ? { editingContainerId: containerId } : {}) }
    }
    const owner = owningContainer(project, id)
    if (owner?.kind === 'global') return { ...base, ...selection, scope: 'global',
      ...(containerId ? { surfaceId: containerId, editingContainerId: containerId } : {}) }
    if (owner?.kind !== 'instance' || !project.instances[owner.instanceId]) break
    if (!containerId && project.instances[owner.instanceId].container) containerId = owner.instanceId
    id = owner.instanceId
  }
  return { available: false, reason: '诊断实例没有可定位的页面或全局归属。' }
}

/** Existing Bridge operations perform the route; nested editing never becomes work navigation. */
export function selectCourseProjectDiagnosticRoute(kernel: Pick<EditorStoreKernel, 'bridge' | 'readView' | 'selectSurface' | 'selectInstances'>,
  route: Extract<ProjectHealthRoute, { available: true }>, setEditingScope?: (scope: EditingScope) => void): void {
  const view = kernel.readView(), documentId = view.activeDocumentId
  if (!documentId) return
  const rootId = route.rootInstanceId ?? (!route.editingContainerId ? route.surfaceId : undefined)
    ?? (route.scope === 'global' && route.instanceId && !route.editingContainerId ? view.rootInstanceId : undefined)
  if (rootId) kernel.selectSurface(rootId, documentId)
  if (route.editingContainerId) kernel.bridge.enterContainer(documentId, route.editingContainerId)
  // Changing the existing editing scope clears selection. Keep it between
  // choosing the actual container and selecting the diagnostic instance.
  setEditingScope?.(route.scope)
  kernel.selectInstances(route.instanceId ? [route.instanceId] : [], route.surfaceId ?? null, documentId)
}

/** Delivery and health UI use the same ownership router, including path-only producer findings. */
export function resolveCourseProjectDeliveryFindingRoute(project: CourseProjectV10, finding: {
  code: string
  surfaceId?: string
  instanceId?: string
  path?: readonly (string | number)[]
}): ProjectHealthRoute {
  const path = finding.path ?? [], id = path[1]
  const target: ComponentProjectDiagnosticTarget = finding.instanceId
    ? { projectId: project.id, kind: 'instance', instanceId: finding.instanceId }
    : typeof id === 'string' && path[0] === 'instances' ? { projectId: project.id, kind: 'instance', instanceId: id }
      : typeof id === 'string' && path[0] === 'definitions' ? { projectId: project.id, kind: 'definition', definitionId: id }
        : typeof id === 'string' && path[0] === 'assets' ? { projectId: project.id, kind: 'asset', assetId: id }
          : finding.surfaceId ? { projectId: project.id, kind: 'surface', surfaceId: finding.surfaceId }
            : { projectId: project.id, kind: 'project' }
  return resolveCourseProjectDiagnosticTargetRoute(project, target, finding.code, path)
}
