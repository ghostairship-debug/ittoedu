import { useState } from 'react'
import type { CompositionLayerItem } from '../../shared/courseProjectTypes'
import { findCompositionNode } from '../../shared/composition/content'
import type { CompositionContentEdit } from '../../core/tools/compositionContent'
import { CompositionProfessionalEditor } from './CompositionProfessionalEditor'
import { compositionDom, compositionStyleFact, compositionStylePatch, compositionToFlow, compositionToFree } from './compositionLayout'

type Content = CompositionLayerItem['content']
type Node = Content['root']

export interface CompositionContentEditorProps {
  content: Content
  selectedNodeId: string | null
  onSelect(nodeId: string): void
  onEdit(edit: CompositionContentEdit): Promise<void>
  disabled?: boolean
  assetUrls?: Readonly<Record<string, string>>
  /** The actual layout viewport; geometry and rules are read-only browser facts. */
  viewport?: HTMLIFrameElement | null
}

function parentOf(root: Node, id: string): Extract<Node, { kind: 'element' }> | undefined {
  if (root.kind !== 'element') return undefined
  if (root.children.some(child => child.id === id)) return root
  for (const child of root.children) {
    const result = parentOf(child, id)
    if (result) return result
  }
  return undefined
}

function visibleInTree(node: Node): boolean {
  return node.kind !== 'comment' && (node.kind !== 'text' || Boolean(node.text.trim()))
    && (node.kind !== 'element' || !['head', 'style', 'script', 'meta', 'link', 'title'].includes(node.tagName.toLowerCase()))
}

function nodeLabel(node: Node): string {
  if (node.kind === 'text') return `文字：${node.text.trim().slice(0, 36)}`
  if (node.kind === 'element') return `${node.tagName}${node.attributes.id ? ` · ${node.attributes.id}` : ''}`
  return { document: '富文本正文', native: '原生内容', runtime: '互动区域', comment: '注释' }[node.kind]
}

function treeOptions(root: Node, depth = 0): { node: Node; depth: number }[] {
  if (!visibleInTree(root)) return []
  return [{ node: root, depth }, ...(root.kind === 'element' ? root.children.flatMap(child => treeOptions(child, depth + 1)) : [])]
}

/** Move across actual content siblings, without requiring users to move through formatting whitespace. */
export function compositionSiblingMove(content: Content, nodeId: string, direction: -1 | 1): CompositionContentEdit | null {
  const parent = parentOf(content.root, nodeId)
  if (!parent) return null
  const index = parent.children.findIndex(child => child.id === nodeId)
  for (let target = index + direction; target >= 0 && target < parent.children.length; target += direction) {
    if (visibleInTree(parent.children[target]!)) return { type: 'move', nodeId, parentId: parent.id, index: target }
  }
  return null
}

function CommitField({ label, value, multiline = false, onCommit }: {
  label: string; value: string; multiline?: boolean; onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  const common = { 'aria-label': label, value: draft, onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => { if (draft !== value) onCommit(draft) }, style: { width: '100%', boxSizing: 'border-box' as const } }
  return <label style={{ display: 'block', margin: '9px 0' }}><span>{label}</span>
    {multiline ? <textarea {...common} rows={3} /> : <input {...common} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') { setDraft(value); event.stopPropagation() }
    }} />}
  </label>
}

