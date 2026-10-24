import type { InteractionRule } from '../../shared/interactionTypes'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { buildInteractionTemplateRule, type InteractionTemplateRequest } from './interactionTemplates'
import { planComponentRuleChange, type ComponentRuleChange } from '../../shared/componentInteractionData'

export interface InteractionAuthoringPorts { kernel: EditorStoreKernel; capture(): CapturedCourseTarget }
export type InteractionAuthoringCommitResult = { ok: true; status: 'committed' } | { ok: false; reason: string }
/** All authoring entries share the canonical behavior data; no renderer-owned content history. */
export function createInteractionAuthoringActions({ kernel, capture }: InteractionAuthoringPorts) {
  const commit = async (global: boolean, change: ComponentRuleChange, surfaceId?: string): Promise<InteractionAuthoringCommitResult> => {
    try {
      const target = capture(), id = surfaceId ?? target.surfaceId
      if (!global && !id) throw new Error('当前没有目标页面')
      const owner = global ? { kind: 'project' as const } : { kind: 'surface' as const, surfaceId: id! }
      await kernel.editCaptured(kernel.capture(planComponentRuleChange(target.editingProject, owner, change), target))
      return { ok: true, status: 'committed' }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
  }
  return {
    addInteractionRule: (surfaceId: string, rule: InteractionRule) => commit(false, { kind: 'add', rule }, surfaceId),
    updateInteractionRule: (surfaceId: string, id: string, patch: Partial<Omit<InteractionRule, 'id'>>) => commit(false, { kind: 'patch', ruleId: id, patch }, surfaceId),
    deleteInteractionRule: (surfaceId: string, id: string) => commit(false, { kind: 'remove', ruleId: id }, surfaceId),
    duplicateInteractionRule: (surfaceId: string, id: string) => commit(false, { kind: 'duplicate', ruleId: id }, surfaceId),
    moveInteractionRule: (surfaceId: string, id: string, direction: -1 | 1) => commit(false, { kind: 'move', ruleId: id, direction }, surfaceId),
    addGlobalInteractionRule: (rule: InteractionRule) => commit(true, { kind: 'add', rule }),
    updateGlobalInteractionRule: (id: string, patch: Partial<Omit<InteractionRule, 'id'>>) => commit(true, { kind: 'patch', ruleId: id, patch }),
    deleteGlobalInteractionRule: (id: string) => commit(true, { kind: 'remove', ruleId: id }),
    duplicateGlobalInteractionRule: (id: string) => commit(true, { kind: 'duplicate', ruleId: id }),
    moveGlobalInteractionRule: (id: string, direction: -1 | 1) => commit(true, { kind: 'move', ruleId: id, direction }),
    applyInteractionTemplate: (request: InteractionTemplateRequest, global = false, surfaceId?: string) => commit(global, { kind: 'add', rule: buildInteractionTemplateRule(request) }, surfaceId),
  }
}
