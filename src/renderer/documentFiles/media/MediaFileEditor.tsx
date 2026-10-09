import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import type { FileArtifactBinding, MediaFileDraftInput, MediaFileEditorPort, MediaFileOperation, MediaFileSnapshot, MediaPoint, MediaRectangle } from '../../../shared/workbench/mediaFiles'
import { MediaFileDraft } from './mediaFileDraft'
import { PdfPagePreview } from './PdfPagePreview'
import './mediaFileEditor.css'

export interface MediaFileEditorProps {
  snapshot: MediaFileSnapshot
  port: MediaFileEditorPort
  onSaved?(snapshot: MediaFileSnapshot): void
  /** The tab owner uses this to prevent silently closing unsaved media gestures. */
  onDirtyChange?(dirty: boolean): void
}
export interface MediaFileEditorHandle {
  flush(): Promise<boolean>
  close(): Promise<boolean>
  preserveDraft(): Promise<boolean>
  drain(): Promise<boolean>
  captureCopyDraft(): MediaFileDraftInput
  binding(): FileArtifactBinding
  rebind(binding: FileArtifactBinding): void
  suspendForClose(): void
  resumeAfterCloseCancelled(): void
}
type GestureMode = 'select' | 'crop' | 'rectangle' | 'ink' | 'highlight'
function rectBetween(a: MediaPoint, b: MediaPoint): MediaRectangle {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export const MediaFileEditor = forwardRef<MediaFileEditorHandle, MediaFileEditorProps>(function MediaFileEditor({ snapshot, port, onSaved, onDirtyChange }, ref) {
  const currentPort = useRef(port); currentPort.current = port
  const closeSuspended = useRef(false)
  const draft = useMemo(() => new MediaFileDraft(snapshot, {
    preview: (...args) => currentPort.current.preview(...args), save: (...args) => currentPort.current.save(...args), reload: (...args) => currentPort.current.reload(...args),
  }), [])
  const state = useSyncExternalStore(draft.subscribe, draft.read)
  const [page, setPage] = useState(0)
  const [mode, setMode] = useState<GestureMode>('select')
  const [color, setColor] = useState('#e14747')
  const [points, setPoints] = useState<MediaPoint[]>([])
  const [pdfReady, setPdfReady] = useState(false)
  const gesture = useRef<MediaPoint[]>([])
  const activePointer = useRef<number | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState('')
  const content = state.preview.content
  const lastPage = content.kind === 'pdf' ? content.pages.length - 1 : 0
  const currentPage = Math.min(page, Math.max(0, lastPage))
  const disabled = Boolean(state.busy) || !state.previewReady || !content.editable || content.kind === 'pdf' && !pdfReady
  useEffect(() => () => draft.dispose(), [draft])
  useEffect(() => { draft.rebind(snapshot.binding) }, [draft, snapshot.binding])
  useEffect(() => { onDirtyChange?.(state.operations.length > 0) }, [state.operations.length, onDirtyChange])
  useEffect(() => {
    if (content.kind !== 'image') { setImageUrl(null); return }
    const url = URL.createObjectURL(new Blob([content.bytes.slice().buffer], { type: content.mimeType }))
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [content])
  const apply = (operation: MediaFileOperation) => { if (!closeSuspended.current) { setSavedMessage(''); void draft.apply(operation) } }
  const drain = async () => {
    if (draft.read().busy) await new Promise<void>(resolve => {
      const unsubscribe = draft.subscribe(() => { if (!draft.read().busy) { unsubscribe(); resolve() } })
    })
    return draft.read().previewReady
  }
  const save = async () => {
    if (closeSuspended.current) return false
    if (!await drain()) return false
    if (closeSuspended.current) return false
    if (!draft.read().operations.length) return true
    const saved = await draft.save()
    if (!saved) return false
    setSavedMessage('已保存到原文件，并重新读取确认。'); onSaved?.(saved)
    return true
  }
  useImperativeHandle(ref, () => ({
    flush: save, drain,
    binding: () => draft.read().base.binding,
    rebind: binding => draft.rebind(binding),
    captureCopyDraft: () => {
      if (activePointer.current !== null || gesture.current.length) throw new Error('请完成当前媒体手势后再复制当前稿')
      return draft.captureCopyDraft()
    },
    suspendForClose: () => { closeSuspended.current = true; activePointer.current = null; gesture.current = []; setPoints([]) },
    resumeAfterCloseCancelled: () => { closeSuspended.current = false },
    close: async () => {
      if (!await drain()) return false
      if (draft.read().operations.length && !window.confirm('保存当前文件的编辑后关闭？取消将保留文件标签和草稿。')) return false
      return save()
    },
    preserveDraft: async () => {
      if (!await drain()) return false
      if (!draft.read().operations.length) return true
      setSavedMessage('当前图片或 PDF 编辑尚未保存，请先保存或撤销后再关闭应用。')
      return false
    },
  }))
  const pointAt = (event: PointerEvent<SVGSVGElement>): MediaPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return
    const next = [...gesture.current, pointAt(event)]
    activePointer.current = null; gesture.current = []; setPoints([])
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (disabled || next.length < 2) return
    if (mode === 'ink') {
      apply(content.kind === 'image' ? { type: 'image.ink', points: next, color, strokeWidth: 0.006 }
        : { type: 'pdf.ink', page: currentPage, points: next, color, strokeWidth: 0.006 })
      return
    }
    const rectangle = rectBetween(next[0]!, next.at(-1)!)
    if (rectangle.width < 0.002 || rectangle.height < 0.002) return
    if (content.kind === 'image') apply(mode === 'crop' ? { type: 'image.crop', rectangle } : { type: 'image.rectangle', rectangle, color, strokeWidth: 0.006 })
    else if (mode === 'highlight') apply({ type: 'pdf.highlight', page: currentPage, rectangle, color })
    if (mode === 'crop') setMode('select')
  }
  const pendingRect = points.length ? rectBetween(points[0]!, points.at(-1)!) : null
  const dimensions = content.kind === 'image' ? content : content.pages[currentPage]
  return <section className="media-file-editor" aria-label={content.kind === 'pdf' ? 'PDF 查看与编辑' : '图片查看与编辑'}
    onKeyDown={event => {
      if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).matches('input,textarea')) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); void (event.shiftKey ? draft.redo() : draft.undo()) }
    }}>
    <div className="media-file-editor__toolbar" role="toolbar" aria-label="文件轻编辑">
      <button type="button" disabled={!state.operations.length || state.busy === 'save' || state.busy === 'reload'} onClick={() => void draft.undo()}>撤销</button>
      <button type="button" disabled={!state.redo.length || Boolean(state.busy)} onClick={() => void draft.redo()}>重做</button>
      <button type="button" disabled={!state.operations.length || disabled} onClick={() => void save()}>{state.busy === 'save' ? '保存中…' : '保存'}</button>
      <span className="media-file-editor__divider" />
      <button type="button" aria-pressed={mode === 'select'} onClick={() => setMode('select')}>浏览</button>
      {content.kind === 'image' && <>
        <button type="button" disabled={disabled} aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}>框选裁剪</button>
        <button type="button" disabled={disabled} aria-pressed={mode === 'rectangle'} onClick={() => setMode('rectangle')}>方框标注</button>
      </>}
      {content.kind === 'pdf' && <button type="button" disabled={disabled} aria-pressed={mode === 'highlight'} onClick={() => { setMode('highlight'); setColor('#f5c542') }}>高亮</button>}
      <button type="button" disabled={disabled} aria-pressed={mode === 'ink'} onClick={() => setMode('ink')}>画笔</button>
      <input type="color" aria-label="标注颜色" value={color} onChange={event => setColor(event.target.value)} disabled={disabled} />
      <button type="button" disabled={disabled} onClick={() => apply(content.kind === 'image' ? { type: 'image.rotate', degrees: 90 } : { type: 'pdf.rotate-page', page: currentPage, degrees: 90 })}>顺时针旋转</button>
      <button type="button" disabled={state.busy === 'save'} onClick={() => {
        if (!state.operations.length || window.confirm('放弃尚未保存的编辑，重新读取原文件？')) { void draft.reload(); setSavedMessage('') }
      }}>重新读取</button>
    </div>
    {content.kind === 'pdf' && <div className="media-file-editor__pages" role="toolbar" aria-label="PDF 页操作">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <label>第 <select aria-label="PDF 当前页" value={currentPage} onChange={event => setPage(Number(event.target.value))}>
        {content.pages.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}
      </select> / {content.pages.length} 页</label>
      <button type="button" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button>
      <button type="button" disabled={disabled || currentPage === 0} onClick={() => { apply({ type: 'pdf.move-page', from: currentPage, to: currentPage - 1 }); setPage(currentPage - 1) }}>向前移一页</button>
      <button type="button" disabled={disabled || currentPage >= lastPage} onClick={() => { apply({ type: 'pdf.move-page', from: currentPage, to: currentPage + 1 }); setPage(currentPage + 1) }}>向后移一页</button>
      <button type="button" disabled={disabled || lastPage === 0} onClick={() => apply({ type: 'pdf.delete-page', page: currentPage })}>删除本页</button>
    </div>}
    <p className="media-file-editor__notice">{content.kind === 'image' && !content.editable ? content.editReason
      : '编辑暂存为草稿；保存后写入原文件。撤销仅作用于尚未保存的编辑。'}
      {mode === 'crop' && ' 在图片上拖出要保留的区域。'}{mode === 'ink' && ' 在画面上拖动画笔。'}{mode === 'highlight' && ' 在页面上拖出高亮区域。'}</p>
    {state.error && <p role="alert" className="media-file-editor__error">{state.error} 当前草稿已保留。</p>}
    <div className="media-file-editor__scroll">
      <div className="media-file-editor__page" style={{ aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : undefined,
        maxWidth: content.kind === 'image' ? `${Math.max(200, content.width)}px` : '960px' }}>
        {content.kind === 'image' ? imageUrl && <img src={imageUrl} alt="当前图片" draggable={false} />
          : <PdfPagePreview bytes={content.bytes} page={currentPage} onReady={setPdfReady} />}
        <svg className="media-file-editor__gesture" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="拖动选择编辑区域"
          style={{ pointerEvents: mode === 'select' || disabled ? 'none' : 'auto' }}
          onPointerDown={event => {
            if (disabled || mode === 'select' || event.button !== 0) return
            event.preventDefault(); activePointer.current = event.pointerId; gesture.current = [pointAt(event)]; setPoints(gesture.current)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            if (activePointer.current !== event.pointerId) return
            gesture.current = mode === 'ink' ? [...gesture.current, pointAt(event)] : [gesture.current[0]!, pointAt(event)]
            setPoints(gesture.current)
          }} onPointerUp={finish} onPointerCancel={() => { activePointer.current = null; gesture.current = []; setPoints([]) }}>
          {mode === 'ink' && points.length > 1 ? <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth="0.006" />
            : pendingRect && <rect {...pendingRect} fill={mode === 'highlight' ? color : 'rgba(68,130,245,.12)'} fillOpacity={0.35} stroke={color} strokeWidth="0.003" />}
        </svg>
      </div>
    </div>
    <div role="status" className="media-file-editor__status">{state.busy === 'preview' ? '正在生成编辑预览…' : state.busy === 'reload' ? '正在重新读取…'
      : savedMessage || (state.operations.length ? `${state.operations.length} 项编辑尚未保存` : content.kind === 'image' ? `${content.width} × ${content.height}` : `${content.pages.length} 页`)}</div>
  </section>
})
