import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import {
  openSlideAuthoringSession,
  setSlideEditingScope,
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
})
