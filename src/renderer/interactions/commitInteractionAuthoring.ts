import type { InteractionRule } from '../../shared/interactionTypes'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { componentRuleEdits, duplicateComponentRule, interactionBehavior, interactionRules } from './componentInteractionAuthoring'
import { buildInteractionTemplateRule, type InteractionTemplateRequest } from './interactionTemplates'
import { moveComponentRule, removeComponentRule } from '../../shared/componentInteractionData'

export interface InteractionAuthoringPorts { kernel: EditorStoreKernel; capture(): CapturedCourseTarget }
export type InteractionAuthoringCommitResult = { ok: true; status: 'committed' } | { ok: false; reason: string }
/** All authoring entries share the canonical behavior data; no renderer-owned content history. */
export function createInteractionAuthoringActions({ kernel, capture }: InteractionAuthoringPorts) {
  const commit = async (global: boolean, change: (rules: InteractionRule[]) => InteractionRule[], surfaceId?: string): Promise<InteractionAuthoringCommitResult> => {
    try {
      const target = capture(), id = surfaceId ?? target.surfaceId
      if (!global && !id) throw new Error('当前没有目标页面')
      const owner = global ? { kind: 'project' as const } : { kind: 'surface' as const, surfaceId: id! }
      const rules = structuredClone(interactionRules(interactionBehavior(target.project, owner)))
      await kernel.editCaptured(kernel.capture(componentRuleEdits(target.project, owner, change(rules)), target))
      return { ok: true, status: 'committed' }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
  }
  const update = (rules: InteractionRule[], id: string, patch: Partial<Omit<InteractionRule, 'id'>>) => {
    if (!rules.some(rule => rule.id === id)) throw new Error('互动规则已不存在')
    return rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule)
  }
  const duplicate = (rules: InteractionRule[], id: string) => {
    const index = rules.findIndex(rule => rule.id === id); if (index < 0) throw new Error('互动规则已不存在')
    rules.splice(index + 1, 0, duplicateComponentRule(rules[index]!)); return rules
  }
  return {
    addInteractionRule: (surfaceId: string, rule: InteractionRule) => commit(false, rules => [...rules, rule], surfaceId),
    updateInteractionRule: (surfaceId: string, id: string, patch: Partial<Omit<InteractionRule, 'id'>>) => commit(false, rules => update(rules, id, patch), surfaceId),
    deleteInteractionRule: (surfaceId: string, id: string) => commit(false, rules => removeComponentRule(rules, id), surfaceId),
    duplicateInteractionRule: (surfaceId: string, id: string) => commit(false, rules => duplicate(rules, id), surfaceId),
    moveInteractionRule: (surfaceId: string, id: string, direction: -1 | 1) => commit(false, rules => moveComponentRule(rules, id, direction), surfaceId),
    addGlobalInteractionRule: (rule: InteractionRule) => commit(true, rules => [...rules, rule]),
    updateGlobalInteractionRule: (id: string, patch: Partial<Omit<InteractionRule, 'id'>>) => commit(true, rules => update(rules, id, patch)),
    deleteGlobalInteractionRule: (id: string) => commit(true, rules => removeComponentRule(rules, id)),
    duplicateGlobalInteractionRule: (id: string) => commit(true, rules => duplicate(rules, id)),
    moveGlobalInteractionRule: (id: string, direction: -1 | 1) => commit(true, rules => moveComponentRule(rules, id, direction)),
    applyInteractionTemplate: (request: InteractionTemplateRequest, global = false, surfaceId?: string) => commit(global, rules => [...rules, buildInteractionTemplateRule(request)], surfaceId),
  }
}
