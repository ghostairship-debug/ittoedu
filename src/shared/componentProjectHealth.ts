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
