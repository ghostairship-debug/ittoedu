import type { CourseProjectV10 } from './contracts/component-platform/project'
import { courseProjectV10Schema } from './contracts/component-platform/schema'

export type ComponentProjectDiagnosticTarget = { projectId: string } & (
  | { kind: 'project' }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'definition'; definitionId: string }
  | { kind: 'asset'; assetId: string }
)
export interface ComponentProjectHealthFinding {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  path: Array<string | number>
  target: ComponentProjectDiagnosticTarget
  evidence?: string
  suggestion?: string
}

/** Check actual V10 ownership/resources/dependency references. Source execution is a separate consumer. */
export function collectComponentProjectHealth(project: CourseProjectV10,
  resources: { assetFiles: Readonly<Record<string, Uint8Array>> }): ComponentProjectHealthFinding[] {
  const findings: ComponentProjectHealthFinding[] = []
  const add = (code: string, message: string, path: Array<string | number>, target: ComponentProjectDiagnosticTarget,
    severity: ComponentProjectHealthFinding['severity'] = 'error') => findings.push({ code, message, path, target, severity })
  const result = courseProjectV10Schema.safeParse(project)
  if (!result.success) for (const issue of result.error.issues) {
    const path = issue.path.filter(value => typeof value === 'string' || typeof value === 'number') as Array<string | number>
    const target: ComponentProjectDiagnosticTarget = path[0] === 'instances' && typeof path[1] === 'string'
      ? { projectId: project.id, kind: 'instance', instanceId: path[1] }
      : { projectId: project.id, kind: 'project' }
    add('project-structure-invalid', issue.message, path, target)
  }
  for (const [id] of Object.entries(project.assets)) if (!resources.assetFiles[id])
    add('asset-bytes-missing', `素材 ${id} 缺少工程字节；可用内容与引用保留`, ['assets', id], { projectId: project.id, kind: 'asset', assetId: id })
  const background = (id: string | null | undefined, path: Array<string | number>, target: ComponentProjectDiagnosticTarget) => {
    if (id && !project.assets[id]) add('background-asset-reference-missing', `背景引用的素材 ${id} 已不存在`, path, target)
  }
  background(project.background?.assetId, ['background', 'assetId'], { projectId: project.id, kind: 'project' })
  project.surfaces.forEach((surface, index) => {
    const target: ComponentProjectDiagnosticTarget = { projectId: project.id, kind: 'surface', surfaceId: surface.id }
    background(surface.background?.assetId, ['surfaces', index, 'background', 'assetId'], target)
    surface.presentation?.states.forEach((state, stateIndex) => background(state.background?.assetId,
      ['surfaces', index, 'presentation', 'states', stateIndex, 'background', 'assetId'], target))
  })
  for (const instance of Object.values(project.instances)) {
    const definition = project.definitions[instance.definitionId]
    const implementation = instance.implementationOverride ?? definition?.implementation
    const target: ComponentProjectDiagnosticTarget = { projectId: project.id, kind: 'instance', instanceId: instance.id }
    if (implementation?.kind === 'source') for (const id of implementation.dependencies ?? []) {
      const dependency = project.definitions[id]
      if (!dependency || dependency.implementation.kind !== 'source') add('source-dependency-missing',
        `源码依赖 ${id} 未提供实际模块源码；当前实例源码保留`, ['instances', instance.id, 'implementation'], target)
    }
    // These IDs are the real image consumer's contract, not guessed arbitrary JSON keys.
    if (definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.image'
      && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)) {
      for (const field of ['assetId', 'originalAssetId']) {
        const id = instance.data[field]
        if (typeof id === 'string' && !project.assets[id]) add('image-asset-reference-missing', `图片引用的素材 ${id} 已不存在`,
          ['instances', instance.id, 'data', field], target)
      }
    }
    if (definition?.implementation.kind === 'builtin' && ['guoling.audio', 'guoling.video'].includes(definition.implementation.key)
      && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)) {
      const data = instance.data, poster = data.poster
      const refs = [{ id: data.assetId, path: ['instances', instance.id, 'data', 'assetId'] },
        ...(poster && typeof poster === 'object' && !Array.isArray(poster) && poster.mode === 'image'
          ? [{ id: poster.assetId, path: ['instances', instance.id, 'data', 'poster', 'assetId'] }] : [])]
      for (const ref of refs) if (typeof ref.id === 'string' && !project.assets[ref.id]) add('media-asset-reference-missing', `媒体引用的素材 ${ref.id} 已不存在`, ref.path, target)
    }
  }
  return findings
}

export interface CourseProjectHealthSummary {
  error: number
  warning: number
  info: number
  total: number
  canExport: boolean
}

export function summarizeCourseProjectHealth(
  findings: readonly Pick<ComponentProjectHealthFinding, 'severity'>[],
): CourseProjectHealthSummary {
  const summary: Record<ComponentProjectHealthFinding['severity'], number> & {
    total: number
    canExport: boolean
  } = {
    error: 0,
    warning: 0,
    info: 0,
    total: findings.length,
    canExport: true,
  }
  findings.forEach(({ severity }) => { summary[severity] += 1 })
  summary.canExport = summary.error === 0
  return summary
}
