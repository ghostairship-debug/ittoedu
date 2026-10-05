import type { ComponentRuntimeImplementation, JsonValue } from '../../shared/contracts/component-platform'
import { bindPublishedNativeInputSubmit } from '../../player/composition/nativeInput'
import { normalizeShortAnswer, normalizeNumberAnswer, evaluateAssessment } from '../../shared/assessmentEvaluators'
import { interactionStateKey, runtimeLifetime } from './shared'
import { inputAnswerContent, inputDataSchema } from './data'

/** Parsing and IME belong here; authored feedback actions run only in the shared rule executor. */
export const inputRuntimeImplementation: ComponentRuntimeImplementation = {
  mount({ instance, scope, root }) {
    let data = inputDataSchema.parse(instance.data)
    inputAnswerContent(instance.id, data)
    const life = runtimeLifetime(scope)
    if (!root) throw new Error('填空组件需要内容容器')
    const doc = root.ownerDocument, form = doc.createElement('form'), label = doc.createElement('label'), caption = doc.createTextNode(''), input = doc.createElement('input'), button = doc.createElement('button')
    input.type = 'text'; input.dataset.inputNodeId = instance.id; button.type = 'submit'
    label.append(caption, input); form.append(label, button); root.append(form); life.own(() => form.remove())
    const key = () => interactionStateKey(instance.id, data.stateKey)
    const saved = scope.state.get(key())
    input.value = typeof saved === 'object' && saved && !Array.isArray(saved) && typeof saved.value === 'string' ? saved.value : data.initialValue
    input.defaultValue = input.value
    const paint = () => {
      caption.textContent = data.label; input.setAttribute('aria-label', data.label); input.placeholder = data.placeholder; button.textContent = data.submitLabel
      input.inputMode = data.answer?.type === 'number' ? 'decimal' : 'text'
      const style = data.style
      Object.assign(input.style, { fontFamily: style.fontFamily, fontSize: `${style.fontSize}px`, color: style.textColor,
        backgroundColor: `color-mix(in srgb, ${style.fillColor} ${style.fillOpacity * 100}%, transparent)`,
        border: `${style.borderWidth}px solid color-mix(in srgb, ${style.borderColor} ${style.borderOpacity * 100}%, transparent)`,
        borderRadius: `${style.cornerRadius}px`, textAlign: style.horizontalAlign, padding: `${style.padding}px`, boxSizing: 'border-box', maxWidth: '100%' })
    }
    life.own(bindPublishedNativeInputSubmit(form, instance.id, life.active, raw => {
      let normalizedValue: string | number | null = raw, valid = true
      if (data.answer) {
        normalizedValue = data.answer.type === 'number' ? normalizeNumberAnswer(raw) : normalizeShortAnswer(raw)
        valid = normalizedValue !== null && normalizedValue !== ''
        scope.state.set(data.answer.stateKey, normalizedValue); scope.state.set(data.answer.validityKey, valid)
      }
      // Simple accepted-answer feedback remains available; managed family grading is authored rule data.
      const normalize = (value: string) => { const normalized = data.trim ? value.trim() : value; return data.caseSensitive ? normalized : normalized.toLocaleLowerCase('und') }
      const correct = data.answer ? null : !data.acceptedAnswers.length ? null : !data.caseSensitive && data.trim
        ? evaluateAssessment({ evaluatorId: 'EVAL-normalized-short-v1', input: raw, acceptedValues: data.acceptedAnswers }).status === 'pass'
        : data.acceptedAnswers.some(answer => normalize(answer) === normalize(raw))
      const result: JsonValue = { instanceId: instance.id, value: raw, normalizedValue, valid, submitted: true, correct }
      scope.state.set(key(), result); scope.events.emit('input.submit', result)
    }))
    // Author updates never replace the live input or interrupt an IME draft.
    paint()
    return { update(next) { if (!life.active()) return; const nextData = inputDataSchema.parse(next.data); inputAnswerContent(instance.id, nextData); data = nextData; paint() }, dispose: life.dispose }
  },
}
