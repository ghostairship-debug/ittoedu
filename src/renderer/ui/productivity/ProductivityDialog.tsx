import { PptxImportForm } from './PptxImportForm'
import { useState } from 'react'
import type { EditorTransactionStep } from '../../authoring/editorTransaction'
import { applyProductivityPreview, createProductivityPreview, type ProductivityContext, type ProductivityPreview, type ProductivityScope, type ColorProperty } from '../../authoring/productivity'
import { cloneReferencePage } from '../../authoring/productivity/referenceClone'
import { StyleRemixForm } from './StyleRemixForm'

export interface ProductivityDialogProps {
  pptxOnly?: boolean
  getContext(): ProductivityContext
  getAssetFiles(): Readonly<Record<string, Uint8Array>>
  onCommit(step: EditorTransactionStep): boolean
  onClose(): void
}
export function ProductivityDialog({ pptxOnly = false, getContext, getAssetFiles, onCommit, onClose }: ProductivityDialogProps) {
  const [mode, setMode] = useState<'text' | 'color' | 'clone' | 'remix' | 'pptx'>(pptxOnly ? 'pptx' : 'text')
  const [scope, setScope] = useState<ProductivityScope>('page')
  const [find, setFind] = useState(''); const [replacement, setReplacement] = useState('')
  const [tokenId, setTokenId] = useState(''); const [property, setProperty] = useState<ColorProperty>('text')
  const [sceneId, setSceneId] = useState('')
  const [preview, setPreview] = useState<ProductivityPreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const context = getContext()
  const reset = () => { setPreview(null); setSelected([]); setMessage('') }
  const generate = () => {
    try {
      const next = createProductivityPreview(getContext(), mode === 'color' ? { kind: 'color', scope, tokenId, property } : { kind: 'text', scope, find, replacement })
      setPreview(next); setSelected(next.items.map(i => i.id)); setMessage(next.items.length ? '' : '没有需要修改的项目')
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法生成预览') }
  }
  const commit = () => {
    const result = mode === 'clone' ? cloneReferencePage(getContext(), sceneId, getAssetFiles()) : preview ? applyProductivityPreview(getContext(), preview, selected) : null
    if (!result) return
    if (!result.ok) { setMessage(result.reason); return }
    if (!result.step) { setMessage('请至少勾选一项'); return }
    if (onCommit(result.step)) onClose(); else setMessage('未能提交，请重新预览后重试')
  }
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={pptxOnly ? '导入 PPT' : '设计生产力'} style={{ background: 'var(--panel-bg, #20242c)', color: 'inherit', padding: 24, borderRadius: 12, width: 'min(880px, 92vw)', maxHeight: '88vh', overflow: 'auto' }}>
    <h2>{pptxOnly ? '导入 PPT' : '设计生产力'}</h2>
    {!pptxOnly && <label>操作 <select aria-label="生产力操作" value={mode} onChange={e => { setMode(e.target.value as typeof mode); reset() }}><option value="text">批量查找替换</option><option value="color">应用项目色</option><option value="clone">克隆参考页</option><option value="remix">样板改写</option><option value="pptx">导入 PPTX</option></select></label>}
    {mode === 'pptx' ? <PptxImportForm getContext={getContext} getAssetFiles={getAssetFiles} onCommit={onCommit} onClose={onClose} /> : mode === 'remix' ? <StyleRemixForm getContext={getContext} getAssetFiles={getAssetFiles} onCommit={onCommit} onClose={onClose} /> : mode === 'clone' ? <><p>复制本工程的演示页及其可编辑内容；生成独立对象、状态和素材，一次撤销恢复。</p><label>参考页 <select aria-label="参考页" value={sceneId} onChange={e => setSceneId(e.target.value)}><option value="">选择参考页</option>{context.document.surfaces.flatMap(s => s.type === 'slide' ? s.scenes.map(scene => <option key={scene.id} value={scene.id}>{s.title} / {scene.name}</option>) : [])}</select></label></> : <>
      <p>当前页：Slide 当前页、Flow 当前文档、Spatial 当前世界；共享层仅随“当前 Surface / 整课”修改。</p>
      <label>范围 <select aria-label="修改范围" value={scope} onChange={e => { setScope(e.target.value as ProductivityScope); reset() }}><option value="page">当前页</option><option value="surface">当前 Surface</option><option value="course">整课</option></select></label>
      {mode === 'text' ? <div><label>查找 <input aria-label="查找文字" value={find} onChange={e => { setFind(e.target.value); reset() }} /></label><label>替换为 <input aria-label="替换文字" value={replacement} onChange={e => { setReplacement(e.target.value); reset() }} /></label><p>只修改正式文字字段，不改代码、组件参数、身份或跳转引用。按原文精确匹配。</p></div> : <div><label>项目色 <select aria-label="项目色" value={tokenId} onChange={e => { setTokenId(e.target.value); reset() }}><option value="">选择项目色</option>{context.document.designTokens.colors.map(t => <option key={t.id} value={t.id}>{t.label} · {t.color}</option>)}</select></label><label>颜色属性 <select aria-label="颜色属性" value={property} onChange={e => { setProperty(e.target.value as ColorProperty); reset() }}><option value="text">文字</option><option value="fill">填充</option><option value="stroke">边框</option><option value="background">背景 / 高亮</option><option value="all">全部颜色属性</option></select></label><p>应用实际色值；以后修改项目色不会自动改动对象。</p></div>}
      <button type="button" onClick={generate}>预览修改</button>
      {preview && <div><p>{selected.length} / {preview.items.length} 项已选择</p><button type="button" onClick={() => setSelected(preview.items.map(i => i.id))}>全选</button><button type="button" onClick={() => setSelected([])}>全不选</button><ul>{preview.items.map(item => <li key={item.id} style={{ marginBlock: 12, overflowWrap: 'anywhere' }}><label><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />{item.owner} · {item.target} · {item.property}<div>原值：{item.oldValue || '（空）'}</div><div>新值：{item.newValue || '（空）'}</div></label></li>)}</ul>{preview.unsupported.length > 0 && <details><summary>保留不修改的内容（{preview.unsupported.length}）</summary><ul>{preview.unsupported.map((reason, i) => <li key={i}>{reason}</li>)}</ul></details>}</div>}
    </>}
    {message && <p role="status">{message}</p>}
    <footer style={{ display: 'flex', gap: 12, marginTop: 20 }}>{mode !== 'remix' && mode !== 'pptx' && <button type="button" onClick={commit} disabled={mode === 'clone' ? !sceneId : !preview || !selected.length}>{mode === 'clone' ? '克隆参考页' : '应用勾选项'}</button>}<button type="button" onClick={onClose}>取消</button></footer>
  </section></div>
}
