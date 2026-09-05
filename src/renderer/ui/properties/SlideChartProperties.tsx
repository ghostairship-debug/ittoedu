import { nanoid } from 'nanoid'
import {
  useEffect,
  useRef,
  useState,
  useContext,
} from 'react'
import type {
  NativeChartCommonStyle,
  NativeChartContent,
} from '../../../shared/contracts/native-v1/types'
import type { SlideChartCandidateData } from '../../course/v9ChartCommands'
import type { ChartCanvasTextPort } from '../../authoring/chartCanvasTextBridge'
import { ColorInput } from '../ColorInput'
import { NativeColorInput, NativeColorPreviewContext } from './NativeColorPreview'
import {
  BufferedInput,
  FontFamilyPicker,
  RangeField,
  SelectField,
  ToggleRow,
} from './PropertyControls'
import type { PropertiesItemBase } from './SlideNativePropertiesPanel'

export type SlideChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut'

export type SlideChartPropertiesView = PropertiesItemBase & {
  type: 'chart'
} & NativeChartContent

export type SlideChartStylePatch = Partial<NativeChartCommonStyle> & Partial<{
  showCategoryAxis: boolean
  showValueAxis: boolean
  showGridLines: boolean
  valueMin: number | undefined
  valueMax: number | undefined
  holeSize: number
}>

export interface SlideChartPropertiesCommands {
  readonly connectCanvasText?: (port: ChartCanvasTextPort) => () => void
  readonly patchTitle: (title: string) => void
  readonly patchType: (newType: SlideChartType, retainedSeriesId?: string) => void
  readonly patchStyle: (patch: SlideChartStylePatch) => void
  /** Returns null on success; on failure returns the reason and writes nothing. */
  readonly commitTableData: (candidateData: SlideChartCandidateData) => string | null
}

const CHART_TYPE_OPTIONS: ReadonlyArray<{ value: SlideChartType; label: string }> = [
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'area', label: '面积图' },
  { value: 'pie', label: '饼图' },
  { value: 'donut', label: '环形图' },
]

const DRAFT_SERIES_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
] as const

function isCircularType(type: SlideChartType): boolean {
  return type === 'pie' || type === 'donut'
}

interface DraftCategory {
  readonly key: string
  readonly id?: string
  label: string
}

interface DraftSeries {
  readonly key: string
  readonly id?: string
  name: string
  color: string
  values: string[]
}

interface ChartDataDraft {
  categories: DraftCategory[]
  series: DraftSeries[]
}

function draftFromView(node: SlideChartPropertiesView): ChartDataDraft {
  return {
    categories: node.categories.map((category) => ({
      key: category.id,
      id: category.id,
      label: category.label,
    })),
    series: node.series.map((series, seriesIndex) => ({
      key: series.id,
      id: series.id,
      name: series.name,
      color: series.color || DRAFT_SERIES_COLORS[seriesIndex % DRAFT_SERIES_COLORS.length]!,
      values: node.categories.map((category) => {
        const point = series.points.find((candidate) => candidate.categoryId === category.id)
        return point ? String(point.value) : ''
      }),
    })),
  }
}

function draftSignature(node: SlideChartPropertiesView): string {
  return JSON.stringify({ categories: node.categories, series: node.series })
}

interface DraftValidation {
  readonly cellErrors: Record<string, string>
  readonly formErrors: readonly string[]
  readonly candidate: SlideChartCandidateData | null
}

