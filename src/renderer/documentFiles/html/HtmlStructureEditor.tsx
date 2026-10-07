import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { HtmlPreviewLease } from '../../../shared/workbench/htmlPreview'
import { inspectHtmlSource, flattenHtmlSourceNodes, type HtmlSourceNode } from '../../../shared/html/htmlSourceStructure'
import { htmlSourceEditCommandSchema, type HtmlSourceEditCommand } from '../../../shared/html/sourceEditCommands'
import { createHtmlGrapesProjection } from './htmlGrapesProjection'
import 'grapesjs/dist/css/grapes.min.css'

export interface HtmlStructureEditorProps {
  committed: DocumentSnapshot
  lease: HtmlPreviewLease
  pendingDraft?: boolean
  loading?: boolean
}

function nodeLabel(node: HtmlSourceNode): string {
  if (node.kind === 'text') return node.value?.trim().slice(0, 60) ?? '文字'
  return `${node.name}${node.attributes.id ? `#${node.attributes.id}` : ''}${node.attributes.class ? `.${node.attributes.class.trim().replace(/\s+/g, '.')}` : ''}`
}

/** Controls are projections of the committed source. Every application returns to its existing Main transaction. */
export function HtmlStructureEditor({ committed, lease, pendingDraft = false, loading = false }: HtmlStructureEditorProps) {
  const source = committed.model.kind === 'text' ? committed.model.source : ''
  const structure = useMemo(() => inspectHtmlSource(source), [source])
  const nodes = useMemo(() => flattenHtmlSourceNodes(structure.roots), [structure])
  const [tab, setTab] = useState<'structure' | 'styles' | 'data'>('structure')
  const [selectedKey, setSelectedKey] = useState('')
  const [ruleIndex, setRuleIndex] = useState(0)
  const [dataIndex, setDataIndex] = useState(0)
  const [value, setValue] = useState('')
  const [property, setProperty] = useState('')
  const [propertyValue, setPropertyValue] = useState('')
  const [attribute, setAttribute] = useState('class')
  const [attributeValue, setAttributeValue] = useState('')
  const [parentKey, setParentKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<string | null>(null)
  const grapesContainer = useRef<HTMLDivElement>(null)
  const grapes = useRef<ReturnType<typeof createHtmlGrapesProjection> | null>(null)
  const commit = useRef<(command: HtmlSourceEditCommand) => Promise<void>>(async () => {})
  const selected = nodes.find(node => node.key === selectedKey)
  const parent = nodes.find(node => node.children.some(child => child.key === selectedKey))
  const rule = structure.rules[ruleIndex], data = structure.data[dataIndex]
  const editable = !pendingDraft && !busy && !loading
  useEffect(() => { setSelectedKey(''); setIssue(null) }, [committed.documentId, committed.epoch, committed.revision])
  useEffect(() => {
    if (tab === 'structure') setValue(selected?.value ?? '')
    setAttributeValue(selected?.attributes[attribute] ?? ''); setParentKey(parent?.key ?? '')
  }, [tab, selectedKey, source, attribute])
  useEffect(() => { if (tab === 'data') setValue(data ? JSON.stringify(data.value, null, 2) : '') }, [tab, dataIndex, source])

  const apply = async (command: HtmlSourceEditCommand) => {
    if (!editable) return
    if (command.type === 'style' && command.target.kind === 'element' && selected && grapes.current) {
      if (grapes.current.style(selected.key, command.patch)) return
    }
    if (command.type === 'move' && grapes.current) {
      const destination = nodes.find(node => node.address?.from === command.parent.from)
      const target = nodes.find(node => node.address?.from === command.target.from)
      if (destination && target && grapes.current.move(target.key, destination.key, command.index)) return
    }
    await commit.current(command)
  }
  commit.current = async (command: HtmlSourceEditCommand) => {
    if (!editable) return
    setBusy(true); setIssue(null)
    try {
      const checked = htmlSourceEditCommandSchema.parse(command)
      const result = await window.desktopAPI.workspaceFiles!({ type: 'html-preview.edit-source',
        operationId: crypto.randomUUID(), documentId: committed.documentId, epoch: committed.epoch,
        baseRevision: committed.revision, bindingVersion: lease.bindingVersion, leaseId: lease.leaseId,
        loadId: lease.loadId, command: checked })
      if (result.status === 'rejected') setIssue(result.message ?? '源码已变化，请重新选择。')
    } catch (error) { setIssue(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!grapesContainer.current) return
    const projection = createHtmlGrapesProjection(grapesContainer.current, { commit: command => commit.current(command), select: setSelectedKey })
    grapes.current = projection
    projection.project(source, lease.url)
    return () => { projection.dispose(); if (grapes.current === projection) grapes.current = null }
  }, [committed.documentId, committed.epoch])
  useEffect(() => { grapes.current?.project(source, lease.url) }, [source, committed.revision, lease.url])
  useEffect(() => { if (selectedKey) grapes.current?.select(selectedKey) }, [selectedKey])
  const applyJson = () => {
    if (!data) return
    try { void apply({ type: 'data', target: data.address, path: [], value: JSON.parse(value) }) }
    catch { setIssue('JSON 格式不完整，请先修正。') }
  }
  const tree = (children: readonly HtmlSourceNode[]) => <ul role="group">{children.map(node => <li key={node.key}>
    <button type="button" aria-pressed={selectedKey === node.key} onClick={() => { setSelectedKey(node.key); setIssue(null) }}
      title={node.kind === 'source' ? '程序和样式保留源码；可在对应页签或源码视图修改' : undefined}>{nodeLabel(node)}</button>
    {node.children.length > 0 && tree(node.children)}
  </li>)}</ul>
  const styleForm = (shared: boolean) => <fieldset disabled={!editable}>
    <legend>{shared ? '修改共享规则' : '修改当前元素样式'}</legend>
    <label>CSS 属性<input aria-label={shared ? '共享 CSS 属性' : '元素 CSS 属性'} value={property} placeholder="gap / grid-template-columns"
      onChange={event => setProperty(event.target.value)} /></label>
    <label>属性值<input aria-label={shared ? '共享 CSS 属性值' : '元素 CSS 属性值'} value={propertyValue} placeholder="24px / 1fr 1fr"
      onChange={event => setPropertyValue(event.target.value)} /></label>
    <div className="html-structure-editor__actions">
      <button type="button" disabled={!property.trim() || (shared ? !rule : !selected?.address)} onClick={() => void apply({
        type: shared ? 'stylesheet' : 'style', target: shared ? rule!.address : selected!.address!, patch: { [property]: propertyValue } })}>应用样式</button>
      <button type="button" disabled={!property.trim() || (shared ? !rule : !selected?.address)} onClick={() => void apply({
        type: shared ? 'stylesheet' : 'style', target: shared ? rule!.address : selected!.address!, patch: { [property]: null } })}>移除此声明</button>
    </div>
  </fieldset>

  return <aside className="html-structure-editor" aria-label="HTML 结构与样式">
    <div ref={grapesContainer} aria-label="HTML 可视结构编辑" style={{ minHeight: 280, pointerEvents: editable ? undefined : 'none' }} />
    <div role="group" aria-label="HTML 编辑内容" className="html-structure-editor__tabs">
      <button type="button" aria-pressed={tab === 'structure'} onClick={() => setTab('structure')}>结构</button>
      <button type="button" aria-pressed={tab === 'styles'} onClick={() => setTab('styles')}>共享样式</button>
      <button type="button" aria-pressed={tab === 'data'} onClick={() => setTab('data')}>程序数据</button>
    </div>
    {pendingDraft && <p role="status">先应用文字或源码草稿，再修改结构和样式。</p>}
    {loading && <p role="status">正在加载当前版本的预览…</p>}
    {tab === 'structure' && nodes.some(node => node.sourceOnly) && <p>
      结构树显示原始 HTML。程序生成或重写的内容请在“程序数据”或源码中修改。
    </p>}
    {tab === 'structure' && <>
      <div className="html-structure-editor__tree" role="group" aria-label="HTML 结构树">{tree(structure.roots)}</div>
      {selected && <div className="html-structure-editor__properties">
        <strong>{nodeLabel(selected)}</strong>
        {selected.sourceOnly && <p>此节点由程序源码负责。请在源码视图修改；不会把运行结果转成静态内容。</p>}
        {!selected.address && <p>浏览器自动补充的结构没有独立源码，请选择其子节点。</p>}
        {selected.kind === 'text' && selected.address && <fieldset disabled={!editable}>
          <legend>文字</legend><textarea aria-label="结构节点文字" value={value} onChange={event => setValue(event.target.value)} />
          <button type="button" onClick={() => void apply({ type: 'text', target: selected.address!, text: value })}>应用文字</button>
        </fieldset>}
        {selected.kind === 'element' && selected.address && <>
          {styleForm(false)}
          <fieldset disabled={!editable}><legend>HTML 属性</legend>
            <label>属性名<input aria-label="HTML 属性名" value={attribute} onChange={event => setAttribute(event.target.value)} /></label>
            <label>属性值<input aria-label="HTML 属性值" value={attributeValue} onChange={event => setAttributeValue(event.target.value)} /></label>
            <div className="html-structure-editor__actions">
              <button type="button" disabled={!attribute.trim()} onClick={() => void apply({ type: 'attributes', target: selected.address!, patch: { [attribute]: attributeValue } })}>应用属性</button>
              <button type="button" disabled={!attribute.trim()} onClick={() => void apply({ type: 'attributes', target: selected.address!, patch: { [attribute]: null } })}>移除属性</button>
            </div>
          </fieldset>
        </>}
        {selected.address && selected.kind !== 'source' && !['html', 'head', 'body'].includes(selected.name) && <fieldset disabled={!editable}>
          <legend>结构顺序</legend>
          <div className="html-structure-editor__actions">
            <button type="button" disabled={!parent?.address || parent.children.findIndex(child => child.key === selectedKey) <= 0}
              onClick={() => void apply({ type: 'move', target: selected.address!, parent: parent!.address!, index: parent!.children.findIndex(child => child.key === selectedKey) - 1 })}>上移</button>
            <button type="button" disabled={!parent?.address || parent.children.findIndex(child => child.key === selectedKey) >= parent.children.length - 1}
              onClick={() => void apply({ type: 'move', target: selected.address!, parent: parent!.address!, index: parent!.children.findIndex(child => child.key === selectedKey) + 1 })}>下移</button>
            <button type="button" onClick={() => void apply({ type: 'remove', target: selected.address! })}>删除节点</button>
          </div>
          <label>移入容器<select aria-label="HTML 目标容器" value={parentKey} onChange={event => setParentKey(event.target.value)}>
            <option value="">选择容器</option>{nodes.filter(node => node.kind === 'element' && node.address && node.contentSpan).map(node =>
              <option key={node.key} value={node.key}>{nodeLabel(node)}</option>)}
          </select></label>
          <button type="button" disabled={!parentKey} onClick={() => {
            const destination = nodes.find(node => node.key === parentKey)
            if (destination?.address) void apply({ type: 'move', target: selected.address!, parent: destination.address,
              index: destination.children.filter(node => node.key !== selectedKey).length })
          }}>移到容器末尾</button>
        </fieldset>}
      </div>}
    </>}
    {tab === 'styles' && <>
      <label>内联样式规则<select aria-label="共享样式规则" value={ruleIndex} onChange={event => setRuleIndex(Number(event.target.value))}>
        {structure.rules.map((rule, index) => <option key={rule.address.from} value={index}>{[...rule.context, rule.selector].join(' › ')}</option>)}
      </select></label>
      {rule ? <><p>修改 {rule.selector} 会影响所有匹配元素；保留其原有作用域。</p>
        <pre>{rule.declarations}</pre>{styleForm(true)}</> : <p>没有可定位的内联样式规则。外部 CSS 请在其源码文件中编辑。</p>}
    </>}
    {tab === 'data' && <>
      <label>JSON 数据源<select aria-label="程序 JSON 数据源" value={dataIndex} onChange={event => setDataIndex(Number(event.target.value))}>
        {structure.data.map((data, index) => <option key={data.address.from} value={index}>{data.name}</option>)}
      </select></label>
      {data ? <><p>修改原始 JSON 后重新运行预览。程序代码和互动仍由原源码负责。</p>
        <textarea aria-label="HTML 程序 JSON 数据" value={value} onChange={event => setValue(event.target.value)} disabled={!editable} />
        <button type="button" disabled={!editable} onClick={applyJson}>应用数据</button></>
        : <p>未找到可可靠定位的 JSON 数据。动态表达式请使用源码视图编辑。</p>}
    </>}
    {issue && <p role="alert">{issue}</p>}
  </aside>
}
