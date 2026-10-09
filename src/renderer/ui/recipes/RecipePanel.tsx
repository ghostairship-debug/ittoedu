import { useState } from 'react'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import { RECIPE_CATALOG, recipeDefaults, type RecipeId, type RecipeInput } from '../../recipes/recipeCatalog'

export interface RecipePanelProps {
  project: CourseProjectV10
  locationId: string
  sessionGeneration?: number
  captureTarget(): CapturedCourseTarget
  onApply(input: RecipeInput): void
  error?: string
}

/** Transient form only: outputs ordinary V10 content and is never persisted. */
export function RecipePanel({ project, locationId, sessionGeneration, captureTarget, onApply, error }: RecipePanelProps) {
  const capture = () => captureTarget()
  const [target, setTarget] = useState(capture)
  const [recipeId, setRecipeId] = useState<RecipeId>('cover-v1')
  const [slots, setSlots] = useState<Record<string, string>>(() => recipeDefaults('cover-v1'))
  const [accentTokenId, setAccentTokenId] = useState('')
  const definition = RECIPE_CATALOG.find(entry => entry.id === recipeId)!
  const stale = target.project.id !== project.id || target.surfaceId !== locationId
  return <section aria-label="页面配方" style={{ display: 'grid', gap: 12, padding: 12, minWidth: 0 }}>
    <p>新建一张可继续编辑的演示页。展开后使用原生文字与可编辑互动组件。</p>
    <label>配方<select aria-label="选择配方" value={recipeId} onChange={event => {
      const next = event.target.value as RecipeId; setRecipeId(next); setSlots(recipeDefaults(next))
    }}>{RECIPE_CATALOG.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
    {definition.fields.filter(field => !(recipeId === 'classify-sort-v1' && (field.key === 'groups' && slots.mode === 'sort' || field.key === 'correctOrder' && slots.mode !== 'sort'))).map(field => <label key={field.key} style={{ display: 'grid', gap: 5, minWidth: 0 }}>{field.key === 'mode' ? '互动方式' : field.label}
      {field.key === 'mode' ? <select aria-label="互动方式" value={slots.mode ?? 'classify'} onChange={event => setSlots(current => ({ ...current, mode: event.target.value }))}>
        <option value="classify">分类</option><option value="sort">排序</option>
      </select> : <textarea aria-label={field.label} rows={field.key === 'items' || field.key === 'steps' ? 4 : 2} value={slots[field.key] ?? ''} onChange={event => setSlots(current => ({ ...current, [field.key]: event.target.value }))} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />}
    </label>)}
    {recipeId === 'classify-sort-v1' && slots.mode === 'sort' && <p>项目每行一个文字，数字也可作为项目文字。正确顺序优先按项目文字匹配；按从 1 开始的序号排序时可写“序号：3,1,2”，无文字匹配的数字也按序号处理。留空时按项目输入顺序作为答案。</p>}
    <label>强调色<select aria-label="配方项目色" value={accentTokenId} onChange={event => setAccentTokenId(event.target.value)}>
      <option value="">默认强调色</option>{(project.designTokens?.colors ?? []).map(token => <option key={token.id} value={token.id}>{token.label}</option>)}
    </select></label>
    {stale && <p role="status">工程或页面已改变。保留输入并刷新目标后再应用。<button type="button" onClick={() => setTarget(capture())}>刷新目标</button></p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={stale} onClick={() => onApply({ recipeId, target, slots, ...(accentTokenId ? { accentTokenId } : {}) })}>新建配方页</button>
  </section>
}
