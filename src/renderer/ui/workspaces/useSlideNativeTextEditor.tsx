import { useEffect, useRef, useState } from 'react'
import { CanvasPlainTextEditor, type CanvasPlainTextBounds } from '../CanvasPlainTextEditor'
import { buildNativeTableLayout } from '../../../shared/nativeTableLayout'
import type { NativeLayerItem } from '../../../shared/courseProjectTypes'
import {
  buildSlideEditorView,
  makeSlideAuthoringTarget,
  type SlideAuthoringBackend,
  type SlideAuthoringSession,
  type SlideAuthoringTarget,
  type SlideCommandResult,
} from '../../course/slideAuthoringBackend'
import { patchSlideLayerPropertiesAtTarget } from '../../course/v9SlideContentCommands'
import { commitSlideTableLastCellAndAppendRow, patchSlideTableCellText } from '../../course/v9TableCommands'
import { clientToWorld, rotateWorldPoint, type StagePoint, type StageViewportTransform } from '../../authoring/stageViewportTransform'
import { chartCanvasTextPort } from '../../authoring/chartCanvasTextBridge'

interface Edit {
  target: SlideAuthoringTarget
  kind: 'table-cell' | 'title' | 'category' | 'series'
  childId: string
  value: string
  bounds: CanvasPlainTextBounds
  rotation: number
}
interface Ports {
  readBackend(): SlideAuthoringBackend | null
  readHost(): HTMLElement | null
  readTransform(): StageViewportTransform | null
  apply(command: (session: SlideAuthoringSession) => SlideCommandResult): SlideCommandResult
  report(message: string): void
}
function layerIn(session: SlideAuthoringSession, id: string): NativeLayerItem | null {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find(entry => entry.selectionId === id && entry.source === session.scope)
  return layer?.item.kind === 'native' && !layer.item.locked ? structuredClone(layer.item) as NativeLayerItem : null
}

function tableEdit(session: SlideAuthoringSession, item: NativeLayerItem, cellId: string): Edit | null {
  if (item.content.nativeType !== 'table') return null
  const cell = buildNativeTableLayout(item.content.data, item.frame).cells.find(entry => entry.id === cellId)
  if (!cell) return null
  const center = rotateWorldPoint(
    { x: item.frame.x + cell.x + cell.width / 2, y: item.frame.y + cell.y + cell.height / 2 },
    { x: item.frame.x + item.frame.width / 2, y: item.frame.y + item.frame.height / 2 },
    item.rotation,
  )
  return {
    target: makeSlideAuthoringTarget(session, item.layerItemId, 'item'),
    kind: 'table-cell', childId: cellId, value: cell.text,
    bounds: {
      x: center.x - cell.width / 2, y: center.y - cell.height / 2,
      width: cell.width, height: cell.height,
    },
    rotation: item.rotation,
  }
}

function matchesTarget(session: SlideAuthoringSession, target: SlideAuthoringTarget): boolean {
  return session.sessionId === target.sessionId && session.generation === target.generation &&
    session.scope === target.scope && session.history.present.revision === target.revision &&
    makeSlideAuthoringTarget(session, target.layerItemId, 'item').authoringAddress === target.authoringAddress
}

