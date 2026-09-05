import { describe, expect, it } from 'vitest'
import {
  courseProjectDocumentSchema,
  mergeCourseNativeData,
} from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import {
  activateSlidePresentationState,
  addSlidePresentationState,
  openSlideAuthoringSession,
  setSlideEditingScope,
  undoSlideAuthoring,
  redoSlideAuthoring,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
} from '@/renderer/course/slideEditorCommands'
import {
  createChartNode,
  rebuildChartItemIds,
} from '@/renderer/project/nativeNodeFactories'
import {
  addSlideChartLayer,
  deleteSlideChartCategory,
  deleteSlideChartSeries,
  insertSlideChartCategory,
  insertSlideChartSeries,
  patchSlideChartPointValue,
  patchSlideChartStyle,
  patchSlideChartTitle,
  patchSlideChartType,
  reorderSlideChartCategories,
  reorderSlideChartSeries,
  replaceSlideChartTableData,
} from '@/renderer/course/v9ChartCommands'

const NOW = '2026-09-04T12:00:00.000Z'

function documentShell(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'test-chart-project',
    revision: 1,
    title: 'Chart Test Project',
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

function getChartData(session: SlideAuthoringSession) {
  return (getNativeItem(getSlideScene(session)).content as any).data
}

function getEffectiveChartData(session: SlideAuthoringSession) {
  const scene = getSlideScene(session)
  const item = getNativeItem(scene)
  const baseData = item.content.data as any
  const stateId = session.selection.stateId
  if (!stateId) return baseData
  const state = scene.presentation?.states.find((s) => s.id === stateId)
  const override = state?.layerItemOverrides[item.layerItemId]?.nativeData
  if (!override) return baseData
  return mergeCourseNativeData(
    baseData as unknown as Record<string, unknown>,
    override,
  ) as any
}

describe('r12-020-chart-core Chart Factory & Rebuild IDs', () => {
  it('creates deterministic 3-category 1-series chart with bar type and cartesian style', () => {
    let counter = 0
    const testIdFactory = () => `id_${++counter}`
    const chart = createChartNode({ idFactory: testIdFactory, chartType: 'bar' })

    expect(chart.chartType).toBe('bar')
    expect(chart.categories).toHaveLength(3)
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0]!.points).toHaveLength(3)
    expect((chart.style as any).showGridLines).toBe(true)
    expect(chart.style.showLegend).toBe(true)

    for (let i = 0; i < chart.categories.length; i++) {
      expect(chart.series[0]!.points[i]!.categoryId).toBe(chart.categories[i]!.id)
    }
  })

  it('creates donut chart with circular style and innerRadius', () => {
    const chart = createChartNode({ chartType: 'donut' })
    expect(chart.chartType).toBe('donut')
    expect((chart.style as any).holeSize).toBe(50)
    expect((chart.style as any).showGridLines).toBeUndefined()
  })

  it('rebuildChartItemIds rebuilds all category, series, and point IDs while keeping categoryId mapping', () => {
    let counter = 100
    const chart = createChartNode({ idFactory: () => `${++counter}` })
    const rebuilt = rebuildChartItemIds(chart, () => `new_${++counter}`)

    expect(rebuilt.categories.map((c) => c.id)).not.toEqual(chart.categories.map((c) => c.id))
    expect(rebuilt.series.map((s) => s.id)).not.toEqual(chart.series.map((s) => s.id))

    for (let s = 0; s < rebuilt.series.length; s++) {
      for (let p = 0; p < rebuilt.categories.length; p++) {
        expect(rebuilt.series[s]!.points[p]!.categoryId).toBe(rebuilt.categories[p]!.id)
        expect(rebuilt.series[s]!.points[p]!.id).not.toBe(chart.series[s]!.points[p]!.id)
      }
    }
  })
})

