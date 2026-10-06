import type { ComponentProjectDiagnosticTarget, ComponentProjectHealthFinding } from '../../shared/componentProjectHealth'
import { owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { EditingScope, SidebarTab } from '../store/slices/editorShellSlice'

export type ProjectHealthRoute = {
  available: true
  scope: EditingScope
  tab: SidebarTab
  surfaceId?: string
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
  if (target.kind === 'surface') return project.surfaces.some(surface => surface.id === target.surfaceId)
    ? { ...base, surfaceId: target.surfaceId } : { available: false, reason: '诊断页面已不存在。' }

  if (!project.instances[target.instanceId]) return { available: false, reason: '诊断实例已不存在。' }
  let id = target.instanceId
  const visited = new Set<string>()
  while (!visited.has(id)) {
    visited.add(id)
    const owner = owningContainer(project, id)
    if (owner?.kind === 'surface') return { ...base, scope: 'scene', surfaceId: owner.surfaceId, instanceId: target.instanceId }
    if (owner?.kind === 'global') return { ...base, scope: 'global', instanceId: target.instanceId }
    if (owner?.kind !== 'instance' || !project.instances[owner.instanceId]) break
    id = owner.instanceId
  }
  return { available: false, reason: '诊断实例没有可定位的页面或全局归属。' }
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
