import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { GeometryPoint } from '../../../core/components/geometry'
import { frameToSpaceMatrix, invertMatrix, transformPoint } from '../../../core/components/geometry'
import { TextComponentEditor, FormulaComponentEditor } from '../../../components/text/editor'
import { textComponentDataSchema, formulaComponentDataSchema, renderTextComponent, renderFormulaComponent, measureTextComponent } from '../../../components/text'
import { layoutTable, editTableData, parseTableData } from '../../../components/table'
import { chartDataSchema, editChartData } from '../../../components/chart'
import { componentFrameStyle, freeSurfaceTargets } from '../../componentPlatform/surfaces/slide'
import { CanvasPlainTextEditor, type CanvasPlainTextBounds } from '../CanvasPlainTextEditor'
import type { SlideContentEdit } from '../../store/slices/slideAuthoringSlice'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import { SelectionQuickBar } from '../../editing/quickbar/SelectionQuickBar'
import { visibleBounds, type QuickBarBounds, type QuickBarRect } from '../../editing/quickbar/placeQuickBar'

interface Field { instanceId: string; kind: 'table-cell' | 'title' | 'category' | 'series'; childId: string; bounds: CanvasPlainTextBounds }
interface Ports {
  project: CourseProjectV10
  surfaceId: string
  edit: SlideContentEdit | null
  begin(instanceId: string): SlideContentEdit | null
  update(data: unknown, composing?: boolean, height?: number): void
  updateSpot?(value: string, composing?: boolean): void
  setComposing?(active: boolean): void
  commit(): Promise<void>
  cancel(): void
  undo(): void
  redo(): void
  host(): HTMLElement | null
  report(message: string): void
}
/** Uses the same rich text/IME owner and logical cell editor as the mature workspace. */
export function useSlideNativeTextEditor(ports: Ports, contextKey: string) {
  const latest = useRef(ports); latest.current = ports
  const latestContext = useRef(contextKey); latestContext.current = contextKey
  const [field, setField] = useState<Field | null>(null)
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const [toolbarPlace, setToolbarPlace] = useState<{ anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ports.edit || ports.edit.source !== 'canvas') return
    const editor = editorRoot.current?.querySelector<HTMLElement>('.ProseMirror,[contenteditable="true"]')
    editor?.focus({ preventScroll: true })
  }, [ports.edit?.instanceId, ports.edit?.target.documentId, ports.edit?.source])
  useEffect(() => { setField(null) }, [contextKey])
  const begin = (instanceId: string, surfacePoint: GeometryPoint, client: GeometryPoint): boolean => {
    const p = latest.current, instance = p.project.instances[instanceId]
    const target = freeSurfaceTargets(p.project, p.surfaceId).find(value => value.instanceId === instanceId)
    if (!instance || !target || instance.locked) return false
    const matrix = frameToSpaceMatrix(target.frame, target.parentToSurface)
    const local = transformPoint(invertMatrix(matrix), surfacePoint)
    const kind = componentDefinitionPresentation(p.project.definitions[instance.definitionId]).builtinKey
    if (kind === 'guoling.table') {
      const data = parseTableData(instance.data)
      const cell = layoutTable(data, { width: target.frame.width, height: target.frame.height }).cells.find(c =>
        local.x >= c.x && local.x <= c.x + c.width && local.y >= c.y && local.y <= c.y + c.height)
      if (!cell || !p.begin(instanceId)) return false
      setField({ instanceId, kind: 'table-cell', childId: cell.id, bounds: { x: cell.x, y: cell.y, width: cell.width, height: cell.height } })
      return true
    }
    if (kind === 'guoling.chart') {
      const svg = [...(p.host()?.querySelectorAll<SVGSVGElement>('svg[data-native-chart-id]') ?? [])].find(node => node.dataset.nativeChartId === instanceId)
      const text = [...(svg?.querySelectorAll<SVGTextElement>('[data-chart-text], [data-chart-category-id], [data-chart-series-id]') ?? [])].find(node => {
        const box = node.getBoundingClientRect()
        return client.x >= box.left - 6 && client.x <= box.right + 6 && client.y >= box.top - 6 && client.y <= box.bottom + 6
      })
      if (!text || !p.begin(instanceId)) return false
      const box = text.getBBox()
      setField({ instanceId, kind: text.dataset.chartCategoryId ? 'category' : text.dataset.chartSeriesId ? 'series' : 'title',
        childId: text.dataset.chartCategoryId ?? text.dataset.chartSeriesId ?? '', bounds: { x: box.x, y: box.y, width: Math.max(160, box.width), height: 32 } })
      return true
    }
    if (kind === 'guoling.text' || kind === 'guoling.formula') {
      setField(null)
      return Boolean(p.begin(instanceId))
    }
    return false
  }
  const draft = ports.edit
  const target = draft && freeSurfaceTargets(ports.project, ports.surfaceId).find(value => value.instanceId === draft.instanceId)
  const authoredFrame = draft?.frame === undefined ? target?.frame : draft.frame
  const outerMatrix = target && authoredFrame && frameToSpaceMatrix(authoredFrame, target.parentToSurface)
  const frame = target && authoredFrame && outerMatrix && (draft?.authorSpot
    ? { ...draft.authorSpot.localBounds, transform: [...frameToSpaceMatrix(draft.authorSpot.localBounds, outerMatrix)] as typeof target.frame.transform }
    : { ...authoredFrame, transform: [...outerMatrix] as typeof target.frame.transform })
  const reportCommit = (afterBlur = false, blurred?: EventTarget | null) => { queueMicrotask(() => {
    const current = latest.current.edit
    // A queued blur belongs to its original draft, even if navigation mounted another editor.
    if (!draft || latestContext.current !== contextKey || !current || current.target !== draft.target || current.instanceId !== draft.instanceId) return
    // Effect replay detaches the focused ProseMirror node. Restore its live
    // replacement; only a real departure from the editor commits the draft.
    if (afterBlur && blurred instanceof Node && !blurred.isConnected && editorRoot.current?.isConnected) {
      const replacement = editorRoot.current.querySelector<HTMLElement>('.ProseMirror,[contenteditable="true"]')
      if (replacement) { replacement.focus({ preventScroll: true }); return }
    }
    const active = document.activeElement
    if (afterBlur && active && (editorRoot.current?.contains(active) || active.closest('.text-edit-toolbar,.selection-quick-bar,.palette-button__panel'))) return
    void latest.current.commit().catch(error => latest.current.report(error instanceof Error ? error.message : String(error)))
  }) }
  const fieldValue = (): string => {
    if (!draft || !field || field.instanceId !== draft.instanceId) return ''
    if (field.kind === 'table-cell') return layoutTable(parseTableData(draft.data)).cells.find(cell => cell.id === field.childId)?.text ?? ''
    const chart = chartDataSchema.parse(draft.data)
    return field.kind === 'title' ? chart.title : field.kind === 'category'
      ? chart.categories.find(value => value.id === field.childId)?.label ?? ''
      : chart.series.find(value => value.id === field.childId)?.name ?? ''
  }
  const updateField = (text: string, composing: boolean) => {
    const current = latest.current.edit
    if (!current || !field) return
    const data = field.kind === 'table-cell'
      ? editTableData(parseTableData(current.data), { kind: 'cell-text', cellId: field.childId, text })
      : editChartData(chartDataSchema.parse(current.data), field.kind === 'title' ? { type: 'title', value: text }
        : field.kind === 'category' ? { type: 'category', categoryId: field.childId, label: text }
        : { type: 'series', seriesId: field.childId, name: text })
    latest.current.update(data, composing)
  }
  const advance = async (text: string, direction: 1 | -1) => {
    const current = latest.current.edit
    if (!current || !field || field.kind !== 'table-cell') return
    let data = editTableData(parseTableData(current.data), { kind: 'cell-text', cellId: field.childId, text })
    let cells = layoutTable(data).cells, index = cells.findIndex(cell => cell.id === field.childId)
    if (direction === 1 && index === cells.length - 1) {
      data = editTableData(data, { kind: 'insert-row', referenceRowId: data.rows.at(-1)!.id, position: 'after' })
      cells = layoutTable(data).cells
    }
    const next = cells[Math.max(0, Math.min(cells.length - 1, index + direction))]
    latest.current.update(data, false)
    try {
      await latest.current.commit()
      if (latestContext.current !== contextKey) return
      if (next && latest.current.project.instances[current.instanceId]?.definitionId === current.definitionId && latest.current.begin(current.instanceId))
        setField({ ...field, childId: next.id, bounds: { x: next.x, y: next.y, width: next.width, height: next.height } })
    } catch (error) { latest.current.report(error instanceof Error ? error.message : String(error)) }
  }
  const kind = draft && componentDefinitionPresentation(ports.project.definitions[draft.definitionId]).builtinKey
  const rich = !draft?.authorSpot && kind === 'guoling.text' && draft ? <TextComponentEditor data={textComponentDataSchema.parse(draft.data)}
    revision={draft.target.epoch + ':' + draft.instanceId} toolbarHost={toolbarHost} onChange={data => {
      const layout = authoredFrame && measureTextComponent(renderTextComponent(document, data), authoredFrame, data.sizing)
      ports.update(data, undefined, layout?.height)
    }}
    onUndo={ports.undo} onRedo={ports.redo} onDiagnostic={ports.report} />
    : !draft?.authorSpot && kind === 'guoling.formula' && draft ? <FormulaComponentEditor data={formulaComponentDataSchema.parse(draft.data)}
      revision={draft.target.epoch + ':' + draft.instanceId} toolbarHost={toolbarHost} onChange={data => {
        const layout = authoredFrame && measureTextComponent(renderFormulaComponent(document, data), authoredFrame, data.sizing)
        ports.update(data, undefined, layout?.height)
      }}
      onUndo={ports.undo} onRedo={ports.redo} onDiagnostic={ports.report} /> : null
  useLayoutEffect(() => {
    if (!rich) { setToolbarPlace(null); return }
    const root = editorRoot.current, host = latest.current.host()
    if (!root || !host) return
    const position = () => {
      const bounds = visibleBounds(host), rect = root.getBoundingClientRect()
      const next = bounds.right > bounds.left && bounds.bottom > bounds.top
        ? { anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, bounds } : null
      setToolbarPlace(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    position()
    window.addEventListener('scroll', position, true); window.addEventListener('resize', position)
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    const changed = typeof MutationObserver === 'undefined' ? null : new MutationObserver(position)
    // Pan, zoom and frame transforms change the projection without resizing the logical frame.
    for (let element: HTMLElement | null = root; element && element !== document.body; element = element.parentElement) {
      resized?.observe(element)
      changed?.observe(element, { attributes: true, attributeFilter: ['style', 'class'] })
    }
    return () => { window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); resized?.disconnect(); changed?.disconnect() }
  }, [Boolean(rich), draft?.instanceId, contextKey])
  return { begin, cancel: ports.cancel, editor: draft && frame && (rich || draft.authorSpot || field?.instanceId === draft.instanceId) ? <><div ref={editorRoot} data-component-professional-editor="" className="text-edit-overlay"
    style={{ ...componentFrameStyle(frame), zIndex: 20, pointerEvents: 'auto', background: '#fff', overflow: 'visible' }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onCompositionStart={() => { if (rich) { if (latest.current.setComposing) latest.current.setComposing(true); else latest.current.update(latest.current.edit?.data ?? null, true) } }}
    onCompositionEnd={() => { if (rich) { if (latest.current.setComposing) latest.current.setComposing(false); else latest.current.update(latest.current.edit?.data ?? null, false) } }}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !latest.current.edit?.composing) { event.stopPropagation(); ports.cancel() } }}
    onBlur={event => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      // Professional toolbar is a portal. Keep its selection and IME alive.
      if (next instanceof Element && next.closest('.text-edit-toolbar,.selection-quick-bar,.palette-button__panel')) return
      if (rich) reportCommit(true, event.target)
    }}>
    {rich}
    {draft.authorSpot && <CanvasPlainTextEditor key={draft.authorSpot.id} bounds={{ x: 0, y: 0, width: frame.width, height: frame.height }}
      value={draft.spotText ?? ''} multiline label={draft.authorSpot.sourceRegion?.kind === 'implementation' ? '编辑此处源码片段' : '编辑此处文字'}
      onDraftChange={(value, composing) => ports.updateSpot?.(value, composing)}
      onCommit={value => { ports.updateSpot?.(value, false); reportCommit() }} onCancel={ports.cancel} />}
    {field && field.instanceId === draft.instanceId && <CanvasPlainTextEditor key={field.kind + ':' + field.childId}
      bounds={field.bounds} value={fieldValue()} label={field.kind === 'table-cell' ? '编辑单元格' : '编辑图表文字'}
      maxLength={field.kind === 'table-cell' ? 20000 : 500} onDraftChange={updateField}
      onCommit={value => { updateField(value, false); reportCommit() }} onCancel={ports.cancel}
      onAdvance={field.kind === 'table-cell' ? (value, direction) => { void advance(value, direction) } : undefined} />}
  </div>
    {rich && <SelectionQuickBar anchor={toolbarPlace?.anchor ?? null} bounds={toolbarPlace?.bounds ?? null}
      label="文字编辑工具" selectionKey={contextKey + ':' + draft.instanceId} aboveOffset={34}>
      <div className="text-edit-toolbar native-text-toolbar-host" ref={setToolbarHost}
        style={{ maxWidth: toolbarPlace ? Math.max(0, toolbarPlace.bounds.right - toolbarPlace.bounds.left - 18) : undefined }} />
    </SelectionQuickBar>}
  </> : null }
}
