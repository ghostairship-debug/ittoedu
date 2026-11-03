import { copyElements, isElementDescendantOf, outermostSelectedElementIds, queryRunProps, queryTableGrid, slideOfElement, writableLayerSiblingIds } from '@web-ppt/edit-core'
import type { AlignEdge, Command, Editor, ElementClipboardPayload, ElementId, ElementLayerTarget, ParagraphPropertyInput, RunPropertiesState, RunPropertyOverrides, Selection, SlideId, TextRange } from '@web-ppt/edit-core'
import type { TableRow } from '@web-ppt/core'

/** These helpers only compose SDK commands; the existing File owner still commits bytes/history. */
export function pptxSelectionIds(editor: Editor, slideId: SlideId, selection: Selection = editor.selection): ElementId[] {
  const ids = selection.kind === 'elements' ? selection.ids : selection.kind === 'none' ? [] : [selection.id]
  return outermostSelectedElementIds(editor.doc, ids.filter(id => editor.doc.elements[id] && slideOfElement(editor.doc, id) === slideId))
}

function writable(editor: Editor, id: ElementId): boolean {
  for (let record = editor.doc.elements[id]; record; record = editor.doc.elements[record.parent]) {
    if (record.meta.locked || record.meta.hiddenByUser || record.meta.editable === 'none') return false
  }
  return true
}

export function pptxObjectSelection(editor: Editor, slideId: SlideId): ElementId[] {
  return editor.selection.kind === 'elements' ? pptxSelectionIds(editor, slideId).filter(id => writable(editor, id)) : []
}

function objectTextTargets(editor: Editor, slideId: SlideId): { id: ElementId; range: TextRange }[] {
  return pptxObjectSelection(editor, slideId).flatMap(id => {
    const element = editor.effectiveElement(id)
    if (element.kind !== 'shape' || !element.text?.paragraphs.length) return []
    const p = element.text.paragraphs.length - 1, runs = element.text.paragraphs[p].runs, r = Math.max(0, runs.length - 1)
    return [{ id, range: { from: { p: 0, r: 0, off: 0 }, to: { p, r, off: runs[r]?.text.length ?? 0 } } }]
  })
}

/** The view API requires an active text caret. Object selection formats complete text bodies. */
export function queryPptxObjectRunProps(editor: Editor, slideId: SlideId): RunPropertiesState | null {
  const states = objectTextTargets(editor, slideId).map(({ id, range }) => queryRunProps(editor.doc, id, range))
  if (!states.length) return null
  return Object.fromEntries(Object.entries(states[0]).map(([key, state]) => {
    const mixed = states.some(value => value[key as keyof RunPropertiesState].mixed || value[key as keyof RunPropertiesState].value !== state.value)
    return [key, { value: mixed ? null : state.value, mixed }]
  })) as unknown as RunPropertiesState
}

export type PptxTextFormat = { kind: 'run'; props: RunPropertyOverrides }
  | { kind: 'paragraph'; props: ParagraphPropertyInput } | { kind: 'clear' }
export function formatPptxObjectText(editor: Editor, slideId: SlideId, format: PptxTextFormat): boolean {
  const commands: Command[] = objectTextTargets(editor, slideId).map(target => format.kind === 'clear'
    ? { type: 'ClearFormat', ...target } : format.kind === 'run'
      ? { type: 'SetRunProps', ...target, props: format.props } : { type: 'SetParaProps', ...target, props: format.props })
  if (!commands.length) return false
  editor.transaction(tx => tx.exec(...commands), '设置文字格式')
  return true
}

export function pptxFocus(editor: Editor, slideId: SlideId) {
  const part = editor.doc.slides[slideId]?.origin?.part
  return {
    page: editor.doc.slideOrder.indexOf(slideId), part,
    shapeIds: pptxSelectionIds(editor, slideId).flatMap(id => {
      const origin = editor.doc.elements[id]?.meta.origin
      // Inherited layout/master objects are not writable slide-shape references.
      return origin && part && origin.part === part && !editor.doc.elements[id]?.meta.inherited ? [String(origin.spid)] : []
    }),
  }
}

export function restorePptxSelection(editor: Editor, slideId: SlideId, shapeIds: readonly string[]): void {
  const part = editor.doc.slides[slideId]?.origin?.part, wanted = new Set(shapeIds)
  const ids = Object.values(editor.doc.elements).filter(record => record.meta.origin?.part === part
    && wanted.has(String(record.meta.origin?.spid)) && slideOfElement(editor.doc, record.id) === slideId).map(record => record.id)
  editor.select(ids.length ? { kind: 'elements', ids, enteredGroup: null } : { kind: 'none' })
}

