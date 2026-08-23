import { interactionRuleSchema } from '@/shared/interactionSchema'
import type {
  InteractionCondition,
  InteractionRule,
} from '@/shared/interactionTypes'

export const SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID =
  'scene-enter-reveal-sequence' as const

/** The existing Automation template deliberately limits a readable sequence to six nodes. */
export const SCENE_ENTER_REVEAL_SEQUENCE_MAX_TARGETS = 6

export interface SceneEnterRevealSequenceTemplateRequest {
  readonly templateId: typeof SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID
  readonly ruleId: string
  readonly actionIds: readonly string[]
  readonly targetLayerItemIds: readonly string[]
  readonly conditions?: readonly InteractionCondition[]
  readonly name?: string
}

export type InteractionTemplateRequest =
  SceneEnterRevealSequenceTemplateRequest

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function assertRevealSequenceShape(
  request: SceneEnterRevealSequenceTemplateRequest,
): void {
  const targetCount = request.targetLayerItemIds.length
  if (targetCount === 0) {
    throw new TypeError('依次出现模板至少需要一个目标元素')
  }
  if (targetCount > SCENE_ENTER_REVEAL_SEQUENCE_MAX_TARGETS) {
    throw new TypeError(
      `依次出现模板最多支持 ${SCENE_ENTER_REVEAL_SEQUENCE_MAX_TARGETS} 个目标元素`,
    )
  }
  if (request.actionIds.length !== targetCount) {
    throw new TypeError('每个依次出现的目标必须对应一个稳定动作 ID')
  }
  if (new Set(request.targetLayerItemIds).size !== targetCount) {
    throw new TypeError('依次出现模板不能重复选择同一元素')
  }
  if (new Set(request.actionIds).size !== request.actionIds.length) {
    throw new TypeError('依次出现模板的动作 ID 必须唯一')
  }
}

/**
 * Builds the canonical Interaction V1 rule behind the existing
 * “enter scene, then reveal elements in sequence” template. There is no
 * template-only persisted shape: professional authoring edits this same rule.
 */
export function buildInteractionTemplateRule(
  request: InteractionTemplateRequest,
): InteractionRule {
  switch (request.templateId) {
    case SCENE_ENTER_REVEAL_SEQUENCE_TEMPLATE_ID: {
      assertRevealSequenceShape(request)
      const parsed = interactionRuleSchema.parse({
        id: request.ruleId,
        name: request.name ?? '进入场景后依次出现',
        enabled: true,
        trigger: { type: 'scene.enter' },
        conditions: structuredClone(request.conditions ?? []),
        actions: request.targetLayerItemIds.map((nodeId, index) => ({
          id: request.actionIds[index],
          start: 'after-previous' as const,
          delayMs: index === 0 ? 0 : 80,
          action: {
            type: 'node.enter' as const,
            nodeId,
            effect: 'fade' as const,
            durationMs: 240,
            easing: 'ease-out' as const,
          },
        })),
      })
      return deepFreeze(parsed)
    }
    default: {
      const unsupported = request as { readonly templateId?: unknown }
      throw new TypeError(
        `不支持的互动模板：${String(unsupported.templateId ?? '缺失')}`,
      )
    }
  }
}
