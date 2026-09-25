import { planSlideTableInsertion, type AddSlideTableLayerInput } from '../../core/tools/slideStructuredInsertion'
export type { AddSlideTableLayerInput } from '../../core/tools/slideStructuredInsertion'
import { slideSceneContext } from '../../core/tools/slideInsertion'
import { commitResourceAwareAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { commitTableLastCellAndAppendRow, TableContentError, patchTableCellText, patchTableStyle, patchTableCellStyle, patchTableRowHeight, patchTableColumnWidth, insertTableRow, deleteTableRow, reorderTableRows, insertTableColumn, deleteTableColumn, reorderTableColumns } from './tableContentOperations'
import { nanoid } from 'nanoid'
import { mergeTableCells, splitTableCells } from './tableContentOperations'
import type { TableMergeRegion } from '../../shared/tableMerge'
import { tableNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type {
  NativeTableCellStyle,
  NativeTableContent,
  NativeTableStyle,
} from '../../shared/contracts/native-v1/types'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  LayerItemOverride,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import { SLIDE_REJECT_LOCKED, SLIDE_REJECT_STALE_REVISION, SLIDE_REJECT_WRONG_OWNER, SlideCommandError, commitSlideProjectMutation, selectSlideEditorLayers, type SlideAuthoringSelection, type SlideAuthoringSessionRef, type SlideCommandOptions, type SlideCommandResult } from './slideEditorCommands'
import type { SlideAuthoringSession } from './slideAuthoringBackend'
import {
  type IdFactory,
} from '../../core/tools/nativeNodeFactories'

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
  if (error instanceof SlideCommandError || error instanceof TableContentError) return reject(session, error.reason)
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
    history: commitResourceAwareAuthoringHistory(session.history, project),
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
    history: commitResourceAwareAuthoringHistory(session.history, project),
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

/** Content dimensions keep their current display scale when rows/columns change. */
function resizedTableFrame(
  frame: Pick<LayerItem['frame'], 'width' | 'height'>,
  before: NativeTableContent,
  after: NativeTableContent,
): Partial<Pick<LayerItem['frame'], 'width' | 'height'>> {
  const previousWidth = before.columns.reduce((sum, column) => sum + column.width, 0)
  const nextWidth = after.columns.reduce((sum, column) => sum + column.width, 0)
  const previousHeight = before.rows.reduce((sum, row) => sum + row.height, 0)
  const nextHeight = after.rows.reduce((sum, row) => sum + row.height, 0)
  return {
    ...(nextWidth !== previousWidth ? { width: frame.width * nextWidth / previousWidth } : {}),
    ...(nextHeight !== previousHeight ? { height: frame.height * nextHeight / previousHeight } : {}),
  }
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
        Object.assign(nativeScopedItem.frame, resizedTableFrame(nativeScopedItem.frame, table, nextTable))
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
        Object.assign(nativeBaseItem.frame, resizedTableFrame(nativeBaseItem.frame, table, nextTable))
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
      const framePatch = resizedTableFrame({ ...nativeBaseItem.frame, ...currentOverride.frame }, currentData, nextTable)
      for (const axis of ['width', 'height'] as const) {
        const value = framePatch[axis]
        if (value === undefined) continue
        const frameOverride = itemOverride.frame ?? {}
        if (value === nativeBaseItem.frame[axis]) delete frameOverride[axis]
        else frameOverride[axis] = value
        if (Object.keys(frameOverride).length) itemOverride.frame = frameOverride
        else delete itemOverride.frame
      }
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
    const planned = planSlideTableInsertion(session.history.present, session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchCommand(session, error) }
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(patchTableCellText(target.table, input))
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function changeSlideTableMerge(
  session: SlideAuthoringSession,
  input: { layerItemId: string } & ({ kind: 'merge'; region: TableMergeRegion } | { kind: 'split'; rowId: string; columnId: string }),
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, draft => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(input.kind === 'merge' ? mergeTableCells(target.table, input.region) : splitTableCells(target.table, input))
    }, options.now)
    return commitUpdated(session, project)
  } catch (error) { return catchCommand(session, error) }
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
      target.commit(patchTableStyle(target.table, input))
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
      target.commit(patchTableCellStyle(target.table, input))
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(patchTableRowHeight(target.table, input))
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(patchTableColumnWidth(target.table, input))
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(insertTableRow(target.table, input))
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
      target.commit(deleteTableRow(target.table, input))
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
      target.commit(reorderTableRows(target.table, input))
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
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      target.commit(insertTableColumn(target.table, input))
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
      target.commit(deleteTableColumn(target.table, input))
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
      target.commit(reorderTableColumns(target.table, input))
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
    let focusResult: {
      readonly newRowId: string
      readonly newCellId: string
      readonly targetColumnId: string
    } | undefined

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveTableTarget(draft, session, input.layerItemId)
      const result = commitTableLastCellAndAppendRow(target.table, input)
      target.commit(result.table)
      focusResult = result.focusResult
    }, options.now)

    return {
      ...commitUpdated(session, project),
      focusResult,
    }
  } catch (error) {
    return catchCommand(session, error)
  }
}
