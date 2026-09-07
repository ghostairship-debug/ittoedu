import { useEffect, useMemo, useRef, useState } from 'react'
import type { LocalAgentEvent, LocalAgentHostResult, LocalAgentId, LocalAgentRecord } from '../../../shared/localAgentContract'
import type { GenerationCandidate, GenerationRequest } from '../../../shared/generationContract'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import { GENERATION_OPEN } from '../../../shared/generationResult'
import { localAgentText } from '../../../shared/localAgentText'
import { captureGenerationSnapshot, type GenerationReferenceScope } from '../../authoring/generation/generationSnapshot'
import { captureGenerationRepair, generationRepairMadeProgress } from '../../authoring/generation/generationRepair'
import { selectActiveCourseProjectDocument, selectEffectiveLayerProjection, useEditorStore } from '../../store/editorStore'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { SafeChatMessage } from './SafeChatMessage'
import './course-chat.css'

type Preview = Awaited<ReturnType<ReturnType<typeof useEditorStore.getState>['prepareGenerationCandidate']>> & { requestId: string; sessionId: string }
type Turn = { id: string; request: GenerationRequest; events: LocalAgentEvent[]; status: string; result?: unknown }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const eventMessage = (event?: LocalAgentEvent) => event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && typeof event.payload.message === 'string' ? event.payload.message : 'CLI 本轮未完成，请重试或检查本地 CLI。'
const assistantText = (events: LocalAgentEvent[]) => localAgentText(events).split(GENERATION_OPEN)[0]
const recordedReferenceNames = (request: GenerationRequest) => {
  const context = request.context as { pages?: { location?: { label?: string } }[] }
  return Array.isArray(context?.pages) ? context.pages.map(page => page?.location?.label).filter(Boolean).join('、') : ''
}

