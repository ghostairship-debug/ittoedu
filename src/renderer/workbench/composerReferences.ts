import type { ExecutionDocumentReference, ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'

/** Stable logical identity. Versions are refreshed when submitting, not part of a pin. */
export function referenceIdentity(reference: ExecutionDocumentReference): string {
  return reference.referenceId ?? `${reference.documentId}:${JSON.stringify(reference.selection ?? [])}`
}
export function targetLabel(target: ExecutionSelectionTarget): string {
  if (target.kind === 'course-surface') return '当前页面'
  if (target.kind === 'course-instance') return target.dataPath ? '所选文字' : '所选对象'
  if (target.kind === 'course-object') return '所选对象'
  if (target.kind === 'flow-block') return '所选内容块'
  return '所选文字'
}
/** The document/page and every selected element have independent pin/remove controls. */
export function splitComposerReferences(captured: readonly ExecutionDocumentReference[]): ExecutionDocumentReference[] {
  return captured.flatMap(reference => {
    const targets = reference.selection ?? []
    const surface = targets.find(target => target.kind === 'course-surface')
      ?? targets.flatMap(target => 'surfaceId' in target ? [{ kind: 'course-surface' as const, surfaceId: target.surfaceId }]
        : target.kind === 'course-object' ? [{ kind: 'course-surface' as const, surfaceId: target.locationId }] : [])[0]
    const page = { ...structuredClone(reference), selection: surface ? [surface] : undefined, pinned: false,
      referenceId: `${reference.documentId}:page:${surface?.surfaceId ?? ''}`, displayLabel: surface ? '当前页面' : '文档' }
    return [page, ...targets.filter(target => target.kind !== 'course-surface').map(target => ({
      ...structuredClone(reference), selection: [structuredClone(target)], pinned: false,
      referenceId: `${reference.documentId}:target:${JSON.stringify(target)}`, displayLabel: targetLabel(target),
    }))]
  })
}
export function mergeAutomaticReferences(current: readonly ExecutionDocumentReference[], automatic: readonly ExecutionDocumentReference[], removed: ReadonlySet<string> = new Set()): ExecutionDocumentReference[] {
  const pinned = current.filter(reference => reference.pinned)
  // Main coalesces selections for the same document. Sending competing automatic
  // targets would erase which location the user fixed, so pins take precedence here.
  return pinned.length ? [...pinned] : automatic.filter(reference => !removed.has(referenceIdentity(reference)))
}
export function pinReferences(current: readonly ExecutionDocumentReference[], added: readonly ExecutionDocumentReference[]): ExecutionDocumentReference[] {
  const replacements = new Map(added.map(reference => [referenceIdentity(reference), { ...structuredClone(reference), pinned: true }]))
  return [...current.map(reference => replacements.get(referenceIdentity(reference)) ?? reference),
    ...[...replacements.values()].filter(reference => !current.some(value => referenceIdentity(value) === referenceIdentity(reference)))]
}
