import { useState } from 'react'
import { answerProblem, USER_QUESTION_LIMITS, type UserAnswer } from '../../shared/workbench/userQuestion'
import { readableExecutionData, type PendingQuestion } from './executionTimelineModel'

export interface ExecutionQuestionCardProps {
  pending: PendingQuestion
  /** Resolves once Main accepted the answer; a rejection keeps the card open with its reason. */
  onAnswer?(answer: UserAnswer): Promise<void>
}

/** The option card for the AI's open question. It never takes focus by itself and never answers for the user. */
export function ExecutionQuestionCard({ pending, onAnswer }: ExecutionQuestionCardProps) {
  const { question } = pending
  const [chosen, setChosen] = useState<number[]>([]), [other, setOther] = useState('')
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState('')
  const send = async (answer: UserAnswer) => {
    const problem = answerProblem(question, answer)
    if (problem) { setError(problem); return }
    if (!onAnswer || busy || submitted) return
    setBusy(true); setError('')
    // Accepted answers stay locked until the run's own event closes this card.
    try { await onAnswer(answer); setSubmitted(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '回答没有提交，请重试。') }
    finally { setBusy(false) }
  }
  const locked = busy || submitted || !onAnswer
  const note = other.trim()
  const withNote = (choices: number[]): UserAnswer => ({ choices, ...(note ? { other: note } : {}) })
  return <section className="execution-question" aria-label="AI 的提问">
    <header><strong>AI 需要你选择</strong><small>{question.multiple ? '可多选，选好后提交' : '点选一项即可回答'}</small></header>
    <p className="execution-question__text">{readableExecutionData(question.text)}</p>
    <div className="execution-question__options" role="group" aria-label="可选答案">
      {question.options.map((option, index) => <button type="button" key={index} disabled={locked}
        className="execution-question__option" aria-pressed={question.multiple ? chosen.includes(index) : undefined}
        onClick={() => question.multiple
          ? setChosen(value => value.includes(index) ? value.filter(item => item !== index) : [...value, index].sort((a, b) => a - b))
          : void send(withNote([index]))}>
        <span>{readableExecutionData(option.label)}</span>
        {option.description && <small>{readableExecutionData(option.description)}</small>}
      </button>)}
    </div>
    <form className="execution-question__other" onSubmit={event => { event.preventDefault(); void send(withNote(question.multiple ? chosen : [])) }}>
      <label>其他（自己填写）<input value={other} maxLength={USER_QUESTION_LIMITS.other} disabled={locked}
        onChange={event => setOther(event.target.value)} placeholder={question.multiple ? '可选：补充说明' : '不选以上选项时，在这里写你的回答'} /></label>
      <button type="submit" disabled={locked || (question.multiple ? chosen.length === 0 && !note : !note)}>
        {question.multiple ? '提交选择' : '用这段文字回答'}</button>
    </form>
    <p className="execution-question__note" role={submitted ? 'status' : undefined}>{submitted ? '已提交回答，任务继续中…' : onAnswer
      ? '回答后同一任务继续；输入框里的新消息会排在本任务之后。停止任务则不再回答。' : '当前环境不能提交回答。'}</p>
    {error && <p className="execution-question__error" role="alert">{error}</p>}
  </section>
}
