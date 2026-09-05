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
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
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

export interface CommitSlideTableLastCellAndAppendRowInput {
  readonly layerItemId: string
  readonly cellId: string
  readonly text: string
  readonly idFactory?: IdFactory
}

export interface CommitSlideTableLastCellAndAppendRowResult extends SlideCommandResult {
  readonly focusResult?: {
    readonly newRowId: string
    readonly newCellId: string
    readonly targetColumnId: string
  }
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sparseObjectDiff(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (sameJson(base[key], next[key])) continue
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      diff[key] = null
    } else {
      const baseVal = base[key]
      const nextVal = next[key]
      if (isPlainRecord(baseVal) && isPlainRecord(nextVal)) {
        const nestedDiff = sparseObjectDiff(baseVal, nextVal)
        if (Object.keys(nestedDiff).length > 0) {
          diff[key] = nestedDiff
        }
      } else {
        diff[key] = structuredClone(nextVal)
      }
    }
  }
  return diff
}

function deleteEmptyOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  const override = overrides[layerItemId]
  if (override && Object.keys(override).length === 0) {
    delete overrides[layerItemId]
  }
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

function nextSurfaceLayerOrder(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
): number {
  const preferred = Math.max(-1, ...surface.surfaceLayerItems.map((entry) => entry.item.order)) + 1
  return allocateCourseLayerOrder(project, Math.max(0, preferred))
}