function validateDraft(draft: ChartDataDraft, chartType: SlideChartType): DraftValidation {
  const cellErrors: Record<string, string> = {}
  const formErrors: string[] = []
  const circular = isCircularType(chartType)
  if (draft.categories.length === 0) formErrors.push('至少需要一个分类。')
  if (draft.series.length === 0) formErrors.push('至少需要一个数据系列。')
  if (circular && draft.series.length > 1) {
    formErrors.push('饼图/环形图只支持一个数据系列，请删除多余系列。')
  }
  for (const category of draft.categories) {
    if (!category.label.trim()) {
      cellErrors[`cat:${category.key}`] = '分类标签不能为空。'
    }
  }
  for (const series of draft.series) {
    if (!series.name.trim()) {
      cellErrors[`series:${series.key}`] = '系列名称不能为空。'
    }
    draft.categories.forEach((category, categoryIndex) => {
      const raw = (series.values[categoryIndex] ?? '').trim()
      const key = `value:${series.key}:${category.key}`
      if (!raw) {
        cellErrors[key] = '请输入数值。'
        return
      }
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) {
        cellErrors[key] = '必须是有效数字。'
        return
      }
      if (circular && parsed < 0) {
        cellErrors[key] = '饼图/环形图不支持负值。'
      }
    })
  }
  const hasErrors = formErrors.length > 0 || Object.keys(cellErrors).length > 0
  return {
    cellErrors,
    formErrors,
    candidate: hasErrors
      ? null
      : {
          categories: draft.categories.map((category) => ({
            id: category.id,
            label: category.label.trim(),
          })),
          series: draft.series.map((series) => ({
            id: series.id,
            name: series.name.trim(),
            color: series.color,
            values: draft.categories.map((_, categoryIndex) => (
              Number(series.values[categoryIndex])
            )),
          })),
        },
  }
}

