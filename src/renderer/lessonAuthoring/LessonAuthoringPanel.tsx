import { useCallback, useEffect, useRef, useState } from 'react'
import './lessonAuthoringPanel.css'
import type { LessonIdentity } from '../../shared/lessonWorkspace'
import type { LocalAgentId } from '../../shared/localAgentContract'
import type { LessonAuthoringTicket, LessonAuthoringMaterialSelection } from '../../shared/lessonAuthoring'
import type { LessonAuthoringDesktopOperation, LessonAuthoringDesktopResult, LessonAssemblyInput, LessonBuildTarget } from '../../shared/lessonAuthoringDesktop'
const labels = { 'teaching-brief': '教学简报', 'teaching-plan': '教学策划', 'presentation-brief': '呈现简报', 'presentation-script': '呈现脚本', build: '构建课件' }
export interface LessonAuthoringPanelProps {
  lesson: LessonIdentity; conversationId: string; adapter: LocalAgentId; operate: LessonAuthoringDesktopOperation
  materialSelections: LessonAuthoringMaterialSelection[]
  flushDocuments(): Promise<boolean>
  openDocument(relativePath: string): void
  assemble(input: LessonAssemblyInput): Promise<string>
  observeEmptyProject?(): LessonBuildTarget
  continueProjectEditing?(expectedProjectId: string): Promise<void>
  cancelDocumentRepair?(): Promise<void>
  repairDocument?(relativePath: string, instruction: string, ticket: LessonAuthoringTicket): Promise<void>
  onProjectReady?(projectPath: string): void
}
/** Workflow controls consume the sole main-process stage owner. */
export function LessonAuthoringPanel(props: LessonAuthoringPanelProps) {
  const [result, setResult] = useState<LessonAuthoringDesktopResult>(), [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const current = useRef(props); current.current = props
  const generation = useRef(0)
  const assembly = useRef<string | undefined>(undefined)
  const context = useCallback(() => ({ lesson: current.current.lesson, conversationId: current.current.conversationId }), [])
  const receive = useCallback(async (next: LessonAuthoringDesktopResult) => {
    const receivedGeneration = generation.current
    setResult(next)
    if (next.assembly && assembly.current !== next.assembly.ticket.id) {
      assembly.current = next.assembly.ticket.id
      const applicationContext = context()
      let started = false
      try {
        if (!await current.current.flushDocuments()) throw new Error('请先保存当前教学文档')
        if (receivedGeneration !== generation.current) return
        if (next.application !== 'applying') await current.current.operate({ operation: 'begin-application', ...applicationContext, ticketId: next.assembly.ticket.id })
        started = true
        if (receivedGeneration !== generation.current) throw Object.assign(new Error('课例已切换，旧构建未应用'), { hasCommittedChanges: false, failure: { committedStepCount: 0, message: '课例已切换，旧构建未应用' } })
        const projectPath = await current.current.assemble(next.assembly)
        if (receivedGeneration !== generation.current) return
        const accepted = await current.current.operate({ operation: 'accept-build', ...context(), ticketId: next.assembly.ticket.id, projectPath })
        setResult(accepted); if (accepted.projectPath) current.current.onProjectReady?.(accepted.projectPath)
      } catch (cause) {
        if (started) {
          const failed = await current.current.operate({ operation: 'fail-application', ...applicationContext, ticketId: next.assembly.ticket.id, hasCommittedChanges: (cause as { hasCommittedChanges?: boolean }).hasCommittedChanges !== false, failure: (cause as { failure?: LessonAuthoringDesktopResult['failure'] }).failure }).catch(() => undefined)
          if (receivedGeneration === generation.current && failed) setResult(failed)
        }
        if (receivedGeneration === generation.current) setError((cause as Error).message)
      }
    }
  }, [context])
  useEffect(() => {
    let disposed = false; generation.current++; assembly.current = undefined
    setResult(undefined); setError(''); setBusy(false)
    const read = async () => { try { const value = await current.current.operate({ operation: 'read', ...context() }); if (!disposed) await receive(value) } catch (cause) { if (!disposed) setError((cause as Error).message) } }
    void read(); return () => { disposed = true }
  }, [props.lesson.lessonId, props.lesson.normalizedDirectory, props.conversationId, context, receive])
  useEffect(() => {
    if (result?.run?.status !== 'running' && !result?.repairTicket) return
    let disposed = false
    const timer = setTimeout(async () => { try { const value = await current.current.operate({ operation: result?.repairTicket ? 'read' : 'poll', ...context() }); if (!disposed) await receive(value) } catch (cause) { if (!disposed) setError((cause as Error).message) } }, 1000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [result, context, receive])
  const act = async (action: () => Promise<LessonAuthoringDesktopResult>) => { const activeGeneration = generation.current; setBusy(true); setError(''); try { const value = await action(); if (activeGeneration === generation.current) await receive(value) } catch (cause) { if (activeGeneration === generation.current) { setError((cause as Error).message); try { setResult(await props.operate({ operation: 'read', ...context() })) } catch {} } } finally { if (activeGeneration === generation.current) setBusy(false) } }
  const active = result?.run?.status === 'running' || !!result?.repairTicket
  const stage = result?.view.currentStage
  const document = result?.view.documents.find(item => item.role === stage)
  return <section className="lesson-authoring-panel" aria-label="课例创作流程" style={{ borderBottom: '1px solid var(--border)', padding: 12, display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', gap: 8 }}>
      <button disabled={busy || active} aria-pressed={result?.view.state.mode === 'manual'} onClick={() => void act(() => props.operate({ operation: 'set-mode', ...context(), mode: 'manual', materials: props.materialSelections }))}>手动分阶段</button>
      <button disabled={busy || active} aria-pressed={result?.view.state.mode === 'automatic'} onClick={() => void act(() => props.operate({ operation: 'set-mode', ...context(), mode: 'automatic', materials: props.materialSelections }))}>根据材料自动创作</button>
    </div>
    <div>当前阶段：{stage ? labels[stage] : '读取中'}</div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{result?.view.documents.map(item => <button key={item.role} onClick={() => props.openDocument(item.relativePath)}>{labels[item.role]} · {item.status === 'confirmed' ? '已确认' : item.status === 'review' ? '待复核' : '查看当前稿'}</button>)}</div>
    <textarea aria-label="课例创作目标" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="说明教学主题、学生情况和希望达成的目标" rows={2} />
    <div style={{ display: 'flex', gap: 8 }}>
      <button disabled={busy || active || !!result?.application || !instruction.trim()} onClick={() => void act(async () => { if (!await props.flushDocuments()) throw new Error('请先保存当前文档'); return props.operate({ operation: 'start', ...context(), adapter: props.adapter, instruction }) })}>{stage === 'build' ? '构建课件' : '生成当前阶段'}</button>
      {result?.view.state.mode === 'manual' && document && <button disabled={busy || active} onClick={() => void act(async () => { if (!await props.flushDocuments()) throw new Error('请先保存当前文档'); return props.operate({ operation: 'confirm', ...context(), role: document.role, expectedVersion: document.version }) })}>确认已查看的当前稿</button>}
      {stage && stage !== 'build' && result?.run && props.repairDocument && <button disabled={busy || active || !instruction.trim()} onClick={() => void act(async () => {
        if (!await props.flushDocuments()) throw new Error('请先处理当前文档恢复稿')
        const begun = await props.operate({ operation: 'begin-document-repair', ...context(), role: stage })
        const paths = { 'teaching-brief': 'teaching-brief.md', 'teaching-plan': '01-teaching-plan.md', 'presentation-brief': 'presentation-brief.md', 'presentation-script': '02-presentation-script.md' }
        await props.repairDocument!(document?.relativePath ?? paths[stage], instruction, begun.repairTicket!)
        return props.operate({ operation: 'read', ...context() })
      })}>修复当前阶段文档</button>}
      {stage === 'build' && result?.run?.status === 'ready-to-build' && !result.assembly && (!result.application || result.application === 'has-changes' && result.failure?.committedStepCount === 0 && !!result.failure.target) && <button disabled={busy} onClick={() => void act(() => props.operate({ operation: 'reprepare-existing-build', ...context() }))}>按当前稿重新准备原构建</button>}
      {result?.application === 'has-changes' && result.failure?.committedStepCount === 0 && result.failure.target && <button disabled={busy || active} onClick={() => void act(async () => { assembly.current = undefined; const currentTarget = props.observeEmptyProject?.(); if (!currentTarget || JSON.stringify(currentTarget) !== JSON.stringify(result.failure!.target)) throw new Error('当前工程目标已变化，请继续编辑当前工程'); return props.operate({ operation: 'continue-application', ...context(), ticketId: result.run!.ticketId, currentTarget }) })}>修正模块后继续当前构建</button>}
      {result?.application === 'retryable' && <button disabled={busy || active} onClick={() => void act(async () => { assembly.current = undefined; return props.operate({ operation: 'begin-application', ...context(), ticketId: result.run!.ticketId, ...(result.repairTarget ? { currentTarget: props.observeEmptyProject?.() } : {}) }) })}>重试当前构建</button>}
      {result?.run?.stage === 'build' && result.run.status !== 'completed' && result.failure?.committedStepCount === 0 && result.failure.message && props.observeEmptyProject && <button disabled={busy || active || !instruction.trim()} onClick={() => void act(async () => {
        if (!await props.flushDocuments()) throw new Error('请先保存当前教学文档')
        return props.operate({ operation: 'repair-build', ...context(), ticketId: result.run!.ticketId, instruction, currentTarget: props.observeEmptyProject!() })
      })}>请助手修复当前构建</button>}
      {result?.application === 'has-changes' && (result.failure?.committedStepCount ?? 0) > 0 && result.failure?.target && props.continueProjectEditing && <button disabled={busy || active} onClick={() => void act(async () => {
        await props.continueProjectEditing!(result.failure!.target!.projectId)
        return props.operate({ operation: 'read', ...context() })
      })}>保存并继续编辑当前课件</button>}
      {result?.repairTicket && props.cancelDocumentRepair && <button onClick={() => void act(async () => {
        await props.cancelDocumentRepair!()
        return props.operate({ operation: 'cancel-document-repair', ...context(), ticketId: result.repairTicket!.id })
      })}>停止文档修复</button>}
      {result?.run?.status === 'running' && <button onClick={() => void act(() => props.operate({ operation: 'stop', ...context() }))}>停止</button>}
    </div>
    {result?.run && <div role="status">{result.run.message}</div>}
    {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
  </section>
}