function appendSurfaceLayer(
  project: CourseProjectDocument,
  surface: SlideSurfaceDocument,
  item: LayerItem,
): void {
  if (surface.surfaceLayerItems.length >= MAX_SCENE_NODES) {
    throw new Error(`已达到 ${MAX_SCENE_NODES} 个节点上限`)
  }
  if (surface.surfaceLayerItems.some((entry) => entry.item.layerItemId === item.layerItemId)) {
    throw new Error(`图层 ID 已存在：${item.layerItemId}`)
  }
  item.order = nextSurfaceLayerOrder(project, surface)
  surface.surfaceLayerItems.push({
    item,
    visibility: { mode: 'all', locationIds: [] },
  })
  surface.surfaceLayerItems.sort((a, b) =>
    a.item.order - b.item.order || a.item.layerItemId.localeCompare(b.item.layerItemId),
  )
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

interface ResolvedTableTarget {
  readonly item: LayerItem
  readonly table: NativeTableContent
  commit(nextTable: NativeTableContent): void
}

function resolveTableTarget(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): ResolvedTableTarget {
  if (session.scope === 'global') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '表格只能在幻灯片场景或本页中使用')
  }
  if (session.scope !== 'scene' && session.scope !== 'surface') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '表格只能在幻灯片场景或本页中使用')
  }

  const { surface, scene } = slideSceneContext(project, session)

  if (session.scope === 'surface') {
    const scoped = surface.surfaceLayerItems.find(
      (entry) => entry.item.layerItemId === layerItemId,
    )
    if (!scoped) {
      if (scene.layerItems.some((candidate) => candidate.layerItemId === layerItemId)) {
        throw new SlideCommandError(
          SLIDE_REJECT_WRONG_OWNER,
          '当前元素属于场景层，请切换到场景层编辑',
        )
      }
      throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
    }
    if (scoped.item.locked) {
      throw new SlideCommandError(SLIDE_REJECT_LOCKED, '所选元素已锁定，无法修改')
    }
    const nativeScopedItem = scoped.item
    if (nativeScopedItem.kind !== 'native' || nativeScopedItem.content.nativeType !== 'table') {
      throw new SlideCommandError('invalid-target', '所选元素不是表格')
    }
    const table = structuredClone(nativeScopedItem.content.data as NativeTableContent)
    return {
      item: nativeScopedItem,
      table,
      commit(nextTable: NativeTableContent) {
        tableNativeContentObjectSchema.parse(nextTable)
        nativeScopedItem.content.data = structuredClone(nextTable)
      },
    }
  }

  // session.scope === 'scene'
  const baseItem = scene.layerItems.find(
    (candidate) => candidate.layerItemId === layerItemId,
  )
  if (!baseItem) {
    if (surface.surfaceLayerItems.some((entry) => entry.item.layerItemId === layerItemId)) {
      throw new SlideCommandError(
        SLIDE_REJECT_WRONG_OWNER,
        '当前元素属于本页层，请切换到本页层编辑',
      )
    }
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  const stateId = session.selection.stateId
  const state = stateId
    ? scene.presentation?.states.find((candidate) => candidate.id === stateId)
    : undefined
  if (stateId && !state) {
    throw new Error(`找不到命名状态：${stateId}`)
  }
  const override = state ? state.layerItemOverrides[layerItemId] : undefined
  const isLocked = override?.locked ?? baseItem.locked
  if (isLocked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '所选元素已锁定，无法修改')
  }
  const nativeBaseItem = baseItem
  if (nativeBaseItem.kind !== 'native' || nativeBaseItem.content.nativeType !== 'table') {
    throw new SlideCommandError('invalid-target', '所选元素不是表格')
  }

  if (!state) {
    const table = structuredClone(nativeBaseItem.content.data as NativeTableContent)
    return {
      item: nativeBaseItem,
      table,
      commit(nextTable: NativeTableContent) {
        tableNativeContentObjectSchema.parse(nextTable)
        nativeBaseItem.content.data = structuredClone(nextTable)
      },
    }
  }

  const currentOverride = state.layerItemOverrides[layerItemId] ?? {}
  const currentData = currentOverride.nativeData
    ? (mergeCourseNativeData(
        nativeBaseItem.content.data as unknown as Record<string, unknown>,
        currentOverride.nativeData,
      ) as unknown as NativeTableContent)
    : structuredClone(nativeBaseItem.content.data as NativeTableContent)

  return {
    item: nativeBaseItem,
    table: currentData,
    commit(nextTable: NativeTableContent) {
      tableNativeContentObjectSchema.parse(nextTable)
      const nextNative = sparseObjectDiff(
        nativeBaseItem.content.data as unknown as Record<string, unknown>,
        nextTable as unknown as Record<string, unknown>,
      )
      const itemOverride = state.layerItemOverrides[layerItemId] ?? {}
      if (Object.keys(nextNative).length === 0) {
        delete itemOverride.nativeData
      } else {
        itemOverride.nativeData = nextNative
      }
      state.layerItemOverrides[layerItemId] = itemOverride
      deleteEmptyOverride(state.layerItemOverrides, layerItemId)
    },
  }
}

