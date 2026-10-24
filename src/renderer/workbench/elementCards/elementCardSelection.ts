import { readTarget, type CourseInstanceTarget } from '../../../core/tools/ToolTargets'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { jsonValueSchema } from '../../../shared/contracts/component-platform/schema'
import { authorFieldRichContent } from '../../authoring/professionalContentFields'
import type { CourseV10DocumentBridge } from '../../documents/CourseV10DocumentBridge'

/** Restore the same formal field used by a canvas hit; locating a card never opens input. */
export function selectElementCardField(bridge: Pick<CourseV10DocumentBridge, 'selectInteraction'>,
  snapshot: DocumentSnapshot, target: CourseInstanceTarget): boolean {
  if (target.authorField) {
    const value = readTarget(snapshot.model, target)
    if (typeof value !== 'string') throw new Error('字段内容类型已改变，请重新选择')
    bridge.selectInteraction(snapshot.documentId,
      { kind: 'author-field', instanceId: target.instanceId, field: { ...target.authorField, initialValue: value } }, target.surfaceId)
    return true
  }
  if (!target.dataPath || target.from !== undefined || target.to !== undefined || target.fieldScope === 'flowLayout') return false
  const value = readTarget(snapshot.model, target)
  // A data-path target can be a professional rich text slot. Other JSON values
  // are not author text fields merely because the AI card has an address.
  const content = typeof value === 'string' ? value : authorFieldRichContent(value)
  if (content === undefined) throw new Error('此字段没有可独立选择的文字内容，请使用对应的专业编辑入口。')
  bridge.selectInteraction(snapshot.documentId, { kind: 'author-field', instanceId: target.instanceId,
    field: { kind: 'text', dataPath: [...target.dataPath], fieldScope: target.fieldScope ?? 'data', initialValue: jsonValueSchema.parse(content) } }, target.surfaceId)
  return true
}
