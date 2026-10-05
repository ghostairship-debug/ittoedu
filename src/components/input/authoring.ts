import type { ComponentEdit, ComponentInstance, ComponentTarget, CourseProjectV10, CourseProjectLogic, JsonValue } from '../../shared/contracts/component-platform'
import type { NativeInputContent, NativeInputStyle } from '../../shared/contracts/native-v1/types'
import type { CapturedCourseTarget } from '../../renderer/documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../../renderer/store/editorStoreKernel'
import { buildInputRuleFamily, inspectInputRuleFamily, type InputRuleConfig } from '../../core/tools/inputRuleFamily'
import { componentRuleEdits, interactionBehavior, interactionRules } from '../../renderer/interactions/componentInteractionAuthoring'
import { inputAnswerContent, inputDataSchema } from './data'

export function inputAuthoringContent(instance: ComponentInstance): NativeInputContent {
  return inputAnswerContent(instance.id, inputDataSchema.parse(instance.data))
}
function inputRuleOwner(project: CourseProjectV10, surfaceId: string, instanceId: string): ComponentTarget {
  const seen = new Set<string>()
  const contains = (id: string): boolean => { if (seen.has(id)) return false; seen.add(id); return id === instanceId || (project.instances[id]?.childIds ?? []).some(contains) }
  return [...project.global.underlay, ...project.global.overlay].some(contains) ? { kind: 'project' } : { kind: 'surface', surfaceId }
}
export function inspectComponentInputRules(project: CourseProjectV10, surfaceId: string, instanceId: string) {
  const instance = project.instances[instanceId]
  if (!instance) throw new Error('填空对象已不存在')
  return inspectInputRuleFamily(instanceId, inputAuthoringContent(instance), interactionRules(interactionBehavior(project, inputRuleOwner(project, surfaceId, instanceId))))
}
export function inputContentPatchEdits(instance: ComponentInstance,
  patch: Partial<Omit<NativeInputContent, 'style'>> & { style?: Partial<NativeInputStyle> }): ComponentEdit[] {
  const current = inputDataSchema.parse(instance.data), content = inputAnswerContent(instance.id, current)
  const modifiesAnswer = ['answerType', 'stateKey', 'validityKey', 'ruleFamilyRuleIds'].some(key => Object.hasOwn(patch, key))
  const data = inputDataSchema.parse({ ...current, ...(patch.placeholder !== undefined ? { placeholder: patch.placeholder } : {}),
    ...(patch.style ? { style: { ...current.style, ...patch.style } } : {}),
    ...(modifiesAnswer ? { answer: { type: patch.answerType ?? content.answerType, stateKey: patch.stateKey ?? content.stateKey,
      validityKey: patch.validityKey ?? content.validityKey, ruleFamilyRuleIds: patch.ruleFamilyRuleIds ?? content.ruleFamilyRuleIds } } : {}) })
  return [{ type: 'data.set', instanceId: instance.id, path: [], value: JSON.parse(JSON.stringify(data)) as JsonValue }]
}
export type ComponentInputRuleRequest = { mode: 'apply' | 'rebuild'; config: InputRuleConfig } | { mode: 'unmanage' }
export function componentInputRuleEdits(target: CapturedCourseTarget, request: ComponentInputRuleRequest): ComponentEdit[] {
  const { project, surfaceId, instanceId } = target
  if (!surfaceId || !instanceId || !project.instances[instanceId]) throw new Error('填空目标已不存在')
  const instance = project.instances[instanceId], current = inputDataSchema.parse(instance.data), content = inputAnswerContent(instanceId, current)
  const owner = inputRuleOwner(project, surfaceId, instanceId), rules = interactionRules(interactionBehavior(project, owner))
  const inspection = inspectInputRuleFamily(instanceId, content, rules)
  if (request.mode === 'unmanage') {
    // Clear only management bookkeeping. Keep the scalar parser and every hand-authored rule.
    if (!current.answer) return []
    return inputContentPatchEdits(instance, { ruleFamilyRuleIds: [] })
  }
  if (request.mode === 'apply' && (inspection.managed && inspection.conflict || rules.some(rule => rule.trigger.type === 'input.submit' && rule.trigger.nodeId === instanceId && !content.ruleFamilyRuleIds.includes(rule.id)))) {
    throw new Error('判题规则已经手改，请保留手改或明确选择重建。')
  }
  const answer = { ...content, answerType: request.config.answerType }
  const family = buildInputRuleFamily(instanceId, answer, request.config, () => crypto.randomUUID())
  const edited = inputContentPatchEdits(instance, { answerType: request.config.answerType, stateKey: content.stateKey,
    validityKey: content.validityKey, ruleFamilyRuleIds: family.map(rule => rule.id) })
  const logic: CourseProjectLogic = structuredClone(project.logic ?? { courseState: [], navigationGuards: [] })
  for (const declaration of [request.config.answerType === 'number'
    ? { key: content.stateKey, valueType: 'number' as const, defaultValue: 0 }
    : { key: content.stateKey, valueType: 'string' as const, defaultValue: '' },
    { key: content.validityKey, valueType: 'boolean' as const, defaultValue: false }]) {
    const index = logic.courseState.findIndex(value => value.key === declaration.key)
    if (index < 0) logic.courseState.push(declaration)
    else if (logic.courseState[index]!.valueType !== declaration.valueType) logic.courseState[index] = declaration
  }
  return [...edited, { type: 'project.logic.set', logic }, ...componentRuleEdits(project, owner, [...rules.filter(rule => !content.ruleFamilyRuleIds.includes(rule.id)), ...family])]
}
/** Rebind software-managed defaults and rule-family identities during a surface clone. */
export function remapComponentInputData(data: JsonValue, copy: {
  fromInstanceId: string; toInstanceId: string; rules: ReadonlyMap<string, string>; stateKeys: Map<string, string>
}): JsonValue {
  const next = inputDataSchema.parse(data)
  if (next.answer) {
    for (const [field, suffix] of [['stateKey', 'value'], ['validityKey', 'valid']] as const) {
      const previous = next.answer[field]
      if (previous === `input:${copy.fromInstanceId}:${suffix}`) {
        const rebound = `input:${copy.toInstanceId}:${suffix}`
        copy.stateKeys.set(previous, rebound); next.answer[field] = rebound
      }
    }
    next.answer.ruleFamilyRuleIds = next.answer.ruleFamilyRuleIds.map(id => copy.rules.get(id) ?? id)
  }
  if (next.stateKey === `interaction:${copy.fromInstanceId}`) next.stateKey = `interaction:${copy.toInstanceId}`
  return JSON.parse(JSON.stringify(next)) as JsonValue
}
export async function configureComponentInputRules(kernel: EditorStoreKernel, target: CapturedCourseTarget, request: ComponentInputRuleRequest): Promise<string | null> {
  try { await kernel.editCaptured(kernel.capture(componentInputRuleEdits(target, request), target)); return null }
  catch (error) { return error instanceof Error ? error.message : String(error) }
}
