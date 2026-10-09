import { useRef, useState, type KeyboardEvent } from 'react'
import { runtimeLightEditCommands, useRuntimeLightEditView, type RuntimePageTextResult, type CapturedRuntimePageCopy } from '../composition/runtime/runtimeLightEditCommands'

/**
 * M15 "页面文字": strings in the Runtime source that read like page copy, including text that only
 * shows in other states. Editing one writes a rule for that text wherever the Runtime renders it;
 * the Runtime source is never rewritten.
 */
export function RuntimePageTextList({ itemId, onError }: { itemId: string; onError(message: string): void }) {
  const view = useRuntimeLightEditView(itemId)
  if (!view) return <p className="runtime-page-text__empty">这个对象不是可编辑的 Runtime。</p>
  const everywhere = new Map(view.overrides.filter(rule => !rule.region).map(rule => [rule.original, rule.text]))
  const regional = (original: string) => view.overrides.filter(rule => rule.region && rule.original === original).map(rule => rule.text)
  return <div className="runtime-page-text" role="group" aria-label="页面文字">
    <p className="runtime-page-text__hint">改这里会替换页面上所有位置的同一段文字；程序实时计算的文字请用 AI 修改。</p>
    {view.pageCopy.length === 0
      ? <p className="runtime-page-text__empty">源码里没有找到像页面文字的字符串。</p>
      : <ul className="runtime-page-text__list">
        {view.pageCopy.map(original => <li key={original}>
          <PageTextRow original={original} current={everywhere.get(original) ?? original} regional={regional(original)} disabled={view.locked}
            capture={() => runtimeLightEditCommands.capturePageCopy(view.documentId, itemId, original)}
            onCommit={(captured, text) => runtimeLightEditCommands.setPageCopy(captured, text)} onError={onError} />
        </li>)}
      </ul>}
  </div>
}

function PageTextRow({ original, current, regional, disabled, capture, onCommit, onError }: {
  original: string; current: string; regional: readonly string[]; disabled: boolean
  capture(): CapturedRuntimePageCopy
  onCommit(captured: CapturedRuntimePageCopy, text: string): Promise<RuntimePageTextResult>; onError(message: string): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const captured = useRef<CapturedRuntimePageCopy | null>(null)
  const freeze = () => { if (!captured.current) captured.current = capture() }
  const value = draft ?? current
  const commit = () => {
    if (submitting.current || draft === null) return
    if (draft === current) { setDraft(null); captured.current = null; return }
    try { freeze() } catch (error) { onError(error instanceof Error ? error.message : '原文字尚未就绪，草稿已保留'); return }
    const submittedDraft = draft
    submitting.current = true
    setSaving(true)
    void onCommit(captured.current!, submittedDraft).then(result => {
      if (result.ok) { setDraft(previous => previous === submittedDraft ? null : previous); captured.current = null }
      else onError(result.reason)
    }).catch(error => onError(error instanceof Error ? error.message : '页面文字提交失败，草稿已保留'))
      .finally(() => { submitting.current = false; setSaving(false) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); commit() }
    if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); event.stopPropagation(); setDraft(null); captured.current = null }
  }
  return <label className="runtime-page-text__row">
    {current !== original && <span className="runtime-page-text__original" title={original}>原文：{original}</span>}
    {regional.length > 0 && <span className="runtime-page-text__original">画面中已单独改为：{regional.join('、')}</span>}
    <input aria-label={`页面文字：${original}`} value={value} disabled={disabled || saving} aria-busy={saving}
      onFocus={() => { try { freeze() } catch (error) { onError(error instanceof Error ? error.message : '原文字尚未就绪') } }}
      onChange={event => { setDraft(event.target.value); try { freeze() } catch (error) { onError(error instanceof Error ? error.message : '原文字尚未就绪，草稿已保留') } }}
      onBlur={commit} onKeyDown={onKeyDown} />
  </label>
}