export function selectPptxContextTarget(editor: Editor, slideId: SlideId, targetId: ElementId | null): void {
  if (!targetId || slideOfElement(editor.doc, targetId) !== slideId) { editor.select({ kind: 'none' }); return }
  const selected = pptxSelectionIds(editor, slideId)
  if (selected.some(id => id === targetId || isElementDescendantOf(editor.doc, targetId, id))) return
  const enteredGroup = editor.selection.kind === 'elements' ? editor.selection.enteredGroup : null
  let id = targetId
  while (editor.doc.elements[id]?.parent !== slideId && editor.doc.elements[id]?.parent !== enteredGroup) {
    const parent = editor.doc.elements[id]?.parent
    if (!parent || !editor.doc.elements[parent]) break
    id = parent
  }
  editor.select(writable(editor, id) ? { kind: 'elements', ids: [id], enteredGroup } : { kind: 'none' })
}

export function selectAllPptxObjects(editor: Editor, slideId: SlideId): void {
  const ids = editor.doc.slides[slideId].children.filter(id => writable(editor, id))
  editor.select(ids.length ? { kind: 'elements', ids, enteredGroup: null } : { kind: 'none' })
}

export function copyPptxObjects(editor: Editor, slideId: SlideId): ElementClipboardPayload | null {
  const ids = pptxObjectSelection(editor, slideId)
  if (!ids.length) return null
  const payload = copyElements(editor.doc, ids), tables = clipboardTables(editor, slideId)
  if (!tables.length) return payload
  // SDK 0.5 materializes the edited table grid but leaves append-row templates
  // in source-column order. Project only these derived clipboard templates;
  // the live model, OOXML roots, resources and copy provenance stay unchanged.
  return { ...payload, records: Object.fromEntries(Object.entries(payload.records).map(([key, record]) => {
    if (record.src.kind !== 'table' || !record.src.editInfo?.tableRowAppend) return [key, record]
    const source = tables.find(table => table.meta.origin?.spid === record.meta.sourceSpid)
    if (!source || source.src.kind !== 'table') return [key, record]
    const columns = queryTableGrid(editor.doc, source.id).columns, originalColumns = source.src.colWidths.length
    const project = (row: TableRow): TableRow => ({ ...row, cells: columns.map(column => {
      const index = column.source ?? source.ovr.tableColumns?.[column.id]?.template ?? originalColumns - 1
      const cell = row.cells[index]
      if (!cell) throw new Error('表格列的复制模板已失效，请保存后重新打开原件。')
      return structuredClone(cell)
    }) })
    const append = record.src.editInfo.tableRowAppend
    return [key, { ...record, src: { ...record.src, editInfo: { ...record.src.editInfo, tableRowAppend: {
      ...(append.previousLast ? { previousLast: project(append.previousLast) } : {}),
      regular: [project(append.regular[0]), project(append.regular[1])],
      last: [project(append.last[0]), project(append.last[1])],
    } } } }]
  })) }
}

function clipboardTables(editor: Editor, slideId: SlideId) {
  const roots = pptxObjectSelection(editor, slideId)
  return Object.values(editor.doc.elements).filter(record => record.src.kind === 'table'
    && (record.ovr.tableColumns || record.ovr.tableRemovedColumns)
    && roots.some(id => id === record.id || isElementDescendantOf(editor.doc, record.id, id)))
}
export function pptxClipboardNeedsTableProjection(editor: Editor, slideId: SlideId): boolean {
  return clipboardTables(editor, slideId).length > 0
}

export function pastePptxObjects(editor: Editor, slideId: SlideId, payload: ElementClipboardPayload, enteredGroup: ElementId | null = null): void {
  if (!editor.doc.slides[slideId]) throw new Error('粘贴目标页已不存在。')
  if (enteredGroup && (!editor.doc.elements[enteredGroup] || slideOfElement(editor.doc, enteredGroup) !== slideId)) {
    throw new Error('粘贴目标组合已改变，请重新选择目标。')
  }
  editor.exec({ type: 'PasteElements', payload, at: { parentId: enteredGroup ?? slideId, x: payload.bounds.left + 10, y: payload.bounds.top + 10 } })
}

export function deletePptxObjects(editor: Editor, slideId: SlideId): void {
  const ids = pptxObjectSelection(editor, slideId)
  if (ids.length) editor.transaction(tx => {
    tx.exec(...ids.map(id => ({ type: 'RemoveElement' as const, id }))); tx.select({ kind: 'none' })
  }, '删除对象')
}

