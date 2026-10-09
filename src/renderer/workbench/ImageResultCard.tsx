import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import { componentDefinitionBuiltinKey, resolveComponentPresentation, type ComponentSurface } from '../../shared/contracts/component-platform/project'
import { readTarget } from '../../core/tools/ToolTargets'
import type { ImageResourceReference } from '../../shared/workbench/images'
import type { ImageApplyCapture, ImageInsertionFrame, ImageResultOwner, ImageResultsDesktopAPI, ImageResultView } from '../../shared/workbench/imageResultsDesktop'
import { workbenchSelection } from './SelectionContextController'
import './imageResultCard.css'

const labels = { preparing: '准备中', running: '图片请求进行中', ready: '已生成，尚未应用', unapplied: '已生成，停止后尚未应用', stopped: '已停止', unknown: '结果未知；不会自动重发', failed: '图片请求失败' }
const billingLabels = { metered: '按量付费', 'token-plan': 'Token Plan', subscription: '订阅', prepaid: '预付费', unknown: '未知' }
function suggestedFrame(surface: ComponentSurface, resource: ImageResourceReference): ImageInsertionFrame {
  const scale = Math.min(480 / resource.width, 320 / resource.height, 1)
  const width = Math.max(1, Math.round(resource.width * scale)), height = Math.max(1, Math.round(resource.height * scale))
  if (surface.kind === 'slide') {
    const canvas = surface.designSize ?? { width: 1280, height: 720 }
    return { x: canvas.width - width - 48, y: canvas.height - height - 48, width, height }
  }
  if (surface.kind === 'flow') return { x: Math.max(0, (surface.flow?.layout.readingWidth ?? 800) - width - 32), y: 320, width, height }
  return { x: (surface.spatial?.home.x ?? 0) + 160, y: (surface.spatial?.home.y ?? 0) + 100, width, height }
}
function parseFrame(values: Record<'x' | 'y' | 'width' | 'height', string>): ImageInsertionFrame | null {
  if (Object.values(values).some(value => !value.trim())) return null
  const frame = { x: Number(values.x), y: Number(values.y), width: Number(values.width), height: Number(values.height) }
  return Object.values(frame).every(Number.isFinite) && frame.width > 0 && frame.height > 0 ? frame : null
}
export function ImageResultCard({ api, owner, documents = window.desktopAPI?.documents }: {
  api: ImageResultsDesktopAPI; owner: ImageResultOwner; documents?: DocumentHostAPI;
}) {
  const [view, setView] = useState<ImageResultView>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [available, setAvailable] = useState<DocumentSnapshot[]>([]), [documentId, setDocumentId] = useState(''), [locationId, setLocationId] = useState('')
  const [resourceId, setResourceId] = useState(''), [preview, setPreview] = useState<string>(), [prompt, setPrompt] = useState('')
  const [frameValues, setFrameValues] = useState({ x: '', y: '', width: '', height: '' })
  const retryApply = useRef<Parameters<ImageResultsDesktopAPI['apply']>[0] | null>(null)
  const retryEdit = useRef<Parameters<ImageResultsDesktopAPI['edit']>[0] | null>(null)
  const previewGeneration = useRef(0)
  const [retryKind, setRetryKind] = useState<'apply' | 'edit' | null>(null)
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  const identity = JSON.stringify(owner)
  useEffect(() => {
    let alive = true
    const refresh = () => { void api.read(owner).then(value => { if (alive) { setView(value); setResourceId(current => value.job.resources.some(item => item.resourceId === current) ? current : value.job.resources[0]?.resourceId ?? '') } }).catch(cause => { if (alive) setError((cause as Error).message) }) }
    const stop = api.subscribe(event => { if (event.job.jobId === owner.jobId && event.conversationId === owner.conversationId && event.workspaceId === owner.workspaceId) refresh() })
    refresh(); return () => { alive = false; stop() }
  }, [api, identity])
  useEffect(() => {
    if (!documents) return
    let alive = true
    void documents.list().then(values => { if (alive) setAvailable(values.filter(value => value.model.kind === 'course-v10')) })
    const stop = documents.subscribe(event => {
      if (event.type === 'closed') setAvailable(values => values.filter(value => value.documentId !== event.documentId))
      else if (event.snapshot.model.kind === 'course-v10') setAvailable(values => [...values.filter(value => value.documentId !== event.snapshot.documentId), event.snapshot])
    })
    return () => { alive = false; stop() }
  }, [documents])
  useEffect(() => { ++previewGeneration.current; setPreview(undefined); return () => { ++previewGeneration.current } }, [resourceId])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const selected = available.find(value => value.documentId === documentId)
  const project = selected?.model.kind === 'course-v10' ? selected.model.project : null
  const surface = project?.surfaces.find(value => value.id === locationId)
  const resource = view?.job.resources.find(value => value.resourceId === resourceId)
  const frame = parseFrame(frameValues)
  useEffect(() => {
    if (!surface || !resource) { setFrameValues({ x: '', y: '', width: '', height: '' }); return }
    const suggested = suggestedFrame(surface, resource)
    setFrameValues(Object.fromEntries(Object.entries(suggested).map(([key, value]) => [key, String(value)])) as typeof frameValues)
  }, [documentId, locationId, resourceId, surface?.id, resource?.width, resource?.height])
  const selection = documentId ? workbenchSelection.getManual(documentId) : null
  const replacementTarget = selection?.targets.length === 1 && selection.targets[0]?.kind === 'course-instance' ? selection.targets[0] : null
  const replacementInstance = project && replacementTarget ? resolveComponentPresentation(project, replacementTarget.surfaceId, replacementTarget.stateId ?? null).instances[replacementTarget.instanceId] : null
  const replacement = replacementTarget && replacementTarget.dataPath === undefined && replacementTarget.from === undefined
    && replacementTarget.to === undefined && replacementTarget.fieldScope !== 'flowLayout' && replacementInstance
    && project && componentDefinitionBuiltinKey(project.definitions[replacementInstance.definitionId]) === 'guoling.image' ? selection : null
  const act = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work() } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } }
  const refresh = async () => setView(await api.read(owner))
  const capture = async (mode: 'insert' | 'replace'): Promise<ImageApplyCapture> => {
    if (!documents || !selected) throw new Error('请明确选择要应用图片的 果铃工程')
    const exact = mode === 'replace' ? structuredClone(workbenchSelection.getManual(documentId)) : null
    const targetSurface = locationId, targetDocument = documentId, targetEpoch = selected.epoch
    const current = await workbenchSelection.prepare(documentId)
    if (current.documentId !== targetDocument || current.epoch !== targetEpoch || current.model.kind !== 'course-v10') throw new Error('目标课件已改变，请重新选择')
    if (mode === 'replace') {
      const address = exact?.targets.length === 1 ? exact.targets[0] : undefined
      if (!address || address.kind !== 'course-instance' || address.dataPath !== undefined || address.from !== undefined
        || address.to !== undefined || address.fieldScope === 'flowLayout' || exact?.epoch !== current.epoch) throw new Error('请在正文中选中一张完整图片')
      readTarget(current.model, address)
      return { documentId: targetDocument, epoch: current.epoch, revision: current.revision,
        address: { kind: 'course-instance', surfaceId: address.surfaceId, instanceId: address.instanceId, stateId: address.stateId ?? null }, label: exact!.label }
    }
    const surface = current.model.project.surfaces.find(value => value.id === targetSurface)
    if (!surface) throw new Error('请选择明确的插入页面')
    return { documentId: targetDocument, epoch: current.epoch, revision: current.revision,
      address: { kind: 'course-surface', surfaceId: surface.id }, label: surface.title || surface.id }
  }
  const apply = async (mode: 'insert' | 'replace') => {
    if (mode === 'insert' && !frame) throw new Error('请设置有效的图片位置与尺寸')
    const target = await capture(mode), input = { ...owner, resourceId, target, actionId: crypto.randomUUID(), ...(mode === 'insert' ? { frame: frame! } : {}) }
    retryApply.current = input; setRetryKind('apply')
    const result = await api.apply(input)
    if (!('revision' in result)) throw new Error(result.message)
    retryApply.current = null; setRetryKind(null); await refresh()
  }
  if (!view) return <section className="image-result-card" aria-label="图片成果"><span>读取图片成果…</span>{error && <p role="alert">{error}</p>}</section>
  const provenance = view.job.provenance, applied = view.applications.filter(value => 'revision' in value.result)
  return <section className="image-result-card" aria-label="图片成果">
    <header><strong>{view.job.operation === 'edit' ? '图片编辑结果' : '图片生成结果'}</strong><span role="status">{applied.length ? '已有正式应用记录' : labels[view.job.status]}</span></header>
    {view.userRequested ? <small>由你发起继续编辑{view.source === 'external-mcp' ? '；原图来自外部 MCP' : ''}。</small> : view.source === 'external-mcp' && <small>来自外部 MCP 工具调用；不代表外部完整历史。</small>}
    <p>实际图片模型：{provenance.actualImageModels?.join('、') || '供应商未报告'}。</p>
    <small>请求图片模型：{provenance.requestedImageModel}；执行路径：ChatGPT OAuth 图片{view.job.operation === 'edit' ? '编辑' : '生成'}接口；账号：{provenance.accountId}。</small>
    <small>配置计费来源：{billingLabels[provenance.billing.kind]}；单次实际费用未知，以账号账单为准。</small>
    {provenance.outputWarnings?.length ? <p role="status">实际图片的尺寸或格式与请求不同，请预览确认后再应用。</p> : null}
    {view.job.retryAt && <p role="status">当前图片作业等待限流冷却，预计 {new Date(view.job.retryAt).toLocaleTimeString()} 后继续；可停止，不会更换模型或账号。</p>}
    {view.job.failure && !view.job.retryAt && <p role="alert">{view.job.failure.message}</p>}
    {['preparing', 'running'].includes(view.job.status) && <button type="button" disabled={busy} onClick={() => void act(async () => setView(await api.stop(owner)))}>停止图片请求</button>}
    {applied.length > 0 && <p>已应用 {applied.length} 次；文件保存状态请查看文档头部。撤销后当前内容以文档为准。</p>}
    {view.job.resources.length > 0 && <>
      {view.job.resources.length > 1 && <label>图片<select value={resourceId} onChange={event => setResourceId(event.target.value)}>{view.job.resources.map((resource, index) => <option key={resource.resourceId} value={resource.resourceId}>图片 {index + 1}（{resource.width}×{resource.height}）</option>)}</select></label>}
      <button type="button" disabled={busy} onClick={() => void act(async () => { const ticket = previewGeneration.current, result = await api.preview({ ...owner, resourceId }); if (ticket === previewGeneration.current) setPreview(URL.createObjectURL(new Blob([Uint8Array.from(result.bytes).buffer], { type: result.mimeType }))) })}>预览图片</button>
      {preview && <img className="image-result-card__preview" src={preview} alt="生成的图片预览" />}
      <label>应用到 果铃工程<select value={documentId} onChange={event => { setDocumentId(event.target.value); setLocationId('') }}><option value="">请选择 果铃工程</option>{available.map(document => <option key={document.documentId} value={document.documentId}>{document.binding.kind === 'untitled' ? document.binding.suggestedName : document.binding.path.split(/[\\/]/).pop()}</option>)}</select></label>
      <label>插入位置<select value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">请选择位置</option>{project?.surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.title || surface.id}</option>)}</select></label>
      {surface && resource && <details className="image-result-card__placement">
        <summary>画布位置与尺寸：{frame ? `X ${frame.x} · Y ${frame.y} · ${frame.width}×${frame.height}` : '请填写有效数值'}</summary>
        <div className="image-result-card__frame-fields">
          {([['x', 'X'], ['y', 'Y'], ['width', '宽'], ['height', '高']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" step="any" min={key === 'width' || key === 'height' ? '0.01' : undefined} value={frameValues[key]} onChange={event => setFrameValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        </div>
        <small>按页面坐标设置；插入后也可选中图片继续移动、缩放。</small>
      </details>}
      <div><button type="button" disabled={busy || !documentId || !locationId || !frame || Boolean(retryKind)} onClick={() => void act(() => apply('insert'))}>插入图片</button>
        <button type="button" disabled={busy || !replacement || Boolean(retryKind)} onClick={() => void act(() => apply('replace'))}>替换选中图片</button></div>
      <small>{replacement ? `替换目标：${replacement.label}` : '替换时请在所选 果铃工程中选中一个图片对象。'}</small>
      <label>继续编辑图片<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述这张图片需要怎样修改" /></label>
      <small>使用当前图片编辑设置发起新请求；保留原图，不自动应用。</small>
      <button type="button" disabled={busy || !prompt.trim() || Boolean(retryKind)} onClick={() => void act(async () => {
        const input = { ...owner, resourceId, actionId: crypto.randomUUID(), prompt }; retryEdit.current = input; setRetryKind('edit')
        await api.edit(input); retryEdit.current = null; setRetryKind(null); setPrompt('')
      })}>发送图片编辑请求</button>
    </>}
    {retryKind && <button type="button" disabled={busy} onClick={() => void act(async () => {
      if (retryKind === 'apply' && retryApply.current) { const result = await api.apply(retryApply.current); if (!('revision' in result)) throw new Error(result.message); await refresh() }
      else if (retryEdit.current) await api.edit(retryEdit.current)
      retryApply.current = null; retryEdit.current = null; setRetryKind(null)
    })}>查询上次操作结果</button>}
    {retryKind && <button type="button" disabled={busy} onClick={() => { retryApply.current = null; retryEdit.current = null; setRetryKind(null) }}>已检查当前结果，重新选择操作</button>}
    <button type="button" disabled={busy} onClick={() => void act(refresh)}>刷新状态</button>
    {error && <p role="alert">{error}</p>}
  </section>
}
