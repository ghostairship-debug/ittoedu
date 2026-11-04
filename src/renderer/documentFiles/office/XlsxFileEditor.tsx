import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import type { OfficeEditContent } from '../../../shared/workbench/officeFiles'
import type { OfficeDocumentSnapshot } from '../../../shared/workbench/officeDocument'
import type { OfficeEditorHandle } from './officeEditorHandle'
import type { OfficeLeafEditorProps } from './officeLeafEditorProps'
import { XlsxCellGrid, type XlsxCellGridHandle } from './XlsxCellGrid'
import { cellName, columnName, columnWidthCharacters, columnWidthPixels, inputValue, parsedMergedRanges, parseTsv, position, rangeContains, XLSX_DEFAULT_COLUMN_PIXELS } from './xlsxGridModel'
import { QuickBarButton } from '../../editing/quickbar/SelectionQuickBar'
import { OfficeSelectionTools } from './OfficeSelectionTools'
import './officeLeafEditor.css'

type Edit = Extract<OfficeEditContent, { format: 'xlsx' }>['edits'][number]

/** A virtualized grid whose edits patch original worksheet parts through the shared file owner. */
export const XlsxFileEditor = forwardRef<OfficeEditorHandle, OfficeLeafEditorProps>(function XlsxFileEditor({
  snapshot, name, active = true, onEdit, onUndo, onRedo, onDirtyChange, onFocusChange, autoSave, onAutoSaveChange, onSave, onSaveAs,
}, ref) {
  const drafts = useRef(new Map<string, { sheet: string; cell: string; text: string }>())
  const columnDrafts = useRef(new Map<string, { type: 'columnWidth'; sheet: string; column: number; width: number }>())
  const baseline = useRef<OfficeDocumentSnapshot | null>(null), latest = useRef(snapshot); latest.current = snapshot
  const busyRef = useRef(false), composing = useRef(false), grid = useRef<XlsxCellGridHandle>(null)
  const editVersion = useRef(0)
  const selectedSheetPart = useRef<string | undefined>(undefined), focusCallback = useRef(onFocusChange); focusCallback.current = onFocusChange
  const [busy, setBusy] = useState(false), [, update] = useState(0), [error, setError] = useState<string | null>(null)
  const [sheetName, setSheetName] = useState(''), [selectedCell, setSelectedCell] = useState('A1'), [addressInput, setAddressInput] = useState('A1')
  const [sheetAction, setSheetAction] = useState<'add' | 'rename' | null>(null), [sheetInput, setSheetInput] = useState('')
  const [selectedRange, setSelectedRange] = useState<string | null>(null)
  const view = baseline.current ?? snapshot
  const sheets = view.inspection.format === 'xlsx' ? view.inspection.sheets : []
  const sheet = sheets.find(value => value.name === sheetName) ?? (selectedSheetPart.current ? sheets.find(value => value.part === selectedSheetPart.current) : undefined) ?? sheets[0]
  if (sheet) selectedSheetPart.current = sheet.part
  const cells = new Map(sheet?.cells.map(cell => [cell.cell, cell]) ?? [])
  const dirty = drafts.current.size > 0 || columnDrafts.current.size > 0
  const selected = position(selectedCell) ?? { row: 1, column: 1 }
  let rowCount = Math.max(100, selected.row + 30), columnCount = Math.max(26, selected.column + 8)
  for (const cell of sheet?.cells ?? []) { const pos = position(cell.cell); if (pos) { rowCount = Math.max(rowCount, pos.row + 30); columnCount = Math.max(columnCount, pos.column + 8) } }
  rowCount = Math.min(1048576, rowCount); columnCount = Math.min(16384, columnCount)
  const draftKey = (name: string, cell: string) => JSON.stringify([name, cell])
  const sourceText = (cell: string) => { const value = cells.get(cell); return value?.formula !== undefined ? '=' + value.formula : value?.value === null || value?.value === undefined ? '' : String(value.value) }
  const editorText = (cell: string) => drafts.current.get(draftKey(sheet?.name ?? '', cell))?.text ?? sourceText(cell)
  const displayText = (cell: string) => {
    const pending = drafts.current.get(draftKey(sheet?.name ?? '', cell))
    const original = cells.get(cell)
    return pending?.text ?? original?.display ?? (original?.value !== null && original?.value !== undefined ? String(original.value) : original?.formula ? '=' + original.formula : '')
  }
  const mergedRanges = parsedMergedRanges(sheet?.mergedRanges)
  const selectedMerge = mergedRanges.find(value => rangeContains(value, selected))
  const selectedSubordinate = !!selectedMerge && cellName(selectedMerge.first) !== selectedCell
  const originalColumnWidth = (column: number) => { const width = sheet?.columnWidths?.find(value => column >= value.min && column <= value.max)?.width; return width === undefined ? XLSX_DEFAULT_COLUMN_PIXELS : columnWidthPixels(width) }
  const columnWidth = (column: number) => { const pending = columnDrafts.current.get(draftKey(sheet?.name ?? '', String(column))); return pending ? columnWidthPixels(pending.width) : originalColumnWidth(column) }
  const changedOutside = dirty && JSON.stringify(snapshot.binding) !== JSON.stringify(view.binding)
  useEffect(() => {
    if (active && sheet) focusCallback.current?.({ sheet: sheet.name, cell: selectedRange ?? selectedCell, part: sheet.part })
  }, [active, sheet?.name, sheet?.part, selectedCell, selectedRange])

  function setDraft(cell: string, text: string) {
    if (!sheet || busyRef.current) return
    editVersion.current++
    baseline.current ??= latest.current
    const key = draftKey(sheet.name, cell)
    if (text === sourceText(cell)) drafts.current.delete(key); else drafts.current.set(key, { sheet: sheet.name, cell, text })
    notifyDrafts()
  }
  function notifyDrafts() { const pending = drafts.current.size > 0 || columnDrafts.current.size > 0; if (!pending) baseline.current = null; onDirtyChange?.(pending); update(value => value + 1) }
  function setColumnWidth(column: number, pixels: number) {
    if (!sheet || busyRef.current) return
    editVersion.current++
    baseline.current ??= latest.current
    const key = draftKey(sheet.name, String(column))
    if (originalColumnWidth(column) === Math.round(pixels)) columnDrafts.current.delete(key)
    else columnDrafts.current.set(key, { type: 'columnWidth', sheet: sheet.name, column, width: columnWidthCharacters(pixels) })
    notifyDrafts()
  }
  function focus(cell: string) {
    setSelectedCell(cell); setAddressInput(cell)
  }
  async function commit(extra: Edit[] = []): Promise<boolean> {
    if (composing.current) { setError('请先完成当前输入，再保存或切换。'); return false }
    const edits: Edit[] = [...drafts.current.values()].map(value => ({ sheet: value.sheet, cell: value.cell, value: inputValue(value.text) }))
    edits.push(...columnDrafts.current.values())
    edits.push(...extra)
    if (!edits.length) return true
    if (busyRef.current) return false
    busyRef.current = true; setBusy(true); setError(null)
    try {
      await onEdit((baseline.current ?? latest.current).binding, { format: 'xlsx', edits })
      drafts.current.clear(); columnDrafts.current.clear(); baseline.current = null; onDirtyChange?.(false); update(value => value + 1)
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  useImperativeHandle(ref, () => ({ flush: () => commit() }))
  async function history(action: () => Promise<void>) {
    if (!await commit()) return
    busyRef.current = true; setBusy(true); setError(null)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.nativeEvent.isComposing) return
    const key = event.key.toLowerCase()
    if (key === 's') { event.preventDefault(); event.stopPropagation(); void (onSave ?? commit)() }
    if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); void history(key === 'y' || event.shiftKey ? onRedo : onUndo) }
  }
  function jump(cell: string) {
    const pos = position(cell)
    if (!pos) { setError('请输入有效单元格地址，例如 A1 或 XFD1048576。'); return }
    const merge = mergedRanges.find(value => rangeContains(value, pos)), target = merge ? cellName(merge.first) : cellName(pos)
    focus(target)
    requestAnimationFrame(() => grid.current?.jump(target))
  }
  async function chooseSheet(name: string) {
    if (!await commit()) return
    setSheetName(name); setSelectedCell('A1'); setAddressInput('A1')
    const target = sheets.find(value => value.name === name); onFocusChange?.({ sheet: name, cell: 'A1', part: target?.part })
  }
  async function applySheetAction() {
    const target = sheetInput.trim()
    if (!target || !sheetAction) return
    if (await commit([sheetAction === 'add' ? { type: 'sheetAdd', name: target } : { type: 'sheetRename', sheet: sheet!.name, name: target }])) {
      setSheetName(target); setSheetAction(null); setSheetInput('')
    }
  }
  async function paste(text: string, startCell: string) {
    if (!sheet) return
    const start = position(startCell)!
    const values = parseTsv(text)
    if (start.row + values.length - 1 > 1048576 || values.some(row => start.column + row.length - 1 > 16384)) { setError('粘贴范围超出工作表边界。'); return }
    for (let row = 0; row < values.length; row++) for (let column = 0; column < values[row].length; column++) {
      const target = { row: start.row + row, column: start.column + column }, merge = mergedRanges.find(value => rangeContains(value, target))
      if (merge && cellName(merge.first) !== cellName(target)) { setError(`粘贴范围覆盖合并单元格，请先在 ${cellName(merge.first)} 编辑主单元格。`); return }
    }
    for (let row = 0; row < values.length; row++) for (let column = 0; column < values[row].length; column++) setDraft(columnName(start.column + column) + (start.row + row), values[row][column])
  }
  const hasUnsavedChanges = dirty || snapshot.draftDirty
  const sheetIndex = sheet ? sheets.indexOf(sheet) : -1
  function sheetCommand(command: string) {
    if (command === 'add' || command === 'rename') {
      setSheetAction(command); setSheetInput(command === 'add' ? '新工作表' : sheet?.name ?? '')
    } else if (sheet) {
      if (command === 'delete') void commit([{ type: 'sheetDelete', sheet: sheet.name }])
      if (command === 'left' || command === 'right') {
        void commit([{ type: 'sheetMove', sheet: sheet.name, index: sheetIndex + (command === 'left' ? -1 : 1) }])
      }
    }
  }

  return <section className="office-leaf-editor office-sheet-editor" aria-label={`${name} Excel 编辑器`} aria-busy={busy} hidden={!active} onKeyDown={keydown}>
    <header className="office-leaf-toolbar"><strong title={name}>{name}</strong><span role="status" className="office-leaf-status">{busy ? '正在处理…' : hasUnsavedChanges ? '有未保存修改' : '已保存'}</span>
      <span className="file-save-pair">
        <button type="button" disabled={busy || !hasUnsavedChanges} onClick={() => void (onSave ?? commit)()}>保存</button>
        {onSaveAs && <button type="button" disabled={busy} onClick={() => void onSaveAs()}>另存为</button>}
      </span>
      {onAutoSaveChange && <label className="office-autosave-toggle"><input type="checkbox" role="switch" checked={autoSave ?? false} onChange={event => onAutoSaveChange(event.target.checked)} />自动保存</label>}
      <button type="button" disabled={busy || (!dirty && !snapshot.history.undoDepth)} onClick={() => void history(onUndo)}>撤销</button>
      <button type="button" disabled={busy || dirty || !snapshot.history.redoDepth} onClick={() => void history(onRedo)}>重做</button>
    </header>
    {sheetAction && <form className="office-leaf-toolbar" onSubmit={event => { event.preventDefault(); void applySheetAction() }}><label>工作表名称 <input autoFocus aria-label="工作表名称" value={sheetInput} onChange={event => setSheetInput(event.target.value)} /></label><button type="submit" disabled={busy}>确定</button><button type="button" onClick={() => setSheetAction(null)}>取消</button></form>}
    <div className="office-sheet-formula"><input aria-label="转到单元格" value={addressInput} onChange={event => setAddressInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jump(addressInput) } }} /><span aria-hidden="true">fx</span>
      <input aria-label="单元格内容或公式" disabled={busy || !sheet} readOnly={selectedSubordinate} title={selectedSubordinate ? `合并单元格，请编辑 ${cellName(selectedMerge!.first)}` : undefined} value={editorText(selectedCell)} onChange={event => setDraft(selectedCell, event.target.value)} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void commit() } }} />
    </div>
    {changedOutside && <p className="office-leaf-message" role="alert">文件已被其他操作更新。当前输入已保留；保存会检查原版本。</p>}
    {error && <p className="office-leaf-message" role="alert">{error}</p>}
    {snapshot.diagnostics?.length ? <p className="office-leaf-message" role="status">{snapshot.diagnostics.map(value => value.message).filter((value, index, all) => all.indexOf(value) === index).join(' ')}</p> : null}
    {mergedRanges.length > 0 && <p className="office-leaf-message">合并单元格请在左上角主单元格编辑。</p>}
    <XlsxCellGrid key={sheet?.part ?? sheet?.name ?? ''} ref={grid} sheetName={sheet?.name ?? ''} selectedCell={selectedCell} rowCount={rowCount} columnCount={columnCount} busy={busy}
      mergedRanges={sheet?.mergedRanges} columnWidth={columnWidth} onColumnWidth={setColumnWidth}
      cell={cell => ({ display: displayText(cell), editor: editorText(cell), formula: cells.get(cell)?.formula !== undefined })}
      onFocus={focus} onSelection={setSelectedRange} onDraft={setDraft} onPaste={(text, cell) => { void paste(text, cell) }} onComposition={value => { composing.current = value }} />
    <nav className="office-sheet-tabs" aria-label="工作表"><span className="office-leaf-hint">{selectedCell}</span>{sheets.map(value => <button type="button" key={value.part ?? value.name} aria-pressed={value.name === sheet?.name} disabled={busy} onClick={() => void chooseSheet(value.name)}>{value.name}</button>)}
      <select aria-label="工作表操作" value="" disabled={busy} onChange={event => sheetCommand(event.target.value)}>
        <option value="">工作表操作</option><option value="add">新增工作表</option><option value="rename" disabled={!sheet}>重命名工作表</option>
        <option value="delete" disabled={!sheet || sheets.length < 2}>删除工作表</option>
        <option value="left" disabled={sheetIndex <= 0}>工作表左移</option>
        <option value="right" disabled={sheetIndex < 0 || sheetIndex >= sheets.length - 1}>工作表右移</option>
      </select>
    </nav>
    <OfficeSelectionTools active={active} selectionKey={`${sheet?.name ?? ''}:${selectedRange ?? ''}`}
      viewport={() => grid.current?.viewport() ?? null} measure={() => selectedRange ? grid.current?.selectionRect() ?? null : null}
      suspended={busy} selection={sheet && selectedRange ? { scope: 'range', focus: { sheet: sheet.name, part: sheet.part, range: selectedRange },
        label: `${sheet.name}!${selectedRange}`, editScope: { format: 'xlsx', sheet: sheet.name, range: selectedRange },
        readEditVersion: () => editVersion.current } : null}>
      {selectedRange && !selectedRange.includes(':') && <QuickBarButton label="编辑单元格" text="编辑单元格" disabled={selectedSubordinate} onClick={() => grid.current?.editCell()} />}
    </OfficeSelectionTools>
  </section>
})
