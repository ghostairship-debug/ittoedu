import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewEditOutcome } from '../../../shared/workbench/htmlPreview'
import { captureSelection, workbenchSelection } from '../../workbench/SelectionContextController'
import { TextAiButton, textCardLabel } from '../../workbench/elementCards/ElementTextCards'
import type { HtmlSelectedTarget } from './htmlPreviewController'
import { readEditableTargetContent } from '../../../core/tools/ToolTargets'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'

export interface HtmlLightEditOverlayProps {
  target: HtmlSelectedTarget
  committed: DocumentSnapshot
  position: { left: number; top: number }
  value: string
  onValue(value: string): void
  onText(value: string): Promise<HtmlPreviewEditOutcome>
  onImage(image: { name: string; mimeType: string; bytes: Uint8Array }): Promise<HtmlPreviewEditOutcome>
  onStyle?(patch: Record<string, string | null>): Promise<HtmlPreviewEditOutcome>
  onClose(): void
}

export function HtmlLightEditOverlay({ target, committed, position, value, onValue, onText, onImage, onStyle, onClose }: HtmlLightEditOverlayProps) {
  const overlay = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(position)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<string | null>(null)
  const [lineHeight, setLineHeight] = useState('')
  const [width, setWidth] = useState('')
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
  const authoring = target.report.authoring ?? locator?.authoring
  const aiAvailable = committed.model.kind === 'text'
  return <div ref={overlay} role="dialog" tabIndex={-1} aria-label={target.report.kind === 'text' ? '编辑 HTML 文字' : '替换 HTML 图片'}
    onKeyDown={event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); void submit(); return
      }
      if (event.key !== 'Escape' || busy || event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault(); event.stopPropagation(); onClose()
    }}
    className="html-preview-light-edit" style={{ left: placed.left, top: placed.top, boxSizing: 'border-box', maxHeight: 'min(60vh, 420px, calc(100% - 16px))' }}>
    <div className="html-preview-light-edit__heading">{target.report.kind === 'text' ? '编辑文字' : '替换图片'}</div>
    {target.resolved.status !== 'editable' && <p>这个位置暂时无法定位，请重新选择要修改的文字或图片。</p>}
    {target.report.kind === 'text' && target.resolved.status === 'editable' && <textarea aria-label="HTML 文字" value={value} disabled={busy}
      onChange={event => onValue(event.target.value)} rows={Math.min(8, Math.max(2, value.split('\n').length))} />}
    {onStyle && target.resolved.status === 'editable' && <details>
      <summary>文字与尺寸属性</summary>
      <label>行距<input aria-label="HTML 行距" placeholder="1.5 / 24px" value={lineHeight} disabled={busy}
        onChange={event => setLineHeight(event.target.value)} /></label>
      <label>内容盒宽度<input aria-label="HTML 内容盒宽度" placeholder="240px" value={width} disabled={busy}
        onChange={event => setWidth(event.target.value)} /></label>
      <button type="button" disabled={busy || (!lineHeight.trim() && !width.trim())} onClick={() => {
        setBusy(true); setIssue(null)
        void onStyle({ ...(lineHeight.trim() ? { 'line-height': lineHeight.trim() } : {}), ...(width.trim() ? { width: width.trim() } : {}) })
          .then(result => { if (result.status === 'rejected') setIssue('属性未应用，源码已变化，请重新选择。'); else onClose() })
          .catch(error => setIssue(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false))
      }}>应用属性</button>
    </details>}
    <div className="html-preview-light-edit__actions">
      {target.resolved.status === 'editable' && <button type="button" disabled={busy || (target.report.kind === 'text' && value === target.report.rawText)} onClick={() => void submit()}>
        {target.report.kind === 'text' ? '应用' : '选择图片'}
      </button>}
      {aiAvailable && <TextAiButton documentId={committed.documentId}
        selectionIdentity={authoring ? `${committed.documentId}:${committed.epoch}:${authoring.authorKey}:${JSON.stringify({
          kind: authoring.record.kind, scope: authoring.record.scope, binding: authoring.record.binding })}`
          : `${target.report.kind}:${target.report.handle}:${committed.revision}`} start={async () => {
        const snapshot = await workbenchSelection.prepare(committed.documentId)
        if (snapshot.epoch !== committed.epoch || snapshot.model.kind !== 'text') throw new Error('文档已变化，请重新选择。')
        const current = authoring ? readHtmlAuthoringRecords(snapshot.model.source)[authoring.authorKey] : undefined
        if (!current && locator?.valueSpan) {
          if (snapshot.revision !== locator.revision) throw new Error('源码已变化，请重新选择；输入已保留。')
          const range = { kind: 'markdown-range' as const, from: locator.valueSpan.start, to: locator.valueSpan.end }
          const content = readEditableTargetContent(snapshot.model, range).text
          const label = target.report.kind === 'text' ? textCardLabel(target.report.rawText) : '所选图片地址'
          captureSelection(snapshot, [range], label, snapshot.model.source)
          return { target: range, label, content }
        }
        if (!authoring || target.report.bindingStatus !== 'bound') throw new Error('这个对象的运行位置尚未绑定，请重新选择。')
        const original = authoring.record
        if (current && (current.kind !== original.kind || !equalComponentValue(current.scope ?? {}, original.scope ?? {})
          || !equalComponentValue(current.binding, original.binding))) throw new Error('对象已变化，请重新选择；输入已保留。')
        const record = current ?? original, field = target.report.kind === 'text' ? 'text' as const : 'src' as const
        const value = record.overrides[field]
        const address = { kind: 'html-author-field' as const, authorKey: authoring.authorKey, field,
          record: { ...record, overrides: value === undefined ? {} : { [field]: value } } }
        const content = readEditableTargetContent(snapshot.model, address).text
        const label = target.report.kind === 'text' ? textCardLabel(content) : '所选图片地址'
        captureSelection(snapshot, [address], label)
        return { target: address, label, content }
      }} disabledReason={!authoring && !locator?.valueSpan ? '这个位置暂时无法定位，请重新选择。' : null} />}
      <button type="button" disabled={busy} onClick={onClose}>关闭</button>
    </div>
    {issue && <p role="alert">{issue}</p>}
  </div>
}
