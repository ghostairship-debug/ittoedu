import { allDocumentTextSlots, documentTextRanges, inlineComponentIds } from '../../shared/document/textInteraction'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { equalComponentValue } from '../drivers/courseV10Operations'
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value))

/** Removing the last text/atom removes its actual relation in the same canonical transaction. */
export function componentTextRelationshipCleanupEdits(project: CourseProjectV10, instanceId: string, next: JsonValue, versions: readonly JsonValue[] = [next]): ComponentEdit[] {
  const before = project.instances[instanceId]
  if (!before) return []
  const slots = allDocumentTextSlots(next), oldSlots = allDocumentTextSlots(before.data)
  const versionSlots = versions.flatMap(data => allDocumentTextSlots(data))
  const inlineIds = new Set(versionSlots.flatMap(slot => inlineComponentIds(slot.content)))
  const oldInlineIds = new Set(oldSlots.flatMap(slot => inlineComponentIds(slot.content)))
  const removed = new Set([...oldInlineIds].filter(id => !inlineIds.has(id) && before.childIds?.includes(id)))
  const edits: ComponentEdit[] = []
  for (const instance of Object.values(project.instances)) {
    const attachments = instance.attachments?.flatMap(attachment => {
      const target = attachment.target
      if (target.kind !== 'text-range' || target.instanceId !== instanceId) return [attachment]
      const slot = slots.find(slot => documentTextRanges(slot.content).has(target.rangeId))
        ?? versionSlots.find(slot => JSON.stringify(slot.path) === JSON.stringify(target.dataPath) && documentTextRanges(slot.content).has(target.rangeId))
        ?? versionSlots.find(slot => documentTextRanges(slot.content).has(target.rangeId))
      return slot ? [{ ...attachment, target: { ...target, dataPath: slot.path } }] : []
    })
    if (attachments && !equalComponentValue(json(attachments), json(instance.attachments))) {
      if (!attachments.length && before.childIds?.includes(instance.id) && instance.definitionId === 'guoling.range-popover') removed.add(instance.id)
      else edits.push({ type: 'attachments.set', instanceId: instance.id, attachments })
    }
  }
  return [...edits, ...[...removed].map((id): ComponentEdit => ({ type: 'instance.remove', instanceId: id }))]
}
