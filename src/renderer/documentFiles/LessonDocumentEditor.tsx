import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document/SharedDocumentEditor'
import { parseDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentFileRef } from '../../shared/document/ports'
import { DocumentFileSession, type RecoverableDocumentFilePort } from './documentFileSession'
import { mergedDocumentSource, planDocumentSourceMerge, type DocumentConflictHunk } from './documentSourceMerge'
import './documentFileEditor.css'
import { fileClipboardResourcePort, readFileClipboardContext, selectedFileClipboardContext, type FileClipboardContext } from './fileDocumentClipboard'
import type { FilePreparedDocumentResources } from '../document/fileDocumentResources'
import type { DocumentBlock } from '../../shared/document/content'
import { resolveFileDocumentImage } from '../../shared/document/fileImageReference'

export interface LessonDocumentEditorHandle {
  session: DocumentFileSession
  flush(): Promise<boolean>
  close(): Promise<boolean>
  preserveAndClose(): Promise<boolean>
}
export interface LessonDocumentEditorProps {
  documentRef: DocumentFileRef
  port: RecoverableDocumentFilePort
  onDirtyChange?(dirty: boolean): void
  onClosed?(): void
}
const empty: MarkdownDocument = { content: { blocks: [] }, resources: { assets: [], components: [] } }
function AiSuggestion({ suggestion, source, session }: { suggestion: ReturnType<DocumentFileSession['getSnapshot']>['aiSuggestions'][number]; source: string; session: DocumentFileSession }) {
  const plan = useMemo(() => planDocumentSourceMerge(suggestion.baseSource, source, suggestion.baseSource.slice(0, suggestion.edit.from) + suggestion.edit.after + suggestion.baseSource.slice(suggestion.edit.to)), [suggestion, source])
  const [choices, setChoices] = useState<Record<string, string>>({})
  useEffect(() => setChoices({}), [source])
  return <fieldset><legend>AI 冲突建议</legend><p>教师当前修改已保留；逐处选择或编辑合并内容。</p>
    {plan.conflicts.map(hunk => <div key={hunk.id}><strong>当前稿</strong><pre>{hunk.local}</pre><strong>AI 建议</strong><pre>{hunk.remote}</pre>
      <textarea aria-label="AI 建议合并内容" value={choices[hunk.id] ?? hunk.local} onChange={event => setChoices(current => ({ ...current, [hunk.id]: event.target.value }))} />
      <button onClick={() => setChoices(current => ({ ...current, [hunk.id]: hunk.remote }))}>此处采用 AI 建议</button></div>)}
    {!plan.conflicts.length && <pre>{suggestion.edit.after}</pre>}
    <button onClick={() => { const next = { ...plan, conflicts: plan.conflicts.map(hunk => ({ ...hunk, resolution: choices[hunk.id] ?? hunk.local })) }; void session.applyAiSuggestion(suggestion.id, source, mergedDocumentSource(next)) }}>保存此处合并</button>
    <button onClick={() => session.dismissAiSuggestion(suggestion.id)}>保留当前稿并关闭建议</button>
  </fieldset>
}
function ConflictHunk({ hunk, index, session }: { hunk: DocumentConflictHunk; index: number; session: DocumentFileSession }) {
  const [merged, setMerged] = useState(hunk.local)
  return <fieldset className="document-conflict-hunk"><legend>冲突 {index + 1}</legend>
    <p>其余不冲突的修改已保留，只选择这一处。</p>
    <div className="document-conflict-alternatives"><div><strong>当前稿</strong><pre>{hunk.contextBefore}<mark>{hunk.local || '（删除）'}</mark>{hunk.contextAfter}</pre><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'local') }}>此处保留当前稿</button></div>
      <div><strong>磁盘稿</strong><pre>{hunk.contextBefore}<mark>{hunk.remote || '（删除）'}</mark>{hunk.contextAfter}</pre><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'remote') }}>此处采用磁盘稿</button></div></div>
    <details><summary>手动合并这一处</summary><label>合并内容<textarea value={merged} onChange={event => setMerged(event.target.value)} /></label><button type="button" onClick={() => { void session.resolveConflictHunk(hunk.id, 'local', merged) }}>应用这一处合并</button></details>
  </fieldset>
}

