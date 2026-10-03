import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AttachmentSnapshot, InputAttachmentReference } from '../../../shared/workbench/attachments'
import { AttachmentThumbnail } from './AttachmentThumbnail'
import { readAttachmentFile, type IntakeJob } from './attachmentIntake'
import type { AttachmentIntakeFile, AttachmentsDesktopAPI } from '../../../shared/workbench/attachmentsDesktop'

export interface AttachmentComposerProps {
  api?: AttachmentsDesktopAPI
  workspaceDirectory?: string
  value: readonly InputAttachmentReference[]
  onChange(value: InputAttachmentReference[]): void
  disabled?: boolean
  onBusyChange?(busy: boolean): void
  /** A function child receives the add actions for a "+" menu; plain children keep the inline buttons. */
  children?: ReactNode | ((actions: AttachmentActions) => ReactNode)
}
export interface AttachmentActions { addFiles(): void; referenceWorkspace(): void; canAdd: boolean; canReference: boolean }
const references = (snapshot: AttachmentSnapshot): InputAttachmentReference[] => snapshot.representations.map(representation => ({ attachmentId: snapshot.id, representationId: representation.id, role: 'reference', delivery: !snapshot.derivedFrom && representation.kind === 'image' ? 'inline' : 'source' }))
const htmlImage = /<img\b[^>]*\bsrc\s*=\s*(["'])(data:image\/(png|jpeg|webp|gif);base64,([^"']+))\1/gi

function embeddedClipboardImages(html: string): File[] {
  const files: File[] = []
  for (const match of html.matchAll(htmlImage)) {
    const encoded = match[4].replace(/\s/g, '')
    let bytes: Uint8Array<ArrayBuffer>
    try {
      const binary = atob(encoded)
      bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    }
    catch { throw new Error('HTML 中的图片数据无效，请复制图片本身后重试') }
    const kind = match[3].toLowerCase()
    files.push(new File([bytes], `粘贴图片${files.length + 1}.${kind === 'jpeg' ? 'jpg' : kind}`, { type: `image/${kind}` }))
  }
  return files
}

/** Controlled draft references only. Intake, extraction and preview all use the main snapshot owner. */
export function AttachmentComposer({ api = window.desktopAPI?.attachments, value, onChange, disabled = false, onBusyChange, children, workspaceDirectory }: AttachmentComposerProps) {
  const [snapshots, setSnapshots] = useState<Record<string, AttachmentSnapshot>>({})
  const [jobs, setJobs] = useState<IntakeJob[]>([])
  const jobsRef = useRef<IntakeJob[]>([]), pending = useRef(new Map<string, { controller: AbortController; requestId: string }>())
  const [referencing, setReferencing] = useState(false), [workspaceEntries, setWorkspaceEntries] = useState<{ id: string; name: string; kind: 'file' | 'directory' }[]>([]), [workspace, setWorkspace] = useState<{ workspaceId: string; directoryId: string; rootId: string }>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [ranges, setRanges] = useState<Record<string, string>>({})
  const [imageModes, setImageModes] = useState<Record<string, 'auto' | 'all'>>({})
  const [extracting, setExtracting] = useState<{ name: string; loaded: number; total: number } | null>(null)
  const [previewSelection, setPreviewSelection] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ name: string; text?: string; url?: string } | null>(null)
  const current = useRef(value), change = useRef(onChange), live = useRef(true), request = useRef<string | null>(null), previewURL = useRef<string | null>(null), composing = useRef(false)
  current.current = value; change.current = onChange
  useEffect(() => { live.current = true; return () => { live.current = false; if (request.current) void api?.cancel(request.current).catch(() => undefined); for (const pendingJob of pending.current.values()) { pendingJob.controller.abort(); void api?.cancel(pendingJob.requestId).catch(() => undefined) }; const grants = jobsRef.current.flatMap(job => job.authorizationId ? [job.authorizationId] : []); for (let offset = 0; offset < grants.length; offset += 200) void api?.release(grants.slice(offset, offset + 200)).catch(() => undefined); if (previewURL.current) URL.revokeObjectURL(previewURL.current) } }, [api])
  const preparing = jobs.some(job => job.state === 'queued' || job.state === 'reading' || job.state === 'preparing')
  useEffect(() => { onBusyChange?.(busy || preparing) }, [busy, preparing, onBusyChange])
  useEffect(() => {
    if (!api) return
    let active = true
    void Promise.all([...new Set(value.map(ref => ref.attachmentId))].filter(id => !snapshots[id]).map(async id => {
      try { const snapshot = await api.snapshot(id); if (active) setSnapshots(previous => ({ ...previous, [id]: snapshot })) }
      catch (failure) { if (active) setError(failure instanceof Error ? failure.message : '附件快照未能读取') }
    }))
    return () => { active = false }
  }, [api, value, snapshots])
  const apply = (next: InputAttachmentReference[]) => { current.current = next; change.current(next) }
  const append = (snapshot: AttachmentSnapshot) => {
    setSnapshots(previous => ({ ...previous, [snapshot.id]: snapshot }))
    apply([...current.current, ...references(snapshot)])
  }
  const work = async (action: () => Promise<void>) => {
    if (!api || disabled || busy) return
    setBusy(true); setError('')
    try { await action() } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : '附件操作未完成') }
    finally { request.current = null; if (live.current) { setBusy(false); setExtracting(null) } }
  }
  const updateJobs = (update: (jobs: IntakeJob[]) => IntakeJob[]) => { jobsRef.current = update(jobsRef.current); if (live.current) setJobs([...jobsRef.current]) }
  useEffect(() => api?.subscribeProgress?.(({ requestId, loaded, total, unit }) => {
    if (unit === 'pages' && request.current === requestId) { setExtracting(value => value ? { ...value, loaded, total } : value); return }
    const active = [...pending.current.entries()].find(([, operation]) => operation.requestId === requestId)
    if (!active || active[1].controller.signal.aborted) return
    updateJobs(jobs => jobs.map(job => job.id === active[0] && (job.state === 'reading' || job.state === 'preparing')
      ? { ...job, state: total > 0 && loaded >= total ? 'preparing' : 'reading', progress: total > 0 ? Math.min(1, loaded / total) : undefined } : job))
  }), [api])
  const pump = () => {
    if (!api || !live.current) return
    while (pending.current.size < 2) {
      const job = jobsRef.current.find(item => item.state === 'queued')
      if (!job) break
      const controller = new AbortController(), requestId = crypto.randomUUID()
      pending.current.set(job.id, { controller, requestId })
      updateJobs(jobs => jobs.map(item => item.id === job.id ? { ...item, state: 'reading', error: undefined } : item))
      const currentJob = () => pending.current.get(job.id)?.requestId === requestId && !controller.signal.aborted
      void job.run(controller.signal, (loaded, total) => {
        if (currentJob()) updateJobs(jobs => jobs.map(item => item.id === job.id && (item.state === 'reading' || item.state === 'preparing')
          ? { ...item, state: total > 0 && loaded >= total ? 'preparing' : 'reading', progress: total > 0 ? Math.min(1, loaded / total) : undefined } : item))
      }, requestId)
        .then(snapshot => { if (currentJob() && live.current && jobsRef.current.some(item => item.id === job.id)) { append(snapshot); updateJobs(jobs => jobs.filter(item => item.id !== job.id)); if (job.authorizationId) void api.release([job.authorizationId]).catch(() => undefined) } })
        .catch(failure => { if (currentJob()) updateJobs(jobs => jobs.map(item => item.id === job.id ? { ...item, state: 'failed', error: failure instanceof Error ? failure.message : '附件处理失败' } : item)) })
        .finally(() => { if (pending.current.get(job.id)?.requestId === requestId) { pending.current.delete(job.id); updateJobs(jobs => [...jobs]); pump() } })
    }
  }
  const enqueue = (newJobs: IntakeJob[]) => { if (disabled || !api) return; updateJobs(jobs => [...jobs, ...newJobs]); pump() }
  const receive = (files: File[], source: 'paste' | 'drop') => {
    enqueue(files.map(file => ({ id: crypto.randomUUID(), name: file.name || '粘贴图片.png', state: 'queued', run: async (signal, progress, requestId) => {
      const bytes = await readAttachmentFile(file, signal, progress); signal.throwIfAborted()
      return api!.receive({ requestId, name: file.name || '粘贴图片.png', bytes, source, ...(file.type ? { mediaType: file.type } : {}) })
    } })))
  }
  const granted = (files: AttachmentIntakeFile[]) => enqueue(files.map(file => ({ id: crypto.randomUUID(), name: file.name, authorizationId: file.authorizationId, state: 'queued', run: async (signal, _progress, requestId) => {
    signal.throwIfAborted()
    let source = file
    if (!source.authorizationId && source.workspace) source = (await api!.workspaceFiles({ workspaceId: source.workspace.workspaceId, entryIds: [source.workspace.entryId] }))[0]
    if (!source.authorizationId) throw new Error(source.error ?? '附件文件尚未获得读取授权')
    return api!.receiveGranted({ authorizationId: source.authorizationId, requestId })
  } })))
  const stopJob = (job: IntakeJob, remove = false) => {
    const active = pending.current.get(job.id)
    if (active) { pending.current.delete(job.id); active.controller.abort(); void api?.cancel(active.requestId).catch(() => undefined) }
    updateJobs(jobs => remove ? jobs.filter(item => item.id !== job.id) : jobs.map(item => item.id === job.id ? { ...item, state: 'cancelled' } : item))
    if (remove && job.authorizationId) void api?.release([job.authorizationId]).catch(() => undefined)
    pump()
  }
  const listWorkspace = async (workspaceId: string, directoryId: string, rootId: string) => {
    const fileAPI = window.desktopAPI?.workspaceFiles
    if (!fileAPI) throw new Error('资源树文件服务不可用')
    const entries: typeof workspaceEntries = []; let cursor: string | undefined
    do { const page = await fileAPI({ type: 'list', workspaceId, directoryEntryId: directoryId, cursor, limit: 200 }); entries.push(...page.entries.flatMap(entry => entry.status === 'accessible' ? [{ id: entry.entryId, name: entry.name, kind: entry.kind }] : [])); cursor = page.nextCursor } while (cursor)
    if (live.current) { setWorkspace({ workspaceId, directoryId, rootId }); setWorkspaceEntries(entries); setReferencing(true) }
  }
  const startReference = () => work(async () => {
    if (!workspaceDirectory || !window.desktopAPI?.workspaceFiles) throw new Error('请先打开一个工作空间')
    const root = await window.desktopAPI.workspaceFiles({ type: 'root', directory: workspaceDirectory }); await listWorkspace(root.workspaceId, root.rootEntryId, root.rootEntryId)
  })
  const extract = (snapshot: AttachmentSnapshot) => work(async () => {
    const sourceId = snapshot.derivedFrom ?? snapshot.id
    const selectedPages = snapshot.coverage?.selectedPages
    const rawRange = (ranges[sourceId] ?? (selectedPages ? `${selectedPages.from}-${selectedPages.to}` : '')).trim(), match = rawRange.match(/^(\d+)\s*[-–]\s*(\d+)$/)
    if (rawRange && !match) throw new Error('页范围请填写“1-3”，留空提取全文')
    const requestId = crypto.randomUUID(); request.current = requestId
    setExtracting({ name: snapshot.name, loaded: 0, total: 0 })
    const derived = await api!.extract({ attachmentId: sourceId, requestId, images: imageModes[sourceId] ?? snapshot.coverage?.imageMode ?? (snapshot.coverage ? 'all' : 'auto'), ...(match ? { pages: { from: Number(match[1]), to: Number(match[2]) } } : {}) })
    if (!live.current || request.current !== requestId || !current.current.some(ref => ref.attachmentId === snapshot.id)) return
    setSnapshots(previous => ({ ...previous, [derived.id]: derived }))
    if (!derived.representations.length) { setError('所选页面没有可提取的文字或图片；原有材料仍保留，可调整页范围。'); return }
    const selected = current.current.filter(ref => ref.attachmentId === snapshot.id), role = selected[0]?.role
    const delivery: 'source' | 'inline' = selected.every(ref => ref.delivery === 'source') ? 'source' : 'inline'
    apply([...current.current.filter(ref => ref.attachmentId !== snapshot.id), ...references(derived).map(ref => ({ ...ref, delivery, ...(role ? { role } : {}) }))])
  })
  const cancelExtraction = () => {
    const requestId = request.current
    request.current = null
    setExtracting(null)
    if (requestId) void api?.cancel(requestId).catch(() => undefined)
  }
  const showPreview = (snapshot: AttachmentSnapshot) => work(async () => {
    const selected = current.current.filter(ref => ref.attachmentId === snapshot.id)
    const image = snapshot.representations.find(rep => rep.kind === 'image' && selected.some(ref => ref.representationId === rep.id))
    const text = snapshot.representations.find(rep => rep.kind === 'text' && selected.some(ref => ref.representationId === rep.id))
    const representation = snapshot.representations.find(rep => rep.id === previewSelection[snapshot.id] && selected.some(ref => ref.representationId === rep.id)) ?? image ?? text
    if (!representation) { setPreview({ name: snapshot.name, text: '原件已保存。先提取后可预览将要发送的表示。' }); return }
    const read = await api!.readRepresentation(snapshot.id, representation.id)
    if (!live.current) return
    if (previewURL.current) URL.revokeObjectURL(previewURL.current)
    previewURL.current = representation.kind === 'image' ? URL.createObjectURL(new Blob([Uint8Array.from(read.bytes).buffer], { type: representation.mediaType })) : null
    setPreview({ name: snapshot.name, ...(previewURL.current ? { url: previewURL.current } : { text: new TextDecoder().decode(read.bytes).slice(0, 10000) }) })
  })
  return <div className="attachment-composer"
    onCompositionStartCapture={event => { if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute('data-attachment-paste-target')) composing.current = true }}
    onCompositionEndCapture={event => { if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute('data-attachment-paste-target')) composing.current = false }}
    onPaste={event => {
    // Only the conversation input owns attachment paste. Other controls within
    // this composer, and document editors elsewhere, retain their native paste.
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.hasAttribute('data-attachment-paste-target')
      || composing.current || !api || disabled || event.defaultPrevented) return
    const html = event.clipboardData.getData('text/html'), plain = event.clipboardData.getData('text/plain')
    // HTML copied with an image can also carry real paragraph text. Keep the
    // textarea's native text insertion while the image enters attachment intake.
    const preserveHtmlText = Boolean(html && plain)
    const files = event.clipboardData.files.length ? [...event.clipboardData.files]
      : [...event.clipboardData.items].filter(item => item.kind === 'file').flatMap(item => { const file = item.getAsFile(); return file ? [file] : [] })
    if (files.length) { if (!preserveHtmlText) event.preventDefault(); event.stopPropagation(); receive(files, 'paste'); return }
    if (/<img\b/i.test(html)) {
      try {
        const embedded = embeddedClipboardImages(html)
        if (embedded.length) { if (!preserveHtmlText) event.preventDefault(); event.stopPropagation(); receive(embedded, 'paste'); return }
        setError('HTML 图片不含可读取的本地字节，请复制图片本身或保存后添加附件')
      } catch (failure) { event.preventDefault(); setError(failure instanceof Error ? failure.message : 'HTML 图片无法读取'); return }
    }
    // Plain text and HTML text remain native textarea editing. Explorer
    // CF_HDROP normally has neither and uses the controlled clipboard bridge.
    if (plain || html) return
    event.preventDefault(); event.stopPropagation()
    void work(async () => { granted(await api.clipboardFiles({ gestureId: crypto.randomUUID() })) })
  }}
    onDragOver={event => { if ((event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('application/x-guoling-workspace-entries')) && api && !disabled) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } }}
    onDrop={event => {
      if (!api || disabled) return
      const raw = event.dataTransfer.getData('application/x-guoling-workspace-entries')
      if (raw) { event.preventDefault(); event.stopPropagation(); void work(async () => { const data = JSON.parse(raw); if (typeof data.workspaceId !== 'string' || !Array.isArray(data.ids)) throw new Error('资源树引用无效'); granted(await api.workspaceFiles({ workspaceId: data.workspaceId, entryIds: data.ids })) }); return }
      if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); receive([...event.dataTransfer.files], 'drop') }
    }}>
    {typeof children === 'function' ? null : children}
    {typeof children === 'function' ? busy && <div className="attachment-composer__status"><span role="status">正在处理附件… {request.current && <button type="button" onClick={cancelExtraction}>取消</button>}</span></div>
      : <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" disabled={!api || disabled || busy} onClick={() => void work(async () => { granted(await api!.select()) })}>添加附件</button>
      <button type="button" disabled={!api || disabled || busy || !workspaceDirectory} onClick={startReference}>@ 引用空间文件</button>
      <span style={{ fontSize: 12, color: '#64748b' }}>可粘贴或拖入图片、文档；原件只读保存</span>
      {busy && <span role="status">正在处理附件… {request.current && <button type="button" onClick={cancelExtraction}>取消</button>}</span>}
    </div>}
    {preparing && <p role="status">附件正在准备，完成前不能发送；可以取消单项处理。</p>}
    {jobs.map(job => <div key={job.id} aria-label={`附件准备：${job.name}`} style={{ border: '1px solid #cbd5e1', padding: 8, marginTop: 6 }}>
      <strong>{job.name}</strong> · {job.state === 'queued' ? '等待准备' : job.state === 'reading' ? '读取中' : job.state === 'preparing' ? '正在创建快照' : job.state === 'cancelled' ? '已取消，此项不会发送' : '失败，此项不会发送'}
      {(job.state === 'reading' || job.state === 'preparing') && <><progress aria-label={`${job.name}读取进度`} max={1} value={job.progress} />{job.progress !== undefined && <span>{Math.round(job.progress * 100)}%</span>}</>}
      {job.error && <div role="alert">{job.error}</div>}
      {['queued', 'reading', 'preparing'].includes(job.state) ? <button type="button" onClick={() => stopJob(job)}>取消处理</button> : <button type="button" disabled={disabled || pending.current.has(job.id)} onClick={() => { updateJobs(jobs => jobs.map(item => item.id === job.id ? { ...item, state: 'queued', progress: undefined, error: undefined } : item)); pump() }}>重试</button>}
      <button type="button" onClick={() => stopJob(job, true)}>移除失败项</button>
    </div>)}
    {referencing && workspace && <section role="dialog" aria-label="引用空间文件"><button type="button" onClick={() => { void listWorkspace(workspace.workspaceId, workspace.rootId, workspace.rootId).catch(reason => setError(String(reason))) }}>工作空间根目录</button><button type="button" onClick={() => setReferencing(false)}>关闭引用列表</button>
      {workspaceEntries.map(entry => <button type="button" key={entry.id} onClick={() => { void work(async () => { if (entry.kind === 'directory') await listWorkspace(workspace.workspaceId, entry.id, workspace.rootId); else { granted(await api!.workspaceFiles({ workspaceId: workspace.workspaceId, entryIds: [entry.id] })); setReferencing(false) } }) }}>{entry.kind === 'directory' ? '文件夹：' : '引用：'}{entry.name}</button>)}
    </section>}
    {[...new Set(value.map(ref => ref.attachmentId))].map(id => {
      const snapshot = snapshots[id]
      if (!snapshot) return <div key={id}>正在读取附件快照…</div>
      const pending = snapshot.representations.some(rep => rep.kind === 'file')
      const extractable = pending || Boolean(snapshot.derivedFrom && snapshot.coverage)
      const sourceId = snapshot.derivedFrom ?? id
      const selected = value.filter(ref => ref.attachmentId === id)
      const sourceOnly = selected.every(ref => ref.delivery === 'source')
      return <div key={id} style={{ border: '1px solid #cbd5e1', borderRadius: 6, marginTop: 8, padding: 8 }}>
        <AttachmentThumbnail api={api} snapshot={snapshot} /><strong>{snapshot.name}</strong> <span style={{ fontSize: 12 }}>{Math.ceil(snapshot.byteLength / 1024)} KB · {sourceOnly ? '供助手按需读取' : pending ? '原件目录' : `本轮直接发送 · ${selected.length} 个表示`} · 尚未发送</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {!pending && selected.length > 1 && <select aria-label={`${snapshot.name}预览表示`} value={previewSelection[id] ?? snapshot.representations.find(rep => rep.kind === 'image')?.id ?? selected[0].representationId} onChange={event => setPreviewSelection(previous => ({ ...previous, [id]: event.target.value }))}>
            {selected.map(ref => { const rep = snapshot.representations.find(item => item.id === ref.representationId)!; return <option key={ref.representationId} value={ref.representationId}>{rep.provenance.locator?.page ? `第 ${rep.provenance.locator.page} 页 · ` : ''}{rep.kind === 'image' ? '图片' : '文本'} · {rep.provenance.locator?.paragraph ?? ref.representationId}</option> })}
          </select>}
          <button type="button" disabled={busy || disabled} onClick={() => void showPreview(snapshot)}>预览材料内容</button>
          {!pending && <label><input type="checkbox" checked={!sourceOnly} disabled={busy || disabled}
            onChange={event => apply(current.current.map(ref => ref.attachmentId === id ? { ...ref, delivery: event.target.checked ? 'inline' : 'source' } : ref))} />直接发送所选表示到本轮</label>}
          <select aria-label={`${snapshot.name}用途`} disabled={busy || disabled} value={selected[0]?.role ?? 'reference'} onChange={event => apply(current.current.map(ref => ref.attachmentId === id ? { ...ref, role: event.target.value as 'reference' | 'target' } : ref))}>
            <option value="reference">参考资料</option><option value="target">待处理附件</option>
          </select>
          <button type="button" disabled={busy || disabled} onClick={() => apply(current.current.filter(ref => ref.attachmentId !== id))}>移除</button>
          {extractable && <><input aria-label={`${snapshot.name}页范围`} placeholder={/\.docx$/i.test(snapshot.name) ? 'Word 仅支持全文' : '页范围，如 1-3；留空为全部'} disabled={busy || disabled || /\.docx$/i.test(snapshot.name)} value={ranges[sourceId] ?? (snapshot.coverage?.selectedPages ? `${snapshot.coverage.selectedPages.from}-${snapshot.coverage.selectedPages.to}` : '')} onChange={event => setRanges(previous => ({ ...previous, [sourceId]: event.target.value }))} />
            {/\.pdf$/i.test(snapshot.name) && <select aria-label={`${snapshot.name}图片提取方式`} disabled={busy || disabled} value={imageModes[sourceId] ?? snapshot.coverage?.imageMode ?? (snapshot.coverage ? 'all' : 'auto')} onChange={event => setImageModes(previous => ({ ...previous, [sourceId]: event.target.value as 'auto' | 'all' }))}>
              <option value="auto">优先文本，必要时保留页图</option><option value="all">保留全部所选页图</option>
            </select>}
            <button type="button" disabled={busy || disabled} onClick={() => void extract(snapshot)}>{pending ? '提取内容' : '重新提取'}</button></>}
        </div>
        {snapshot.coverage?.selectedPages && <div style={{ fontSize: 12 }}>已选第 {snapshot.coverage.selectedPages.from}–{snapshot.coverage.selectedPages.to} 页，共 {snapshot.coverage.totalPages} 页</div>}
        {snapshot.gaps.map((gap, index) => <div key={index} style={{ fontSize: 12, color: '#92400e' }}>{gap.message}</div>)}
      </div>
    })}
    {typeof children === 'function' && children({ addFiles: () => void work(async () => { granted(await api!.select()) }), referenceWorkspace: () => void startReference(),
      canAdd: Boolean(api) && !disabled && !busy, canReference: Boolean(api) && !disabled && !busy && Boolean(workspaceDirectory) })}
    {extracting && <div role="status">正在提取 {extracting.name}：{extracting.total ? `${extracting.loaded}/${extracting.total} 页已保留` : '读取首批页码…'}
      <button type="button" onClick={cancelExtraction}>取消后续提取</button></div>}
    {error && <div role="alert">{error}</div>}
    {preview && <div role="dialog" aria-label={`附件预览：${preview.name}`} style={{ border: '1px solid #94a3b8', padding: 10, marginTop: 8 }}>
      <strong>{preview.name}</strong><button type="button" onClick={() => { if (previewURL.current) URL.revokeObjectURL(previewURL.current); previewURL.current = null; setPreview(null) }}>关闭预览</button>
      {preview.url ? <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', maxHeight: 300 }} /> : <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{preview.text}</pre>}
      <small>预览来自所选快照表示；文本预览最多显示 10000 字符，不改变实际发送内容。</small>
    </div>}
  </div>
}
