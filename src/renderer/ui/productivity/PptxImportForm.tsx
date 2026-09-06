import { useRef, useState } from 'react'
import type { ProductivityContext } from '../../authoring/productivity'
import type { EditorTransactionStep } from '../../authoring/editorTransaction'
import { parsePptxImport, type PptxImportDraft } from '../../project/pptxImport'
import { PPTX_IMPORT_LIMITS } from '../../project/pptxPackage'
import { planPptxImportTransaction } from '../../project/pptxImportTransaction'
import type { ProductivityDialogProps } from './ProductivityDialog'

const issueLabels: Record<string, string> = { graphicFrame: '表格、图表等图形对象', grpSp: '分组对象', cxnSp: '连接线', AlternateContent: '替代格式内容', oleObj: '嵌入文档', videoFile: '视频', audioFile: '音频', custGeom: '自定义形状', gradFill: '渐变填充', pattFill: '图案填充' }

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
    <p>导入为新的可编辑演示表面。支持明确字号的普通文字、基础形状和内嵌 PNG / JPEG。无法转换的对象会跳过，动画、超链接和部分视觉效果会省略；请查看下方清单，再确认导入保留的内容。原 PPTX 不会被修改。</p>
    <label>选择 PPTX <input type="file" accept=".pptx" aria-label="选择 PPTX" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = '' }} /></label>
    {busy && <p role="status">正在检查页面与素材…</p>}
    {preview && <div><h3>{preview.name}：{preview.draft.slides.length} 页，{preview.draft.assets.length} 个素材</h3>
      <ul>{preview.draft.slides.map((slide, index) => <li key={index}>{index + 1}. {slide.title} · {slide.items.length} 个可编辑对象</li>)}</ul>
      <ul>{preview.draft.notes.map(note => <li key={note}>{note}</li>)}</ul>
      {!!preview.draft.issues.length && <section aria-label="PPTX 导入提示"><h4>部分内容未保留（{preview.draft.issues.length} 项）</h4>
        <ul>{preview.draft.issues.map((issue, index) => <li key={index}>第 {issue.page} 页：{issueLabels[issue.type] ?? issue.type} — {issue.message}</li>)}</ul>
        <p>不支持的内容可先在 PowerPoint 中转换后重新导入。确认后可整体撤销。</p>
      </section>}
      <button type="button" onClick={commit}>确认导入可用内容</button>
    </div>}
    {message && <p role="alert" style={{ whiteSpace: 'pre-wrap' }}>{message}</p>}
  </div>
}
