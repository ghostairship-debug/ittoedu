import { useImperativeHandle, useState, type Ref } from 'react'
import type { TextFormatShortcut } from '../../../shared/editorShortcuts'
import { MoreHorizontal, Pencil, Check } from 'lucide-react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewEditOutcome, HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { authorSpotIsSvgText } from '../../../core/components/authoring/componentAuthorEdits'
import { SelectionQuickBar, QuickBarButton, QuickBarLabel, QuickBarPopoverButton, QuickBarSeparator } from '../../editing/quickbar/SelectionQuickBar'
import type { QuickBarRect, QuickBarBounds } from '../../editing/quickbar/placeQuickBar'
import { TextFormatActions, textFormatTogglePatch } from '../../editing/quickbar/TextFormatActions'
import { domTextFormatView, domTextStylePatch } from '../../editing/quickbar/domTextFormatting'
import { HtmlTargetAiButton } from './HtmlTargetAiButton'
import type { HtmlSelectedTarget } from './htmlPreviewController'

export interface HtmlSelectionToolbarHandle { toggleFormat(format: TextFormatShortcut): void }

export function HtmlSelectionToolbar({ target, committed, lease, anchor, bounds, editing, composing, style, onEdit, onStyle, prepareTarget, commands }: {
  target: HtmlSelectedTarget
  committed: DocumentSnapshot
  lease: HtmlPreviewLease
  anchor: QuickBarRect
  bounds: QuickBarBounds
  editing: boolean
  composing: boolean
  style: Record<string, string | undefined>
  onEdit(): void
  onStyle(patch: Record<string, string | null>): Promise<HtmlPreviewEditOutcome>
  prepareTarget(): Promise<HtmlSelectedTarget>
  commands?: Ref<HtmlSelectionToolbarHandle>
}) {
  const [busy, setBusy] = useState(false), [issue, setIssue] = useState<string | null>(null)
  const [lineHeight, setLineHeight] = useState(''), [width, setWidth] = useState('')
  const authoring = target.report.authoring ?? (target.resolved.status === 'editable' ? target.resolved.locator.authoring : undefined)
  const svg = authorSpotIsSvgText({ binding: authoring?.record.binding })
  const view = domTextFormatView(target.report.rawText, style, svg)
  const apply = async (patch: Record<string, string | null>) => {
    if (busy || !Object.keys(patch).length) return
    setBusy(true); setIssue(null)
    try { if ((await onStyle(patch)).status === 'rejected') setIssue('属性未应用，源码已变化，请重新选择；输入已保留。') }
    catch (error) { setIssue(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  useImperativeHandle(commands, () => ({ toggleFormat(format) {
    if (target.report.kind !== 'text' || target.resolved.status !== 'editable' || !target.report.geometry || composing) return
    void apply(domTextStylePatch(style, svg, view, textFormatTogglePatch(view, format)))
  } }))
  return <SelectionQuickBar anchor={anchor} bounds={bounds} label="HTML 对象快捷工具条"
    selectionKey={`${committed.documentId}:${committed.epoch}:${target.report.handle}`}>
    <QuickBarLabel>{editing ? '内容编辑' : target.report.kind === 'text' ? '文字对象' : '图片对象'}</QuickBarLabel>
    <fieldset disabled={busy || composing} style={{ display: 'contents' }}>
      {target.resolved.status === 'editable' && <QuickBarButton
        label={editing ? '完成编辑' : target.report.kind === 'text' ? '编辑文字' : '编辑图片'}
        text={editing ? '完成' : '编辑'} icon={editing ? <Check size={14} /> : <Pencil size={14} />} onClick={onEdit} />}
      {target.report.kind === 'text' && target.resolved.status === 'editable' && <>
        {target.report.geometry ? <TextFormatActions view={view} patch={patch => { void apply(domTextStylePatch(style, svg, view, patch)) }}
          alignment={Boolean(target.report.geometry) && /^(?:p|div|h[1-6]|li|td|th|section|article|blockquote|pre|header|footer|main|aside)$/.test(authoring?.record.binding.path.at(-1)?.tag ?? '')}
          highlight={!svg} /> : <QuickBarLabel>纯文本</QuickBarLabel>}
        <QuickBarPopoverButton label="更多文字属性" icon={<MoreHorizontal size={14} />} popoverLabel="文字与尺寸属性">
          {() => <div className="html-preview-extra-style">
            <label>行距<input aria-label="HTML 行距" placeholder={style['line-height'] ?? '1.5 / 24px'} value={lineHeight} onChange={event => setLineHeight(event.target.value)} /></label>
            <label>内容盒宽度<input aria-label="HTML 内容盒宽度" placeholder={style.width ?? '240px'} value={width} onChange={event => setWidth(event.target.value)} /></label>
            <button type="button" disabled={!lineHeight.trim() && !width.trim()} onClick={() => { void apply({
              ...(lineHeight.trim() ? { 'line-height': lineHeight.trim() } : {}), ...(width.trim() ? { width: width.trim() } : {}) }) }}>应用属性</button>
          </div>}
        </QuickBarPopoverButton>
      </>}
      <QuickBarSeparator />
      <HtmlTargetAiButton target={target} committed={committed} lease={lease} prepareTarget={prepareTarget} />
    </fieldset>
    {issue && <span role="alert">{issue}</span>}
  </SelectionQuickBar>
}
