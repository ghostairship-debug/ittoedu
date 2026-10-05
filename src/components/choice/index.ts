import { z } from 'zod'
import type { ComponentRuntimeImplementation, JsonValue } from '../../shared/contracts/component-platform'
import { interactionDefinition, interactionStateKey, runtimeLifetime } from '../input/shared'

export const CHOICE_DEFINITION = interactionDefinition('guoling.choice', '选择')
export const choiceDataSchema = z.object({ label: z.string(), options: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
  multiple: z.boolean().default(false), correctOptionIds: z.array(z.string()).default([]), stateKey: z.string().optional() }).strict()
  .superRefine((data, ctx) => { const ids = data.options.map(option => option.id)
    if (new Set(ids).size !== ids.length || data.correctOptionIds.some(id => !ids.includes(id))) ctx.addIssue({ code: 'custom', message: '选项身份重复或答案指向不存在的选项' }) })
export type ChoiceData = z.infer<typeof choiceDataSchema>
export const createChoiceData = (data: Partial<ChoiceData> = {}) => choiceDataSchema.parse({ label: '选择答案', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], ...data })
export const choiceRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root }) {
    let data = choiceDataSchema.parse(instance.data)
    const life = runtimeLifetime(scope)
    if (!root) throw new Error('选择组件需要内容容器')
    const doc = root.ownerDocument, fieldset = doc.createElement('fieldset')
    root.append(fieldset); life.own(() => fieldset.remove())
    const key = () => interactionStateKey(instance.id, data.stateKey)
    const saved = scope.state.get(key())
    let selected = new Set(typeof saved === 'object' && saved && !Array.isArray(saved) && Array.isArray(saved.value) ? saved.value.filter((id): id is string => typeof id === 'string') : [])
    const paint = () => {
      selected = new Set([...selected].filter(id => data.options.some(option => option.id === id)))
      const legend = doc.createElement('legend'); legend.textContent = data.label; fieldset.replaceChildren(legend)
      data.options.forEach(option => { const label = doc.createElement('label'), input = doc.createElement('input')
        input.type = data.multiple ? 'checkbox' : 'radio'; input.name = `${scope.runScopeId}:${instance.id}`; input.value = option.id; input.checked = selected.has(option.id)
        label.append(input, doc.createTextNode(option.label)); fieldset.append(label) })
    }
    life.listen(fieldset, 'keydown', event => { event.stopPropagation() })
    life.listen(fieldset, 'pointerdown', event => event.stopPropagation())
    life.listen(fieldset, 'click', event => event.stopPropagation())
    life.listen(fieldset, 'change', event => {
      if (!life.active()) return
      const input = event.target as HTMLInputElement
      if (input.tagName !== 'INPUT' || !data.options.some(option => option.id === input.value)) return
      if (!data.multiple) selected.clear()
      if (input.checked) selected.add(input.value); else selected.delete(input.value)
      const value = data.options.filter(option => selected.has(option.id)).map(option => option.id)
      const result: JsonValue = { instanceId: instance.id, value, submitted: true, correct: data.correctOptionIds.length
        ? value.length === data.correctOptionIds.length && value.every(id => data.correctOptionIds.includes(id)) : null }
      scope.state.set(key(), result); scope.events.emit('choice.change', result)
    })
    paint()
    return { update(next) { if (!life.active()) return; data = choiceDataSchema.parse(next.data); paint() }, dispose: life.dispose }
  },
}