/** Local draft only. Every commit uses the existing target-checked Native commands. */
export function useSlideNativeTextEditor(ports: Ports, contextKey: string) {
  const portsRef = useRef(ports)
  portsRef.current = ports
  const [edit, setEdit] = useState<Edit | null>(null)
  useEffect(() => { setEdit(null) }, [contextKey])

  const begin = (layerId: string, world: StagePoint, client: StagePoint): boolean => {
    const session = portsRef.current.readBackend()?.getSession()
    if (!session) return false
    const item = layerIn(session, layerId)
    if (!item) return false
    if (item.content.nativeType === 'table') {
      const local = rotateWorldPoint(world,
        { x: item.frame.x + item.frame.width / 2, y: item.frame.y + item.frame.height / 2 }, -item.rotation)
      const cell = buildNativeTableLayout(item.content.data, item.frame).cells.find(entry =>
        local.x >= item.frame.x + entry.x && local.x <= item.frame.x + entry.x + entry.width &&
        local.y >= item.frame.y + entry.y && local.y <= item.frame.y + entry.y + entry.height)
      if (!cell) return false
      setEdit(tableEdit(session, item, cell.id))
      return true
    }
    if (item.content.nativeType !== 'chart') return false
    const chart = item.content.data
    const host = portsRef.current.readHost()
    const svg = [...(host?.querySelectorAll<SVGSVGElement>('svg[data-native-chart-id]') ?? [])].find(node => node.dataset.nativeChartId === layerId)
    const text = [...(svg?.querySelectorAll<SVGTextElement>('[data-chart-text], [data-chart-category-id], [data-chart-series-id]') ?? [])].find(node => {
      const rect = node.getBoundingClientRect()
      return client.x >= rect.left - 6 && client.x <= rect.right + 6 &&
        client.y >= rect.top - 6 && client.y <= rect.bottom + 6
    })
    const transform = portsRef.current.readTransform()
    if (!text || !transform) return false
    const kind = text.dataset.chartCategoryId ? 'category' : text.dataset.chartSeriesId ? 'series' : 'title'
    const childId = text.dataset.chartCategoryId ?? text.dataset.chartSeriesId ?? ''
    const target = makeSlideAuthoringTarget(session, layerId, 'item')
    const bridge = chartCanvasTextPort(target)
    const value = kind === 'title' ? chart.title : bridge ? bridge.read(kind, childId)
      : kind === 'category' ? chart.categories.find(entry => entry.id === childId)?.label
      : chart.series.find(entry => entry.id === childId)?.name
    if (value === undefined) return false
    const rect = text.getBoundingClientRect()
    const origin = clientToWorld(transform, { x: rect.left, y: rect.top })
    setEdit({
      target, kind, childId, value,
      bounds: { ...origin, width: Math.max(160, rect.width / transform.scale), height: 32 },
      rotation: 0,
    })
    return true
  }

  const finish = (value: string, advance?: 1 | -1) => {
    if (!edit) return
    setEdit(null)
    const live = portsRef.current.readBackend()?.getSession()
    if (!live || !matchesTarget(live, edit.target)) {
      portsRef.current.report('编辑目标已改变，文字未写入工程，请重新编辑。')
      return
    }
    const bridge = chartCanvasTextPort(edit.target)
    if (bridge && (edit.kind === 'category' || edit.kind === 'series')) {
      const reason = bridge.commit(edit.kind, edit.childId, value)
      if (reason) portsRef.current.report(reason)
      return
    }
    let nextCellId: string | undefined
    const result = portsRef.current.apply(session => {
      const target = edit.target
      const item = layerIn(session, target.layerItemId)
      if (!item || !matchesTarget(session, target)) {
        return { ok: false, reason: '编辑目标已改变，文字未写入工程，请重新编辑。', nextSession: session }
      }
      if (edit.kind === 'table-cell' && item.content.nativeType === 'table') {
        const cells = buildNativeTableLayout(item.content.data, item.frame).cells
        const index = cells.findIndex(cell => cell.id === edit.childId)
        const cellPatch = { layerItemId: item.layerItemId, cellId: edit.childId, text: value }
        if (advance === 1 && index === cells.length - 1) {
          const appended = commitSlideTableLastCellAndAppendRow(session, cellPatch, { expectedRevision: target.revision })
          if (appended.ok) {
            const updated = layerIn(appended.nextSession!, item.layerItemId)
            if (updated?.content.nativeType === 'table') nextCellId = updated.content.data.rows.at(-1)?.cells[0]?.id
          }
          return appended
        }
        if (advance) nextCellId = cells[Math.max(0, Math.min(cells.length - 1, index + advance))]?.id
        return patchSlideTableCellText(session, cellPatch, { expectedRevision: target.revision })
      }
      if (item.content.nativeType !== 'chart') return { ok: false, reason: '图表编辑目标已失效', nextSession: session }
      const chart = item.content.data
      const nativeData = edit.kind === 'title' ? { title: value } : edit.kind === 'category'
        ? { categories: chart.categories.map(entry => entry.id === edit.childId ? { ...entry, label: value } : entry) }
        : { series: chart.series.map(entry => entry.id === edit.childId ? { ...entry, name: value } : entry) }
      return patchSlideLayerPropertiesAtTarget(session, target, { nativeData }, { expectedRevision: target.revision })
    })
    if (!result.ok) {
      portsRef.current.report(result.reason ?? '文字提交失败')
      return
    }
    if (nextCellId && result.nextSession) {
      const item = layerIn(result.nextSession, edit.target.layerItemId)
      if (item) setEdit(tableEdit(result.nextSession, item, nextCellId))
    }
  }

  return {
    begin,
    cancel: () => setEdit(null),
    editor: edit ? <CanvasPlainTextEditor
      key={`${edit.target.authoringAddress}:${edit.target.revision}:${edit.kind}:${edit.childId}`}
      bounds={edit.bounds}
      rotation={edit.rotation}
      label={edit.kind === 'table-cell' ? '编辑单元格' : '编辑图表文字'}
      value={edit.value}
      maxLength={edit.kind === 'table-cell' ? 20000 : 500}
      onCommit={value => finish(value)}
      onAdvance={edit.kind === 'table-cell' ? (value, direction) => finish(value, direction) : undefined}
      onCancel={() => setEdit(null)}
    /> : null,
  }
}