describe('r12-020-chart-core Canonical Chart Commands', () => {
  it('adds a Chart layer and rejects in global scope', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    expect(added.ok).toBe(true)
    expect(added.historyEntry).toBe(true)

    const chartId = added.selection?.selectionIds[0]!
    const scene = getSlideScene(added.nextSession!)
    const item = scene.layerItems.find((l) => l.layerItemId === chartId)!
    expect(item.kind).toBe('native')
    if (item.kind !== 'native') throw new Error('expected native')
    expect(item.content.nativeType).toBe('chart')

    // Reject in global scope
    const globalSession = requireSession(setSlideEditingScope(session, 'global'))
    const rejectGlobal = addSlideChartLayer(globalSession)
    expect(rejectGlobal.ok).toBe(false)
    expect(rejectGlobal.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('rejects commands on stale revision', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    expect(added.ok).toBe(true)

    const chartId = added.selection?.selectionIds[0]!
    const staleResult = patchSlideChartTitle(
      added.nextSession!,
      { layerItemId: chartId, title: 'New Title' },
      { expectedRevision: 999 },
    )
    expect(staleResult.ok).toBe(false)
    expect(staleResult.reason).toBe(SLIDE_REJECT_STALE_REVISION)
  })

  it('modifies chart title and styles', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    const titled = patchSlideChartTitle(added.nextSession!, {
      layerItemId: chartId,
      title: '年度销售趋势',
    })
    expect(titled.ok).toBe(true)

    const styled = patchSlideChartStyle(titled.nextSession!, {
      layerItemId: chartId,
      stylePatch: {
        showLegend: false,
        showDataLabels: true,
      },
    })
    expect(styled.ok).toBe(true)

    const scene = getSlideScene(styled.nextSession!)
    const chartItem = scene.layerItems.find((l) => l.layerItemId === chartId)!
    if (chartItem.kind !== 'native') throw new Error('n')
    const chart = (chartItem.content as any).data
    expect(chart.title).toBe('年度销售趋势')
    expect(chart.style.showLegend).toBe(false)
    expect(chart.style.showDataLabels).toBe(true)
  })

  it('patches point value and rejects invalid numbers', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!
    const scene0 = getSlideScene(added.nextSession!)
    const chartItem0 = scene0.layerItems.find((l) => l.layerItemId === chartId)!
    if (chartItem0.kind !== 'native') throw new Error('n')
    const chart0 = (chartItem0.content as any).data

    const catId = chart0.categories[0]!.id
    const seriesId = chart0.series[0]!.id

    const patched = patchSlideChartPointValue(
      added.nextSession!,
      {
        layerItemId: chartId,
        categoryId: catId,
        seriesId,
        value: 42.5,
      },
    )
    expect(patched.ok).toBe(true)

    const scene1 = getSlideScene(patched.nextSession!)
    const chartItem1 = scene1.layerItems.find((l) => l.layerItemId === chartId)!
    if (chartItem1.kind !== 'native') throw new Error('n')
    const chart1 = (chartItem1.content as any).data
    expect(chart1.series[0]!.points[0]!.value).toBe(42.5)

    // Reject NaN
    const rejectNaN = patchSlideChartPointValue(
      patched.nextSession!,
      {
        layerItemId: chartId,
        categoryId: catId,
        seriesId,
        value: NaN,
      },
    )
    expect(rejectNaN.ok).toBe(false)
    expect(rejectNaN.reason).toBe('invalid-data')

    // Reject non-existent category
    const rejectBadCat = patchSlideChartPointValue(
      patched.nextSession!,
      {
        layerItemId: chartId,
        categoryId: 'bad-cat',
        seriesId,
        value: 10,
      },
    )
    expect(rejectBadCat.ok).toBe(false)
    expect(rejectBadCat.reason).toBe('invalid-target')
  })

  it('handles chart type switching and requires retainedSeriesId when reducing to single-series pie', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    // Add a second series
    const addedSeries = insertSlideChartSeries(added.nextSession!, {
      layerItemId: chartId,
      name: '系列 2',
      color: '#10b981',
      values: [10, 20, 30],
    })
    expect(addedSeries.ok).toBe(true)

    // Switching multi-series to line should succeed
    const toLine = patchSlideChartType(addedSeries.nextSession!, {
      layerItemId: chartId,
      nextType: 'line',
    })
    expect(toLine.ok).toBe(true)
    const lineChart = (getNativeItem(getSlideScene(toLine.nextSession!)).content as any).data
    expect(lineChart.chartType).toBe('line')
    expect(lineChart.series).toHaveLength(2)

    // Switching multi-series to pie without retainedSeriesId should reject
    const toPieReject = patchSlideChartType(toLine.nextSession!, {
      layerItemId: chartId,
      nextType: 'pie',
    })
    expect(toPieReject.ok).toBe(false)
    expect(toPieReject.reason).toBe('retained-series-required')

    // Switching with retainedSeriesId succeeds and drops other series
    const seriesToKeep = lineChart.series[1]!.id
    const toPie = patchSlideChartType(toLine.nextSession!, {
      layerItemId: chartId,
      nextType: 'pie',
      retainedSeriesId: seriesToKeep,
    })
    expect(toPie.ok).toBe(true)
    const pieChart = (getNativeItem(getSlideScene(toPie.nextSession!)).content as any).data
    expect(pieChart.chartType).toBe('pie')
    expect(pieChart.series).toHaveLength(1)
    expect(pieChart.series[0]!.id).toBe(seriesToKeep)
    expect(pieChart.series[0]!.name).toBe('系列 2')
  })

  it('inserts, deletes, and reorders categories', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    // Insert category at index 1
    const firstSeriesId = (getNativeItem(getSlideScene(added.nextSession!)).content as any).data.series[0]!.id
    const inserted = insertSlideChartCategory(added.nextSession!, {
      layerItemId: chartId,
      label: '新季度',
      index: 1,
      seriesValues: { [firstSeriesId]: 88 },
    })
    expect(inserted.ok).toBe(true)

    let scene = getSlideScene(inserted.nextSession!)
    let chart = (getNativeItem(scene).content as any).data
    expect(chart.categories).toHaveLength(4)
    expect(chart.categories[1]!.label).toBe('新季度')
    expect(chart.series[0]!.points[1]!.value).toBe(88)

    // Reorder categories
    const originalOrder = chart.categories.map((c: any) => c.id)
    const newOrder = [originalOrder[3]!, originalOrder[0]!, originalOrder[1]!, originalOrder[2]!]
    const reordered = reorderSlideChartCategories(inserted.nextSession!, {
      layerItemId: chartId,
      orderedCategoryIds: newOrder,
    })
    expect(reordered.ok).toBe(true)

    scene = getSlideScene(reordered.nextSession!)
    chart = (getNativeItem(scene).content as any).data
    expect(chart.categories.map((c: any) => c.id)).toEqual(newOrder)
    expect(chart.series[0]!.points.map((p: any) => p.categoryId)).toEqual(newOrder)

    // Delete categories down to 1
    let curSession = reordered.nextSession!
    curSession = deleteSlideChartCategory(curSession, { layerItemId: chartId, categoryId: newOrder[0]! }).nextSession!
    curSession = deleteSlideChartCategory(curSession, { layerItemId: chartId, categoryId: newOrder[1]! }).nextSession!
    curSession = deleteSlideChartCategory(curSession, { layerItemId: chartId, categoryId: newOrder[2]! }).nextSession!

    scene = getSlideScene(curSession)
    chart = (getNativeItem(scene).content as any).data
    expect(chart.categories).toHaveLength(1)

    // Deleting the last category must be rejected
    const rejectLast = deleteSlideChartCategory(curSession, { layerItemId: chartId, categoryId: chart.categories[0]!.id })
    expect(rejectLast.ok).toBe(false)
    expect(rejectLast.reason).toBe('invalid-data')
  })

  it('inserts, deletes, and reorders series', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    // Insert 2 series
    const s2 = insertSlideChartSeries(added.nextSession!, {
      layerItemId: chartId,
      name: '系列 B',
      values: [1, 2, 3],
    })
    const s3 = insertSlideChartSeries(s2.nextSession!, {
      layerItemId: chartId,
      name: '系列 C',
      values: [4, 5, 6],
    })
    expect(s3.ok).toBe(true)

    let scene = getSlideScene(s3.nextSession!)
    let chart = (getNativeItem(scene).content as any).data
    expect(chart.series).toHaveLength(3)

    // Reorder series
    const sIds = chart.series.map((s: any) => s.id)
    const reversedSIds = [...sIds].reverse()
    const reordered = reorderSlideChartSeries(s3.nextSession!, {
      layerItemId: chartId,
      orderedSeriesIds: reversedSIds,
    })
    expect(reordered.ok).toBe(true)

    scene = getSlideScene(reordered.nextSession!)
    chart = (getNativeItem(scene).content as any).data
    expect(chart.series.map((s: any) => s.id)).toEqual(reversedSIds)

    // Delete down to 1
    let curSession = reordered.nextSession!
    curSession = deleteSlideChartSeries(curSession, { layerItemId: chartId, seriesId: reversedSIds[0]! }).nextSession!
    curSession = deleteSlideChartSeries(curSession, { layerItemId: chartId, seriesId: reversedSIds[1]! }).nextSession!

    scene = getSlideScene(curSession)
    chart = (getNativeItem(scene).content as any).data
    expect(chart.series).toHaveLength(1)

    // Reject deleting last series
    const rejectLast = deleteSlideChartSeries(curSession, { layerItemId: chartId, seriesId: chart.series[0]!.id })
    expect(rejectLast.ok).toBe(false)
    expect(rejectLast.reason).toBe('invalid-data')
  })

  it('atomically replaces chart table data and enforces pie single-series rule', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    const replaced = replaceSlideChartTableData(added.nextSession!, {
      layerItemId: chartId,
      data: {
        categories: [
          { label: '一月' },
          { label: '二月' },
        ],
        series: [
          { name: '收入', color: '#3b82f6', values: [100, 200] },
          { name: '支出', color: '#ef4444', values: [80, 150] },
        ],
      },
    })
    expect(replaced.ok).toBe(true)

    let scene = getSlideScene(replaced.nextSession!)
    let chart = (getNativeItem(scene).content as any).data
    expect(chart.categories).toHaveLength(2)
    expect(chart.categories[0]!.label).toBe('一月')
    expect(chart.series).toHaveLength(2)
    expect(chart.series[0]!.points[0]!.value).toBe(100)
    expect(chart.series[1]!.points[1]!.value).toBe(150)

    // Switch to pie
    const toPie = patchSlideChartType(replaced.nextSession!, {
      layerItemId: chartId,
      nextType: 'pie',
      retainedSeriesId: chart.series[0]!.id,
    })
    expect(toPie.ok).toBe(true)

    // Replacing pie with multiple series should reject
    const rejectMultiPie = replaceSlideChartTableData(toPie.nextSession!, {
      layerItemId: chartId,
      data: {
        categories: [{ label: 'A' }, { label: 'B' }],
        series: [
          { name: 'S1', values: [1, 2] },
          { name: 'S2', values: [3, 4] },
        ],
      },
    })
    expect(rejectMultiPie.ok).toBe(false)
    expect(rejectMultiPie.reason).toBe('invalid-data')
  })

  it('supports undo and redo for chart mutations', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!

    const titled = patchSlideChartTitle(added.nextSession!, {
      layerItemId: chartId,
      title: '最初标题',
    })
    expect(titled.ok).toBe(true)

    const retitled = patchSlideChartTitle(titled.nextSession!, {
      layerItemId: chartId,
      title: '更新后标题',
    })
    expect(retitled.ok).toBe(true)

    // Undo to "最初标题"
    const undone1 = undoSlideAuthoring(retitled.nextSession!)
    expect(undone1.ok).toBe(true)
    let scene = getSlideScene(undone1.nextSession!)
    expect((getNativeItem(scene).content as any).data.title).toBe('最初标题')

    // Undo to before titled
    const undone2 = undoSlideAuthoring(undone1.nextSession!)
    expect(undone2.ok).toBe(true)
    scene = getSlideScene(undone2.nextSession!)
    expect((getNativeItem(scene).content as any).data.title).toBe('柱状图')

    // Redo to "最初标题"
    const redone1 = redoSlideAuthoring(undone2.nextSession!)
    expect(redone1.ok).toBe(true)
    scene = getSlideScene(redone1.nextSession!)
    expect((getNativeItem(scene).content as any).data.title).toBe('最初标题')

    // Redo to "更新后标题"
    const redone2 = redoSlideAuthoring(redone1.nextSession!)
    expect(redone2.ok).toBe(true)
    scene = getSlideScene(redone2.nextSession!)
    expect((getNativeItem(scene).content as any).data.title).toBe('更新后标题')
  })

  it('maintains state isolation with nativeData override for title, style, and type', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!
    let cur = added.nextSession!
    const baseChart = getChartData(cur)
    expect(baseChart.title).toBe('柱状图')
    expect(baseChart.chartType).toBe('bar')

    // Add state A and state B
    const stateAResult = addSlidePresentationState(cur, 'State A')
    expect(stateAResult.ok).toBe(true)
    cur = stateAResult.nextSession!
    const stateAId = cur.selection.stateId!

    const stateBResult = addSlidePresentationState(cur, 'State B')
    expect(stateBResult.ok).toBe(true)
    cur = stateBResult.nextSession!
    const stateBId = cur.selection.stateId!

    // Activate State A and patch title
    cur = activateSlidePresentationState(cur, stateAId).nextSession!
    const patchTitleResult = patchSlideChartTitle(cur, {
      layerItemId: chartId,
      title: 'Title in State A',
    })
    expect(patchTitleResult.ok).toBe(true)
    cur = patchTitleResult.nextSession!

    // Verify State A has override
    const scene = getSlideScene(cur)
    const stateA = scene.presentation?.states.find((s) => s.id === stateAId)
    expect(stateA?.layerItemOverrides[chartId]?.nativeData?.title).toBe('Title in State A')

    // Verify base is UNPOLLUTED
    const baseItem = scene.layerItems.find((l) => l.layerItemId === chartId)!
    if (baseItem.kind !== 'native') throw new Error('expected native')
    expect((baseItem.content.data as any).title).toBe('柱状图')

    // Verify State B sees base title
    cur = activateSlidePresentationState(cur, stateBId).nextSession!
    expect(getChartData(cur).title).toBe('柱状图')

    // Verify base state sees base title
    cur = activateSlidePresentationState(cur, null).nextSession!
    expect(getChartData(cur).title).toBe('柱状图')

    // In State A, switch type to pie with retainedSeriesId
    cur = activateSlidePresentationState(cur, stateAId).nextSession!
    const curChartInA = getChartData(cur)
    const switchTypeResult = patchSlideChartType(cur, {
      layerItemId: chartId,
      newChartType: 'pie',
      retainedSeriesId: curChartInA.series[0].id,
    })
    expect(switchTypeResult.ok).toBe(true)
    cur = switchTypeResult.nextSession!

    // State A has override chartType 'pie' with 1 series
    const stateAAfterSwitch = getSlideScene(cur).presentation?.states.find((s) => s.id === stateAId)!
    expect(stateAAfterSwitch.layerItemOverrides[chartId]?.nativeData?.chartType).toBe('pie')
    const chartInA = getEffectiveChartData(cur)
    expect(chartInA.chartType).toBe('pie')
    expect(chartInA.series).toHaveLength(1)

    // Base state still has chartType 'bar' with 1 series
    cur = activateSlidePresentationState(cur, null).nextSession!
    const chartInBase = getChartData(cur)
    expect(chartInBase.chartType).toBe('bar')
    expect(chartInBase.series).toHaveLength(1)

    // State B still has chartType 'bar' with 1 series
    cur = activateSlidePresentationState(cur, stateBId).nextSession!
    const chartInB = getChartData(cur)
    expect(chartInB.chartType).toBe('bar')
    expect(chartInB.series).toHaveLength(1)

    // In State A, reset title back to base '柱状图'
    cur = activateSlidePresentationState(cur, stateAId).nextSession!
    const resetTitleResult = patchSlideChartTitle(cur, {
      layerItemId: chartId,
      title: '柱状图',
    })
    expect(resetTitleResult.ok).toBe(true)
    cur = resetTitleResult.nextSession!
    const curStateA = getSlideScene(cur).presentation?.states.find((s) => s.id === stateAId)!
    // title diff is removed
    expect(curStateA.layerItemOverrides[chartId]?.nativeData?.title).toBeUndefined()
    // chartType diff remains
    expect(curStateA.layerItemOverrides[chartId]?.nativeData?.chartType).toBe('pie')
  })

  it('creates and edits Chart on Slide surface scope without touching scene base', () => {
    const session = makeSession()
    // Switch to surface scope
    const surfaceSession = requireSession(setSlideEditingScope(session, 'surface'))
    expect(surfaceSession.scope).toBe('surface')

    // Add chart on surface
    const added = addSlideChartLayer(surfaceSession, { label: 'Surface Chart' })
    expect(added.ok).toBe(true)
    const chartId = added.selection?.selectionIds[0]!
    let cur = added.nextSession!

    // Verify it is in surfaceLayerItems, not scene.layerItems
    const surface = cur.history.present.surfaces[0]!
    expect(surface.surfaceLayerItems).toHaveLength(1)
    const surfaceItem = surface.surfaceLayerItems[0]!.item
    expect(surfaceItem.layerItemId).toBe(chartId)
    const scene = getSlideScene(cur)
    expect(scene.layerItems).toHaveLength(0)

    // Edit title in surface scope
    const patched = patchSlideChartTitle(cur, {
      layerItemId: chartId,
      title: 'Surface Chart Title',
    })
    expect(patched.ok).toBe(true)
    cur = patched.nextSession!
    const curSurfaceItem = cur.history.present.surfaces[0]!.surfaceLayerItems[0]!.item
    if (curSurfaceItem.kind !== 'native') throw new Error('expected native')
    expect((curSurfaceItem.content.data as any).title).toBe('Surface Chart Title')

    // Editing surface chart from scene scope must be rejected
    const sceneScopeSession = requireSession(setSlideEditingScope(cur, 'scene'))
    const rejectFromScene = patchSlideChartTitle(sceneScopeSession, {
      layerItemId: chartId,
      title: 'Forbidden',
    })
    expect(rejectFromScene.ok).toBe(false)
    expect(rejectFromScene.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('rejects cross-scope edits with SLIDE_REJECT_WRONG_OWNER', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!
    const cur = added.nextSession!

    // Attempting to edit scene chart from surface scope
    const surfaceSession = requireSession(setSlideEditingScope(cur, 'surface'))
    const rejectSurface = patchSlideChartTitle(surfaceSession, {
      layerItemId: chartId,
      title: 'Should Fail',
    })
    expect(rejectSurface.ok).toBe(false)
    expect(rejectSurface.reason).toBe(SLIDE_REJECT_WRONG_OWNER)

    // Attempting to edit scene chart from global scope
    const globalSession = requireSession(setSlideEditingScope(cur, 'global'))
    const rejectGlobal = patchSlideChartTitle(globalSession, {
      layerItemId: chartId,
      title: 'Should Fail',
    })
    expect(rejectGlobal.ok).toBe(false)
    expect(rejectGlobal.reason).toBe(SLIDE_REJECT_WRONG_OWNER)
  })

  it('strictly requires retainedSeriesId when converting multi-series to pie/donut with zero writes on failure', () => {
    const session = makeSession()
    const added = addSlideChartLayer(session)
    const chartId = added.selection?.selectionIds[0]!
    const cur = added.nextSession!

    // Insert a second series so chart is multi-series
    const insertSeriesResult = insertSlideChartSeries(cur, {
      layerItemId: chartId,
      name: '系列 2',
    })
    expect(insertSeriesResult.ok).toBe(true)
    const multiSeriesSession = insertSeriesResult.nextSession!
    const initialRevision = multiSeriesSession.history.present.revision
    expect(getChartData(multiSeriesSession).series).toHaveLength(2)

    // 1. Convert to pie without retainedSeriesId
    const missingRetainedResult = patchSlideChartType(multiSeriesSession, {
      layerItemId: chartId,
      newChartType: 'pie',
    })
    expect(missingRetainedResult.ok).toBe(false)
    expect(missingRetainedResult.reason).toBe('retained-series-required')
    expect(missingRetainedResult.nextSession).toBeDefined()
    expect(missingRetainedResult.nextSession!.history.present.revision).toBe(initialRevision)

    // 2. Convert to pie with non-existent retainedSeriesId
    const invalidRetainedResult = patchSlideChartType(multiSeriesSession, {
      layerItemId: chartId,
      newChartType: 'pie',
      retainedSeriesId: 'non-existent-series-id',
    })
    expect(invalidRetainedResult.ok).toBe(false)
    expect(invalidRetainedResult.reason).toBe('invalid-target')
    expect(invalidRetainedResult.nextSession).toBeDefined()
    expect(invalidRetainedResult.nextSession!.history.present.revision).toBe(initialRevision)

    // 3. Switch to pie with valid retainedSeriesId
    const toPieResult = patchSlideChartType(multiSeriesSession, {
      layerItemId: chartId,
      newChartType: 'pie',
      retainedSeriesId: getChartData(multiSeriesSession).series[0].id,
    })
    expect(toPieResult.ok).toBe(true)
    const pieSession = toPieResult.nextSession!
    const pieRevision = pieSession.history.present.revision

    // Negative values in pie data replacement
    const negativeValueResult = replaceSlideChartTableData(pieSession, {
      layerItemId: chartId,
      candidateData: {
        categories: [{ label: 'Cat 1' }],
        series: [{ name: 'Ser 1', values: [-10] }],
      },
    })
    expect(negativeValueResult.ok).toBe(false)
    expect(negativeValueResult.reason).toBe('invalid-data')
    expect(negativeValueResult.nextSession).toBeDefined()
    expect(negativeValueResult.nextSession!.history.present.revision).toBe(pieRevision)

    // Non-finite values
    const nonFiniteResult = replaceSlideChartTableData(pieSession, {
      layerItemId: chartId,
      candidateData: {
        categories: [{ label: 'Cat 1' }],
        series: [{ name: 'Ser 1', values: [NaN] }],
      },
    })
    expect(nonFiniteResult.ok).toBe(false)
    expect(nonFiniteResult.reason).toBe('invalid-data')
    expect(nonFiniteResult.nextSession).toBeDefined()
    expect(nonFiniteResult.nextSession!.history.present.revision).toBe(pieRevision)
  })
})

