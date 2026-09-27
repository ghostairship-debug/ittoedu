import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { normalizeLightEditText } from '../../shared/contracts/runtime/lightEdit'
import { scanRuntimePageText } from '../../shared/runtimeText/scanPageText'
import { runtimeLightEditCommands, useRuntimeLightEditView, type RuntimePageTextResult } from '../composition/runtime/runtimeLightEditCommands'

const MAX_PAGE_TEXTS = 200

/**
 * M15 "页面文字": strings in the Runtime source that read like page copy, including text that only
 * shows in other states. Editing one writes a rule for that text wherever the Runtime renders it;
 * the Runtime source is never rewritten.
 */
export function RuntimePageTextList({ itemId, onError }: { itemId: string; onError(message: string): void }) {
  const view = useRuntimeLightEditView(itemId)
  const entries = useMemo(() => {
    if (!view) return []
    const seen = new Set<string>()
    return scanRuntimePageText(view.source, { maxEntries: MAX_PAGE_TEXTS }).entries
      .map(entry => normalizeLightEditText(entry.text))
      .filter(text => text && !seen.has(text) && seen.add(text))
  }, [view])
  if (!view) return <p className="runtime-page-text__empty">这个对象不是可编辑的 Runtime。</p>
  const everywhere = new Map(view.overrides.filter(rule => !rule.region).map(rule => [rule.original, rule.text]))
  const regional = (original: string) => view.overrides.filter(rule => rule.region && rule.original === original).map(rule => rule.text)
  return <div className="runtime-page-text" role="group" aria-label="页面文字">
    <p className="runtime-page-text__hint">改这里会替换页面上所有位置的同一段文字；程序实时计算的文字请用 AI 修改。</p>
    {entries.length === 0
      ? <p className="runtime-page-text__empty">源码里没有找到像页面文字的字符串。</p>
      : <ul className="runtime-page-text__list">
        {entries.map(original => <li key={original}>
          <PageTextRow original={original} current={everywhere.get(original) ?? original} regional={regional(original)} disabled={view.locked}
            onCommit={text => runtimeLightEditCommands.setPageText(itemId, original, text)} onError={onError} />
        </li>)}
      </ul>}
  </div>
}

function PageTextRow({ original, current, regional, disabled, onCommit, onError }: {
  original: string; current: string; regional: readonly string[]; disabled: boolean
  onCommit(text: string): Promise<RuntimePageTextResult>; onError(message: string): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const value = draft ?? current
  const commit = () => {
    if (submitting.current || draft === null) return
    if (draft === current) { setDraft(null); return }
    const submittedDraft = draft
    submitting.current = true
    setSaving(true)
    void onCommit(submittedDraft).then(result => {
      if (result.ok) setDraft(previous => previous === submittedDraft ? null : previous)
      else onError(result.reason)
    }).catch(error => onError(error instanceof Error ? error.message : '页面文字提交失败，草稿已保留'))
      .finally(() => { submitting.current = false; setSaving(false) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); commit() }
    if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); event.stopPropagation(); setDraft(null) }
  }
  return <label className="runtime-page-text__row">
    {current !== original && <span className="runtime-page-text__original" title={original}>原文：{original}</span>}
    {regional.length > 0 && <span className="runtime-page-text__original">画面中已单独改为：{regional.join('、')}</span>}
    <input aria-label={`页面文字：${original}`} value={value} disabled={disabled || saving} aria-busy={saving}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
  </label>
}
