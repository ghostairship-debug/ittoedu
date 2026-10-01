import type { ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolTarget } from '../../../shared/workbench/tools'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
export interface UnresolvedEffect { names: readonly string[]; targets?: ExecutionToolRecord['effectTargets']; paths?: string[] }

const sameDocumentOverlap = (a: ToolTarget, b: ToolTarget) => {
  if (a.kind === 'course-object' && b.kind === 'course-object') return a.itemId === b.itemId
  if ((a.kind === 'flow-range' || a.kind === 'flow-block') && (b.kind === 'flow-range' || b.kind === 'flow-block'))
    return a.surfaceId === b.surfaceId && a.blockId === b.blockId
  // Unknown source splices can move every later offset. A fresh coordinate is
  // not sufficient proof that another range of that source is independent.
  return true
}
export function conflictsWithUnresolvedEffects(effects: readonly UnresolvedEffect[], names: readonly string[], targets: ExecutionToolRecord['effectTargets'], paths?: string[]): boolean {
  return effects.some(effect => effect.names.some(name => names.includes(name)) && (
    effect.paths?.length ? !paths?.length || effect.paths.some(a => paths.some(b => isInsideRoot(a, b) || isInsideRoot(b, a)))
      : !targets?.length || !effect.targets?.length
        || effect.targets.some(a => targets.some(b => a.documentId === b.documentId && sameDocumentOverlap(a.target, b.target)))))
}
