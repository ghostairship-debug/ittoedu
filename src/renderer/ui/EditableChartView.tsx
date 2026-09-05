import type { ChartCanvasTextPort } from '../authoring/chartCanvasTextBridge'
import { useEffect, useRef, useState } from 'react'
import type { NativeChartContent } from '../../shared/contracts/native-v1'
import { buildNativeChartSvg } from '../../shared/nativeChartSvg'
import { chartNativeContentObjectSchema } from '../../shared/contracts/native-v1'

export function EditableChartView({ id, chart, width, height, onCommit, onHeightCommit, canvasTextPort }: {
  id: string
  chart: NativeChartContent
  width: number
  height: number
  onCommit?: (chart: NativeChartContent) => string | null
  onHeightCommit?: (height: number) => void
  canvasTextPort?: () => ChartCanvasTextPort | undefined
}) {
  const root = useRef<HTMLDivElement>(null)
  const [edit, setEdit] = useState<{ value: string; left: number; top: number; apply: (value: string) => string | null } | null>(null)
  const composing = useRef(false)
  const finishAfterComposition = useRef(false)
  const editRef = useRef(edit)
  editRef.current = edit
  const [error, setError] = useState<string | null>(null)
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  const resize = useRef<{ y: number; height: number; scale: number; commit: (height: number) => void } | null>(null)
  useEffect(() => { setEdit(null); setError(null) }, [id])
  const finish = () => {
    if (composing.current) { finishAfterComposition.current = true; return }
    const current = editRef.current
    if (!current) return
    editRef.current = null
    const reason = current.apply(current.value)
    if (reason) { setError(reason); setEdit(current); editRef.current = current }
    else { setEdit(null); setError(null) }
  }
  return <div ref={root} data-testid="editable-chart-view" style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${previewHeight ?? height}`, pointerEvents: 'auto' }}
    onDoubleClick={event => {
      if (!onCommit || !(event.target instanceof Element)) return
      event.stopPropagation()
      const label = event.target.closest('[data-chart-text],[data-chart-category-id],[data-chart-series-id]')
      if (!label) return
      const categoryId = label.getAttribute('data-chart-category-id')
      const seriesId = label.getAttribute('data-chart-series-id')
      const source = structuredClone(chart)
      const port = canvasTextPort?.()
      const draftLabel = categoryId ? port?.read('category', categoryId) : seriesId ? port?.read('series', seriesId) : undefined
      const value = draftLabel ?? ( categoryId ? source.categories.find(item => item.id === categoryId)?.label : seriesId ? source.series.find(item => item.id === seriesId)?.name : source.title)
      if (value === undefined) return
      const bounds = root.current!.getBoundingClientRect()
      const localWidth = root.current!.clientWidth || width
      const rect = label.getBoundingClientRect()
      const svgBox = typeof (label as SVGGraphicsElement).getBBox === 'function' ? (label as SVGGraphicsElement).getBBox() : null
      const left = svgBox ? svgBox.x * localWidth / width : (rect.left - bounds.left) / (bounds.width / localWidth || 1)
      const top = svgBox ? svgBox.y * localWidth / width : (rect.top - bounds.top) / (bounds.width / localWidth || 1)
      setEdit({ value, left: Math.max(0, Math.min(localWidth - 150, left)), top: Math.max(0, top), apply: value => {
        if (port && categoryId) return port.commit('category', categoryId, value)
        if (port && seriesId) return port.commit('series', seriesId, value)
        if (categoryId) source.categories.find(item => item.id === categoryId)!.label = value
        else if (seriesId) source.series.find(item => item.id === seriesId)!.name = value
        else source.title = value
        const result = chartNativeContentObjectSchema.safeParse(source)
        return result.success ? onCommit(result.data) : '图表文字无效，请输入非空文字'
      } })
    }}>
    <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: buildNativeChartSvg(chart, width, previewHeight ?? height, id) }} />
    {edit ? <input autoFocus aria-label="图表文字" value={edit.value} style={{ position: 'absolute', left: edit.left, top: edit.top, minWidth: 150, maxWidth: '100%', zIndex: 10, color: '#111827', background: '#fff' }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onChange={event => { const next = { ...edit, value: event.target.value }; editRef.current = next; setEdit(next) }} onBlur={finish}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={event => {
        composing.current = false
        if (editRef.current) { const next = { ...editRef.current, value: event.currentTarget.value }; editRef.current = next; setEdit(next) }
        if (finishAfterComposition.current) { finishAfterComposition.current = false; finish() }
      }}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); finish() }
        if (event.key === 'Escape') { editRef.current = null; setEdit(null); setError(null) }
      }} /> : null}
    {error ? <div role="alert" style={{ position: 'absolute', bottom: 0, background: '#fee2e2', color: '#991b1b' }}>{error}</div> : null}
    {onHeightCommit ? <button type="button" aria-label="调整图表高度" style={{ position: 'absolute', bottom: -5, left: '45%', width: '10%', height: 10, padding: 0, cursor: 'ns-resize', touchAction: 'none' }}
      onPointerDown={event => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { y: event.clientY, height, scale: (root.current?.getBoundingClientRect().width ?? width) / width, commit: onHeightCommit } }}
      onPointerMove={event => { if (resize.current) setPreviewHeight(Math.round(Math.min(1600, Math.max(160, resize.current.height + (event.clientY - resize.current.y) / resize.current.scale)))) }}
      onPointerUp={event => { event.stopPropagation(); const active = resize.current; resize.current = null; if (active && previewHeight !== null && previewHeight !== active.height) active.commit(previewHeight); setPreviewHeight(null) }}
      onPointerCancel={() => { resize.current = null; setPreviewHeight(null) }} /> : null}
  </div>
}
