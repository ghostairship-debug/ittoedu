import { useEffect, useRef, useState } from 'react'
import { answerProblem, type UserAnswer } from '../../shared/workbench/userQuestion'
import { readableExecutionData, type PendingQuestion } from './executionTimelineModel'

export interface ExecutionQuestionCardProps {
  pending: PendingQuestion
  /** Resolves once Main accepted the answer; a rejection keeps the card open with its reason. */
  onAnswer?(answer: UserAnswer): Promise<void>
}

/** A question pauses the run until this explicit answer is accepted. It never takes focus or answers by itself. */
export function ExecutionQuestionCard({ pending, onAnswer }: ExecutionQuestionCardProps) {
  const { question } = pending
  const [chosen, setChosen] = useState<number[]>([]), [other, setOther] = useState('')
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState('')
  const questionKey = `${pending.runId}:${pending.callId}`
  const currentQuestion = useRef(questionKey)
  currentQuestion.current = questionKey
  useEffect(() => { setChosen([]); setOther(''); setBusy(false); setSubmitted(false); setError('') }, [questionKey])
  const kind = question.responseKind ?? 'choice'
  const send = async (answer: UserAnswer) => {
    const problem = answerProblem(question, answer)
    if (problem) { setError(problem); return }
    if (!onAnswer || busy || submitted) return
    setBusy(true); setError('')
    // Accepted answers stay locked until the run's own event closes this card.
    try { await onAnswer(answer); if (currentQuestion.current === questionKey) setSubmitted(true) }
    catch (failure) { if (currentQuestion.current === questionKey) setError(failure instanceof Error ? failure.message : '回答没有提交，请重试。') }
    finally { if (currentQuestion.current === questionKey) setBusy(false) }
  }
  const locked = busy || submitted || !onAnswer
  const note = other.trim()
  return <section className="execution-question" aria-label="AI 的提问">
    <header><strong>{question.options.length ? 'AI 需要你的回答' : 'AI 需要你的文字回答'}</strong>
      <small>{question.options.length ? question.multiple ? '可多选，也可独立提交文字' : '点选一项或直接填写文字'
        : '填写后提交，任务会继续'}</small></header>
    <p className="execution-question__text">{readableExecutionData(question.text)}</p>
    {question.options.length > 0 && <div className="execution-question__options" role="group" aria-label="可选答案">
      {question.options.map((option, index) => <button type="button" key={index} disabled={locked}
        className="execution-question__option" aria-pressed={question.multiple ? chosen.includes(index) : undefined}
        onClick={() => question.multiple
          ? setChosen(value => value.includes(index) ? value.filter(item => item !== index) : [...value, index].sort((a, b) => a - b))
          : void send({ choices: [index] })}>
        <span>{readableExecutionData(option.label)}</span>
        {option.description && <small>{readableExecutionData(option.description)}</small>}
      </button>)}
    </div>}
    {question.multiple && question.options.length > 0 && <button type="button" disabled={locked || chosen.length === 0}
      onClick={() => void send({ choices: chosen })}>提交选择</button>}
    <form className="execution-question__other" onSubmit={event => { event.preventDefault(); void send({ choices: [], other: note }) }}>
      <label>其他想法<textarea value={other} disabled={locked} rows={kind === 'free-text' ? 4 : 2}
        onChange={event => setOther(event.target.value)} placeholder="直接填写你的想法，提交后同一任务继续" /></label>
      <button type="submit" disabled={locked || !note}>提交文字回答</button>
    </form>
    <p className="execution-question__note" role={submitted ? 'status' : undefined}>{submitted ? '已提交回答，任务继续中…' : onAnswer
      ? '回答后同一任务继续；输入框里的新消息会排在本任务之后。停止任务则不再回答。' : '当前环境不能提交回答。'}</p>
    {error && <p className="execution-question__error" role="alert">{error}</p>}
  </section>
}
