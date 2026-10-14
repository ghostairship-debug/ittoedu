import type { ComponentEdit, ComponentTarget, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import { documentTextAt, markDocumentRange, replaceDocumentText, documentReplacementEdits } from '../../shared/document/textInteraction'
import { documentTextLength, plainDocumentText, sliceDocumentText } from '../../shared/document/content'
import { componentDataEdits } from './componentDataEdits'
import { INPUT_DEFINITION, createInputData } from '../../components/input/data'
import { POPOVER_DEFINITION, popoverDataSchema } from '../../components/popover'

export interface ComponentTextSelection { surfaceId: string | null; instanceId: string; dataPath: string[]; from: number; to: number; stateId?: string | null }
export type ComponentTextInteractionIntent = { kind: 'annotation'; content: string; label?: string }
  | { kind: 'input'; label?: string; placeholder?: string; acceptedAnswers?: string[] }
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value))
/** Captured selection is resolved by software. Identity, body, ownership and behavior commit together. */
export function componentTextInteractionEdits(project: CourseProjectV10, selection: ComponentTextSelection, intent: ComponentTextInteractionIntent): { edits: ComponentEdit[]; target: ComponentTarget; instanceId: string } {
  const effective = resolveComponentPresentation(project, selection.surfaceId, selection.stateId ?? null)
  const owner = effective.instances[selection.instanceId], content = documentTextAt(owner?.data, selection.dataPath)
  if (!owner || !content) throw new Error('选区不再属于可编辑正文')
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to < selection.from || selection.to > documentTextLength(content)) throw new RangeError('正文选区已改变')
  const instanceId = crypto.randomUUID(), rangeId = crypto.randomUUID()
  const target: ComponentTarget = intent.kind === 'annotation' ? { kind: 'text-range', instanceId: owner.id, dataPath: selection.dataPath, rangeId } : { kind: 'instance', instanceId }
  const definition = intent.kind === 'annotation' ? { ...POPOVER_DEFINITION, id: 'guoling.range-popover', role: 'behavior' as const } : INPUT_DEFINITION
  const selected = plainDocumentText(sliceDocumentText(content, selection.from, selection.to))
  const data = intent.kind === 'annotation' ? popoverDataSchema.parse({ label: intent.label ?? '正文注释', content: intent.content })
    : createInputData({ presentation: 'inline', label: intent.label ?? '填写答案', placeholder: intent.placeholder ?? '', acceptedAnswers: intent.acceptedAnswers ?? [] })
  const next = intent.kind === 'annotation' ? markDocumentRange(content, selection.from, selection.to, rangeId)
    : replaceDocumentText(content, selection.from, selection.to, { inlines: [{ type: 'component', instanceId, accessibleText: intent.label ?? (selected || '填写答案') }] })
  const edits: ComponentEdit[] = [
    ...(project.definitions[definition.id] ? [] : [{ type: 'definition.set' as const, definition }]),
    { type: 'instance.insert', container: { kind: 'instance', instanceId: owner.id }, index: owner.childIds?.length ?? 0,
      instances: [{ id: instanceId, definitionId: definition.id, data: json(data), ...(intent.kind === 'annotation' ? { attachments: [{ instanceId, target }] } : {}) }], rootIds: [instanceId] },
    ...componentDataEdits(project, { surfaceId: selection.surfaceId, instanceId: owner.id, stateId: selection.stateId },
      { kind: 'fields', fields: [{ path: selection.dataPath, value: json(next) }], ...(intent.kind === 'input'
        ? { textEdits: [{ path: selection.dataPath, edits: documentReplacementEdits(content, next, selection.from, selection.to) }] } : {}) }),
  ]
  return { edits, target, instanceId }
}
