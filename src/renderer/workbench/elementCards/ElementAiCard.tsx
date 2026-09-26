import { Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { QuickBarPopoverButton } from '../../editing/quickbar/SelectionQuickBar'
import type { ExecutionSelectionTarget } from '../../../shared/workbench/executionDesktop'
import { ExecutionApprovalCard } from '../ExecutionApprovalCard'
import { ExecutionQuestionCard } from '../ExecutionQuestionCard'
import type { SelectionCapture } from '../SelectionContextController'
import { elementCardKey, elementCards, useElementCard, type ElementCardEntryState } from './elementCardController'
import './elementCards.css'

const STATE_LABEL: Record<ElementCardEntryState, string> = {
  sending: '发送中…', queued: '排队中', running: '进行中…', completed: '已完成', failed: '未完成', stopped: '已停止', cancelled: '已取消',
}

/** The element's own AI card (M15): its requests and replies, questions and approvals, and an input for the next one. */
export function ElementAiCard({ cardKey, capture, onClose }: { cardKey: string; capture?(): Promise<SelectionCapture>; onClose(): void }) {
  const card = useElementCard(cardKey)
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('')
  const [conflict, setConflict] = useState<{ direction: 'undo' | 'redo'; submissionId: string; fields: readonly string[] } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLOListElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const count = card?.entries.length ?? 0
  useEffect(() => { log.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' }) }, [count])
  if (!card) return null
  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setError('')
    try { await elementCards.send(cardKey, text, capture ? await capture() : undefined); setDraft('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSending(false) }
  }
  const revert = async (direction: 'undo' | 'redo', submissionId: string, force = false) => {
    setError(''); setConflict(null)
    try {
      const result = await elementCards.revert(cardKey, submissionId, direction, force)
      if (result.status === 'conflict') setConflict({ direction, submissionId, fields: result.fields })
      else if (result.status === 'unavailable') setError(result.message)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const question = card.question, approval = card.approval, text = card.kind === 'text'
  const undoTitle = card.undo ? `撤销 AI 对${card.undo.fields.join('、')}的修改` : card.undoUnavailable ?? '没有可撤销的 AI 修改'
  const redoTitle = card.redo ? `重做 AI 对${card.redo.fields.join('、')}的修改` : '没有可重做的 AI 修改'
  return <section className="element-ai-card" aria-label={`AI 修改：${card.label}`} onKeyDown={event => event.stopPropagation()}>
    <header className="element-ai-card__header">
      <Sparkles size={14} aria-hidden="true" />
      <strong title={card.label}>{card.label}</strong>
      <button type="button" aria-label="撤销这张卡的 AI 修改" title={undoTitle} disabled={!card.undo}
        onClick={() => { if (card.undo) void revert('undo', card.undo.submissionId) }}><Undo2 size={13} aria-hidden="true" /></button>
      <button type="button" aria-label="重做这张卡的 AI 修改" title={redoTitle} disabled={!card.redo}
        onClick={() => { if (card.redo) void revert('redo', card.redo.submissionId) }}><Redo2 size={13} aria-hidden="true" /></button>
      <button type="button" className="element-ai-card__close" aria-label={text ? '关闭 AI 卡' : '收起 AI 卡'}
        title={text ? '关闭（这张卡随之结束，修改保留）' : '收起（记录保留到文件关闭）'} onClick={onClose}>×</button>
    </header>
    {conflict && <div className="element-ai-card__confirm" role="alertdialog" aria-label={conflict.direction === 'undo' ? '确认撤销' : '确认重做'}>
      <p>{conflict.fields.join('、')}在 AI 修改后又改过。仍要{conflict.direction === 'undo' ? '撤销' : '重做'}吗？这会覆盖后来的修改。</p>
      <div className="element-ai-card__actions">
        <button type="button" onClick={() => setConflict(null)}>取消</button>
        <button type="button" onClick={() => { void revert(conflict.direction, conflict.submissionId, true) }}>仍要{conflict.direction === 'undo' ? '撤销' : '重做'}</button>
      </div>
    </div>}
    {count === 0
      ? <p className="element-ai-card__hint">{text ? '告诉 AI 怎么改这段文字。这里的 AI 只改选中的文字，可以连续追问；关闭卡片即结束，修改会保留。'
        : '告诉 AI 怎么改它。这里的 AI 只改这一个对象；要牵动其他对象，请用右侧 AI 助手。'}</p>
      : <ol ref={log} className="element-ai-card__log" aria-label="修改记录">
        {card.entries.map(entry => <li key={entry.submissionId} className="element-ai-card__entry" data-state={entry.state}>
          <p className="element-ai-card__request">{entry.text}</p>
          <p className="element-ai-card__state">{STATE_LABEL[entry.state]}</p>
          {entry.reply && <p className="element-ai-card__reply">{entry.reply}</p>}
          {entry.failure && entry.state !== 'completed' && <p className="element-ai-card__failure" role="alert">{entry.failure}</p>}
        </li>)}
      </ol>}
    {question && <ExecutionQuestionCard pending={question} onAnswer={answer => elementCards.answer(cardKey, question.runId, question.callId, answer)} />}
    {approval && <ExecutionApprovalCard pending={approval} onDecide={decision => elementCards.approve(cardKey, approval.runId, approval.callId, decision)} />}
    <form className="element-ai-card__form" onSubmit={event => { event.preventDefault(); void send() }}>
      <textarea ref={input} aria-label="AI 修改要求" value={draft} rows={2}
        placeholder={card.busy ? text ? '等 AI 改完再继续追问' : '可以继续提要求，会排在后面' : text ? '继续告诉 AI 怎么改' : '告诉 AI 怎么改'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault(); void send()
        }} />
      <div className="element-ai-card__actions">
        {card.busy && <button type="button" onClick={() => { void elementCards.stop(cardKey).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))) }}>停止</button>}
        <button type="submit" disabled={!draft.trim() || sending || text && (card.busy || Boolean(card.textLost))}>{sending ? '发送中…' : '发送'}</button>
      </div>
    </form>
    {(error || card.error || card.textLost) && <p className="element-ai-card__failure" role="alert">{error || card.error || card.textLost}</p>}
  </section>
}

/**
 * The quick bar's "AI 修改" for one element: it opens that element's card, which keeps its records while the file is
 * open. `capture` reads the element as selected at the moment of sending.
 */
export function ElementAiButton({ documentId, target, label, capture, disabledReason }: {
  documentId: string
  target: ExecutionSelectionTarget
  label: string
  capture(): Promise<SelectionCapture>
  disabledReason?: string | null
}) {
  const key = elementCardKey(documentId, target)
  // The card is registered after rendering: registering notifies the other views of cards.
  const latest = useRef(target); latest.current = target
  const targetJson = JSON.stringify(target)
  useEffect(() => { elementCards.ensure({ documentId, target: latest.current, label }) }, [documentId, targetJson, label])
  const card = useElementCard(key)
  const busy = Boolean(card?.busy || card?.question || card?.approval)
  // A jump from the top bar's indicator opens the card as soon as the element's quick bar is here.
  const [openToken, setOpenToken] = useState(0)
  useEffect(() => { if (elementCards.takeOpenRequest(key)) setOpenToken(value => value + 1) })
  return <QuickBarPopoverButton label="AI 修改" text={busy ? 'AI 进行中' : 'AI 修改'} icon={<Sparkles size={14} />} popoverLabel={`AI 修改：${label}`}
    disabled={Boolean(disabledReason)} openToken={openToken}>
    {close => <ElementAiCard cardKey={key} capture={capture} onClose={close} />}
  </QuickBarPopoverButton>
}
