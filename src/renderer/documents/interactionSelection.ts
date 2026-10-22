import type { ComponentAuthorField, ComponentAuthorSpot } from '../../shared/contracts/component-platform/runtime'
import type { DocumentSelection } from '../../shared/document/ports'

/** Current author intent. Browser geometry and AI authorization are separate facts. */
export type CourseInteractionSelection =
  | { readonly kind: 'objects'; readonly instanceIds: readonly string[] }
  | { readonly kind: 'author-field'; readonly instanceId: string; readonly field: ComponentAuthorField }
  | { readonly kind: 'document'; readonly selection: DocumentSelection }

const derivedIds = new WeakMap<CourseInteractionSelection, readonly string[]>()

export function interactionInstanceIds(selection: CourseInteractionSelection | null | undefined): readonly string[] {
  if (!selection) return []
  if (selection.kind === 'objects') return selection.instanceIds
  const cached = derivedIds.get(selection)
  if (cached) return cached
  const value = selection.kind === 'document' ? selection.selection : null
  const ids = selection.kind === 'author-field' ? [selection.instanceId] : value!.kind === 'text'
    ? [...new Set([value!.anchor.blockId, value!.head.blockId])]
    : [value!.kind === 'object' ? value!.blockId : value!.tableId]
  derivedIds.set(selection, ids)
  return ids
}

/** A field's value can advance after its own ACK without changing its author identity. */
export function authorFieldIdentity(instanceId: string, field: ComponentAuthorField): string {
  const scope = Object.entries(field.scope ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([instanceId, field.kind, scope, field.authorKey
    ? ['author', field.authorKey]
    : field.dataPath ? ['data', field.fieldScope ?? 'data', field.dataPath]
      : field.sourceRegion ? ['source', field.sourceRegion]
        : ['binding', field.binding?.path, field.binding?.textIndex]])
}

export function interactionSelectionIdentity(selection: CourseInteractionSelection | null | undefined): string {
  return !selection ? '' : selection.kind === 'author-field' ? authorFieldIdentity(selection.instanceId, selection.field)
    : selection.kind === 'objects' ? JSON.stringify(['objects', selection.instanceIds])
      : JSON.stringify(['document', selection.selection])
}

/** Drop live registration, DOM geometry and mount identity at the view boundary. */
export function authorFieldFromSpot(spot: ComponentAuthorSpot): ComponentAuthorField {
  const { kind, authorKey, scope, binding, bindingStatus, fieldScope, dataPath, sourceRegion, initialValue } = spot
  return { kind, authorKey, scope, binding, bindingStatus, fieldScope, dataPath, sourceRegion, initialValue }
}

export function selectionMatchesSpot(selection: CourseInteractionSelection | null | undefined, spot: ComponentAuthorSpot): boolean {
  return selection?.kind === 'author-field' && authorFieldIdentity(selection.instanceId, selection.field) === authorFieldIdentity(spot.instanceId, spot)
}
