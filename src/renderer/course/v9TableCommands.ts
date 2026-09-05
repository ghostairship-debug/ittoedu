import { nanoid } from 'nanoid'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type {
  NativeTableCell,
  NativeTableCellStyle,
  NativeTableColumn,
  NativeTableContent,
  NativeTableRow,
  NativeTableStyle,
} from '../../shared/contracts/native-v1/types'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  SlideCommandError,
  commitSlideAuthoringHistory,
  commitSlideProjectMutation,
  selectSlideEditorLayers,
  type SlideAuthoringSelection,
  type SlideAuthoringSessionRef,
  type SlideCommandOptions,
  type SlideCommandResult,
} from './slideEditorCommands'
import {
  allocateCourseLayerOrder,
} from './globalLayerCommands'
import type { SlideAuthoringSession } from './slideAuthoringBackend'
import {
  createTableLayerItem,
  createTableNode,
  type IdFactory,
  type TableNodeOptions,
} from '../project/nativeNodeFactories'
import { offsetDefaultSlideInsertion } from './v9SlideContentCommands'

export interface AddSlideTableLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly columns?: NativeTableColumn[]
  readonly rows?: NativeTableRow[]
  readonly headerRowCount?: number
  readonly style?: Partial<NativeTableStyle>
  readonly label?: string
}

function freezeSelection(selection: SlideAuthoringSelection): SlideAuthoringSelection {
  return Object.freeze({
    locationId: selection.locationId,
    stateId: selection.stateId,
    selectionIds: Object.freeze([...selection.selectionIds]),
  })
}

function freezeSession(session: SlideAuthoringSessionRef): SlideAuthoringSession {
  return Object.freeze({
    sessionId: session.sessionId,
    history: Object.freeze({
      present: session.history.present,
      past: Object.freeze([...session.history.past]),
      future: Object.freeze([...session.history.future]),
    }),
    selection: freezeSelection(session.selection),
    scope: session.scope,
    generation: session.generation,
  })
}

function succeed(
  next: SlideAuthoringSessionRef,
  historyEntry: boolean,
): SlideCommandResult {
  const session = freezeSession(next)
  return {
    ok: true,
    nextSession: session,
    historyEntry,
    selection: session.selection,
  }
}

function reject(session: SlideAuthoringSessionRef, reason: string): SlideCommandResult {
  const current = freezeSession(session)
  return {
    ok: false,
    reason,
    nextSession: current,
    historyEntry: false,
    selection: current.selection,
  }
}

function rejectIfStale(
  session: SlideAuthoringSessionRef,
  expectedRevision?: number,
): SlideCommandResult | null {
  if (
    expectedRevision !== undefined &&
    expectedRevision !== session.history.present.revision
  ) {
    return reject(session, SLIDE_REJECT_STALE_REVISION)
  }
  return null
}

function catchCommand(session: SlideAuthoringSessionRef, error: unknown): SlideCommandResult {
  if (error instanceof SlideCommandError) return reject(session, error.reason)
  if (error instanceof Error) return reject(session, error.message)
  return reject(session, '命令失败')
}

function slideSceneContext(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} {
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { location, surface, scene }
}

function requireSceneScope(session: SlideAuthoringSessionRef): void {
  if (session.scope !== 'scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '表格只能添加到幻灯片场景内')
  }
}

function nextSceneLayerOrder(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
): number {
  const preferred = Math.max(-1, ...scene.layerItems.map((item) => item.order)) + 1
  return allocateCourseLayerOrder(project, Math.max(0, preferred))
}

