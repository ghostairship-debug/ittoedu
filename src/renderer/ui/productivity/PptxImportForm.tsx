import { useRef, useState } from 'react'
import type { ProductivityContext } from '../../authoring/productivity'
import type { EditorTransactionStep } from '../../authoring/editorTransaction'
import { parsePptxImport, type PptxImportDraft } from '../../project/pptxImport'
import { PPTX_IMPORT_LIMITS } from '../../project/pptxPackage'
import { planPptxImportTransaction } from '../../project/pptxImportTransaction'
import type { ProductivityDialogProps } from './ProductivityDialog'

export function PptxImportForm({ getContext, onCommit, onClose }: ProductivityDialogProps) {
  const [preview, setPreview] = useState<{ context: ProductivityContext; draft: PptxImportDraft; name: string; step: EditorTransactionStep } | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const sequence = useRef(0)
  const read = async (file: File) => {
    const request = ++sequence.current
    setPreview(null); setMessage(''); setBusy(true)
    try {
      if (file.size > PPTX_IMPORT_LIMITS.fileBytes) throw new Error('PPTX 不能超过 32 MiB')
      const context = getContext()
      const draft = await parsePptxImport(new Uint8Array(await file.arrayBuffer()))
      const name = file.name.replace(/\.pptx$/i, '')
      const step = planPptxImportTransaction(context.document, draft, name)
      if (sequence.current === request) setPreview({ context, draft, name, step })
    } catch (error) { if (sequence.current === request) setMessage(error instanceof Error ? error.message : 'PPTX 无法导入') }
    finally { if (sequence.current === request) setBusy(false) }
  }
  const commit = () => {
    if (!preview) return
    try {
      const live = getContext(), captured = preview.context
      if (live.document.id !== captured.document.id || live.document.revision !== captured.document.revision || live.sessionToken.generation !== captured.sessionToken.generation || live.sessionToken.locationId !== captured.sessionToken.locationId) throw new Error('工程已变化，请重新选择文件并预览')
      if (onCommit(preview.step)) onClose()
      else setMessage('导入未提交，请重新选择文件并预览')
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入未提交') }
  }
  return <div>
    <p>导入为新的可编辑演示表面。支持明确字号的普通文字、基础形状和内嵌 PNG / JPEG；占位符、分组、图表、表格、动画和复杂效果需先在 PowerPoint 中转换。不支持项会按页报告，整包不写入。</p>
    <label>选择 PPTX <input type="file" accept=".pptx" aria-label="选择 PPTX" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = '' }} /></label>
    {busy && <p role="status">正在检查页面与素材…</p>}
    {preview && <div><h3>{preview.name}：{preview.draft.slides.length} 页，{preview.draft.assets.length} 个素材</h3>
      <ul>{preview.draft.slides.map((slide, index) => <li key={index}>{index + 1}. {slide.title} · {slide.items.length} 个可编辑对象</li>)}</ul>
      <ul>{preview.draft.notes.map(note => <li key={note}>{note}</li>)}</ul>
      <button type="button" onClick={commit}>确认导入全部页面</button>
    </div>}
    {message && <p role="alert" style={{ whiteSpace: 'pre-wrap' }}>{message}</p>}
  </div>
}
