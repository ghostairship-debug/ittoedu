import { useState } from 'react'
import type { ComponentEdit } from '../../shared/contracts/component-platform'
import type { ChartData } from './data'
import { chartEdit, type ChartEdit } from './edit'

/** Controlled projection: the host applies each operation through its canonical session. */
export function ChartEditor({ instanceId, data, onEdit }: {
  instanceId: string; data: ChartData; onEdit: (edit: ComponentEdit) => void | Promise<void>
}) {
  const [error, setError] = useState('')
  const apply = (edit: ChartEdit) => {
    try {
      const ack = onEdit(chartEdit(instanceId, data, edit))
      if (ack) void ack.then(() => setError(''), failure => setError(failure instanceof Error ? failure.message : String(failure)))
      else setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const toggle = (label: string, field: string, checked: boolean) => <label>{label}<input type="checkbox" checked={checked}
    onChange={event => apply({ type: 'style', patch: { [field]: event.target.checked } })} /></label>
  return <fieldset><legend>图表数据与样式</legend>
    <label>标题<input value={data.title} onChange={event => apply({ type: 'title', value: event.target.value })} /></label>
    <table><thead><tr><th>分类</th>{data.series.map(series => <th key={series.id}>
      <input aria-label="系列名称" value={series.name} onChange={event => apply({ type: 'series', seriesId: series.id, name: event.target.value })} />
      <input aria-label="系列颜色" type="color" value={series.color} onChange={event => apply({ type: 'series', seriesId: series.id, color: event.target.value })} />
    </th>)}</tr></thead><tbody>{data.categories.map(category => <tr key={category.id}>
      <td><input aria-label="分类名称" value={category.label} onChange={event => apply({ type: 'category', categoryId: category.id, label: event.target.value })} /></td>
      {data.series.map(series => <td key={series.id}><input aria-label={`${series.name} ${category.label}`} type="number"
        min={data.chartType === 'pie' || data.chartType === 'donut' ? 0 : undefined}
        value={series.points.find(point => point.categoryId === category.id)?.value ?? ''}
        onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) apply({ type: 'point', seriesId: series.id, categoryId: category.id, value: event.target.valueAsNumber }) }} /></td>)}
    </tr>)}</tbody></table>
    {toggle('图例', 'showLegend', data.style.showLegend)}
    <label>图例位置<select value={data.style.legendPosition} onChange={event => apply({ type: 'style', patch: { legendPosition: event.target.value } })}>
      <option value="top">上</option><option value="bottom">下</option><option value="left">左</option><option value="right">右</option>
    </select></label>
    {toggle('数据标签', 'showDataLabels', data.style.showDataLabels)}
    {'showCategoryAxis' in data.style && <>
      {toggle('分类坐标', 'showCategoryAxis', data.style.showCategoryAxis)}
      {toggle('数值坐标', 'showValueAxis', data.style.showValueAxis)}
      {toggle('网格', 'showGridLines', data.style.showGridLines)}
      <label>坐标最小值<input type="number" value={data.style.valueMin ?? ''} onChange={event => {
        const valueMin = event.target.value === '' ? undefined : event.target.valueAsNumber
        if (event.target.value === '' || Number.isFinite(valueMin)) apply({ type: 'style', patch: { valueMin } })
      }} /></label>
      <label>坐标最大值<input type="number" value={data.style.valueMax ?? ''} onChange={event => {
        const valueMax = event.target.value === '' ? undefined : event.target.valueAsNumber
        if (event.target.value === '' || Number.isFinite(valueMax)) apply({ type: 'style', patch: { valueMax } })
      }} /></label>
    </>}
    {error && <p role="alert">{error}</p>}
  </fieldset>
}
