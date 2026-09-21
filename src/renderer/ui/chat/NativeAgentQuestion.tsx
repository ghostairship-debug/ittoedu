import { useEffect, useState } from 'react'
import { readableChatError } from './readableChatStatus'
import type { z } from 'zod'
import type { aiQuestionSchema } from '../../../shared/localAgentInteraction'
import type { AiUserInput } from '../../../shared/localAgentTaskContract'

type Question = z.infer<typeof aiQuestionSchema>
export function readablePermissionTitle(title: string): string {
  for (const line of title.split('\n')) {
    try {
      const input = JSON.parse(line)
      const file = input.filepath ?? input.filePath ?? input.path
      if (typeof file === 'string') return `CLI 需要访问此文件：${file}`
      if (typeof input.command === 'string') return `CLI 需要执行此命令：${input.command}`
    } catch { /* Native titles are normally plain text. */ }
  }
  return title
}
const permissionOption = (option: string) => ({ 'Allow once': '仅允许这次', 'Always allow': '按原生规则持续允许', Reject: '拒绝', Allow: '允许' })[option] ?? option
const announcementStyle = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap' as const,
  border: 0,
}
export function NativeAgentQuestion({ question, onAnswer }: { question: Question; onAnswer(input: AiUserInput): Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const permission = question.purpose === 'permission'
  useEffect(() => {
    setAnnouncement('')
    const timer = window.setTimeout(() => setAnnouncement(permission
      ? '创作助手请求授权，请在对话中查看并选择是否允许。'
      : '创作助手有一个新问题，请在对话中查看并回答。'), 0)
    return () => window.clearTimeout(timer)
  }, [question.questionId, permission])
  return <section className="native-agent-question" aria-label={permission ? 'CLI 授权请求' : 'CLI 提问'}>
    <p role="status" aria-live="polite" aria-atomic="true" style={announcementStyle}>{announcement}</p>
    <h3>{permission ? 'CLI 请求授权' : '需要你的回答'}</h3>
    <form onSubmit={event => {
      event.preventDefault()
      if (submitting || question.questions.some(item => !answers[item.id]?.some(value => value.trim()))) return
      setSubmitting(true); setError('')
      void onAnswer({ version: 1, kind: 'answer', taskId: question.taskId, epoch: question.epoch, workspace: question.workspace,
        inputId: crypto.randomUUID(), turnId: question.turnId, questionId: question.questionId,
        answers: question.questions.map(item => ({ id: item.id, values: answers[item.id]! })) })
        .catch(reason => setError(readableChatError(reason)))
        .finally(() => setSubmitting(false))
    }}>
      {question.questions.map(item => <fieldset key={item.id} disabled={submitting}><legend>{permission ? readablePermissionTitle(item.title) : item.title}</legend>
        {item.options.map(option => <label key={option}><input type={item.multiple ? 'checkbox' : 'radio'} name={item.id}
          checked={answers[item.id]?.includes(option) ?? false} onChange={event => setAnswers(prior => ({ ...prior,
            [item.id]: item.multiple ? event.target.checked ? [...(prior[item.id] ?? []), option] : (prior[item.id] ?? []).filter(value => value !== option) : [option] }))} />{permission ? permissionOption(option) : option}</label>)}
        {!permission && <label>填写回答<input aria-label={item.title + '：填写回答'} type="text" value={(answers[item.id] ?? []).filter(value => !item.options.includes(value)).join('、')}
          onChange={event => setAnswers(prior => ({ ...prior, [item.id]: event.target.value ? [event.target.value] : [] }))} /></label>}
      </fieldset>)}
      <button type="submit" disabled={submitting || question.questions.some(item => !answers[item.id]?.some(value => value.trim()))}>{submitting ? '正在发送' : permission ? '确认选择' : '发送回答'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}