function appendSceneLayer(
  project: CourseProjectDocument,
  scene: SlideSceneDocument,
  item: LayerItem,
  stateId: string | null,
): void {
  if (scene.layerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (scene.layerItems.some((candidate) => candidate.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSceneLayerOrder(project, scene)
  if (stateId) {
    const presentationState = scene.presentation?.states.find(
      (candidate) => candidate.id === stateId,
    )
    if (!presentationState) throw new Error(`找不到命名状态：${stateId}`)
    item.visible = false
    presentationState.layerItemOverrides[item.layerItemId] = { visible: true }
  }
  scene.layerItems.push(item)
  scene.layerItems.sort((a, b) => a.order - b.order || a.layerItemId.localeCompare(b.layerItemId))
}

function selectAdded(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  layerItemId: string,
): SlideAuthoringSelection {
  return selectSlideEditorLayers({
    project,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
    selectionIds: [layerItemId],
  })
}

function commitAdded(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
  layerItemId: string,
): SlideCommandResult {
  return succeed({
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection: selectAdded(session, project, layerItemId),
    scope: session.scope,
    generation: session.generation,
  }, true)
}

function commitUpdated(
  session: SlideAuthoringSessionRef,
  project: CourseProjectDocument,
): SlideCommandResult {
  return succeed({
    sessionId: session.sessionId,
    history: commitSlideAuthoringHistory(session.history, project),
    selection: session.selection,
    scope: session.scope,
    generation: session.generation,
  }, true)
}

function requireTableLayer(
  scene: SlideSceneDocument,
  layerItemId: string,
): { item: LayerItem; table: NativeTableContent } {
  const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item) {
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  if (item.locked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '所选元素已锁定，无法修改')
  }
  if (item.kind !== 'native' || item.content.nativeType !== 'table') {
    throw new SlideCommandError('invalid-target', '所选元素不是表格')
  }
  return { item, table: item.content.data }
}

export function addSlideTableLayer(
  session: SlideAuthoringSession,
  input: AddSlideTableLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const { scene } = slideSceneContext(session.history.present, session)
    const existingCount = scene.layerItems.length

    const tableNode = createTableNode({
      id: input.id,
      name: input.label ?? '表格',
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      columns: input.columns,
      rows: input.rows,
      headerRowCount: input.headerRowCount,
      style: input.style,
    })

    // Validate against strict table schema
    tableNativeContentObjectSchema.parse({
      columns: tableNode.columns,
      rows: tableNode.rows,
      headerRowCount: tableNode.headerRowCount,
      style: tableNode.style,
    })

    const positioned = offsetDefaultSlideInsertion(
      tableNode,
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const layerItem = createTableLayerItem(positioned)

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene: draftScene } = slideSceneContext(draft, session)
      appendSceneLayer(draft, draftScene, layerItem, session.selection.stateId)
    }, options.now)

    return commitAdded(session, project, layerItem.layerItemId)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideTableCellText(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly cellId: string
    readonly text: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    if (typeof input.text !== 'string' || input.text.length > 20000) {
      throw new SlideCommandError('invalid-data', '单元格文本长度超出上限')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      let found = false
      for (const row of table.rows) {
        const cell = row.cells.find((c) => c.id === input.cellId)
        if (cell) {
          if (cell.text === input.text) return // no-op
          cell.text = input.text
          found = true
          break
        }
      }
      if (!found) {
        throw new SlideCommandError('invalid-target', `找不到单元格：${input.cellId}`)
      }

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideTableStyle(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly stylePatch: Partial<NativeTableStyle>
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      const candidateStyle = {
        ...table.style,
        ...input.stylePatch,
      }
      const candidateTable = {
        ...table,
        style: candidateStyle,
      }
      tableNativeContentObjectSchema.parse(candidateTable)
      table.style = candidateStyle
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideTableCellStyle(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly cellId: string
    readonly stylePatch: Partial<NativeTableCellStyle>
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      let targetCell: NativeTableCell | undefined
      for (const row of table.rows) {
        const found = row.cells.find((c) => c.id === input.cellId)
        if (found) {
          targetCell = found
          break
        }
      }
      if (!targetCell) {
        throw new SlideCommandError('invalid-target', `找不到单元格：${input.cellId}`)
      }

      const nextStyle = {
        ...(targetCell.style ?? {}),
        ...input.stylePatch,
      }
      // Clean undefined keys
      for (const key of Object.keys(nextStyle) as (keyof NativeTableCellStyle)[]) {
        if (nextStyle[key] === undefined) delete nextStyle[key]
      }
      targetCell.style = Object.keys(nextStyle).length > 0 ? nextStyle : undefined

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideTableRowHeight(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly rowId: string
    readonly height: number
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    if (!Number.isFinite(input.height) || input.height < 20 || input.height > 2000) {
      throw new SlideCommandError('invalid-data', '行高必须介于 20 到 2000 之间')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      const row = table.rows.find((r) => r.id === input.rowId)
      if (!row) throw new SlideCommandError('invalid-target', `找不到行：${input.rowId}`)
      row.height = input.height

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideTableColumnWidth(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly columnId: string
    readonly width: number
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    if (!Number.isFinite(input.width) || input.width < 24 || input.width > 2000) {
      throw new SlideCommandError('invalid-data', '列宽必须介于 24 到 2000 之间')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      const col = table.columns.find((c) => c.id === input.columnId)
      if (!col) throw new SlideCommandError('invalid-target', `找不到列：${input.columnId}`)
      col.width = input.width

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function insertSlideTableRow(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly referenceRowId: string
    readonly position: 'before' | 'after'
    readonly idFactory?: IdFactory
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (table.rows.length >= 1000) {
        throw new SlideCommandError('invalid-data', '表格行数已达上限（1000 行）')
      }

      const refIndex = table.rows.findIndex((r) => r.id === input.referenceRowId)
      if (refIndex < 0) {
        throw new SlideCommandError('invalid-target', `找不到参考行：${input.referenceRowId}`)
      }

      const insertIndex = input.position === 'before' ? refIndex : refIndex + 1
      const refRow = table.rows[refIndex]!

      const newRowId = `row_${idFactory()}`
      const newCells: NativeTableCell[] = table.columns.map((col) => ({
        id: `cell_${idFactory()}`,
        columnId: col.id,
        text: '',
      }))

      const newRow: NativeTableRow = {
        id: newRowId,
        height: refRow.height,
        cells: newCells,
      }

      table.rows.splice(insertIndex, 0, newRow)

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideTableRow(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly rowId: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (table.rows.length <= 1) {
        throw new SlideCommandError('invalid-data', '表格至少需要保留一行')
      }

      const index = table.rows.findIndex((r) => r.id === input.rowId)
      if (index < 0) {
        throw new SlideCommandError('invalid-target', `找不到行：${input.rowId}`)
      }

      table.rows.splice(index, 1)
      if (table.headerRowCount > table.rows.length) {
        table.headerRowCount = table.rows.length
      }

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlideTableRows(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly orderedRowIds: readonly string[]
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (
        input.orderedRowIds.length !== table.rows.length ||
        new Set(input.orderedRowIds).size !== table.rows.length
      ) {
        throw new SlideCommandError('invalid-data', '行重排 ID 列表长度或唯一性无效')
      }

      const rowMap = new Map(table.rows.map((r) => [r.id, r]))
      const nextRows: NativeTableRow[] = []
      for (const id of input.orderedRowIds) {
        const row = rowMap.get(id)
        if (!row) {
          throw new SlideCommandError('invalid-data', `行 ID 不存在：${id}`)
        }
        nextRows.push(row)
      }

      table.rows = nextRows
      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function insertSlideTableColumn(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly referenceColumnId: string
    readonly position: 'before' | 'after'
    readonly width?: number
    readonly idFactory?: IdFactory
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (table.columns.length >= 100) {
        throw new SlideCommandError('invalid-data', '表格列数已达上限（100 列）')
      }

      const refIndex = table.columns.findIndex((c) => c.id === input.referenceColumnId)
      if (refIndex < 0) {
        throw new SlideCommandError('invalid-target', `找不到参考列：${input.referenceColumnId}`)
      }

      const insertIndex = input.position === 'before' ? refIndex : refIndex + 1
      const refCol = table.columns[refIndex]!

      const newColId = `col_${idFactory()}`
      const newColumn: NativeTableColumn = {
        id: newColId,
        width: input.width ?? refCol.width,
      }

      table.columns.splice(insertIndex, 0, newColumn)

      // Insert matching cell in every row at insertIndex
      for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
        const row = table.rows[rIdx]!
        const isHeader = rIdx < table.headerRowCount
        const newCell: NativeTableCell = {
          id: `cell_${idFactory()}`,
          columnId: newColId,
          text: '',
          style: isHeader ? { bold: true, fillColor: '#f3f4f6' } : undefined,
        }
        row.cells.splice(insertIndex, 0, newCell)
      }

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideTableColumn(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly columnId: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (table.columns.length <= 1) {
        throw new SlideCommandError('invalid-data', '表格至少需要保留一列')
      }

      const colIndex = table.columns.findIndex((c) => c.id === input.columnId)
      if (colIndex < 0) {
        throw new SlideCommandError('invalid-target', `找不到列：${input.columnId}`)
      }

      table.columns.splice(colIndex, 1)

      // Remove matching cell in every row
      for (const row of table.rows) {
        row.cells = row.cells.filter((c) => c.columnId !== input.columnId)
      }

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlideTableColumns(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly orderedColumnIds: readonly string[]
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    requireSceneScope(session)
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const { scene } = slideSceneContext(draft, session)
      const { table } = requireTableLayer(scene, input.layerItemId)

      if (
        input.orderedColumnIds.length !== table.columns.length ||
        new Set(input.orderedColumnIds).size !== table.columns.length
      ) {
        throw new SlideCommandError('invalid-data', '列重排 ID 列表长度或唯一性无效')
      }

      const colMap = new Map(table.columns.map((c) => [c.id, c]))
      const nextColumns: NativeTableColumn[] = []
      for (const id of input.orderedColumnIds) {
        const col = colMap.get(id)
        if (!col) {
          throw new SlideCommandError('invalid-data', `列 ID 不存在：${id}`)
        }
        nextColumns.push(col)
      }

      table.columns = nextColumns

      // Reorder cells in each row to match nextColumns order
      for (const row of table.rows) {
        const cellByColId = new Map(row.cells.map((cell) => [cell.columnId, cell]))
        row.cells = nextColumns.map((col) => {
          const cell = cellByColId.get(col.id)
          if (!cell) throw new Error(`列 ${col.id} 缺少对应单元格`)
          return cell
        })
      }

      tableNativeContentObjectSchema.parse(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}
