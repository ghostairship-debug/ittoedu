import { useState } from 'react'
import type { ComponentEdit, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { DocumentSelection } from '../../../shared/document/ports'
import { courseInstanceSlotPath } from '../../../core/tools/ToolTargets'
import { componentTextInteractionEdits, type ComponentTextInteractionIntent, type ComponentTextSelection } from '../../../core/course/componentTextInteractionEdits'
import { documentTextAt, documentTextRanges } from '../../../shared/document/textInteraction'
import { componentDataEdits } from '../../../core/course/componentDataEdits'
import { popoverDataSchema } from '../../../components/popover'

export function FlowTextInteractionActions(props: { project: CourseProjectV10; surfaceId: string; selection: DocumentSelection | null; drain(): Promise<{ ok: boolean; reason?: string }>; commit(edits: ComponentEdit[], revision: number): Promise<unknown>; select(instanceId: string): void; report(message: string): void }) {
  const [note, setNote] = useState(''), [answers, setAnswers] = useState(''), [busy, setBusy] = useState(false)
  const selection = props.selection
  let target: ComponentTextSelection | undefined
  try {
    if (selection?.kind === 'text' && selection.anchor.blockId === selection.head.blockId && JSON.stringify(selection.anchor.slot) === JSON.stringify(selection.head.slot)) {
      const owner = props.project.instances[selection.anchor.blockId]
      const path = courseInstanceSlotPath(owner?.data, selection.anchor.slot)
      if (documentTextAt(owner?.data, path)) target = { surfaceId: props.surfaceId, instanceId: owner.id, dataPath: path, from: Math.min(selection.anchor.offset, selection.head.offset), to: Math.max(selection.anchor.offset, selection.head.offset) }
    }
  } catch { /* The next selection reports a current professional slot. */ }
  const run = async (prepare: () => ComponentEdit[]) => {
    if (!target || busy) return
    setBusy(true)
    try { const ready = await props.drain(); if (!ready.ok) throw new Error(ready.reason); await props.commit(prepare(), props.project.revision) }
    catch (error) { props.report(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const insert = (intent: ComponentTextInteractionIntent) => run(() => componentTextInteractionEdits(props.project, target!, intent).edits)
  const attached = target ? Object.values(props.project.instances).filter(instance => instance.attachments?.some(attachment => attachment.target.kind === 'text-range' && attachment.target.instanceId === target!.instanceId && JSON.stringify(attachment.target.dataPath) === JSON.stringify(target!.dataPath) && (() => {
    const range = documentTextRanges(documentTextAt(props.project.instances[target!.instanceId].data, target!.dataPath)!).get(attachment.target.rangeId)
    return range && target!.from <= range.to && target!.to >= range.from
  })())) : []
  return <details className="flow-text-interactions"><summary aria-label="正文互动" onMouseDown={event => event.preventDefault()}>正文互动</summary>
    <div role="group" aria-label="正文范围互动" style={{ minWidth: 240, padding: 8, display: 'grid', gap: 8 }}>
      {!target ? <span>在同一段正文中选中文字或放置光标。</span> : <>
        <label>注释内容<textarea aria-label="注释内容" value={note} onChange={event => setNote(event.target.value)} /></label>
        <button type="button" disabled={busy || !note.trim() || target.from === target.to} onClick={() => void insert({ kind: 'annotation', content: note })}>添加范围注释</button>
        <label>可接受答案（每行一个）<textarea aria-label="填空可接受答案" value={answers} onChange={event => setAnswers(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => void insert({ kind: 'input', acceptedAnswers: answers.split('\n').filter(Boolean) })}>插入行内填空</button>
        {attached.map(instance => { const data = popoverDataSchema.parse(instance.data); return <label key={instance.id}>已有注释<textarea aria-label="编辑范围注释" defaultValue={data.content} onBlur={event => void run(() => componentDataEdits(props.project, { surfaceId: props.surfaceId, instanceId: instance.id }, { kind: 'patch', data: { content: event.target.value } }))} /></label> })}
        {(props.project.instances[target.instanceId]?.childIds ?? []).filter(id => props.project.instances[id]?.definitionId === 'guoling.input').map(id => <button key={id} type="button" onClick={() => props.select(id)}>编辑填空内容与反馈</button>)}
      </>}
    </div>
  </details>
}
