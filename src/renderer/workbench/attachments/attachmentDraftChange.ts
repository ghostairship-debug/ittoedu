import type { InputAttachmentReference } from '../../../shared/workbench/attachments'

const key = (ref: InputAttachmentReference) => `${ref.attachmentId}:${ref.representationId}`
/** Apply a completed operation to its original draft, preserving changes made while it was processing. */
export function attachmentDraftChange(current: readonly InputAttachmentReference[], previous: readonly InputAttachmentReference[], next: readonly InputAttachmentReference[]): InputAttachmentReference[] {
  const before = new Map(previous.map(ref => [key(ref), ref])), after = new Map(next.map(ref => [key(ref), ref]))
  const removed = previous.filter(ref => !after.has(key(ref)))
  // Extraction replaces a source. If it has since been removed, a late result must not restore it.
  const replacementStillWanted = removed.length === 0 || removed.some(ref => current.some(value => key(value) === key(ref)))
  const result = current.flatMap(ref => {
    const original = before.get(key(ref))
    if (!original) return [ref]
    const changed = after.get(key(ref))
    if (!changed) return []
    return [JSON.stringify(original) === JSON.stringify(ref) ? changed : ref]
  })
  if (replacementStillWanted) for (const ref of next) if (!before.has(key(ref)) && !result.some(value => key(value) === key(ref))) result.push(ref)
  return result
}
