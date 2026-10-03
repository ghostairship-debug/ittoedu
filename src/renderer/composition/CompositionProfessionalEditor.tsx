import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompositionLayerItem } from '../../shared/courseProjectTypes'
import type { CompositionContentEdit } from '../../shared/composition/edit'
import type { DocumentContent } from '../../shared/document/content'
import type { MarkdownDocument } from '../../shared/document/markdown'
import { documentResourceReferences } from '../../shared/document/resources'
import { applyTextRunEdits, remapTextRuns } from '../../shared/textRuns'
import { moveTableItem } from '../../core/tools/tableStructure'
import { paintCompositionDocument } from '../../player/composition/documentContent'
import { SharedDocumentEditor } from '../document/SharedDocumentEditor'
import { changeChartType, patchChartStyle, replaceChartTableData } from '../course/chartContentOperations'
import * as table from '../course/tableContentOperations'
import { ChartProperties } from '../ui/properties/ChartProperties'
import { NativeTableProperties } from '../ui/properties/NativeTableProperties'
import { BufferedInput, FontFamilyPicker, SelectField, TextContentTextarea, ToggleRow } from '../ui/properties/PropertyControls'
import { ColorInput } from '../ui/ColorInput'

type Node = CompositionLayerItem['content']['root']
export type CompositionProfessionalNode = Extract<Node, { kind: 'document' | 'native' }>
type NativeNode = Extract<Node, { kind: 'native' }>