export function CourseChatPanel({ projectId, projectPath, onClose }: { projectId: string; projectPath: string | null; onClose(): void }) {
  const [adapter, setAdapter] = useState<LocalAgentId>('codex')
  const [scope, setScope] = useState<GenerationReferenceScope>('page')
  const [wholeCourse, setWholeCourse] = useState(false)
  const [teachingPlan, setTeachingPlan] = useState('')
  const [presentationScript, setPresentationScript] = useState('')
  const [planConfirmed, setPlanConfirmed] = useState(false)
  const [scriptConfirmed, setScriptConfirmed] = useState(false)
  const [visibleEvents, setVisibleEvents] = useState(100)
  const [instruction, setInstruction] = useState('')
  const [sessions, setSessions] = useState<LocalAgentRecord[]>([])
  const [sessionId, setSessionId] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [events, setEvents] = useState<LocalAgentEvent[]>([])
  const [materials, setMaterials] = useState<MaterialRecordV1[]>([])
  const [materialIds, setMaterialIds] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [applied, setApplied] = useState<{ revision: number; sessionId: string; result: LocalAgentHostResult } | null>(null)
  const generation = useRef(0)
  const running = useRef<string | null>(null)
  const scroll = useRef<HTMLDivElement | null>(null)
  const followReply = useRef(true)
  useEffect(() => {
    if (followReply.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [events, turns, busy])
  const currentDocument = useEditorStore(selectActiveCourseProjectDocument)
  const authoringSession = useEditorStore(state => state.courseAuthoringSession)
  const revision = currentDocument?.revision
  const referenceName = useMemo(() => {
    if (!currentDocument || !authoringSession) return '当前引用不可用'
    if (wholeCourse || scope === 'course') return `${currentDocument.title} · ${currentDocument.locations.length}个位置`
    const location = currentDocument.locations.find(item => item.id === authoringSession.token.locationId)
    if (!location) return '当前引用不可用'
    const selected = new Set(authoringSession.itemIds)
    const projection = projectEffectiveLayers({ project: currentDocument, locationId: location.id })
    const names = projection.unifiedRows.filter(row => selected.has(row.id)).map(row => row.item.label)
    if (projection.surfaceType === 'flow') names.push(...buildFlowEditorView({ project: currentDocument, locationId: location.id }).blocks.filter(block => selected.has(block.blockId)).map(block => block.label))
    return scope === 'page' && !names.length ? location.label : `${location.label} · ${names.length ? `已选：${names.join('、')}` : '未选择对象'}`
  }, [currentDocument, authoringSession, wholeCourse, scope])
  const api = window.desktopAPI
  const owner = { projectId, projectPath: projectPath ?? '' }
  async function rememberResult(id: string, result: LocalAgentHostResult) {
    setTurns(prior => prior.map(turn => turn.id === id ? { ...turn, result } : turn))
    setSessions(prior => prior.map(record => record.id === id ? { ...record, hostResult: result } : record))
    try { await api!.localAgent({ operation: 'host-result', ...owner, sessionId: id, result }) }
    catch (reason) { setError(`工程操作结果已产生，但会话结果保存失败：${message(reason)}`) }
  }
  useEffect(() => {
    let live = true
    if (projectPath && api) {
      void api.localAgent({ operation: 'list', ...owner }).then(result => { if (live) setSessions(result.records ?? []) }).catch(reason => { if (live) setError(message(reason)) })
      void api.materials({ operation: 'search', ...owner, query: '' }).then(result => { if (live) setMaterials(result) }).catch(reason => { if (live) setError(message(reason)) })
    }
    return () => {
      live = false; generation.current++; useEditorStore.getState().discardGenerationCandidate()
      if (running.current && api) void api.localAgent({ operation: 'cancel', ...owner, sessionId: running.current }).catch(() => {})
    }
  }, [projectId, projectPath])

  useEffect(() => {
    if (!preview || revision === preview.beforeRevision) return
    useEditorStore.getState().discardGenerationCandidate(); setPreview(null)
    void rememberResult(preview.sessionId, { requestId: preview.requestId, candidateId: preview.candidateId, status: 'stale', summary: '工程已改变，已丢弃未应用候选' })
    setNotice('工程已改变，候选已过期；请重新发送。')
  }, [revision, preview])

  async function stop() {
    generation.current++; useEditorStore.getState().stopGenerationCandidate(); setPreview(null)
    if (preview) void rememberResult(preview.sessionId, { requestId: preview.requestId, candidateId: preview.candidateId, status: 'stale', summary: '用户已停止，未应用候选已丢弃' })
    const id = running.current
    running.current = null; setBusy(false); setNotice('已停止；未应用的候选已丢弃')
    if (id) try { await api!.localAgent({ operation: 'cancel', ...owner, sessionId: id }) } catch (reason) { setError(message(reason)) }
  }
  async function send() {
    if (!api || !projectPath || busy || !instruction.trim()) return
    const token = ++generation.current
    setBusy(true); setError(''); setNotice('正在准备本轮引用'); setPreview(null); setEvents([])
    useEditorStore.getState().discardGenerationCandidate()
    let runId: string | undefined
    try {
      const workspace = (await api.localAgent({ operation: 'workspace', ...owner })).workspace
      if (!workspace) throw new Error('当前构建未启用 CLI 创作')
      const selectedMaterials = await Promise.all(materialIds.map(async id => {
        const records = await api.materials({ operation: 'locate', ...owner, id })
        if (!records[0]) throw new Error('引用材料已删除，请重新选择')
        return records[0]
      }))
      const catalog = await api.loadComponentCatalog()
      if (token !== generation.current) return
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)
      const projection = selectEffectiveLayerProjection(state)
      if (!document || !projection || !state.courseAuthoringSession || state.projectPath !== projectPath) throw new Error('工程已改变，请重新发送')
      if (wholeCourse && (!planConfirmed || !scriptConfirmed || !teachingPlan.trim() || !presentationScript.trim())) throw new Error('整课生成前，请分别审阅并确认当前教学策划和呈现脚本')
      let nextRequest = captureGenerationSnapshot({ document, workspace, projection, sessionToken: state.courseAuthoringSession.token,
        selectedIds: state.courseAuthoringSession.itemIds, scope: wholeCourse ? 'course' : scope, instruction,
        purpose: wholeCourse ? 'whole-course' : scope === 'selection' ? 'local-edit' : 'single-page',
        expectedResult: wholeCourse ? 'candidate' : 'auto',
        confirmedDocuments: wholeCourse ? { teachingPlan, presentationScript } : undefined,
        materials: selectedMaterials, componentPackages: state.componentPackages, catalogPackages: catalog.packages, previousResult: turns.at(-1)?.result ?? sessions.find(record => record.id === sessionId)?.hostResult })
      let rejected: GenerationCandidate | undefined
      let resumeId = sessionId
      const isCurrent = () => {
        const current = useEditorStore.getState()
        const active = selectActiveCourseProjectDocument(current)
        return token === generation.current && current.projectPath === projectPath && active?.id === document.id
          && active.revision === nextRequest.documentRevision && current.courseAuthoringSession?.token.generation === nextRequest.sessionGeneration
      }
      for (let attempt = 0; attempt < 2; attempt++) {
      const request = nextRequest
      if (!isCurrent()) throw new Error('stale：工程或会话已改变，请重新发送')
      let repair = false
      const launched = await api.localAgent({ operation: 'generate', ...owner, adapter, request, ...(resumeId ? { resumeSessionId: resumeId } : {}) })
      runId = launched.sessionId
      if (!runId) throw new Error('CLI 没有创建会话')
      if (token !== generation.current) { await api.localAgent({ operation: 'cancel', ...owner, sessionId: runId }); return }
      running.current = runId; setSessionId(runId); setInstruction('')
      setTurns(prior => [...prior, { id: runId!, request, events: [], status: 'running' }])
      let after = 0; const collected: LocalAgentEvent[] = []
      for (;;) {
        const response = await api.localAgent({ operation: 'read', ...owner, sessionId: runId, after })
        if (token !== generation.current) return
        const record = response.records?.[0]
        if (!record) throw new Error('会话记录不可用')
        for (const event of record.events) if (event.sequence > after) { collected.push(event); after = event.sequence }
        setEvents([...collected]); setTurns(prior => prior.map(turn => turn.id === runId ? { ...turn, events: [...collected], status: record.status } : turn))
        const permission = [...collected].reverse().find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && ['permission-denied', 'api-retry'].includes(String(event.payload.status)))
        setNotice(record.status === 'running' ? (permission ? eventMessage(permission) : '正在回复…') : record.status === 'completed' ? '回复完成' : record.status === 'cancelled' ? '已停止' : '本轮未完成')
        // A terminal page may still have more than 200 events to drain.
        if (record.status !== 'running' && record.events.length < 200) {
          setSessions(prior => [...prior.filter(value => value.id !== record.id), { ...record, events: [] }])
          running.current = null
          if (record.status === 'failed') {
            const failure = [...collected].reverse().find(event => event.kind === 'failed')
            setError(eventMessage(failure))
          }
          if (record.status === 'completed') {
            const result = await api.localAgent({ operation: 'candidate', ...owner, sessionId: runId })
            if (token !== generation.current) return
            const outcome = result.generationResult
            if (!outcome || outcome.requestId !== request.requestId) throw new Error('CLI 结果不属于当前请求')
            if (outcome.kind === 'answer') setNotice('回复完成；本轮没有可应用的修改候选。')
            else {
              const candidate = outcome.kind === 'candidate' ? outcome.candidate : undefined
              setNotice('正在校验候选，尚未修改课件')
              try {
                if (!isCurrent()) throw new Error('stale：工程或会话已改变')
                if (outcome.kind === 'candidate-format-error') throw new Error(outcome.finding)
                if (rejected && !generationRepairMadeProgress(rejected, outcome.candidate)) throw new Error('修复候选没有可观察的变化；已停止')
                const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, outcome.candidate)
                if (token !== generation.current) return
                await rememberResult(runId, { requestId: request.requestId, status: 'checked', summary: prepared.summary,
                  candidateId: prepared.candidateId,
                  beforeRevision: prepared.beforeRevision, afterRevision: prepared.afterRevision })
                if (token !== generation.current) return
                setPreview({ ...prepared, requestId: request.requestId, sessionId: runId }); setNotice('候选检查通过，请查看变更后应用')
              } catch (reason) {
                const fresh = isCurrent() && !message(reason).startsWith('stale：')
                await rememberResult(runId, { requestId: request.requestId, ...(candidate ? { candidateId: candidate.candidateId } : {}), status: fresh ? 'rejected' : 'stale', summary: message(reason).slice(0, 4000) })
                if (!fresh || !isCurrent() || attempt === 1) throw reason
                rejected = candidate
                nextRequest = captureGenerationRepair(request, outcome.kind === 'candidate' ? outcome.candidate : outcome, message(reason))
                resumeId = runId; repair = true
                setNotice('候选未通过检查，正在进行唯一一次局部修复')
              }
            }
          }
          break
        }
        if (record.events.length < 200) await new Promise(resolve => setTimeout(resolve, 350))
      }
      if (!repair) break
      }
    } catch (reason) {
      if (runId && running.current === runId) await api.localAgent({ operation: 'cancel', ...owner, sessionId: runId }).catch(() => {})
      if (token === generation.current) setError(message(reason))
    }
    finally { if (token === generation.current) { running.current = null; setBusy(false) } }
  }
  async function selectSession(id: string) {
    generation.current++; useEditorStore.getState().discardGenerationCandidate(); setPreview(null); setEvents([]); setTurns([]); setSessionId(id)
    const record = sessions.find(value => value.id === id)
    if (!record) return
    setAdapter(record.adapter)
    if (record.generationRequest) setTurns([{ id, request: record.generationRequest, events: [], status: record.status, result: record.hostResult }])
    try {
      let after = 0; const replay: LocalAgentEvent[] = []; const token = generation.current
      for (;;) {
        const response = await api!.localAgent({ operation: 'read', ...owner, sessionId: id, after })
        if (token !== generation.current) return
        const page = response.records?.[0]?.events ?? []
        replay.push(...page.filter(event => event.sequence > after)); after = replay.at(-1)?.sequence ?? after
        setEvents([...replay]); if (page.length < 200) break
      }
    } catch (reason) { setError(message(reason)) }
  }
  const text = assistantText(events)
  return <aside className="course-chat" aria-label="CLI 创作助手" data-flow-selection-preserving-target="true">
    <header><strong>创作助手 · 内部试用</strong><button onClick={onClose}>关闭</button></header>
    {!projectPath ? <p>请先保存工程，再开始对话。</p> : <>
      <div className="chat-controls"><label>CLI<select aria-label="CLI" value={adapter} disabled={busy || !!sessionId} onChange={event => setAdapter(event.target.value as LocalAgentId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option></select></label>
        <label>会话<select aria-label="会话" value={sessionId} disabled={busy} onChange={event => void selectSession(event.target.value)}><option value="">新对话</option>{sessions.map(record => <option key={record.id} value={record.id}>{record.adapter} · {record.id.slice(0, 8)} · {record.status}</option>)}{sessionId && !sessions.some(record => record.id === sessionId) && <option value={sessionId}>当前对话</option>}</select></label></div>
      <div className="chat-scroll" ref={scroll} onScroll={event => {
        const element = event.currentTarget
        followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
      }}>
        {turns.map(turn => <details key={turn.id}><summary>你：{turn.request.instruction.slice(0, 60)}</summary><p>{turn.request.instruction}</p><p>引用：{recordedReferenceNames(turn.request)} · revision {turn.request.documentRevision}</p>{turn.id !== sessionId && <SafeChatMessage text={assistantText(turn.events)} />}<pre>{turn.result ? JSON.stringify(turn.result, null, 2) : turn.status}</pre></details>)}
        {text && <SafeChatMessage text={text} />}
        <details><summary>CLI 原生事件（{events.length}）</summary>{events.length > visibleEvents && <button onClick={() => setVisibleEvents(value => value + 100)}>显示更早的事件</button>}<ol>{events.slice(-visibleEvents).map(event => <li key={event.sequence}>#{event.sequence} {event.kind}<pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></details>
        <p role="status">{notice}</p>{error && <p role="alert">{error}</p>}
        {preview && <section aria-label="候选变更预览"><h3>{preview.summary}</h3><p>预期 revision {preview.beforeRevision} → {preview.afterRevision}</p><ul>{preview.plannedEffects.map((effect, i) => <li key={i}>{effect.operation} · {effect.authoringAddress ?? effect.id}</li>)}</ul>
          <dl>{preview.changes.map(change => <div key={change.path}><dt>{change.path}</dt><dd>原：{change.before}</dd><dd>新：{change.after}</dd></div>)}</dl>
          {preview.omitted > 0 && <p>另有 {preview.omitted} 项变更，请展开候选文档查看。</p>}
          <details><summary>查看候选文档</summary><pre>{JSON.stringify(preview.document, null, 2)}</pre></details>
          <button disabled={revision !== preview.beforeRevision || busy} onClick={() => {
            const result = useEditorStore.getState().applyGenerationCandidate(preview.previewId)
            const requestId = preview.requestId
            const recorded = requestId ? { ...result, requestId, candidateId: preview.candidateId, summary: preview.summary } : undefined
            if (recorded) void rememberResult(sessionId, recorded)
            setPreview(null)
            setNotice(result.status === 'committed' ? '宿主已提交，可一次撤销' : '候选已过期，请重新发送')
            if (result.status === 'committed' && recorded) setApplied({ revision: result.afterRevision, sessionId, result: recorded })
          }}>应用候选</button>{revision !== preview.beforeRevision && <p>工程已改变，候选已过期；请重新发送。</p>}</section>}
        {applied !== null && <button disabled={revision !== applied.revision} title={revision !== applied.revision ? '已有后续修改，请使用编辑器正常撤销顺序' : '撤销最近的 AI 事务'} onClick={() => {
          useEditorStore.getState().undo()
          void rememberResult(applied.sessionId, { ...applied.result, status: 'undone', afterRevision: selectActiveCourseProjectDocument(useEditorStore.getState())?.revision })
          setApplied(null); setNotice('已撤销 AI 提交')
        }}>撤销本次 AI 修改</button>}
      </div>
      <form onSubmit={event => { event.preventDefault(); void send() }}>
        <label>本轮引用<select aria-label="本轮引用" value={scope} disabled={busy || wholeCourse} onChange={event => setScope(event.target.value as GenerationReferenceScope)}><option value="page">当前页</option><option value="selection">当前选择</option><option value="course">整课内容</option></select></label><small aria-label="本轮引用摘要">{referenceName} · revision {revision} · 发送时捕获</small>
        <details><summary>从已确认文档生成整课</summary><label><input type="checkbox" disabled={busy} checked={wholeCourse} onChange={event => setWholeCourse(event.target.checked)} />生成包含多个片段的完整课件</label>
          {wholeCourse && <><label>教学策划 Markdown<textarea value={teachingPlan} disabled={busy} onChange={event => { setTeachingPlan(event.target.value); setPlanConfirmed(false) }} /></label><label><input type="checkbox" disabled={busy || !teachingPlan.trim()} checked={planConfirmed} onChange={event => setPlanConfirmed(event.target.checked)} />已审阅并确认当前教学策划</label>
            <label>呈现脚本 Markdown<textarea value={presentationScript} disabled={busy} onChange={event => { setPresentationScript(event.target.value); setScriptConfirmed(false) }} /></label><label><input type="checkbox" disabled={busy || !presentationScript.trim()} checked={scriptConfirmed} onChange={event => setScriptConfirmed(event.target.checked)} />已审阅并确认当前呈现脚本</label><small>整课生成会引用整课内容；编辑文档后须重新确认。</small></>}
        </details>
        {!!materials.length && <details><summary>引用教学材料（{materialIds.length}）</summary>{materials.map(material => <label key={material.id}><input type="checkbox" checked={materialIds.includes(material.id)} disabled={busy} onChange={event => setMaterialIds(prior => event.target.checked ? [...prior, material.id] : prior.filter(id => id !== material.id))} />{material.title}</label>)}</details>}
        <textarea aria-label="发送给创作助手" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="描述要讲解的内容或需要修改的地方…" rows={4} />
        <button type="submit" disabled={busy || !instruction.trim()}>发送</button> <button type="button" disabled={!busy && !preview} onClick={() => void stop()}>停止</button>
      </form>
    </>}
  </aside>
}

export function CourseChatEntry() {
  const [enabled, setEnabled] = useState(false); const [open, setOpen] = useState(false)
  const projectId = useEditorStore(state => selectActiveCourseProjectDocument(state)?.id ?? '')
  const projectPath = useEditorStore(state => state.projectPath)
  useEffect(() => { let live = true; void window.desktopAPI?.localAgent({ operation: 'probe', adapter: 'codex' }).then(result => { if (live) setEnabled(result.enabled) }).catch(() => {}); return () => { live = false } }, [])
  if (!enabled) return null
  return <>{open ? <CourseChatPanel key={`${projectId}:${projectPath}`} projectId={projectId} projectPath={projectPath} onClose={() => setOpen(false)} /> : <button className="course-chat-launch" onClick={() => setOpen(true)}>创作助手</button>}</>
}
