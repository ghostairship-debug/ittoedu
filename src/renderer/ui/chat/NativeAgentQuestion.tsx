import { useState } from 'react'
import type { z } from 'zod'
import type { aiQuestionSchema } from '../../../shared/localAgentInteraction'
import type { AiUserInput } from '../../../shared/localAgentTaskContract'

type Question = z.infer<typeof aiQuestionSchema>
export function NativeAgentQuestion({ question, onAnswer }: { question: Question; onAnswer(input: AiUserInput): Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const permission = question.purpose === 'permission'
  return <section className="native-agent-question" aria-label={permission ? 'CLI 授权请求' : 'CLI 提问'}>
    <h3>{permission ? 'CLI 请求授权' : '需要你的回答'}</h3>
    <form onSubmit={event => {
      event.preventDefault()
      if (submitting || question.questions.some(item => !answers[item.id]?.some(value => value.trim()))) return
      setSubmitting(true); setError('')
      void onAnswer({ version: 1, kind: 'answer', taskId: question.taskId, epoch: question.epoch, workspace: question.workspace,
        inputId: crypto.randomUUID(), turnId: question.turnId, questionId: question.questionId,
        answers: question.questions.map(item => ({ id: item.id, values: answers[item.id]! })) })
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setSubmitting(false))
    }}>
      {question.questions.map(item => <fieldset key={item.id} disabled={submitting}><legend>{item.title}</legend>
        {item.options.map(option => <label key={option}><input type={item.multiple ? 'checkbox' : 'radio'} name={item.id}
          checked={answers[item.id]?.includes(option) ?? false} onChange={event => setAnswers(prior => ({ ...prior,
            [item.id]: item.multiple ? event.target.checked ? [...(prior[item.id] ?? []), option] : (prior[item.id] ?? []).filter(value => value !== option) : [option] }))} />{option}</label>)}
        {!permission && <label>填写回答<input aria-label={item.title + '：填写回答'} type="text" value={(answers[item.id] ?? []).filter(value => !item.options.includes(value)).join('、')}
          onChange={event => setAnswers(prior => ({ ...prior, [item.id]: event.target.value ? [event.target.value] : [] }))} /></label>}
      </fieldset>)}
      <button type="submit" disabled={submitting || question.questions.some(item => !answers[item.id]?.some(value => value.trim()))}>{submitting ? '正在发送' : permission ? '确认选择' : '发送回答'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}