export const LessonDocumentEditor = forwardRef<LessonDocumentEditorHandle, LessonDocumentEditorProps>(function LessonDocumentEditor({ documentRef, port, onDirtyChange, onClosed }, ref) {
  const identity = JSON.stringify(documentRef)
  const session = useMemo(() => new DocumentFileSession(documentRef, port), [identity, port])
  const lifetime = useMemo(() => ({ leases: 0, opened: false }), [session])
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const editor = useRef<SharedDocumentEditorHandle>(null)
  const [error, setError] = useState<string | null>(null)
  const [document, setDocument] = useState<MarkdownDocument>(empty)
  const [clipboard, setClipboard] = useState<FileClipboardContext | null>(null)
  const operationGroup = useRef<string | undefined>(undefined)
  const draftTicket = useRef(0)
  const resolveImage = (href: string) => resolveFileDocumentImage(documentRef.relativePath, href)
  const parsedSource = useMemo(() => parseDocumentMarkdown(state.source, { createId: () => crypto.randomUUID(), target: 'file', resolveImage }), [state.source])
  useEffect(() => {
    lifetime.leases++
    if (!lifetime.opened) {
      lifetime.opened = true
      void session.open().catch(reason => { if (lifetime.leases) setError((reason as Error).message) })
    }
    // StrictMode immediately replays setup. Retain the live session for that replay;
    // a real unmount or identity change releases this specific session permanently.
    return () => { lifetime.leases--; queueMicrotask(() => { if (!lifetime.leases) session.dispose() }) }
  }, [session, lifetime])
  useEffect(() => { onDirtyChange?.(state.dirty) }, [state.dirty, onDirtyChange])
  useEffect(() => {
    if (parsedSource.status === 'valid') setDocument(parsedSource.document)
  }, [parsedSource])
  const resourceKey = JSON.stringify(document.resources)
  useEffect(() => {
    let live = true; setClipboard(null)
    void readFileClipboardContext(document.resources, relativePath => session.readResource(relativePath)).then(context => { if (live) setClipboard(context) }).catch(reason => { if (live) setError((reason as Error).message) })
    return () => { live = false }
  }, [session, resourceKey, state.disk?.version.contentVersion])
  async function flush() {
    const current = editor.current?.flush()
    if (current && !current.ready) return false
    if (current) session.edit(current.source, operationGroup.current)
    return session.flush()
  }
  function renderObject(block: DocumentBlock, container: HTMLElement) {
    const assetId = block.type === 'media' ? block.assetId : block.type === 'component' ? block.staticFallbackAssetId : null
    const asset = assetId ? clipboard?.assets[assetId] : null
    if (!asset) { container.textContent = block.type === 'chart' ? `图表：${block.chart.title ?? ''}` : '正在读取图示'; return }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(asset.bytes)], { type: asset.meta.mimeType }))
    const element = asset.meta.kind === 'audio' ? window.document.createElement('audio') : asset.meta.kind === 'video' ? window.document.createElement('video') : window.document.createElement('img')
    element.src = url; element.style.maxWidth = '100%'; element.style.maxHeight = '440px'
    if (element instanceof HTMLImageElement) element.alt = block.type === 'media' ? block.altText ?? asset.meta.filename : '互动组件静态图示'
    else element.controls = true
    container.append(element)
    return () => URL.revokeObjectURL(url)
  }
  useImperativeHandle(ref, () => ({ session, flush, close: async () => (await flush()) && session.close(), preserveAndClose: () => session.preserveAndClose() }))
  const status = state.saving ? '正在保存' : state.conflict ? '存在文件冲突' : state.dirty ? '尚未保存' : '已保存'
  return <section aria-label={`教学文档 ${documentRef.relativePath}`} onCompositionStartCapture={() => session.setComposing(true)} onCompositionEndCapture={() => { queueMicrotask(() => session.setComposing(false)) }} onKeyDownCapture={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void flush() }
  }}>
    <header><strong>{documentRef.relativePath}</strong> <span role="status">{status}</span> <button type="button" disabled={state.composing || Boolean(state.conflict) || state.recovery} onClick={() => { void flush() }}>保存</button></header>
    {(error || state.error) && <div role="alert">{error ?? state.error}<button type="button" onClick={() => { void flush() }}>重试保存</button>{onClosed && <button type="button" onClick={() => { void session.preserveAndClose().then(closed => { if (closed) onClosed() }) }}>保留恢复稿后关闭</button>}</div>}
    {state.recovery && <aside role="alert">已找到未保存恢复稿，请比较后继续。{state.conflictHunks.length ? <span>请逐处处理下方冲突。</span> : <button type="button" onClick={() => { void session.resolveConflict('recovery') }}>保留恢复稿并保存</button>}</aside>}
    {state.conflict && <aside role="alert">
      <p>{state.conflict === 'deleted' ? '磁盘文档已删除，当前稿已保留。' : '磁盘稿与当前稿在同一处有修改，请比较后选择。'}</p>
      {state.conflictHunks.map((hunk, index) => <ConflictHunk key={hunk.id} hunk={hunk} index={index} session={session} />)}
      {!state.conflictHunks.length && <>{state.conflict !== 'deleted' && <><details><summary>查看磁盘稿</summary><pre>{state.conflict.source}</pre></details><button type="button" onClick={() => { void session.resolveConflict('disk') }}>采用磁盘稿</button></>}
      <button type="button" onClick={() => { void session.resolveConflict('local') }}>{state.conflict === 'deleted' ? '重新保存当前稿' : '保留当前稿并保存'}</button></>}
    </aside>}
    {state.disk && <div inert={state.conflictHunks.length > 0}><SharedDocumentEditor ref={editor} document={document} revision={state.source} sourceDraft={state.source} target="file" initialMode={parsedSource.status === 'valid' ? 'layout' : 'source'} resolveImage={resolveImage}
      clipboardContext={(resources: MarkdownDocument['resources']) => selectedFileClipboardContext(clipboard, resources)} clipboardResourcePort={fileClipboardResourcePort}
      renderObject={renderObject} objectRevision={clipboard}
      onDraft={source => { const ticket = ++draftTicket.current; queueMicrotask(() => { if (ticket === draftTicket.current) session.edit(source, operationGroup.current) }) }}
      onChange={(next, operation) => {
        if (operation.preparedResources) session.prepareAttachments((operation.preparedResources as FilePreparedDocumentResources).attachments)
        operationGroup.current = operation.historyGroup; setDocument(next); return true
      }} onUndo={() => session.undo()} onRedo={() => session.redo()} /></div>}
    {state.aiSuggestions.map(suggestion => <AiSuggestion key={suggestion.id} suggestion={suggestion} source={state.source} session={session} />)}
    {state.aiMessage && <p role="status">{state.aiMessage}</p>}
    {state.aiRecords.length > 0 && <aside aria-label="AI 改动记录">{state.aiRecords.map(record => <div key={record.id}><span>AI 修改了 {record.applied.length} 处</span><details><summary>查看改动</summary>{record.applied.map((edit, index) => <div key={index}><del>{edit.before}</del><ins>{edit.after}</ins></div>)}</details><button type="button" onClick={() => { void session.revertAiEdit(record) }}>撤回本次 AI 修改</button></div>)}<button type="button" onClick={() => session.clearAiMarkers()}>清除改动标记</button></aside>}
  </section>
})