/** Every control changes stored author content through the supplied canonical command. */
export function CompositionContentEditor({ content, selectedNodeId, onSelect, onEdit, disabled = false, assetUrls, viewport }: CompositionContentEditorProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = selectedNodeId ? findCompositionNode(content.root, selectedNodeId) : undefined
  const submit = async (edit: CompositionContentEdit) => {
    if (pending || disabled) return
    setPending(true); setError(null)
    try { await onEdit(edit) } catch (cause) { setError(cause instanceof Error ? cause.message : '修改未完成') }
    finally { setPending(false) }
  }
  const style = document.createElement('div').style
  if (target?.kind === 'element') style.cssText = target.attributes.style ?? ''
  const element = target ? compositionDom(viewport?.contentDocument, target.id) : null
  const fact = (property: string) => element ? compositionStyleFact(element, property) : { value: style.getPropertyValue(property), computed: '', origins: [] }
  const submitStyle = (patch: Record<string, string | null>) => target && void submit({ type: 'style', nodeId: target.id, patch: element ? compositionStylePatch(element, patch) : patch })
  const changePosition = (position: string) => {
    if (!target || !element) { setError('显示区域尚未就绪，请稍后再切换布局。'); return }
    try { void submit(position === 'absolute' ? compositionToFree(element, target.id) : compositionToFlow(element, target.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '布局未转换') }
  }
  const sourceNote = (property: string) => {
    const info = fact(property)
    return info.origins.length ? `声明：${info.origins.map(origin => `${origin.label} (${origin.value}${origin.important ? ' !important' : ''})`).join('；')}；当前计算：${info.computed}`
      : `沿用浏览器或继承规则${info.computed ? `；当前计算：${info.computed}` : ''}`
  }
  const texts = target?.kind === 'text' ? [target] : target?.kind === 'element'
    ? target.children.filter((node): node is Extract<Node, { kind: 'text' }> => node.kind === 'text' && Boolean(node.text.trim())) : []
  const styles: readonly [string, string][] = [
    ['width', '宽度'], ['height', '高度'], ['gap', '间距'], ['padding', '内边距'],
    ['font-size', '字号'], ['color', '文字颜色'], ['background-color', '背景颜色'], ['border-radius', '圆角'],
    ['flex-basis', '主轴尺寸'], ['grid-template-columns', '网格列定义'],
  ]
  return <div aria-label="组合内容属性" style={{ padding: 16, overflow: 'auto' }}>
    <label>内容对象<select aria-label="内容对象" value={target?.id ?? ''} onChange={event => onSelect(event.target.value)} style={{ width: '100%' }}>
      <option value="" disabled>点击预览中的内容</option>
      {treeOptions(content.root).map(({ node, depth }) => <option key={node.id} value={node.id}>{'　'.repeat(depth)}{nodeLabel(node)}</option>)}
    </select></label>
    {!target && <p>点击左侧的文字、图像或容器，再修改它的内容和布局。</p>}
    {target && <fieldset disabled={pending || disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <p><strong>{nodeLabel(target)}</strong></p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!compositionSiblingMove(content, target.id, -1)} onClick={() => { const edit = compositionSiblingMove(content, target.id, -1); if (edit) void submit(edit) }}>前移</button>
        <button type="button" disabled={!compositionSiblingMove(content, target.id, 1)} onClick={() => { const edit = compositionSiblingMove(content, target.id, 1); if (edit) void submit(edit) }}>后移</button>
        {parentOf(content.root, target.id) && <button type="button" onClick={() => onSelect(parentOf(content.root, target.id)!.id)}>选择容器</button>}
      </div>
      {texts.map((text, index) => <CommitField key={`${text.id}:${text.text}`} label={texts.length > 1 ? `正文 ${index + 1}` : '正文'} value={text.text} multiline onCommit={value => void submit({ type: 'text', nodeId: text.id, text: value })} />)}
      {target.kind === 'element' && <>
        {target.tagName.toLowerCase() === 'img' && <CommitField key={`${target.id}:alt:${target.attributes.alt ?? ''}`} label="图片说明" value={target.attributes.alt ?? ''} onCommit={alt => void submit({ type: 'attributes', nodeId: target.id, patch: { alt } })} />}
        <label style={{ display: 'block', marginTop: 12 }}>布局<select aria-label="布局" value={fact('display').value} onChange={event => submitStyle({ display: event.target.value || null })} style={{ width: '100%' }}>
          <option value="">沿用样式</option><option value="block">纵向内容</option><option value="flex">弹性布局</option><option value="grid">网格布局</option><option value="inline">行内内容</option>
          {fact('display').value && !['block', 'flex', 'grid', 'inline'].includes(fact('display').value) && <option value={fact('display').value}>{fact('display').value}</option>}
        </select></label>
        {styles.map(([property, label]) => <div key={`${target.id}:${property}:${fact(property).value}`}>
          <CommitField label={label} value={fact(property).value} onCommit={value => submitStyle({ [property]: value || null })} />
          <small style={{ display: 'block', overflowWrap: 'anywhere', opacity: .75 }}>{sourceNote(property)}</small>
        </div>)}
        <label style={{ display: 'block', marginTop: 12 }}>定位<select aria-label="定位" disabled={!element}
          value={['absolute', 'fixed'].includes(fact('position').computed || style.position) ? 'absolute' : 'relative'}
          onChange={event => changePosition(event.target.value)} style={{ width: '100%' }}>
          <option value="relative">跟随布局</option><option value="absolute">自由摆放</option>
        </select></label>
        <p style={{ fontSize: 12 }}>自由摆放保持当前显示边界；加入自动排列会按容器与内容顺序重新排版。</p>
        {(['left', 'top'] as const).map(property => <div key={`${target.id}:${property}:${fact(property).value}`}>
          <CommitField label={property === 'left' ? '横向偏移' : '纵向偏移'} value={fact(property).value} onCommit={value => submitStyle({ [property]: value || null })} />
          <small style={{ display: 'block', overflowWrap: 'anywhere', opacity: .75 }}>{sourceNote(property)}</small>
        </div>)}
        <p style={{ fontSize: 12, opacity: 0.7 }}>此处修改只写入当前元素，会覆盖该属性已有普通样式规则，包含其他宽度下的规则；留空恢复原规则。尺寸可填写 24px、50% 或 auto。</p>
      </>}
      {target.kind === 'runtime' && <p>互动区域保留其程序与状态。这里可调整顺序，内部行为由程序编辑入口修改。</p>}
      {(target.kind === 'document' || target.kind === 'native') && <CompositionProfessionalEditor key={target.id}
        node={target} onEdit={onEdit} disabled={disabled || pending} assetUrls={assetUrls} />}
    </fieldset>}
    {pending && <p role="status">正在保存修改…</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
