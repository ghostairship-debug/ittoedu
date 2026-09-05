import { nanoid } from 'nanoid'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { chartNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import type {
  NativeChartCategory,
  NativeChartCommonStyle,
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
import { allocateCourseLayerOrder } from './globalLayerCommands'
import type { SlideAuthoringSession } from './slideAuthoringBackend'
import {
  createChartLayerItem,
  createChartNode,
  type ChartFactoryNode,
  type IdFactory,
} from '../project/nativeNodeFactories'
import { offsetDefaultSlideInsertion } from './v9SlideContentCommands'

export interface AddSlideChartLayerInput {
  readonly id?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly chartType?: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  readonly title?: string
  readonly categories?: NativeChartCategory[]
  readonly series?: NativeChartSeries[]
  readonly style?: Partial<NativeChartContent['style']>
  readonly label?: string
}

export interface SlideChartCandidateData {
  readonly categories: readonly { readonly id?: string; readonly label: string }[]
  readonly series: readonly {
    readonly id?: string
    readonly name: string
    readonly color?: string
    readonly values: readonly number[]
  }[]
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
    if (session.scope !== 'scene' && session.scope !== 'surface') {
      throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '图表只能在幻灯片场景或本页中使用')
    }
    const { surface, scene } = slideSceneContext(session.history.present, session)
    const existingCount = session.scope === 'surface'
      ? surface.surfaceLayerItems.length
      : scene.layerItems.length

    const chartNode = createChartNode({
      id: input.id,
      name: input.label,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      chartType: input.chartType,
      title: input.title,
      categories: input.categories,
      series: input.series,
      style: input.style,
    })

    // Validate against strict chart schema
    chartNativeContentObjectSchema.parse({
      chartType: chartNode.chartType,
      title: chartNode.title,
      categories: chartNode.categories,
      series: chartNode.series,
      style: chartNode.style,
    })

    const positioned = offsetDefaultSlideInsertion(
      chartNode,
      existingCount,
      input.x !== undefined || input.y !== undefined,
    )
    const layerItem = createChartLayerItem(positioned as ChartFactoryNode)

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

      if (chart.chartType === targetType) return

      const isTargetSingleSeries = targetType === 'pie' || targetType === 'donut'

      let nextSeries: NativeChartSeries[]
      if (isTargetSingleSeries) {
        if (chart.series.length > 1) {
          if (!input.retainedSeriesId) {
            throw new SlideCommandError(
              'retained-series-required',
              '多系列图表切入单系列图表（饼图/环形图）时必须指定要保留的系列 ID',
            )
          }
          const matched = chart.series.find((s) => s.id === input.retainedSeriesId)
          if (!matched) {
            throw new SlideCommandError(
              'invalid-target',
              `指定的保留系列不存在：${input.retainedSeriesId}`,
            )
          }
          nextSeries = [structuredClone(matched)]
        } else {
          nextSeries = [structuredClone(chart.series[0]!)]
        }
      } else {
        nextSeries = structuredClone(chart.series)
      }

      // Build style
      const commonStyle: NativeChartCommonStyle = {
        backgroundColor: chart.style.backgroundColor,
        backgroundOpacity: chart.style.backgroundOpacity,
        fontFamily: chart.style.fontFamily,
        fontSize: chart.style.fontSize,
        textColor: chart.style.textColor,
        showLegend: chart.style.showLegend,
        legendPosition: chart.style.legendPosition,
        showDataLabels: chart.style.showDataLabels,
      }

      let candidateChart: NativeChartContent
      if (targetType === 'pie') {
        candidateChart = {
          chartType: 'pie',
          title: chart.title,
          categories: structuredClone(chart.categories),
          series: [nextSeries[0]!] as [NativeChartSeries],
          style: commonStyle,
        }
      } else if (targetType === 'donut') {
        const existingHoleSize =
          'holeSize' in chart.style ? (chart.style as { holeSize: number }).holeSize : 50
        candidateChart = {
          chartType: 'donut',
          title: chart.title,
          categories: structuredClone(chart.categories),
          series: [nextSeries[0]!] as [NativeChartSeries],
          style: {
            ...commonStyle,
            holeSize: existingHoleSize,
          },
        }
      } else {
        const cartesianBase =
          'showCategoryAxis' in chart.style
            ? {
                showCategoryAxis: chart.style.showCategoryAxis,
                showValueAxis: chart.style.showValueAxis,
                showGridLines: chart.style.showGridLines,
                valueMin: chart.style.valueMin,
                valueMax: chart.style.valueMax,
              }
            : {
                showCategoryAxis: true,
                showValueAxis: true,
                showGridLines: true,
              }
        candidateChart = {
          chartType: targetType,
          title: chart.title,
          categories: structuredClone(chart.categories),
          series: nextSeries,
          style: {
            ...commonStyle,
            ...cartesianBase,
          },
        }
      }

      target.commit(candidateChart)
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
      if (!candidateData.categories || candidateData.categories.length === 0) {
        throw new SlideCommandError('invalid-data', '数据表格至少需要包含一个分类')
      }
      if (!candidateData.series || candidateData.series.length === 0) {
        throw new SlideCommandError('invalid-data', '数据表格至少需要包含一个系列')
      }
      if (chart.chartType === 'pie' || chart.chartType === 'donut') {
        if (candidateData.series.length !== 1) {
          throw new SlideCommandError('invalid-data', '饼图和环形图只支持单个系列')
        }
      }

      // Check all values
      for (const s of candidateData.series) {
        if (s.values.length !== candidateData.categories.length) {
          throw new SlideCommandError('invalid-data', `系列 '${s.name}' 数据点数量必须与分类数一致`)
        }
        for (const val of s.values) {
          if (!Number.isFinite(val)) {
            throw new SlideCommandError('invalid-data', '数据表格中存在非数字或无效数值')
          }
          if ((chart.chartType === 'pie' || chart.chartType === 'donut') && val < 0) {
            throw new SlideCommandError('invalid-data', '饼图和环形图数值必须非负')
          }
        }
      }

      // Build categories matching old IDs if available
      const oldCatMap = new Map(chart.categories.map((c) => [c.id, c]))
      const nextCategories: NativeChartCategory[] = candidateData.categories.map((catInput) => {
        const existing = catInput.id ? oldCatMap.get(catInput.id) : undefined
        return {
          id: existing ? existing.id : `cat_${idFactory()}`,
          label: catInput.label,
        }
      })

      // Build series matching old IDs if available
      const oldSerMap = new Map(chart.series.map((s) => [s.id, s]))
      const nextSeries: NativeChartSeries[] = candidateData.series.map((serInput) => {
        const existingSer = serInput.id ? oldSerMap.get(serInput.id) : undefined
        const serId = existingSer ? existingSer.id : `ser_${idFactory()}`
        const color = serInput.color ?? existingSer?.color ?? '#2563eb'

        const points: NativeChartPoint[] = nextCategories.map((cat, catIdx) => {
          const val = serInput.values[catIdx]!
          const existingPt = existingSer?.points.find((p) => p.categoryId === cat.id)
          return {
            id: existingPt ? existingPt.id : `pt_${idFactory()}`,
            categoryId: cat.id,
            value: val,
          }
        })

        return {
          id: serId,
          name: serInput.name,
          color,
          points,
        }
      })

      const candidateChart: NativeChartContent = (chart.chartType === 'pie' || chart.chartType === 'donut')
        ? {
            ...chart,
            categories: nextCategories,
            series: [nextSeries[0]!] as [NativeChartSeries],
          }
        : {
            ...chart,
            categories: nextCategories,
            series: nextSeries,
          }

      target.commit(candidateChart)
    }, options.now)

    return commitUpdated(session, project)
  } catch (error) {
    return catchCommand(session, error)
  }
}
