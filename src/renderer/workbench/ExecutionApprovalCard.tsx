import { useState } from 'react'
import type { ApprovalDecision } from '../../shared/workbench/executionPermission'
import { readableExecutionData, type PendingApproval } from './executionTimelineModel'

export interface ExecutionApprovalCardProps {
  pending: PendingApproval
  /** Resolves once Main accepted the decision; a rejection keeps the card open with its reason. */
  onDecide?(decision: ApprovalDecision): Promise<void>
}

/** "修改前询问" and outside-workspace changes: the modification has not run while this card is open. */
export function ExecutionApprovalCard({ pending, onDecide }: ExecutionApprovalCardProps) {
  const { approval } = pending
  const local = approval.kind === 'local-command'
  const [busy, setBusy] = useState(false), [decided, setDecided] = useState(false), [error, setError] = useState('')
  const decide = async (decision: ApprovalDecision) => {
    if (!onDecide || busy || decided) return
    setBusy(true); setError('')
    try { await onDecide(decision); setDecided(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '决定没有提交，请重试。') }
    finally { setBusy(false) }
  }
  const locked = busy || decided || !onDecide
  return <section className="execution-question execution-approval" aria-label={local ? "工具执行请求" : "修改请求"}>
    <header><strong>{local ? 'AI 想运行本地工具' : 'AI 想修改文档'}</strong><small>{local ? '仅批准这次工具执行' : approval.reason === 'outside-workspace' ? '目标在工作空间外，需要你确认' : '当前权限：修改前询问'}</small></header>
    <p className="execution-question__text">{readableExecutionData(approval.summary)}{approval.documents.length ? ` · ${(local ? approval.documents : approval.documents.map(readableExecutionData)).join('、')}` : ''}</p>
    {approval.preview && <pre className="execution-approval__preview" aria-label={local ? "执行内容" : "修改内容"}>{local ? approval.preview : readableExecutionData(approval.preview)}</pre>}
    <div className="execution-question__options execution-approval__actions" role="group" aria-label="是否允许">
      <button type="button" className="execution-question__option" disabled={locked} onClick={() => void decide('allow')}><span>允许</span></button>
      {!local && <button type="button" className="execution-question__option" disabled={locked} onClick={() => void decide('allow-all')}><span>本任务都允许</span></button>}
      <button type="button" className="execution-question__option" disabled={locked} onClick={() => void decide('deny')}><span>拒绝</span></button>
    </div>
    <p className="execution-question__note" role={decided ? 'status' : undefined}>{decided ? '已提交决定，任务继续中…' : onDecide
      ? local ? '允许后在工作副本中运行；结果需另行审阅和交付。拒绝或停止后不启动。'
        : '允许后才会写入，可在文档中撤销；拒绝则文档不变，AI 会收到拒绝。停止任务则这次修改不会执行。' : '当前环境不能提交决定。'}</p>
    {error && <p className="execution-question__error" role="alert">{error}</p>}
  </section>
}
