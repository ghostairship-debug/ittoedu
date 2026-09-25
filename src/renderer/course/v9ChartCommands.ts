import { planSlideChartInsertion, type AddSlideChartLayerInput } from '../../core/tools/slideStructuredInsertion'
export type { AddSlideChartLayerInput } from '../../core/tools/slideStructuredInsertion'
import { slideSceneContext } from '../../core/tools/slideInsertion'
import { commitResourceAwareAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { nanoid } from 'nanoid'
import { chartNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type {
  NativeChartCategory,
  NativeChartContent,
  NativeChartPoint,
  NativeChartSeries,
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

export type { ChartCandidateData as SlideChartCandidateData } from './chartContentOperations'
import { ChartContentError, changeChartType, replaceChartTableData, type ChartCandidateData as SlideChartCandidateData } from './chartContentOperations'

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
  if (error instanceof SlideCommandError || error instanceof ChartContentError) return reject(session, error.reason)
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

interface ResolvedChartTarget {
  readonly item: Extract<LayerItem, { kind: 'native' }>
  readonly chart: NativeChartContent
  commit(nextChart: NativeChartContent): void
}

function resolveChartTarget(
  project: CourseProjectDocument,
  session: SlideAuthoringSessionRef,
  layerItemId: string,
): ResolvedChartTarget {
  if (session.scope === 'global') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '图表只能在幻灯片场景或本页中使用')
  }
  if (session.scope !== 'scene' && session.scope !== 'surface') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '图表只能在幻灯片场景或本页中使用')
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
    if (nativeScopedItem.kind !== 'native' || nativeScopedItem.content.nativeType !== 'chart') {
      throw new SlideCommandError('invalid-target', '所选元素不是图表')
    }
    const chart = structuredClone(nativeScopedItem.content.data as NativeChartContent)
    return {
      item: nativeScopedItem as Extract<LayerItem, { kind: 'native' }>,
      chart,
      commit(nextChart: NativeChartContent) {
        chartNativeContentObjectSchema.parse(nextChart)
        nativeScopedItem.content.data = structuredClone(nextChart)
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
  if (nativeBaseItem.kind !== 'native' || nativeBaseItem.content.nativeType !== 'chart') {
    throw new SlideCommandError('invalid-target', '所选元素不是图表')
  }

  if (!state) {
    const chart = structuredClone(nativeBaseItem.content.data as NativeChartContent)
    return {
      item: nativeBaseItem as Extract<LayerItem, { kind: 'native' }>,
      chart,
      commit(nextChart: NativeChartContent) {
        chartNativeContentObjectSchema.parse(nextChart)
        nativeBaseItem.content.data = structuredClone(nextChart)
      },
    }
  }

  const currentOverride = state.layerItemOverrides[layerItemId] ?? {}
  const currentData = currentOverride.nativeData
    ? (mergeCourseNativeData(
        nativeBaseItem.content.data as unknown as Record<string, unknown>,
        currentOverride.nativeData,
      ) as unknown as NativeChartContent)
    : structuredClone(nativeBaseItem.content.data as NativeChartContent)

  return {
    item: nativeBaseItem as Extract<LayerItem, { kind: 'native' }>,
    chart: currentData,
    commit(nextChart: NativeChartContent) {
      chartNativeContentObjectSchema.parse(nextChart)
      const nextNative = sparseObjectDiff(
        nativeBaseItem.content.data as unknown as Record<string, unknown>,
        nextChart as unknown as Record<string, unknown>,
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

export function addSlideChartLayer(
  session: SlideAuthoringSession,
  input: AddSlideChartLayerInput = {},
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const planned = planSlideChartInsertion(session.history.present, session, input, options.now)
    return commitAdded(session, planned.project, planned.itemId)
  } catch (error) { return catchCommand(session, error) }
}

export function patchSlideChartTitle(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly title: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    if (typeof input.title !== 'string' || input.title.length > 1000) {
      throw new SlideCommandError('invalid-data', '图表标题长度超出上限')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      chart.title = input.title
      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideChartStyle(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly stylePatch: Partial<NativeChartContent['style']>
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      const candidateStyle = {
        ...chart.style,
        ...input.stylePatch,
      }
      chart.style = candidateStyle as typeof chart.style
      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideChartType(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly newChartType?: 'bar' | 'line' | 'area' | 'pie' | 'donut'
    readonly nextType?: 'bar' | 'line' | 'area' | 'pie' | 'donut'
    readonly retainedSeriesId?: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const targetType = input.newChartType ?? input.nextType
    if (!targetType) {
      throw new SlideCommandError('invalid-data', '未指定新的图表类型')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      target.commit(changeChartType(chart, targetType, input.retainedSeriesId))
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function patchSlideChartPointValue(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly seriesId: string
    readonly categoryId: string
    readonly value: number
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    if (!Number.isFinite(input.value)) {
      throw new SlideCommandError('invalid-data', '数据点数值必须是有效数字')
    }

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      const ser = chart.series.find((s) => s.id === input.seriesId)
      if (!ser) throw new SlideCommandError('invalid-target', `找不到系列：${input.seriesId}`)

      const pt = ser.points.find((p) => p.categoryId === input.categoryId)
      if (!pt) throw new SlideCommandError('invalid-target', `找不到分类对应的数据点：${input.categoryId}`)

      pt.value = input.value
      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function insertSlideChartCategory(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly referenceCategoryId?: string
    readonly position?: 'before' | 'after'
    readonly label?: string
    readonly seriesValues?: Readonly<Record<string, number>>
    readonly index?: number
    readonly idFactory?: IdFactory
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (chart.categories.length >= 200) {
        throw new SlideCommandError('invalid-data', '分类数量已达上限（200 个）')
      }

      let insertIndex: number
      if (input.referenceCategoryId) {
        const refIndex = chart.categories.findIndex((c) => c.id === input.referenceCategoryId)
        if (refIndex < 0) {
          throw new SlideCommandError('invalid-target', `找不到参考分类：${input.referenceCategoryId}`)
        }
        insertIndex = input.position === 'before' ? refIndex : refIndex + 1
      } else if (input.index !== undefined) {
        insertIndex = Math.max(0, Math.min(input.index, chart.categories.length))
      } else {
        insertIndex = chart.categories.length
      }

      const newCatId = `cat_${idFactory()}`
      const newCategory: NativeChartCategory = {
        id: newCatId,
        label: input.label ?? `类别 ${chart.categories.length + 1}`,
      }

      chart.categories.splice(insertIndex, 0, newCategory)

      // In each series, insert a matching point at insertIndex
      for (const ser of chart.series) {
        const defaultValue = chart.chartType === 'pie' || chart.chartType === 'donut' ? 10 : 0
        const newPoint: NativeChartPoint = {
          id: `pt_${idFactory()}`,
          categoryId: newCatId,
          value: input.seriesValues?.[ser.id] ?? defaultValue,
        }
        ser.points.splice(insertIndex, 0, newPoint)
      }

      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideChartCategory(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly categoryId: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (chart.categories.length <= 1) {
        throw new SlideCommandError('invalid-data', '图表至少需要保留一个分类')
      }

      const index = chart.categories.findIndex((c) => c.id === input.categoryId)
      if (index < 0) {
        throw new SlideCommandError('invalid-target', `找不到分类：${input.categoryId}`)
      }

      chart.categories.splice(index, 1)

      // Remove matching point in each series
      for (const ser of chart.series) {
        ser.points = ser.points.filter((p) => p.categoryId !== input.categoryId)
      }

      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlideChartCategories(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly orderedCategoryIds: readonly string[]
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (
        input.orderedCategoryIds.length !== chart.categories.length ||
        new Set(input.orderedCategoryIds).size !== chart.categories.length
      ) {
        throw new SlideCommandError('invalid-data', '分类重排 ID 列表长度或唯一性无效')
      }

      const catMap = new Map(chart.categories.map((c) => [c.id, c]))
      const nextCategories: NativeChartCategory[] = []
      for (const id of input.orderedCategoryIds) {
        const cat = catMap.get(id)
        if (!cat) throw new SlideCommandError('invalid-data', `分类 ID 不存在：${id}`)
        nextCategories.push(cat)
      }

      chart.categories = nextCategories

      // Reorder points in each series to match
      for (const ser of chart.series) {
        const ptMap = new Map(ser.points.map((p) => [p.categoryId, p]))
        ser.points = nextCategories.map((cat) => {
          const pt = ptMap.get(cat.id)
          if (!pt) throw new Error(`系列 ${ser.id} 缺少分类 ${cat.id} 对应的数据点`)
          return pt
        })
      }

      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function insertSlideChartSeries(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly referenceSeriesId?: string
    readonly position?: 'before' | 'after'
    readonly name?: string
    readonly color?: string
    readonly values?: readonly number[]
    readonly index?: number
    readonly idFactory?: IdFactory
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (chart.chartType === 'pie' || chart.chartType === 'donut') {
        throw new SlideCommandError('invalid-data', '饼图和环形图只支持单系列')
      }

      if (chart.series.length >= 20) {
        throw new SlideCommandError('invalid-data', '系列数量已达上限（20 个）')
      }

      let insertIndex: number
      if (input.referenceSeriesId) {
        const refIndex = chart.series.findIndex((s) => s.id === input.referenceSeriesId)
        if (refIndex < 0) {
          throw new SlideCommandError('invalid-target', `找不到参考系列：${input.referenceSeriesId}`)
        }
        insertIndex = input.position === 'before' ? refIndex : refIndex + 1
      } else if (input.index !== undefined) {
        insertIndex = Math.max(0, Math.min(input.index, chart.series.length))
      } else {
        insertIndex = chart.series.length
      }

      const newSerId = `ser_${idFactory()}`

      const newPoints: NativeChartPoint[] = chart.categories.map((cat, idx) => ({
        id: `pt_${idFactory()}`,
        categoryId: cat.id,
        value: input.values?.[idx] ?? 0,
      }))

      const newSeries: NativeChartSeries = {
        id: newSerId,
        name: input.name ?? `系列 ${chart.series.length + 1}`,
        color: input.color ?? '#10b981',
        points: newPoints,
      }

      chart.series.splice(insertIndex, 0, newSeries)

      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function deleteSlideChartSeries(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly seriesId: string
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (chart.series.length <= 1) {
        throw new SlideCommandError('invalid-data', '图表至少需要保留一个系列')
      }

      const index = chart.series.findIndex((s) => s.id === input.seriesId)
      if (index < 0) {
        throw new SlideCommandError('invalid-target', `找不到系列：${input.seriesId}`)
      }

      chart.series.splice(index, 1)
      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function reorderSlideChartSeries(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly orderedSeriesIds: readonly string[]
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      if (
        input.orderedSeriesIds.length !== chart.series.length ||
        new Set(input.orderedSeriesIds).size !== chart.series.length
      ) {
        throw new SlideCommandError('invalid-data', '系列重排 ID 列表长度或唯一性无效')
      }

      const serMap = new Map(chart.series.map((s) => [s.id, s]))
      const nextSeries: NativeChartSeries[] = []
      for (const id of input.orderedSeriesIds) {
        const ser = serMap.get(id)
        if (!ser) throw new SlideCommandError('invalid-data', `系列 ID 不存在：${id}`)
        nextSeries.push(ser)
      }

      chart.series = nextSeries
      target.commit(chart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}

export function replaceSlideChartTableData(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly candidateData?: SlideChartCandidateData
    readonly data?: SlideChartCandidateData
    readonly idFactory?: IdFactory
  },
  options: SlideCommandOptions = {},
): SlideCommandResult {
  const stale = rejectIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const idFactory = input.idFactory ?? nanoid

    const project = commitSlideProjectMutation(session.history.present, (draft) => {
      const target = resolveChartTarget(draft, session, input.layerItemId)
      const chart = target.chart

      const candidateData = input.candidateData ?? input.data
      if (!candidateData) {
        throw new SlideCommandError('invalid-data', '缺少数据表格内容')
      }
      target.commit(replaceChartTableData(chart, candidateData, idFactory))
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}
