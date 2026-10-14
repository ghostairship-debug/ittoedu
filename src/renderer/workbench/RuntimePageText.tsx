import { useState } from 'react'
import { runtimeLightEditCommands, useRuntimeLightEditView, type RuntimePageTextResult } from '../composition/runtime/runtimeLightEditCommands'
import { BufferedInput, PropertyDraftBoundary } from '../ui/properties/PropertyControls'
import { useEditorStore } from '../store/editorStore'

/** Author fields use their own addresses; same-copy replacements remain a separate explicit action. */
export function RuntimePageTextList({ itemId, onError }: { itemId: string; onError(message: string): void }) {
  const view = useRuntimeLightEditView(itemId)
  const courseView = useEditorStore(state => state.courseView)
  if (!view) return <p className="runtime-page-text__empty">这个对象的作者字段尚未就绪。</p>
  const entries = view.entries ?? []
  const everywhere = new Map(view.overrides.filter(rule => !rule.region).map(rule => [rule.original, rule.text]))
  const regional = (original: string) => view.overrides.filter(rule => rule.region && rule.original === original).map(rule => rule.text)
  const binding = [view.documentId, courseView.snapshot?.epoch, courseView.surfaceId, courseView.activeStateId, itemId]
  return <div className="runtime-page-text" role="group" aria-label="页面文字">
    {entries.length > 0 && <section aria-label="逐字段修改">
      <p className="runtime-page-text__hint">逐字段修改只影响对应作者字段；同文的不同字段分别保留。</p>
      <ul className="runtime-page-text__list">
        {entries.map(({ id, spot, text }, index) => <li key={id ?? spot.id}>
          <PropertyDraftBoundary bindingKey={JSON.stringify([...binding, 'field', id ?? spot.id, spot.initialValue])}
            onStale={() => onError('作者字段的目标或原文已改变；输入已保留。')}>
            <PageTextRow label={`作者字段 ${index + 1}：${text}`} original={text} current={text} disabled={view.locked}
              capture={() => runtimeLightEditCommands.capturePageText(view.documentId, spot)}
              onCommit={(captured, value) => runtimeLightEditCommands.setPageText(captured, value)} onError={onError} />
          </PropertyDraftBoundary>
        </li>)}
      </ul>
    </section>}
    {view.pageCopy.length > 0 && <details open={entries.length === 0}>
      <summary>同文批量替换</summary>
      <p className="runtime-page-text__hint">这里会替换此对象所有位置的同一段文字，包括程序后续状态里的同文。</p>
      <ul className="runtime-page-text__list">
        {view.pageCopy.map(original => <li key={original}>
          <PropertyDraftBoundary bindingKey={JSON.stringify([...binding, original])}
            onStale={() => onError('页面文字的目标或原文已改变；输入已保留。')}>
            <PageTextRow label={`页面文字：${original}`} original={original} current={everywhere.get(original) ?? original} regional={regional(original)} disabled={view.locked}
              capture={() => runtimeLightEditCommands.capturePageCopy(view.documentId, itemId, original)}
              onCommit={(captured, text) => runtimeLightEditCommands.setPageCopy(captured, text)} onError={onError} />
          </PropertyDraftBoundary>
        </li>)}
      </ul>
    </details>}
    {entries.length === 0 && view.pageCopy.length === 0 && <p className="runtime-page-text__empty">当前没有可定位的作者文字字段；可通过组件源码修改。</p>}
  </div>
}

function PageTextRow<Capture>({ label, original, current, regional = [], disabled, capture, onCommit, onError }: {
  label: string; original: string; current: string; regional?: readonly string[]; disabled: boolean
  capture(): Capture
  onCommit(captured: Capture, text: string): Promise<RuntimePageTextResult>; onError(message: string): void
}) {
  const [saving, setSaving] = useState(false)
  return <div className="runtime-page-text__row">
    {current !== original && <span className="runtime-page-text__original" title={original}>原文：{original}</span>}
    {regional.length > 0 && <span className="runtime-page-text__original">画面中已单独改为：{regional.join('、')}</span>}
    <BufferedInput label={label} value={current} disabled={disabled || saving} allowEmpty onCommit={async text => {
      setSaving(true)
      try { const result = await onCommit(capture(), text); if (!result.ok) throw new Error(result.reason) }
      catch (error) { onError(error instanceof Error ? error.message : '页面文字提交失败，草稿已保留'); throw error }
      finally { setSaving(false) }
    }} />
  </div>
}