export function addSlideTableLayer(
  session: SlideAuthoringSession,
  input: AddSlideTableLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    if (session.scope !== 'scene' && session.scope !== 'surface') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '表格只能在幻灯片场景或本页中使用')
    }
    const { surface, scene } = slideSceneContext(session.history.present, session)
    const existingCount = session.scope === 'surface'
      ? surface.surfaceLayerItems.length
      : scene.layerItems.length

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
      const { surface: draftSurface, scene: draftScene } = slideSceneContext(draft, session)
      if (session.scope === 'surface') {
        appendSurfaceLayer(draft, draftSurface, layerItem)
      } else {
        appendSceneLayer(draft, draftScene, layerItem, session.selection.stateId)
      }
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
    if (typeof input.text !== 'string' || input.text.length > 20000) {
      throw new SlideCommandError('invalid-data', '单元格文本长度超出上限')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

      let found = false
      for (const row of table.rows) {
        const cell = row.cells.find((c) => c.id === input.cellId)
        if (cell) {
          cell.text = input.text
          found = true
          break
        }
      }
      if (!found) {
        throw new SlideCommandError('invalid-target', `找不到单元格：${input.cellId}`)
      }

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

      table.style = {
        ...table.style,
        ...input.stylePatch,
      }

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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
      for (const key of Object.keys(nextStyle) as (keyof NativeTableCellStyle)[]) {
        if (nextStyle[key] === undefined) delete nextStyle[key]
      }
      targetCell.style = Object.keys(nextStyle).length > 0 ? nextStyle : undefined

      target.commit(table)
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
    if (!Number.isFinite(input.height) || input.height < 20 || input.height > 2000) {
      throw new SlideCommandError('invalid-data', '行高必须介于 20 到 2000 之间')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

      const row = table.rows.find((r) => r.id === input.rowId)
      if (!row) throw new SlideCommandError('invalid-target', `找不到行：${input.rowId}`)
      row.height = input.height

      target.commit(table)
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
    if (!Number.isFinite(input.width) || input.width < 24 || input.width > 2000) {
      throw new SlideCommandError('invalid-data', '列宽必须介于 24 到 2000 之间')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

      const col = table.columns.find((c) => c.id === input.columnId)
      if (!col) throw new SlideCommandError('invalid-target', `找不到列：${input.columnId}`)
      col.width = input.width

      target.commit(table)
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
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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
      target.commit(table)
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
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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

      target.commit(table)
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

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

      target.commit(table)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function commitSlideTableLastCellAndAppendRow(
  session: SlideAuthoringSession,
  input: CommitSlideTableLastCellAndAppendRowInput,
  options: SlideCommandOptions = {},
): CommitSlideTableLastCellAndAppendRowResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    if (typeof input.text !== 'string' || input.text.length > 20000) {
      throw new SlideCommandError('invalid-data', '单元格文本长度超出上限')
    }

    let focusResult: {
      readonly newRowId: string
      readonly newCellId: string
      readonly targetColumnId: string
    } | undefined

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const table = target.table

      if (table.rows.length === 0 || table.columns.length === 0) {
        throw new SlideCommandError('invalid-target', '表格必须包含行与列')
      }

      // Find target cell
      let targetRowIndex = -1
      let targetCell: NativeTableCell | undefined
      for (let r = 0; r < table.rows.length; r++) {
        const cell = table.rows[r]!.cells.find((c) => c.id === input.cellId)
        if (cell) {
          targetRowIndex = r
          targetCell = cell
          break
        }
      }
      if (!targetCell || targetRowIndex < 0) {
        throw new SlideCommandError('invalid-target', `找不到单元格：${input.cellId}`)
      }

      // Check if it is the last cell: last row and last column
      const lastRowIndex = table.rows.length - 1
      const lastRow = table.rows[lastRowIndex]!
      const lastColumn = table.columns[table.columns.length - 1]!
      if (targetRowIndex !== lastRowIndex || targetCell.columnId !== lastColumn.id) {
        throw new SlideCommandError('invalid-target', '所选单元格不是表格末格')
      }

      // Check row limit
      if (table.rows.length >= 1000) {
        throw new SlideCommandError('invalid-data', '表格行数已达上限（1000 行）')
      }

      // 1. Commit text
      targetCell.text = input.text

      // 2. Append new row
      const idFactory = input.idFactory ?? nanoid
      const newRowId = `row_${idFactory()}`
      const newCells: NativeTableCell[] = table.columns.map((col) => ({
        id: `cell_${idFactory()}`,
        columnId: col.id,
        text: '',
      }))
      const newRow: NativeTableRow = {
        id: newRowId,
        height: lastRow.height,
        cells: newCells,
      }
      table.rows.push(newRow)

      // 3. Commit mutation through target commit
      target.commit(table)

      focusResult = {
        newRowId,
        newCellId: newCells[0]!.id,
        targetColumnId: table.columns[0]!.id,
      }
    }, options.now)

    return {
      ...commitUpdated(session, project),
      focusResult,
    }
  } catch (error) {
    return catchCommand(session, error)
  }
}
