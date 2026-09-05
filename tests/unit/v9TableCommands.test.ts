import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import {
  activateSlidePresentationState,
  addSlidePresentationState,
  openSlideAuthoringSession,
  redoSlideAuthoring,
  setSlideEditingScope,
  undoSlideAuthoring,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
} from '@/renderer/course/slideEditorCommands'
import {
  createTableNode,
  rebuildTableItemIds,
} from '@/renderer/project/nativeNodeFactories'
import {
  addSlideTableLayer,
  commitSlideTableLastCellAndAppendRow,
  deleteSlideTableColumn,
  deleteSlideTableRow,
  insertSlideTableColumn,
  insertSlideTableRow,
  patchSlideTableCellStyle,
  patchSlideTableCellText,
  patchSlideTableColumnWidth,
  patchSlideTableRowHeight,
  patchSlideTableStyle,
  reorderSlideTableColumns,
  reorderSlideTableRows,
} from '@/renderer/course/v9TableCommands'

const NOW = '2026-09-04T12:00:00.000Z'

function documentShell(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'test-table-project',
    revision: 1,
    title: 'Table Test Project',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
      colors: [{ id: 'brand', label: '品牌色', color: '#2563eb' }],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    locations: [{
      id: 'loc-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-1',
      sceneId: 'scene-1',
    }],
    startLocationId: 'loc-scene-1',
    globalLayerItems: [],
    globalInteractions: [],
    surfaces: [{
      id: 'surface-1',
      type: 'slide',
      title: '幻灯片表面',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [],
        interactions: [],
      }],
    }],
  })
}

function makeSession(): SlideAuthoringSession {
  return openSlideAuthoringSession(documentShell())
}

function requireSession(result: { ok: boolean; nextSession?: SlideAuthoringSession }) {
  if (!result.ok || !result.nextSession) throw new Error(result.ok ? 'missing session' : 'command failed')
  return result.nextSession
}

function getSlideScene(session: SlideAuthoringSession, sceneIndex = 0) {
  const surface = session.history.present.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('not a slide surface')
  const scene = surface.scenes[sceneIndex]
  if (!scene) throw new Error('missing scene')
  return scene
}

function getNativeItem(scene: ReturnType<typeof getSlideScene>, index = 0) {
  const item = scene.layerItems[index]!
  if (item.kind !== 'native') throw new Error('expected native layer item')
  return item
}

function getTableData(session: SlideAuthoringSession) {
  return (getNativeItem(getSlideScene(session)).content as any).data
}

describe('r12-010-table-core Table Factory & Rebuild IDs', () => {
  it('creates deterministic 3x3 table with header row and unique IDs', () => {
    let counter = 0
    const testIdFactory = () => `id_${++counter}`
    const table = createTableNode({ idFactory: testIdFactory })

    expect(table.columns).toHaveLength(3)
    expect(table.rows).toHaveLength(3)
    expect(table.headerRowCount).toBe(1)
    expect(table.style.lineStyle).toBe('solid')
    expect(table.rows[0]!.cells[0]!.style?.bold).toBe(true)
    expect(table.rows[0]!.cells[0]!.style?.fillColor).toBe('#f3f4f6')

    const colIds = new Set(table.columns.map((c) => c.id))
    expect(colIds.size).toBe(3)

    const cellIds = new Set<string>()
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(3)
      row.cells.forEach((cell, idx) => {
        expect(cellIds.has(cell.id)).toBe(false)
        cellIds.add(cell.id)
        expect(cell.columnId).toBe(table.columns[idx]!.id)
      })
    }
  })

  it('rebuildTableItemIds rebuilds all row, col, and cell IDs while keeping columnId mapping', () => {
    let counter = 100
    const table = createTableNode({ idFactory: () => `${++counter}` })
    const rebuilt = rebuildTableItemIds(table, () => `new_${++counter}`)

    expect(rebuilt.columns.map((c) => c.id)).not.toEqual(table.columns.map((c) => c.id))
    expect(rebuilt.rows.map((r) => r.id)).not.toEqual(table.rows.map((r) => r.id))

    for (let r = 0; r < rebuilt.rows.length; r++) {
      for (let c = 0; c < rebuilt.columns.length; c++) {
        expect(rebuilt.rows[r]!.cells[c]!.columnId).toBe(rebuilt.columns[c]!.id)
        expect(rebuilt.rows[r]!.cells[c]!.id).not.toBe(table.rows[r]!.cells[c]!.id)
      }
    }
  })
})

