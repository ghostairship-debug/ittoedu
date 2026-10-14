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
  const background = recipeId === 'static-background-v1' || recipeId === 'dynamic-background-v1'
  const stale = target.project.id !== project.id || target.surfaceId !== locationId
  return <section aria-label="页面配方" style={{ display: 'grid', gap: 12, padding: 12, minWidth: 0 }}>
    <p>{background ? '在正式全局底层添加一个可继续编辑的背景；按所选页面范围应用，保留前景内容。' : '新建一张可继续编辑的演示页。使用原生文字与可修改参数和源码的互动机制。'}</p>
    <label>配方<select aria-label="选择配方" value={recipeId} onChange={event => {
      const next = event.target.value as RecipeId; setRecipeId(next); setSlots(recipeDefaults(next))
    }}>{RECIPE_CATALOG.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
    {definition.fields.filter(field => !(recipeId === 'classify-sort-v1' && (field.key === 'groups' && slots.mode === 'sort' || field.key === 'correctOrder' && slots.mode !== 'sort')) && !(field.key === 'pages' && !['include', 'exclude'].includes(slots.scope))).map(field => <label key={field.key} style={{ display: 'grid', gap: 5, minWidth: 0 }}>{field.key === 'mode' ? '互动方式' : field.label}
      {field.key === 'mode' ? <select aria-label="互动方式" value={slots.mode ?? 'classify'} onChange={event => setSlots(current => ({ ...current, mode: event.target.value }))}>
        <option value="classify">拖拽分类</option><option value="match">拖拽匹配</option><option value="sort">拖拽排序</option>
      </select> : field.key === 'selectionMode' ? <select aria-label="选择方式" value={slots.selectionMode} onChange={event => setSlots(current => ({ ...current, selectionMode: event.target.value }))}><option value="single">单选，直接反馈</option><option value="multiple">多选，提交后反馈</option></select>
        : field.key === 'scope' ? <select aria-label="背景适用范围" value={slots.scope} onChange={event => setSlots(current => ({ ...current, scope: event.target.value }))}><option value="current">当前页面</option><option value="all">全部页面</option><option value="include">仅所选页面</option><option value="exclude">排除所选页面</option></select>
        : field.key === 'pages' ? <select multiple aria-label="背景页面范围" size={Math.min(6, project.surfaces.length)} value={(slots.pages ?? '').split('\n').filter(Boolean)} onChange={event => setSlots(current => ({ ...current, pages: [...event.target.selectedOptions].map(option => option.value).join('\n') }))}>{project.surfaces.map((surface, index) => <option key={surface.id} value={surface.id}>{index + 1}. {surface.title}</option>)}</select>
        : field.key === 'pattern' ? <select aria-label="背景纹理" value={slots.pattern} onChange={event => setSlots(current => ({ ...current, pattern: event.target.value }))}><option value="gradient">渐变</option><option value="grid">网格</option><option value="dots">点状纹理</option></select>
        : field.key === 'assetId' ? <select aria-label="背景图片素材" value={slots.assetId ?? ''} onChange={event => setSlots(current => ({ ...current, assetId: event.target.value }))}><option value="">保留图形背景</option>{Object.values(project.assets).filter(asset => asset.kind === 'image' || asset.mimeType?.startsWith('image/')).map(asset => <option key={asset.id} value={asset.id}>{asset.filename ?? asset.id}</option>)}</select>
        : <textarea aria-label={field.label} rows={field.key === 'items' || field.key === 'steps' ? 4 : 2} value={slots[field.key] ?? ''} onChange={event => setSlots(current => ({ ...current, [field.key]: event.target.value }))} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />}
    </label>)}
    {recipeId === 'classify-sort-v1' && slots.mode === 'sort' && <p>项目每行一个文字，数字也可作为项目文字。正确顺序优先按项目文字匹配；按从 1 开始的序号排序时可写“序号：3,1,2”，无文字匹配的数字也按序号处理。留空时按项目输入顺序作为答案。</p>}
    <label>强调色<select aria-label="配方项目色" value={accentTokenId} onChange={event => setAccentTokenId(event.target.value)}>
      <option value="">默认强调色</option>{(project.designTokens?.colors ?? []).map(token => <option key={token.id} value={token.id}>{token.label}</option>)}
    </select></label>
    {stale && <p role="status">工程或页面已改变。保留输入并刷新目标后再应用。<button type="button" onClick={() => setTarget(capture())}>刷新目标</button></p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={stale} onClick={() => onApply({ recipeId, target, slots, ...(accentTokenId ? { accentTokenId } : {}) })}>{background ? '添加底层背景' : '新建配方页'}</button>
  </section>
}