/** Preserve selected runs as blocks while composing the SDK's public layer commands. */
export function pptxLayerCommands(editor: Editor, slideId: SlideId, to: ElementLayerTarget): Command[] {
  const ids = pptxObjectSelection(editor, slideId), first = editor.doc.elements[ids[0]]
  if (!first) return []
  if (ids.some(id => editor.doc.elements[id]?.parent !== first.parent || editor.doc.elements[id]?.meta.origin?.part !== first.meta.origin?.part)) {
    throw new Error('请选中同一层级内的对象。')
  }
  const siblings = writableLayerSiblingIds(editor.doc, first), chosen = new Set(ids)
  let ordered = siblings.filter(id => chosen.has(id))
  if (to === 'back') ordered.reverse()
  if (to === 'forward') ordered.reverse()
  if (to === 'forward' || to === 'backward') {
    const unselected = siblings.map((id, index) => chosen.has(id) ? -1 : index).filter(index => index >= 0)
    const edge = to === 'forward' ? unselected.at(-1) : unselected[0]
    ordered = edge === undefined ? [] : ordered.filter(id => to === 'forward' ? siblings.indexOf(id) < edge : siblings.indexOf(id) > edge)
  }
  return ordered.map(id => ({ type: 'SetZ', id, to }))
}

export function arrangePptxObjects(editor: Editor, slideId: SlideId, action: string): void {
  const ids = pptxObjectSelection(editor, slideId)
  if (!ids.length) return
  let commands: Command[] = []
  if (['front', 'back', 'forward', 'backward'].includes(action)) commands = pptxLayerCommands(editor, slideId, action as ElementLayerTarget)
  else if (['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(action)) commands = [{ type: 'AlignElements', ids, edge: action as AlignEdge }]
  else if (action === 'horizontal' || action === 'vertical') commands = [{ type: 'DistributeElements', ids, axis: action }]
  else if (action === 'rotate') commands = ids.map(id => ({ type: 'SetXfrm', id, rot: (editor.effectiveElement(id).rot ?? 0) + 15 }))
  else if (action === 'flipH' || action === 'flipV') commands = ids.map(id => ({ type: 'SetFlip', id,
    ...(action === 'flipH' ? { h: !editor.effectiveElement(id).flipH } : { v: !editor.effectiveElement(id).flipV }),
  }))
  if (commands.length) editor.transaction(tx => tx.exec(...commands), '排列对象')
}

export function insertPptxShape(editor: Editor, slideId: SlideId, preset: string, text = false): ElementId | undefined {
  const before = new Set(Object.keys(editor.doc.elements))
  const { width, height } = editor.doc.meta
  editor.exec({ type: 'AddShape', slideId, preset, rect: { x: width * .12, y: height * .16, w: width * .3, h: text ? height * .13 : height * .24 } })
  const id = Object.keys(editor.doc.elements).find(value => !before.has(value))
  // AddShape allocates its identity in an isolated SDK transaction. Its ID is only
  // available after exec returns. Both synchronous steps reach one deferred File commit.
  if (id && text) editor.exec(
    { type: 'SetFill', id, fill: { type: 'none' } }, { type: 'SetStroke', id, stroke: { type: 'none' } },
    { type: 'EditText', id, ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '双击编辑文字' }] },
    // The default accent shape can inherit white text. A transparent text box
    // starts with a readable 24 pt style instead of carrying that fill contrast.
    { type: 'SetRunProps', id, range: { from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: '双击编辑文字'.length } }, props: { color: '#202124', size: 32 } },
  )
  return id
}

export type PptxTableAction = 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn' | 'merge' | 'split'
export function editPptxTable(editor: Editor, slideId: SlideId, action: PptxTableAction): void {
  const selection = editor.selection, [id] = pptxSelectionIds(editor, slideId)
  if (!id || editor.doc.elements[id]?.src.kind !== 'table') return
  const grid = queryTableGrid(editor.doc, id)
  const cells = selection.kind === 'table' ? selection.cells : selection.kind === 'text' && selection.cell ? [selection.cell] : []
  const cell = cells[0], row = cell && grid.rows[cell.r]?.id, column = cell && grid.columns[cell.c]?.id
  if (action === 'addRow') editor.exec({ type: 'InsertRow', id })
  else if (action === 'addColumn') editor.exec({ type: 'InsertColumn', id })
  else if (action === 'removeRow' && row) editor.exec({ type: 'RemoveRow', id, row })
  else if (action === 'removeColumn' && column) editor.exec({ type: 'RemoveColumn', id, column })
  else if (action === 'split' && row && column) editor.exec({ type: 'SplitCell', id, cell: { row, column } })
  else if (action === 'merge' && cells.length > 1) {
    const rows = cells.map(cell => cell.r), columns = cells.map(cell => cell.c)
    editor.exec({ type: 'MergeCells', id,
      from: { row: grid.rows[Math.min(...rows)].id, column: grid.columns[Math.min(...columns)].id },
      to: { row: grid.rows[Math.max(...rows)].id, column: grid.columns[Math.max(...columns)].id },
    })
  }
}
