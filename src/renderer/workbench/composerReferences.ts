import type { ExecutionDocumentReference, ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'
import type { DocumentSnapshot } from '../../shared/workbench/document'

/** Stable logical identity. Versions are refreshed when submitting, not part of a pin. */
export function referenceIdentity(reference: ExecutionDocumentReference): string {
  return reference.referenceId ?? `${reference.documentId}:${JSON.stringify(reference.selection ?? [])}`
}
export function targetLabel(target: ExecutionSelectionTarget): string {
  if (target.kind === 'course-surface') return '当前页面'
  if (target.kind === 'course-instance') return target.authorField?.kind === 'image' ? '所选图片' : target.dataPath ? '所选文字' : '所选对象'
  if (target.kind === 'course-object') return '所选对象'
  if (target.kind === 'flow-block') return '所选内容块'
  if (target.kind === 'html-author-field' && target.field === 'src') return '所选图片'
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
      referenceId: surface ? `${reference.documentId}:page:${surface.surfaceId}` : `${reference.documentId}:file`, displayLabel: surface ? '当前页面' : '文档' }
    return [page, ...targets.filter(target => target.kind !== 'course-surface').map(target => ({
      ...structuredClone(reference), selection: [structuredClone(target)], pinned: false,
      referenceId: `${reference.documentId}:target:${JSON.stringify(target)}`, displayLabel: targetLabel(target),
    }))]
  })
}
export function mergeAutomaticReferences(current: readonly ExecutionDocumentReference[], automatic: readonly ExecutionDocumentReference[], removed: ReadonlySet<string> = new Set()): ExecutionDocumentReference[] {
  const merged = new Map<string, ExecutionDocumentReference>()
  for (const reference of [...current.filter(reference => reference.pinned), ...automatic]) {
    if (!reference.pinned && removed.has(referenceIdentity(reference))) continue
    const target = JSON.stringify([reference.documentId, reference.selection ?? []])
    if (!merged.has(target)) merged.set(target, reference)
  }
  return [...merged.values()]
}
export function pinReferences(current: readonly ExecutionDocumentReference[], added: readonly ExecutionDocumentReference[]): ExecutionDocumentReference[] {
  const replacements = new Map(added.map(reference => [referenceIdentity(reference), { ...structuredClone(reference), pinned: true }]))
  return [...current.map(reference => replacements.get(referenceIdentity(reference)) ?? reference),
    ...[...replacements.values()].filter(reference => !current.some(value => referenceIdentity(value) === referenceIdentity(reference)))]
}

export function documentScopeOptions(reference: ExecutionDocumentReference, current: ExecutionDocumentReference | undefined, paged: boolean) {
  const currentScope = current?.documentId === reference.documentId && current.epoch === reference.epoch ? current : undefined
  const split = currentScope ? splitComposerReferences([currentScope]) : []
  const page = split.find(value => value.selection?.[0]?.kind === 'course-surface')
  const selected = split.filter(value => value.selection?.some(target => target.kind !== 'course-surface'))
  const targets = selected.flatMap(value => value.selection ?? [])
  const label = selected.length > 1 ? `所选 ${selected.length} 项` : selected[0]?.displayLabel ?? (paged ? '当前对象' : '所选文字')
  const whole = { ...reference, selection: undefined, referenceId: `${reference.documentId}:file`, displayLabel: '文档' }
  const options: { id: string; label: string; target?: ExecutionDocumentReference }[] = [
    { id: 'file', label: '整个文档', target: whole },
  ]
  if (paged || page) options.push({ id: 'page', label: '当前页', target: page })
  options.push({ id: 'selection', label: label === '所选对象' ? '当前对象' : label, target: currentScope && targets.length
    ? { ...currentScope, selection: targets, referenceId: `${currentScope.documentId}:target:${JSON.stringify(targets.length === 1 ? targets[0] : targets)}`, displayLabel: label }
    : undefined })
  return options
}

export function documentReferenceLocation(reference: ExecutionDocumentReference, snapshot?: DocumentSnapshot): string | undefined {
  const project = snapshot?.model.kind === 'course-v10' && snapshot.epoch === reference.epoch ? snapshot.model.project : undefined
  const title = (id: string) => {
    const instance = project?.instances[id]
    return instance?.name || (instance && project?.definitions[instance.definitionId]?.title) || id
  }
  const textSource = (snapshot?.model.kind === 'text' || snapshot?.model.kind === 'markdown') && snapshot.epoch === reference.epoch && snapshot.revision === reference.revision
    ? snapshot.model.source : undefined
  const locations = reference.selection?.map(target => {
    if (target.kind === 'course-surface') return `页面「${title(target.surfaceId)}」`
    if (target.kind === 'course-instance') return `${targetLabel(target)}「${title(target.instanceId)}」 · ${title(target.surfaceId)}`
    if (target.kind === 'course-object') return `对象「${title(target.itemId)}」 · ${title(target.locationId)}`
    if (target.kind === 'flow-block' || target.kind === 'flow-range') return `内容块「${title(target.blockId)}」 · ${title(target.surfaceId)}`
    if (target.kind === 'markdown-range') {
      const excerpt = textSource?.slice(target.from, Math.min(target.to, target.from + 56)).trim()
      return excerpt ? `文字「${excerpt}${target.to - target.from > 56 ? '…' : ''}」` : `文字位置 ${target.from + 1}–${target.to}`
    }
    if (target.kind === 'html-author-field') return `${targetLabel(target)}（${target.authorKey}）`
    return targetLabel(target)
  })
  return locations?.length ? locations.join('；') : undefined
}
