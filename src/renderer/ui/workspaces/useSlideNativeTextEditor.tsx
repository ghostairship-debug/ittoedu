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
import { commitSlideTableLastCellAndAppendRow, patchSlideTableCellText } from '../../course/v9TableCommands'
import { clientToWorld, rotateWorldPoint, type StagePoint, type StageViewportTransform } from '../../authoring/stageViewportTransform'
import { chartCanvasTextPort } from '../../authoring/chartCanvasTextBridge'
import { createChartTextDraft, type ChartTextDraft, type ChartTextField } from '../../authoring/chartTextDraft'
import type { SlideFieldTextIntent, SlideFieldTextReceipt, V9SlideContentEditSession } from '../../authoring/v9SlideContentEdit'

interface Edit {
  target: SlideAuthoringTarget
  kind: 'table-cell' | 'title' | 'category' | 'series'
  childId: string
  value: string
  bounds: CanvasPlainTextBounds
  rotation: number
}
interface Ports {
  readEdit(): V9SlideContentEditSession | null
  runFieldTextIntent(intent: SlideFieldTextIntent): SlideFieldTextReceipt
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

/** Geometry stays local; chart content is held by the Surface edit lifecycle. */
export function useSlideNativeTextEditor(ports: Ports, contextKey: string) {
  const portsRef = useRef(ports)
  portsRef.current = ports
  const [edit, setEdit] = useState<Edit | null>(null)
  const makeChartDraftRef = useRef<((text: string) => ChartTextDraft) | null>(null)
  const ownedEdit = ports.readEdit()
  const ownedEditRef = useRef(ownedEdit)
  ownedEditRef.current = ownedEdit
  useEffect(() => {
    if (edit && !ownedEdit) setEdit(null)
  }, [ownedEdit, edit])
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
      const next = tableEdit(session, item, cell.id)
      if (!next) return false
      const begun = portsRef.current.runFieldTextIntent({ kind: 'begin-field', target: next.target, field: { kind: 'table-cell', cellId: cell.id } })
      if (!begun.ok) { portsRef.current.report(begun.reason); return false }
      ownedEditRef.current = begun.edit
      setEdit(next)
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
    const field: ChartTextField = kind === 'title' ? { kind } : { kind, id: childId }
    const begun = portsRef.current.runFieldTextIntent({ kind: 'begin-chart', target, field })
    if (!begun.ok || !begun.edit) { if (!begun.ok) portsRef.current.report(begun.reason); return false }
    const makeDraft = (text: string) => createChartTextDraft(chart, field, text,
      field.kind === 'title' ? undefined : chartCanvasTextPort(target)?.prepare?.(field.kind, field.id, text))
    makeChartDraftRef.current = makeDraft
    const updated = portsRef.current.runFieldTextIntent({ kind: 'update-chart', expectedEdit: begun.edit, draft: makeDraft(value), composing: false })
    if (updated.ok) ownedEditRef.current = updated.edit
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
    if (edit.kind !== 'table-cell' || advance === undefined) {
      let current = ownedEditRef.current
      if (!current) { setEdit(null); return }
      if (current.kind === 'chart-text' && makeChartDraftRef.current) {
        const updated = portsRef.current.runFieldTextIntent({ kind: 'update-chart', expectedEdit: current, draft: makeChartDraftRef.current(value), composing: false })
        if (!updated.ok || !updated.edit) { if (!updated.ok) portsRef.current.report(updated.reason); return }
        current = updated.edit
        ownedEditRef.current = current
      }
      const result = portsRef.current.runFieldTextIntent({ kind: 'commit', expectedEdit: current })
      if (!result.ok) portsRef.current.report(result.reason)
      else setEdit(null)
      return
    }
    setEdit(null)
    const live = portsRef.current.readBackend()?.getSession()
    if (!live || !matchesTarget(live, edit.target)) {
      portsRef.current.report('编辑目标已改变，文字未写入工程，请重新编辑。')
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
      return { ok: false, reason: '表格编辑目标已失效', nextSession: session }
    })
    if (!result.ok) {
      portsRef.current.report(result.reason ?? '文字提交失败')
      return
    }
    if (nextCellId && result.nextSession) {
      const item = layerIn(result.nextSession, edit.target.layerItemId)
      if (item) {
        const next = tableEdit(result.nextSession, item, nextCellId)
        if (next) {
          const begun = portsRef.current.runFieldTextIntent({ kind: 'begin-field', target: next.target, field: { kind: 'table-cell', cellId: nextCellId } })
          if (begun.ok) { ownedEditRef.current = begun.edit; setEdit(next) }
          else portsRef.current.report(begun.reason)
        }
      }
    }
  }

  return {
    begin,
    cancel: () => {
      const current = ownedEditRef.current
      if (current?.kind === 'chart-text' || current?.textField?.kind === 'table-cell') portsRef.current.runFieldTextIntent({ kind: 'cancel', expectedEdit: current })
      setEdit(null)
    },
    editor: edit ? <CanvasPlainTextEditor
      key={`${edit.target.authoringAddress}:${edit.target.revision}:${edit.kind}:${edit.childId}`}
      bounds={edit.bounds}
      rotation={edit.rotation}
      label={edit.kind === 'table-cell' ? '编辑单元格' : '编辑图表文字'}
      value={ownedEdit && 'text' in ownedEdit.draft ? ownedEdit.draft.text : edit.value}
      onDraftChange={(text, composing) => {
        const current = ownedEditRef.current
        if (current?.kind === 'chart-text' && makeChartDraftRef.current) {
          const updated = portsRef.current.runFieldTextIntent({ kind: 'update-chart', expectedEdit: current, draft: makeChartDraftRef.current(text), composing })
          if (updated.ok) ownedEditRef.current = updated.edit
        } else if (current?.kind === 'field-text') {
          const updated = portsRef.current.runFieldTextIntent({ kind: 'update-field', expectedEdit: current, text, composing })
          if (updated.ok) ownedEditRef.current = updated.edit
        }
      }}
      maxLength={edit.kind === 'table-cell' ? 20000 : 500}
      onCommit={value => finish(value)}
      onAdvance={edit.kind === 'table-cell' ? (value, direction) => finish(value, direction) : undefined}
      onCancel={() => {
        const current = ownedEditRef.current
        if (current?.kind === 'chart-text' || current?.textField?.kind === 'table-cell') portsRef.current.runFieldTextIntent({ kind: 'cancel', expectedEdit: current })
        setEdit(null)
      }}
    /> : null,
  }
}