export interface CompositionProfessionalEditorProps {
  node: CompositionProfessionalNode
  /** The existing canonical composition command. Rejecting keeps this draft available. */
  onEdit(edit: CompositionContentEdit): Promise<void>
  disabled?: boolean
  assetUrls?: Readonly<Record<string, string>>
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function professionalEdit(node: CompositionProfessionalNode): CompositionContentEdit {
  // Full replacement preserves the node identity while clearing fields of former chart variants.
  return node.kind === 'document' ? { type: 'document', nodeId: node.id, content: node.content }
    : { type: 'replace', nodeId: node.id, node }
}

function DocumentProfessionalEditor({ node, revision, disabled, assetUrls, change, onUndo, onRedo, onDiagnostics }: {
  node: Extract<Node, { kind: 'document' }>; revision: string; disabled: boolean
  assetUrls: Readonly<Record<string, string>>
  change(content: DocumentContent, historyGroup?: string): void
  onUndo(): void; onRedo(): void; onDiagnostics(invalid: boolean): void
}) {
  const document = useMemo<MarkdownDocument>(() => {
    const refs = documentResourceReferences(node.content.blocks)
    return { content: node.content, resources: {
      assets: refs.assets.map(assetId => ({ assetId, source: { kind: 'project' } })),
      components: refs.components.map(component => ({ ...component, source: { kind: 'project' } })),
    } }
  }, [node.content])
  return <SharedDocumentEditor document={document} revision={revision} readOnly={disabled} target="flow"
    onChange={(next, operation) => { change(next.content, operation.historyGroup); return true }}
    onDraft={(_source, diagnostics) => onDiagnostics(diagnostics.length > 0)}
    onUndo={onUndo} onRedo={onRedo} contextualCardSuppressed
    renderObject={(block, container) => {
      paintCompositionDocument(container, { blocks: [block] }, id => assetUrls[id])
    }} />
}

function NativeProfessionalEditor({ node, change, report }: {
  node: NativeNode; change(node: NativeNode): void; report(message: string): void
}) {
  const content = node.content
  const textDraft = useRef<{ text: string; runs: Extract<NativeNode['content'], { nativeType: 'text' }>['data']['runs'] } | null>(null)
  const run = (action: () => void) => { try { action() } catch (error) { report(error instanceof Error ? error.message : '修改无效') } }
  if (content.nativeType === 'chart') {
    const chart = content.data
    const setChart = (data: typeof chart) => change({ ...node, content: { nativeType: 'chart', data } })
    return <ChartProperties node={{ id: node.id, type: 'chart', ...chart }} bindingKey={node.id} commands={{
      patchTitle: title => setChart({ ...chart, title }),
      patchType: (type, seriesId) => run(() => setChart(changeChartType(chart, type, seriesId))),
      patchStyle: patch => run(() => setChart(patchChartStyle(chart, patch))),
      commitTableData: candidate => {
        try { setChart(replaceChartTableData(chart, candidate)); return null }
        catch (error) { return error instanceof Error ? error.message : '图表数据无效' }
      },
    }} />
  }
  if (content.nativeType === 'table') {
    const data = content.data
    const update = (operation: (source: typeof data) => typeof data) => run(() => change({ ...node, content: { nativeType: 'table', data: operation(data) } }))
    // This panel edits semantic cells, rows and styles; it does not own layout coordinates.
    return <NativeTableProperties bindingKey={node.id} node={{
      id: node.id, name: '表格', type: 'table', x: 0, y: 0, width: 1, height: 1,
      rotation: 0, opacity: 1, visible: true, locked: false, playbackInitialVisibility: 'inherit', ...data,
    }} commands={{
      beginCellEdit: () => {}, updateCellDraft: () => {}, cancelCellEdit: () => {},
      commitCellText: (cellId, text) => update(source => table.patchTableCellText(source, { cellId, text })),
      commitLastCellAndAppendRow: (cellId, text) => update(source => table.commitTableLastCellAndAppendRow(source, { cellId, text }).table),
      mergeCells: region => update(source => table.mergeTableCells(source, region)),
      splitCells: (rowId, columnId) => update(source => table.splitTableCells(source, { rowId, columnId })),
      patchStyle: stylePatch => update(source => table.patchTableStyle(source, { stylePatch })),
      patchCellStyle: (cellId, stylePatch) => update(source => table.patchTableCellStyle(source, { cellId, stylePatch })),
      setRowHeight: (rowId, height) => update(source => table.patchTableRowHeight(source, { rowId, height })),
      setColumnWidth: (columnId, width) => update(source => table.patchTableColumnWidth(source, { columnId, width })),
      insertRow: (referenceRowId, position) => update(source => table.insertTableRow(source, { referenceRowId, position })),
      deleteRow: rowId => update(source => table.deleteTableRow(source, { rowId })),
      moveRow: (rowId, direction) => update(source => table.reorderTableRows(source, { orderedRowIds: moveTableItem(source.rows, rowId, direction).map(row => row.id) })),
      insertColumn: (referenceColumnId, position) => update(source => table.insertTableColumn(source, { referenceColumnId, position })),
      deleteColumn: columnId => update(source => table.deleteTableColumn(source, { columnId })),
      moveColumn: (columnId, direction) => update(source => table.reorderTableColumns(source, { orderedColumnIds: moveTableItem(source.columns, columnId, direction).map(column => column.id) })),
    }} />
  }
  if (content.nativeType === 'text') {
    const data = content.data
    const patch = (values: Partial<typeof data>) => change({ ...node, content: { nativeType: 'text', data: { ...data, ...values } } })
    const style = (values: Partial<typeof data.style>) => patch({ style: { ...data.style, ...values } })
    return <section aria-label="文字内容">
      <TextContentTextarea label="文字" value={data.text}
        onBegin={() => { textDraft.current = { text: data.text, runs: data.runs } }}
        onChange={(text, edit) => run(() => {
          const before = textDraft.current ?? { text: data.text, runs: data.runs }
          const mapped = edit ? applyTextRunEdits(before.text, before.runs, [edit]) : null
          if (mapped && !mapped.ok) throw new Error(mapped.reason)
          textDraft.current = { text, runs: mapped?.ok ? mapped.runs : remapTextRuns(before.text, text, before.runs) }
        })}
        onCommit={() => { if (textDraft.current) { patch(textDraft.current); textDraft.current = null } }}
        onCancel={() => { textDraft.current = null }} />
      <FontFamilyPicker value={data.style.fontFamily} onCommit={fontFamily => style({ fontFamily })} />
      <BufferedInput label="字号" type="number" min={6} max={400} value={data.style.fontSize} onCommit={value => style({ fontSize: Number(value) })} />
      <ColorInput id={`composition-${node.id}-text-color`} label="文字颜色" value={data.style.color} onChange={color => style({ color })} />
      <SelectField label="对齐" value={data.style.align} options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} onChange={align => style({ align })} />
      {(['bold', 'italic', 'underline', 'strike'] as const).map((key, index) => <ToggleRow key={key}
        label={['加粗', '斜体', '下划线', '删除线'][index]!} checked={data.style[key]} onChange={value => style({ [key]: value })} />)}
    </section>
  }
  return <p>此专业对象保持原有内容。当前组合面板支持正文、文字、图表和表格；此对象尚无内部编辑面板。</p>
}

