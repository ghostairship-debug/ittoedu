import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewEditOutcome } from '../../../shared/workbench/htmlPreview'
import { captureSelection } from '../../workbench/SelectionContextController'
import { TextAiButton, textCardLabel } from '../../workbench/elementCards/ElementTextCards'
import type { HtmlSelectedTarget } from './htmlPreviewController'

export interface HtmlLightEditOverlayProps {
  target: HtmlSelectedTarget
  committed: DocumentSnapshot
  position: { left: number; top: number }
  value: string
  onValue(value: string): void
  onText(value: string): Promise<HtmlPreviewEditOutcome>
  onImage(image: { name: string; mimeType: string; bytes: Uint8Array }): Promise<HtmlPreviewEditOutcome>
  onClose(): void
}

export function HtmlLightEditOverlay({ target, committed, position, value, onValue, onText, onImage, onClose }: HtmlLightEditOverlayProps) {
  const overlay = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(position)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<string | null>(null)
  useLayoutEffect(() => {
    const element = overlay.current
    if (!element) return
    const doc = element.ownerDocument
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
    const control = element.querySelector<HTMLElement>('textarea:not(:disabled), button:not(:disabled)') ?? element
    control.focus()
    return () => {
      // A view/tab switch may already have moved focus to its own control.
      if (previous?.isConnected && (element.contains(doc.activeElement) || doc.activeElement === doc.body)) previous.focus()
    }
  }, [target.report.handle, target.report.kind])
  useLayoutEffect(() => {
    const element = overlay.current, parent = element?.parentElement
    if (!element || !parent) return
    const place = () => {
      const left = Math.max(8, Math.min(position.left, parent.clientWidth - element.offsetWidth - 8))
      const top = Math.max(8, Math.min(position.top, parent.clientHeight - element.offsetHeight - 8))
      setPlaced(previous => previous.left === left && previous.top === top ? previous : { left, top })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(parent); observer.observe(element)
    return () => observer.disconnect()
  }, [position.left, position.top])
  useEffect(() => { setIssue(null) }, [target.report.handle, target.report.rawText])
  const submit = async () => {
    setBusy(true); setIssue(null)
    try {
      let result: HtmlPreviewEditOutcome
      if (target.report.kind === 'text') result = await onText(value)
      else {
        const image = await window.desktopAPI.selectImage()
        if (!image) return
        result = await onImage({ name: image.name, mimeType: image.mimeType, bytes: image.bytes })
      }
      if (result.status === 'rejected') setIssue('源码或文件位置已变化，请重新选择。')
      else onClose()
    } catch (error) { setIssue(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const locator = target.resolved.status === 'editable' ? target.resolved.locator : null
  const aiAvailable = committed.model.kind === 'text'
  return <div ref={overlay} role="dialog" tabIndex={-1} aria-label={target.report.kind === 'text' ? '编辑 HTML 文字' : '替换 HTML 图片'}
    onKeyDown={event => {
      if (event.key !== 'Escape' || busy || event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault(); event.stopPropagation(); onClose()
    }}
    className="html-preview-light-edit" style={{ left: placed.left, top: placed.top, boxSizing: 'border-box', maxHeight: 'min(60vh, 420px, calc(100% - 16px))' }}>
    <div className="html-preview-light-edit__heading">{target.report.kind === 'text' ? '编辑文字' : '替换图片'}</div>
    {target.resolved.status !== 'editable' && <p>不能直接修改这个位置，可用 AI 修改 HTML 源码。</p>}
    {target.report.kind === 'text' && target.resolved.status === 'editable' && <textarea aria-label="HTML 文字" value={value} disabled={busy}
      onChange={event => onValue(event.target.value)} rows={Math.min(8, Math.max(2, value.split('\n').length))} />}
    <div className="html-preview-light-edit__actions">
      {target.resolved.status === 'editable' && <button type="button" disabled={busy || (target.report.kind === 'text' && value === target.report.rawText)} onClick={() => void submit()}>
        {target.report.kind === 'text' ? '应用' : '选择图片'}
      </button>}
      {aiAvailable && <TextAiButton documentId={committed.documentId}
        selectionIdentity={`${target.report.kind}:${target.report.handle}:${committed.revision}`} start={async () => {
        if (committed.model.kind !== 'text' || (locator && committed.revision !== locator.revision)) throw new Error('源码已变化，请重新选择。')
        const range = { kind: 'markdown-range' as const,
          from: target.report.kind === 'text' ? locator?.valueSpan?.start ?? 0 : 0,
          to: target.report.kind === 'text' ? locator?.valueSpan?.end ?? committed.model.source.length : committed.model.source.length }
        const label = target.report.kind === 'text' && locator ? textCardLabel(target.report.rawText) : 'HTML 源码'
        captureSelection(committed, [range], label, committed.model.source)
        return { target: range, label,
          content: committed.model.source.slice(range.from, range.to) }
      }} disabledReason={committed.model.kind === 'text' && committed.model.source.length ? null : 'HTML 源码为空'} />}
      <button type="button" disabled={busy} onClick={onClose}>关闭</button>
    </div>
    {issue && <p role="alert">{issue}</p>}
  </div>
}
