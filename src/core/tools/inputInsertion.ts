import { z } from 'zod'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { createInputLayerItem, DEFAULT_INPUT_STYLE, createTextNode as createInputFeedbackText } from './nativeNodeFactories'
import { buildInputRuleFamily, inspectInputRuleFamily, type InputRuleConfig } from './inputRuleFamily'
import { allocateInputStateKeys } from './inputAuthoringState'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { slideSceneContext, appendOwnedLayer, type SlideInsertionOwner } from './slideInsertion'

export const inputAnswerSchema = z.discriminatedUnion('answerType', [
  z.object({ answerType: z.literal('text'), answers: z.array(z.string()) }).strict(),
  z.object({ answerType: z.literal('number'), min: z.number().finite(), max: z.number().finite() }).strict(),
])

export function planSlideInputInsertion(document: CourseProjectDocument, owner: SlideInsertionOwner, input: { answerType?: 'text' | 'number'; x?: number; y?: number } = {}, createId: () => string, now?: string) {
    if (owner.scope !== 'scene') throw new Error('填空题只允许添加到演示页场景')
    const id = createId
    const layerId = `input_${id()}`
    const answerType = input.answerType ?? 'text'
    const project = commitCourseProjectMutation(document, draft => {
      const { scene } = slideSceneContext(draft, owner)
      const keys = allocateInputStateKeys(draft, answerType, id)
      const data = { ...keys, answerType, placeholder: '填写答案', ruleFamilyRuleIds: [] as string[], style: { ...DEFAULT_INPUT_STYLE } }
      const item = createInputLayerItem(data, { ...input, id: layerId })
      const feedback = (text: string, color: string) => sceneNodeToCourseLayerItem(createInputFeedbackText({
        id: `text_${id()}`, text, name: text, x: item.frame.x, y: item.frame.y + item.frame.height + 16,
        width: 480, height: 60, playbackInitialVisibility: 'hidden', style: { color, fontSize: 24 },
      }))
      const correct = feedback('回答正确！', '#15803d')
      const error = feedback('再想一想，请重新作答。', '#b91c1c')
      const show = (nodeId: string, visible: boolean): import('../../shared/interactionTypes').InteractionActionPayload => ({
        type: visible ? 'node.enter' : 'node.exit', nodeId, effect: 'none', durationMs: 0, easing: 'linear',
      })
      const actions = { correct: [show(error.layerItemId, false), show(correct.layerItemId, true)], error: [show(correct.layerItemId, false), show(error.layerItemId, true)] }
      const config: InputRuleConfig = answerType === 'text' ? { answerType, answers: ['答案'], ...actions } : { answerType, min: 1, max: 1, ...actions }
      const family = buildInputRuleFamily(layerId, data, config, id)
      data.ruleFamilyRuleIds = family.map(rule => rule.id)
      if (item.content.nativeType === 'input') item.content.data = data
      for (const layer of [item, correct, error]) appendOwnedLayer(draft, owner, layer)
      scene.interactions.push(...family)
    }, now)
    return { project, itemId: layerId }
}

export function planConfigureSlideInput(document: CourseProjectDocument, owner: SlideInsertionOwner, itemId: string,
  request: { mode: 'apply' | 'rebuild'; config: InputRuleConfig } | { mode: 'unmanage' }, createId: () => string) {
  if (owner.scope !== 'scene') throw new Error('填空题只允许演示页场景')
    const project = commitCourseProjectMutation(document, draft => {
      const { scene } = slideSceneContext(draft, owner)
      const item = scene.layerItems.find(layer => layer.layerItemId === itemId)
      if (!item || item.locked || item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('输入编辑目标不可用')
      const data = item.content.data
      const inspection = inspectInputRuleFamily(item.layerItemId, data, scene.interactions)
      if (request.mode === 'unmanage') { data.ruleFamilyRuleIds = []; return }
      if (request.mode === 'apply' && inspection.conflict) throw new Error('判题规则已被手改，请选择保留手改或重建')
      scene.interactions = scene.interactions.filter(rule => !data.ruleFamilyRuleIds.includes(rule.id))
      if (request.config.answerType !== data.answerType) {
        data.answerType = request.config.answerType
        const declaration = draft.courseState.find(entry => entry.key === data.stateKey)
        if (!declaration) throw new Error('输入答案状态声明已失效')
        draft.courseState = draft.courseState.map(entry => entry === declaration
          ? data.answerType === 'text' ? { key: entry.key, valueType: 'string', defaultValue: '' } : { key: entry.key, valueType: 'number', defaultValue: 0 }
          : entry)
      }
      const rules = buildInputRuleFamily(item.layerItemId, data, request.config, createId)
      data.ruleFamilyRuleIds = rules.map(rule => rule.id)
      scene.interactions.push(...rules)
    })
    return { project, itemId }
}

/** Change only answers; existing teacher-authored feedback remains authoritative. */
export function planInputAnswer(document: CourseProjectDocument, locationId: string, itemId: string, raw: z.infer<typeof inputAnswerSchema>, createId: () => string) {
  const answer = inputAnswerSchema.parse(raw)
  const owner = { scope: 'scene', selection: { locationId, stateId: null } }
  const { scene } = slideSceneContext(document, owner)
  const item = scene.layerItems.find(item => item.layerItemId === itemId)
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'input') throw new Error('需要场景输入框目标')
  const current = inspectInputRuleFamily(itemId, item.content.data, scene.interactions)
  if (current.conflict || !current.config) throw new Error('判题规则已被手改，请选择保留手改或重建')
  return planConfigureSlideInput(document, owner, itemId, { mode: 'apply', config: { ...answer, correct: current.config.correct, error: current.config.error } }, createId)
}