describe('r12-010-table-core Canonical Table Commands', () => {
  it('adds a Table layer and rejects in global scope', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)

    const tableId = added.selection?.selectionIds[0]!
    const scene = getSlideScene(added.nextSession!)
    const item = scene.layerItems.find((l) => l.layerItemId === tableId)!
    expect(item.kind).toBe('native')
    if (item.kind !== 'native') throw new Error('expected native')
    expect(item.content.nativeType).toBe('table')

    // Reject in global scope
    const globalSession = requireSession(setSlideEditingScope(session, 'global'))
    const rejectGlobal = addSlideTableLayer(globalSession)
    expect(rejectGlobal.ok).toBe(false)
    expect(rejectGlobal.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('patches cell text and validates bounds', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    const tableData = getTableData(added.nextSession!)
    const cellId = tableData.rows[1].cells[1].id

    const patched = patchSlideTableCellText(added.nextSession!, {
      layerItemId: tableId,
      cellId,
      text: '新内容',
    })
    expect(patched.ok).toBe(true)
    expect(patched.historyEntry).toBe(true)

    const nextTableData = getTableData(patched.nextSession!)
    expect(nextTableData.rows[1].cells[1].text).toBe('新内容')

    // Excessive text
    const tooLong = patchSlideTableCellText(patched.nextSession!, {
      layerItemId: tableId,
      cellId,
      text: 'a'.repeat(20001),
    })
    expect(tooLong.ok).toBe(false)
  })

  it('patches table style and cell style', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    const tableData = getTableData(added.nextSession!)
    const cellId = tableData.rows[0].cells[0].id

    const styled = patchSlideTableStyle(added.nextSession!, {
      layerItemId: tableId,
      stylePatch: { fillColor: '#000000', fontSize: 18 },
    })
    expect(styled.ok).toBe(true)
    const nextTable = getTableData(styled.nextSession!)
    expect(nextTable.style.fillColor).toBe('#000000')
    expect(nextTable.style.fontSize).toBe(18)

    const cellStyled = patchSlideTableCellStyle(styled.nextSession!, {
      layerItemId: tableId,
      cellId,
      stylePatch: { textColor: '#ff0000', italic: true },
    })
    expect(cellStyled.ok).toBe(true)
    const nextCell = getTableData(cellStyled.nextSession!).rows[0].cells[0]
    expect(nextCell.style.textColor).toBe('#ff0000')
    expect(nextCell.style.italic).toBe(true)
  })

  it('supports row height and column width patch with valid bounds', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    const tableData = getTableData(added.nextSession!)
    const rowId = tableData.rows[0].id
    const colId = tableData.columns[0].id

    const rowPatched = patchSlideTableRowHeight(added.nextSession!, {
      layerItemId: tableId,
      rowId,
      height: 60,
    })
    expect(rowPatched.ok).toBe(true)

    const colPatched = patchSlideTableColumnWidth(rowPatched.nextSession!, {
      layerItemId: tableId,
      columnId: colId,
      width: 250,
    })
    expect(colPatched.ok).toBe(true)

    // Invalid bounds
    const rowTooSmall = patchSlideTableRowHeight(colPatched.nextSession!, {
      layerItemId: tableId,
      rowId,
      height: 10,
    })
    expect(rowTooSmall.ok).toBe(false)

    const colTooSmall = patchSlideTableColumnWidth(colPatched.nextSession!, {
      layerItemId: tableId,
      columnId: colId,
      width: 15,
    })
    expect(colTooSmall.ok).toBe(false)
  })

  it('inserts, reorders, and deletes rows with ID stability and limits', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    let currentSession = added.nextSession!
    const tableData = getTableData(currentSession)
    const refRowId = tableData.rows[1].id

    // Insert row after
    const inserted = insertSlideTableRow(currentSession, {
      layerItemId: tableId,
      referenceRowId: refRowId,
      position: 'after',
    })
    expect(inserted.ok).toBe(true)
    currentSession = inserted.nextSession!
    let currentTable = getTableData(currentSession)
    expect(currentTable.rows).toHaveLength(4)

    // Reorder rows
    const reversedIds = currentTable.rows.map((r: any) => r.id).reverse()
    const reordered = reorderSlideTableRows(currentSession, {
      layerItemId: tableId,
      orderedRowIds: reversedIds,
    })
    expect(reordered.ok).toBe(true)
    currentSession = reordered.nextSession!
    currentTable = getTableData(currentSession)
    expect(currentTable.rows.map((r: any) => r.id)).toEqual(reversedIds)

    // Delete rows down to 1
    const del1 = deleteSlideTableRow(currentSession, { layerItemId: tableId, rowId: currentTable.rows[0].id })
    currentSession = del1.nextSession!
    currentTable = getTableData(currentSession)
    const del2 = deleteSlideTableRow(currentSession, { layerItemId: tableId, rowId: currentTable.rows[0].id })
    currentSession = del2.nextSession!
    currentTable = getTableData(currentSession)
    const del3 = deleteSlideTableRow(currentSession, { layerItemId: tableId, rowId: currentTable.rows[0].id })
    currentSession = del3.nextSession!
    currentTable = getTableData(currentSession)
    expect(currentTable.rows).toHaveLength(1)

    // Deleting last row must fail
    const delLast = deleteSlideTableRow(currentSession, { layerItemId: tableId, rowId: currentTable.rows[0].id })
    expect(delLast.ok).toBe(false)
    expect(delLast.reason).toBe('invalid-data')
  })

  it('inserts, reorders, and deletes columns and syncs cells across all rows', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    let currentSession = added.nextSession!
    const tableData = getTableData(currentSession)
    const refColId = tableData.columns[1].id

    // Insert column
    const inserted = insertSlideTableColumn(currentSession, {
      layerItemId: tableId,
      referenceColumnId: refColId,
      position: 'before',
    })
    expect(inserted.ok).toBe(true)
    currentSession = inserted.nextSession!
    let currentTable = getTableData(currentSession)
    expect(currentTable.columns).toHaveLength(4)
    for (const row of currentTable.rows) {
      expect(row.cells).toHaveLength(4)
    }

    // Reorder columns
    const reversedIds = currentTable.columns.map((c: any) => c.id).reverse()
    const reordered = reorderSlideTableColumns(currentSession, {
      layerItemId: tableId,
      orderedColumnIds: reversedIds,
    })
    expect(reordered.ok).toBe(true)
    currentSession = reordered.nextSession!
    currentTable = getTableData(currentSession)
    expect(currentTable.columns.map((c: any) => c.id)).toEqual(reversedIds)
    for (const row of currentTable.rows) {
      expect(row.cells.map((cell: any) => cell.columnId)).toEqual(reversedIds)
    }

    // Delete columns down to 1
    const del1 = deleteSlideTableColumn(currentSession, { layerItemId: tableId, columnId: currentTable.columns[0].id })
    currentSession = del1.nextSession!
    currentTable = getTableData(currentSession)
    const del2 = deleteSlideTableColumn(currentSession, { layerItemId: tableId, columnId: currentTable.columns[0].id })
    currentSession = del2.nextSession!
    currentTable = getTableData(currentSession)
    const del3 = deleteSlideTableColumn(currentSession, { layerItemId: tableId, columnId: currentTable.columns[0].id })
    currentSession = del3.nextSession!
    currentTable = getTableData(currentSession)
    expect(currentTable.columns).toHaveLength(1)

    // Deleting last column must fail
    const delLast = deleteSlideTableColumn(currentSession, { layerItemId: tableId, columnId: currentTable.columns[0].id })
    expect(delLast.ok).toBe(false)
    expect(delLast.reason).toBe('invalid-data')
  })

  it('rejects stale revision and locked layers with zero modification', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!

    // Stale revision
    const staleResult = patchSlideTableCellText(added.nextSession!, {
      layerItemId: tableId,
      cellId: 'any',
      text: 'fail',
    }, { expectedRevision: 999 })
    expect(staleResult.ok).toBe(false)
    expect(staleResult.reason).toBe(SLIDE_REJECT_STALE_REVISION)

    // Lock layer
    const lockedDoc = structuredClone(added.nextSession!.history.present)
    const slideSurface = lockedDoc.surfaces[0]
    if (slideSurface && slideSurface.type === 'slide') {
      slideSurface.scenes[0]!.layerItems[0]!.locked = true
    }
    const lockedSession = openSlideAuthoringSession(lockedDoc)

    const lockedResult = patchSlideTableCellText(lockedSession, {
      layerItemId: tableId,
      cellId: 'any',
      text: 'fail',
    })
    expect(lockedResult.ok).toBe(false)
    expect(lockedResult.reason).toBe(SLIDE_REJECT_LOCKED)
  })

  it('maintains state isolation with nativeData override and does not pollute base or sibling state', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    let cur = added.nextSession!
    const baseTable = getTableData(cur)
    const targetCellId = baseTable.rows[0].cells[0].id

    // Add state A and state B
    const addStateAResult = addSlidePresentationState(cur, 'State A')
    expect(addStateAResult.ok).toBe(true)
    cur = addStateAResult.nextSession!
    const stateAId = cur.selection.stateId!
    expect(stateAId).toBeDefined()

    const addStateBResult = addSlidePresentationState(cur, 'State B')
    expect(addStateBResult.ok).toBe(true)
    cur = addStateBResult.nextSession!
    const stateBId = cur.selection.stateId!
    expect(stateBId).toBeDefined()

    // Activate state A
    const activateAResult = activateSlidePresentationState(cur, stateAId)
    cur = activateAResult.nextSession!
    expect(cur.selection.stateId).toBe(stateAId)

    // Edit cell text in State A
    const editResult = patchSlideTableCellText(cur, {
      layerItemId: tableId,
      cellId: targetCellId,
      text: 'Text in State A',
    })
    expect(editResult.ok).toBe(true)
    cur = editResult.nextSession!

    // Verify: State A has nativeData override with the updated rows
    const scene = getSlideScene(cur)
    const stateA = scene.presentation?.states.find((s) => s.id === stateAId)
    expect(stateA?.layerItemOverrides[tableId]?.nativeData?.rows).toBeDefined()

    // Verify: Base scene layer item content data is UNPOLLUTED
    const baseItem = scene.layerItems.find((l) => l.layerItemId === tableId)!
    if (baseItem.kind !== 'native') throw new Error('expected native')
    const baseData = baseItem.content.data as any
    expect(baseData.rows[0].cells[0].text).toBe('标题 1')

    // Switch to State B: verify it sees base data (unpolluted)
    const activateBResult = activateSlidePresentationState(cur, stateBId)
    cur = activateBResult.nextSession!
    const stateB = scene.presentation?.states.find((s) => s.id === stateBId)
    expect(stateB?.layerItemOverrides[tableId]?.nativeData).toBeUndefined()

    // Switch to base state (null): verify it sees base data
    const activateBaseResult = activateSlidePresentationState(cur, null)
    cur = activateBaseResult.nextSession!
    expect(getTableData(cur).rows[0].cells[0].text).toBe('标题 1')

    // Switch back to State A: edit style
    cur = activateSlidePresentationState(cur, stateAId).nextSession!
    const styleResult = patchSlideTableStyle(cur, {
      layerItemId: tableId,
      stylePatch: { fillColor: '#aabbcc' },
    })
    expect(styleResult.ok).toBe(true)
    cur = styleResult.nextSession!

    // Base style remains unpolluted
    const curScene = getSlideScene(cur)
    const curBaseItem = curScene.layerItems.find((l) => l.layerItemId === tableId)!
    if (curBaseItem.kind !== 'native') throw new Error('expected native')
    expect((curBaseItem.content.data as any).style.fillColor).not.toBe('#aabbcc')

    // Reset cell text back to base in State A
    const resetTextResult = patchSlideTableCellText(cur, {
      layerItemId: tableId,
      cellId: targetCellId,
      text: '标题 1',
    })
    expect(resetTextResult.ok).toBe(true)
    cur = resetTextResult.nextSession!
    const curStateA = getSlideScene(cur).presentation?.states.find((s) => s.id === stateAId)!
    // rows diff is removed because it now matches base!
    expect(curStateA.layerItemOverrides[tableId]?.nativeData?.rows).toBeUndefined()
    // style diff remains
    expect(curStateA.layerItemOverrides[tableId]?.nativeData?.style).toBeDefined()
  })

  it('creates and edits Table on Slide surface scope without touching scene base', () => {
    const session = makeSession()
    // Switch to surface scope
    const surfaceSession = requireSession(setSlideEditingScope(session, 'surface'))
    expect(surfaceSession.scope).toBe('surface')

    // Add table to surface
    const added = addSlideTableLayer(surfaceSession, { label: 'Surface Table' })
    expect(added.ok).toBe(true)
    const tableId = added.selection?.selectionIds[0]!
    let cur = added.nextSession!

    // Verify it is in surfaceLayerItems, not scene.layerItems
    const surface = cur.history.present.surfaces[0]!
    expect(surface.surfaceLayerItems).toHaveLength(1)
    const surfaceItem = surface.surfaceLayerItems[0]!.item
    expect(surfaceItem.layerItemId).toBe(tableId)
    const scene = getSlideScene(cur)
    expect(scene.layerItems).toHaveLength(0)

    // Edit cell text in surface scope
    if (surfaceItem.kind !== 'native') throw new Error('expected native')
    const surfaceTable = surfaceItem.content.data as any
    const cellId = surfaceTable.rows[0].cells[0].id
    const patched = patchSlideTableCellText(cur, {
      layerItemId: tableId,
      cellId,
      text: 'Surface Cell Content',
    })
    expect(patched.ok).toBe(true)
    cur = patched.nextSession!
    const curSurfaceItem = cur.history.present.surfaces[0]!.surfaceLayerItems[0]!.item
    if (curSurfaceItem.kind !== 'native') throw new Error('expected native')
    const curSurfaceTable = curSurfaceItem.content.data as any
    expect(curSurfaceTable.rows[0].cells[0].text).toBe('Surface Cell Content')

    // Editing surface table from scene scope must be rejected
    const sceneScopeSession = requireSession(setSlideEditingScope(cur, 'scene'))
    const rejectFromScene = patchSlideTableCellText(sceneScopeSession, {
      layerItemId: tableId,
      cellId,
      text: 'Forbidden',
    })
    expect(rejectFromScene.ok).toBe(false)
    expect(rejectFromScene.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('rejects cross-scope edits with SLIDE_REJECT_WRONG_OWNER', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    const cur = added.nextSession!
    const cellId = getTableData(cur).rows[0].cells[0].id

    // Attempting to edit scene table from surface scope
    const surfaceSession = requireSession(setSlideEditingScope(cur, 'surface'))
    const rejectSurface = patchSlideTableCellText(surfaceSession, {
      layerItemId: tableId,
      cellId,
      text: 'Should Fail',
    })
    expect(rejectSurface.ok).toBe(false)
    expect(rejectSurface.reason).toBe(SLIDE_REJECT_WRONG_OWNER)

    // Attempting to edit scene table from global scope
    const globalSession = requireSession(setSlideEditingScope(cur, 'global'))
    const rejectGlobal = patchSlideTableCellText(globalSession, {
      layerItemId: tableId,
      cellId,
      text: 'Should Fail',
    })
    expect(rejectGlobal.ok).toBe(false)
    expect(rejectGlobal.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('executes commitSlideTableLastCellAndAppendRow atomically, supports Undo/Redo, and rolls back on failure', () => {
    const session = makeSession()
    const added = addSlideTableLayer(session)
    const tableId = added.selection?.selectionIds[0]!
    const initialSession = added.nextSession!
    const initialRevision = initialSession.history.present.revision
    const initialTable = getTableData(initialSession)
    expect(initialTable.rows).toHaveLength(3)

    const lastRow = initialTable.rows[2]!
    const lastCell = lastRow.cells[2]!
    const nonLastCell = initialTable.rows[0]!.cells[0]!

    // 1. Failure on non-last cell: zero writes
    const nonLastResult = commitSlideTableLastCellAndAppendRow(initialSession, {
      layerItemId: tableId,
      cellId: nonLastCell.id,
      text: 'Should Fail',
    })
    expect(nonLastResult.ok).toBe(false)
    expect(nonLastResult.reason).toBe('invalid-target')
    expect(nonLastResult.nextSession).toBeDefined()
    const nonLastFailSession = nonLastResult.nextSession!
    expect(nonLastFailSession.history.present.revision).toBe(initialRevision)
    expect(getTableData(nonLastFailSession).rows).toHaveLength(3)
    expect(getTableData(nonLastFailSession).rows[0].cells[0].text).toBe('标题 1')

    // 2. Failure with oversized text: zero writes
    const tooLongResult = commitSlideTableLastCellAndAppendRow(initialSession, {
      layerItemId: tableId,
      cellId: lastCell.id,
      text: 'x'.repeat(20001),
    })
    expect(tooLongResult.ok).toBe(false)
    expect(tooLongResult.reason).toBe('invalid-data')
    expect(tooLongResult.nextSession).toBeDefined()
    expect(tooLongResult.nextSession!.history.present.revision).toBe(initialRevision)

    // 3. Failure on stale revision: zero writes
    const staleResult = commitSlideTableLastCellAndAppendRow(initialSession, {
      layerItemId: tableId,
      cellId: lastCell.id,
      text: 'Valid',
    }, { expectedRevision: 999 })
    expect(staleResult.ok).toBe(false)
    expect(staleResult.reason).toBe(SLIDE_REJECT_STALE_REVISION)

    // 4. Successful commit on last cell
    const successResult = commitSlideTableLastCellAndAppendRow(initialSession, {
      layerItemId: tableId,
      cellId: lastCell.id,
      text: 'Completed Answer',
    })
    expect(successResult.ok).toBe(true)
    expect(successResult.historyEntry).toBe(true)
    expect(successResult.nextSession).toBeDefined()
    const successSession = successResult.nextSession!
    expect(successSession.history.present.revision).toBe(initialRevision + 1)

    // Verify focus result
    expect(successResult.focusResult).toBeDefined()
    const focus = successResult.focusResult!
    expect(focus.targetColumnId).toBe(initialTable.columns[0].id)

    // Verify table structure: row 2 text updated, row 3 appended
    const updatedTable = getTableData(successSession)
    expect(updatedTable.rows).toHaveLength(4)
    expect(updatedTable.rows[2].cells[2].text).toBe('Completed Answer')
    expect(updatedTable.rows[3].id).toBe(focus.newRowId)
    expect(updatedTable.rows[3].cells[0].id).toBe(focus.newCellId)
    expect(updatedTable.rows[3].cells[0].text).toBe('')
    expect(updatedTable.rows[3].cells[1].text).toBe('')
    expect(updatedTable.rows[3].cells[2].text).toBe('')

    // 5. Undo: BOTH text change and appended row are reverted in a SINGLE undo step
    const undone = undoSlideAuthoring(successSession)
    expect(undone.ok).toBe(true)
    const undoneTable = getTableData(undone.nextSession!)
    expect(undoneTable.rows).toHaveLength(3)
    expect(undoneTable.rows[2].cells[2].text).toBe('单元格 3-3')

    // 6. Redo: BOTH text change and appended row are restored in a SINGLE redo step
    const redone = redoSlideAuthoring(undone.nextSession!)
    expect(redone.ok).toBe(true)
    const redoneTable = getTableData(redone.nextSession!)
    expect(redoneTable.rows).toHaveLength(4)
    expect(redoneTable.rows[2].cells[2].text).toBe('Completed Answer')
  })
})