/** Existing professional editors operate on an unsaved draft, then one canonical host edit applies it. */
export function CompositionProfessionalEditor({ node, onEdit, disabled = false, assetUrls = {} }: CompositionProfessionalEditorProps) {
  const [draft, setDraft] = useState(node)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [invalidSource, setInvalidSource] = useState(false)
  const baseline = useRef(node)
  const current = useRef(draft); current.current = draft
  const history = useRef<{ undo: CompositionProfessionalNode[]; redo: CompositionProfessionalNode[]; group?: string }>({ undo: [], redo: [] })
  const dirty = !same(draft, baseline.current)
  const stale = dirty && !same(node, baseline.current)
  useEffect(() => {
    if (!same(node, baseline.current) && (!dirty || node.id !== baseline.current.id)) {
      baseline.current = node; current.current = node; setDraft(node); setRevision(value => value + 1)
      history.current = { undo: [], redo: [] }; setError(''); setInvalidSource(false)
    }
  }, [node, dirty])
  const stage = (next: CompositionProfessionalNode, group?: string) => {
    if (same(next, current.current)) return
    if (!group || group !== history.current.group) history.current.undo.push(current.current)
    history.current.redo = []; history.current.group = group
    current.current = next; setDraft(next); setRevision(value => value + 1); setError('')
  }
  const step = (direction: 'undo' | 'redo') => {
    const next = history.current[direction].pop()
    if (!next) return
    history.current[direction === 'undo' ? 'redo' : 'undo'].push(current.current)
    history.current.group = undefined; current.current = next; setDraft(next); setRevision(value => value + 1)
  }
  const discard = () => {
    baseline.current = node; current.current = node; setDraft(node); setRevision(value => value + 1)
    history.current = { undo: [], redo: [] }; setError(''); setInvalidSource(false)
  }
  const apply = async () => {
    setPending(true); setError('')
    try {
      await onEdit(professionalEdit(current.current))
      baseline.current = current.current; history.current = { undo: [], redo: [] }
      setRevision(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '应用未完成；修改仍保留在草稿中') }
    finally { setPending(false) }
  }
  return <section aria-label="专业内容编辑">
    <fieldset disabled={disabled || pending} style={{ border: 0, padding: 0, margin: 0 }}>
      {draft.kind === 'document' ? <DocumentProfessionalEditor node={draft} revision={`${draft.id}:${revision}`} disabled={disabled || pending}
        assetUrls={assetUrls} change={(content, group) => stage({ ...draft, content }, group)}
        onUndo={() => step('undo')} onRedo={() => step('redo')} onDiagnostics={setInvalidSource} />
        : <NativeProfessionalEditor node={draft} change={stage} report={setError} />}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={!dirty || stale || invalidSource} onClick={() => void apply()}>应用到作品</button>
        <button type="button" disabled={!dirty && !invalidSource} onClick={discard}>丢弃草稿</button>
      </div>
      {dirty && <p role="status">专业内容尚在草稿中，应用后可用画布撤销。</p>}
      {stale && <p role="alert">此对象已在其他位置修改。草稿保留，请核对后丢弃并重新编辑。</p>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section>
}