export function SlideChartProperties({
  node,
  bindingKey,
  commands,
}: {
  node: SlideChartPropertiesView
  bindingKey: string
  commands: SlideChartPropertiesCommands
}) {
  const chartType = node.chartType as SlideChartType
  const circular = isCircularType(chartType)
  const cartesian = !circular
  const style = node.style
  const preview = useContext(NativeColorPreviewContext)
  useEffect(() => () => preview?.(null), [bindingKey])

  const [pendingType, setPendingType] = useState<{
    target: SlideChartType
    seriesId: string
  } | null>(null)
  const [draft, setDraft] = useState<ChartDataDraft>(() => draftFromView(node))
  const [dirty, setDirty] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const signatureRef = useRef(draftSignature(node))

  const markDirty = () => {
    dirtyRef.current = true
    setDirty(true)
    setApplyError(null)
  }

  // Rebase the local draft whenever the binding changes, or when canonical
  // data moves while no local edit is in flight (undo, external command).
  useEffect(() => {
    const signature = draftSignature(node)
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    if (!dirtyRef.current) setDraft(draftFromView(node))
  })
  // Reset the local draft only when the target node changes. The binding key
  // embeds the session revision, and every chart command bumps it; resetting
  // on revision would wipe an in-progress draft after unrelated style commits.
  useEffect(() => {
    dirtyRef.current = false
    setDirty(false)
    setApplyError(null)
    setPendingType(null)
    signatureRef.current = draftSignature(node)
    setDraft(draftFromView(node))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const validation = validateDraft(draft, chartType)

  useEffect(() => commands.connectCanvasText?.({
    read: (kind, id) => kind === 'category'
      ? draft.categories.find(entry => entry.id === id)?.label
      : draft.series.find(entry => entry.id === id)?.name,
    commit: (kind, id, value) => {
      const exists = kind === 'category'
        ? draft.categories.some(entry => entry.id === id)
        : draft.series.some(entry => entry.id === id)
      if (!exists) return '该分类或系列已在数据草稿中删除，请先应用或取消草稿。'
      const next = {
        categories: draft.categories.map(entry => kind === 'category' && entry.id === id ? { ...entry, label: value } : entry),
        series: draft.series.map(entry => kind === 'series' && entry.id === id ? { ...entry, name: value } : entry),
      }
      const validated = validateDraft(next, chartType)
      const reason = validated.candidate
        ? commands.commitTableData(validated.candidate)
        : '数据草稿含有未完成或无效的内容，请在属性栏修正后应用。'
      setDraft(next)
      dirtyRef.current = Boolean(reason)
      setDirty(Boolean(reason))
      setApplyError(reason)
      return reason
    },
  }), [commands, draft, chartType])

  const selectType = (next: SlideChartType) => {
    if (next === chartType) return
    if (isCircularType(next) && node.series.length > 1) {
      // Multi-series → pie/donut must confirm which series survives before
      // anything is written; cancelling here leaves zero project writes.
      setPendingType({ target: next, seriesId: node.series[0]!.id })
      return
    }
    commands.patchType(next, isCircularType(next) ? node.series[0]?.id : undefined)
  }

  const applyDraft = () => {
    if (!validation.candidate) return
    preview?.(null)
    const reason = commands.commitTableData(validation.candidate)
    if (reason) {
      setApplyError(reason)
      return
    }
    dirtyRef.current = false
    setDirty(false)
    setApplyError(null)
  }

  const resetDraft = () => {
    preview?.(null)
    dirtyRef.current = false
    setDirty(false)
    setApplyError(null)
    setDraft(draftFromView(node))
  }

  const addCategory = () => {
    markDirty()
    setDraft((current) => ({
      categories: [...current.categories, { key: nanoid(8), label: '' }],
      series: current.series.map((series) => ({
        ...series,
        values: [...series.values, ''],
      })),
    }))
  }

  const removeCategory = (key: string) => {
    markDirty()
    setDraft((current) => {
      const index = current.categories.findIndex((category) => category.key === key)
      if (index < 0) return current
      return {
        categories: current.categories.filter((category) => category.key !== key),
        series: current.series.map((series) => ({
          ...series,
          values: series.values.filter((_, valueIndex) => valueIndex !== index),
        })),
      }
    })
  }

  const addSeries = () => {
    markDirty()
    setDraft((current) => ({
      categories: current.categories,
      series: [
        ...current.series,
        {
          key: nanoid(8),
          name: `系列 ${current.series.length + 1}`,
          color: DRAFT_SERIES_COLORS[current.series.length % DRAFT_SERIES_COLORS.length]!,
          values: current.categories.map(() => ''),
        },
      ],
    }))
  }

  const removeSeries = (key: string) => {
    markDirty()
    setDraft((current) => ({
      categories: current.categories,
      series: current.series.filter((series) => series.key !== key),
    }))
  }

  const patchCategoryLabel = (key: string, label: string) => {
    markDirty()
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((category) => (
        category.key === key ? { ...category, label } : category
      )),
    }))
  }

  const patchSeries = (key: string, patch: Partial<Pick<DraftSeries, 'name' | 'color'>>) => {
    markDirty()
    setDraft((current) => ({
      ...current,
      series: current.series.map((series) => (
        series.key === key ? { ...series, ...patch } : series
      )),
    }))
    if (patch.color) preview?.({ series: node.series.map(item => {
      const pending = draft.series.find(series => series.id === item.id)
      return { ...item, color: pending?.key === key ? patch.color! : pending?.color ?? item.color }
    }) })
  }

  const patchValue = (seriesKey: string, categoryIndex: number, value: string) => {
    markDirty()
    setDraft((current) => ({
      ...current,
      series: current.series.map((series) => (
        series.key === seriesKey
          ? {
              ...series,
              values: series.values.map((current2, index) => (
                index === categoryIndex ? value : current2
              )),
            }
          : series
      )),
    }))
  }

  return (
    <section className="property-section" data-testid="chart-properties">
      <h3 className="property-title">图表</h3>
      <BufferedInput
        label="图表标题"
        value={node.title}
        allowEmpty
        onCommit={(title) => commands.patchTitle(title)}
      />
      <SelectField<SlideChartType>
        label="图表类型"
        value={chartType}
        options={[...CHART_TYPE_OPTIONS]}
        onChange={selectType}
      />
      {pendingType && (
        <div className="chart-retained-series-picker" data-testid="chart-retained-series-picker" role="group" aria-label="选择保留的系列">
          <p className="property-hint">
            {pendingType.target === 'pie' ? '饼图' : '环形图'}只显示一个系列。请选择要保留的系列，其余系列将被移除。
          </p>
          {node.series.map((series) => (
            <label key={series.id} className="chart-retained-series-option">
              <input
                type="radio"
                name="chart-retained-series"
                checked={pendingType.seriesId === series.id}
                onChange={() => setPendingType({ ...pendingType, seriesId: series.id })}
              />
              <span>{series.name || series.id}</span>
            </label>
          ))}
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                commands.patchType(pendingType.target, pendingType.seriesId)
                setPendingType(null)
              }}
            >
              确认切换
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPendingType(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="property-subsection-header">
        <div>
          <strong>数据表</strong>
          <small>修改先留在草稿。点击「应用数据」，或在画布确认分类/系列文字时，一并应用。</small>
        </div>
      </div>
      <div
        className="chart-data-grid"
        data-testid="chart-data-table"
        role="group"
        aria-label="图表数据表"
        style={{
          display: 'grid',
          gridTemplateColumns: `minmax(88px, 1.2fr) repeat(${Math.max(draft.series.length, 1)}, minmax(72px, 1fr)) auto`,
          gap: 4,
          alignItems: 'start',
        }}
      >
        <span className="chart-data-grid__header">分类</span>
        {draft.series.map((series) => (
          <div key={series.key} className="chart-data-grid__header chart-data-grid__series">
            <input
              className="form-input"
              aria-label="系列名称"
              value={series.name}
              aria-invalid={validation.cellErrors[`series:${series.key}`] ? true : undefined}
              onChange={(event) => patchSeries(series.key, { name: event.currentTarget.value })}
            />
            <ColorInput
              id={`chart-series-color-${series.key}`}
              label="系列颜色"
              value={series.color}
              onChange={(color) => patchSeries(series.key, { color })}
              onPreviewChange={color => preview?.({
                series: node.series.map(item => ({ ...item, color: item.id === series.id && color !== null ? color
                  : draft.series.find(pending => pending.id === item.id)?.color ?? item.color })),
              })}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`删除系列 ${series.name || series.key}`}
              disabled={draft.series.length <= 1 || circular}
              title={circular ? '饼图/环形图只支持一个系列' : undefined}
              onClick={() => removeSeries(series.key)}
            >
              ×
            </button>
          </div>
        ))}
        <span className="chart-data-grid__header" aria-hidden="true" />
        {draft.categories.map((category, categoryIndex) => (
          <div key={category.key} className="chart-data-grid__row" style={{ display: 'contents' }}>
            <div className="chart-data-grid__cell">
              <input
                className="form-input"
                aria-label={`分类 ${categoryIndex + 1} 标签`}
                value={category.label}
                aria-invalid={validation.cellErrors[`cat:${category.key}`] ? true : undefined}
                onChange={(event) => patchCategoryLabel(category.key, event.currentTarget.value)}
              />
              {validation.cellErrors[`cat:${category.key}`] && (
                <small className="chart-data-grid__error" role="alert">
                  {validation.cellErrors[`cat:${category.key}`]}
                </small>
              )}
            </div>
            {draft.series.map((series) => {
              const error = validation.cellErrors[`value:${series.key}:${category.key}`]
              return (
                <div key={series.key} className="chart-data-grid__cell">
                  <input
                    className="form-input"
                    aria-label={`${series.name || '系列'} 在 ${category.label || `分类 ${categoryIndex + 1}`} 的值`}
                    inputMode="decimal"
                    value={series.values[categoryIndex] ?? ''}
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => patchValue(series.key, categoryIndex, event.currentTarget.value)}
                  />
                  {error && (
                    <small className="chart-data-grid__error" role="alert">{error}</small>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              className="icon-button"
              aria-label={`删除分类 ${category.label || categoryIndex + 1}`}
              disabled={draft.categories.length <= 1}
              onClick={() => removeCategory(category.key)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={addCategory}>添加分类</button>
        <button
          type="button"
          className="secondary-button"
          disabled={circular}
          title={circular ? '饼图/环形图只支持一个系列；切回柱状/折线/面积图后可添加。' : undefined}
          onClick={addSeries}
        >
          添加系列
        </button>
      </div>
      {validation.formErrors.map((message) => (
        <p key={message} className="property-hint chart-data-grid__error" role="alert">{message}</p>
      ))}
      {applyError && (
        <p className="property-hint chart-data-grid__error" role="alert" data-testid="chart-data-apply-error">
          应用失败：{applyError}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-testid="chart-data-apply"
          disabled={!dirty || !validation.candidate}
          onClick={applyDraft}
        >
          应用数据
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!dirty}
          onClick={resetDraft}
        >
          重置
        </button>
      </div>

      <div className="property-subsection-header">
        <div><strong>图表样式</strong></div>
      </div>
      <ToggleRow
        label="显示图例"
        checked={style.showLegend}
        onChange={(showLegend) => commands.patchStyle({ showLegend })}
      />
      <SelectField<NativeChartCommonStyle['legendPosition']>
        label="图例位置"
        value={style.legendPosition}
        disabled={!style.showLegend}
        options={[
          { value: 'top', label: '顶部' },
          { value: 'right', label: '右侧' },
          { value: 'bottom', label: '底部' },
          { value: 'left', label: '左侧' },
        ]}
        onChange={(legendPosition) => commands.patchStyle({ legendPosition })}
      />
      <ToggleRow
        label="显示数据标签"
        checked={style.showDataLabels}
        onChange={(showDataLabels) => commands.patchStyle({ showDataLabels })}
      />
      {cartesian && 'showCategoryAxis' in style && (
        <>
          <ToggleRow
            label="显示分类轴"
            checked={style.showCategoryAxis}
            onChange={(showCategoryAxis) => commands.patchStyle({ showCategoryAxis })}
          />
          <ToggleRow
            label="显示数值轴"
            checked={style.showValueAxis}
            onChange={(showValueAxis) => commands.patchStyle({ showValueAxis })}
          />
          <ToggleRow
            label="显示网格线"
            checked={style.showGridLines}
            onChange={(showGridLines) => commands.patchStyle({ showGridLines })}
          />
          <BufferedInput
            label="数值轴最小值（留空自动）"
            value={style.valueMin ?? ''}
            allowEmpty
            onCommit={(raw) => {
              const trimmed = raw.trim()
              if (!trimmed) {
                if (style.valueMin !== undefined) commands.patchStyle({ valueMin: undefined })
                return
              }
              const parsed = Number(trimmed)
              if (Number.isFinite(parsed)) commands.patchStyle({ valueMin: parsed })
            }}
          />
          <BufferedInput
            label="数值轴最大值（留空自动）"
            value={style.valueMax ?? ''}
            allowEmpty
            onCommit={(raw) => {
              const trimmed = raw.trim()
              if (!trimmed) {
                if (style.valueMax !== undefined) commands.patchStyle({ valueMax: undefined })
                return
              }
              const parsed = Number(trimmed)
              if (Number.isFinite(parsed)) commands.patchStyle({ valueMax: parsed })
            }}
          />
        </>
      )}
      {chartType === 'donut' && 'holeSize' in style && (
        <RangeField
          label="中心孔径"
          value={style.holeSize}
          min={10}
          max={90}
          suffix="%"
          onChange={(holeSize) => commands.patchStyle({ holeSize })}
        />
      )}
      <NativeColorInput
        id="chart-background"
        previewPatch={backgroundColor => ({ style: { backgroundColor } })}
        label="背景颜色"
        value={style.backgroundColor}
        onChange={(backgroundColor) => commands.patchStyle({ backgroundColor })}
      />
      <RangeField
        label="背景透明度"
        value={Math.round((1 - style.backgroundOpacity) * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => commands.patchStyle({ backgroundOpacity: 1 - value / 100 })}
      />
      <NativeColorInput
        id="chart-text-color"
        previewPatch={textColor => ({ style: { textColor } })}
        label="文字颜色"
        value={style.textColor}
        onChange={(textColor) => commands.patchStyle({ textColor })}
      />
      <FontFamilyPicker
        value={style.fontFamily}
        onCommit={(fontFamily) => commands.patchStyle({ fontFamily })}
      />
      <BufferedInput
        label="字号"
        type="number"
        min={6}
        max={144}
        value={style.fontSize}
        onCommit={(fontSize) => commands.patchStyle({ fontSize: Number(fontSize) })}
      />
    </section>
  )
}
