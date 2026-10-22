import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import type { ComponentAuthorSpot, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { GeometryPoint } from '../../../core/components/geometry'
import { frameToSpaceMatrix, invertMatrix, transformPoint } from '../../../core/components/geometry'
import { TextComponentEditor } from '../../../components/text/editor'
import { ProfessionalContentEditor } from './ProfessionalContentEditor'
import { createTextComponentData, renderTextComponent, renderFormulaComponent, measureTextComponent } from '../../../components/text'
import { layoutTable, editTableData, parseTableData, tableLayoutCellContent } from '../../../components/table'
import { chartDataSchema, editChartData } from '../../../components/chart'
import { componentFrameStyle, freeSurfaceTargets } from '../../componentPlatform/surfaces/slide'
import { CanvasPlainTextEditor, type CanvasPlainTextBounds, type PlainTextSelectionIntent } from '../CanvasPlainTextEditor'
import type { SlideContentEdit, SlideContentLayoutReady } from '../../store/slices/slideAuthoringSlice'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import { SelectionQuickBar } from '../../editing/quickbar/SelectionQuickBar'
import { visibleBounds, type QuickBarBounds, type QuickBarRect } from '../../editing/quickbar/placeQuickBar'
import type { SharedDocumentEditorHandle } from '../../document/SharedDocumentEditor'
import { authorFieldIdentity } from '../../documents/interactionSelection'
import { authorSpotValue } from '../../../core/components/authoring/componentAuthorEdits'
import { elementTextFontRequests, prepareTextFonts } from '../../../shared/fonts/ensureBundledFonts'

interface Field { instanceId: string; kind: 'table-cell' | 'title' | 'category' | 'series'; childId: string; bounds: CanvasPlainTextBounds; selectionIdentity?: string }
interface Ports {
  project: CourseProjectV10
  readProject?(): CourseProjectV10
  fieldIsCurrent?(identity: string): boolean
  surfaceId: string
  edit: SlideContentEdit | null
  begin(instanceId: string): SlideContentEdit | null
  update(data: unknown, composing?: boolean, height?: number, width?: number, rangeProjection?: TextRangeProjection[], historyGroup?: string, layoutReady?: SlideContentLayoutReady): void
  updateSpot?(value: string, composing?: boolean): void
  setComposing?(active: boolean): void
  onSelectField?(spot: ComponentAuthorSpot, activate?: () => boolean, read?: () => ComponentAuthorSpot | undefined): void
  commit(): Promise<void>
  commitInput?(): Promise<void>
  cancel(): void
  undo(): void
  redo(): void
  host(): HTMLElement | null
  report(message: string): void
}
/** The native editor and Bridge use the same semantic cell/label address. */
function fieldAuthorSpot(project: CourseProjectV10, field: Field): ComponentAuthorSpot | undefined {
  const instance = project.instances[field.instanceId]
  if (!instance) return undefined
  let path: string[] | undefined
  let bounds = field.bounds
  if (field.kind === 'table-cell') {
    const data = parseTableData(instance.data)
    const cell = layoutTable(data, instance.frame ? { width: instance.frame.width, height: instance.frame.height } : undefined).cells.find(value => value.id === field.childId)
    if (!cell) return undefined
    bounds = { x: cell.x, y: cell.y, width: cell.width, height: cell.height }
    for (const [rowIndex, row] of data.rows.entries()) {
      const cellIndex = row.cells.findIndex(cell => cell.id === field.childId)
      if (cellIndex >= 0) { path = ['rows', String(rowIndex), 'cells', String(cellIndex), row.cells[cellIndex].content ? 'content' : 'text']; break }
    }
    if (!path) {
      const columnIndex = data.columns.findIndex(column => `flow_header_${column.id}` === field.childId)
      if (columnIndex >= 0) path = ['columns', String(columnIndex), 'header']
    }
  } else {
    const data = chartDataSchema.parse(instance.data)
    const index = field.kind === 'category' ? data.categories.findIndex(value => value.id === field.childId)
      : field.kind === 'series' ? data.series.findIndex(value => value.id === field.childId) : -1
    path = field.kind === 'title' ? ['title'] : index < 0 ? undefined
      : field.kind === 'category' ? ['categories', String(index), 'label'] : ['series', String(index), 'name']
  }
  if (!path) return undefined
  const authorKey = field.kind === 'table-cell' ? path[0] === 'columns' ? `native:table-header:${field.childId}` : `native:table-cell:${field.childId}`
    : `native:chart-${field.kind}:${field.childId}`
  return { id: `native-field:${field.instanceId}:${field.kind}:${field.childId}`, instanceId: field.instanceId,
    mountGeneration: 0, kind: 'text', authorKey, dataPath: path, initialValue: structuredClone(authorSpotValue(instance.data, path) ?? null),
    localBounds: { width: bounds.width, height: bounds.height, transform: [1, 0, 0, 1, bounds.x, bounds.y] } }
}
/** Uses the same rich text/IME owner and logical cell editor as the mature workspace. */
export function useSlideNativeTextEditor(ports: Ports, contextKey: string) {
  const latest = useRef(ports); latest.current = ports
  const latestContext = useRef(contextKey); latestContext.current = contextKey
  const layoutGeneration = useRef(0)
  const [field, setField] = useState<Field | null>(null)
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const [toolbarPlace, setToolbarPlace] = useState<{ anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  const editorRoot = useRef<HTMLDivElement>(null)
  const richEditor = useRef<SharedDocumentEditorHandle>(null)
  const nativeObservation = useRef<{ context: string; field: Field; activate(): boolean; read(): ComponentAuthorSpot | undefined } | null>(null)
  const pendingCaret = useRef<{ instanceId: string; contextKey: string; client: GeometryPoint; caretOffset?: number } | null>(null)
  const [selectionIntent, setSelectionIntent] = useState<{ instanceId: string; authorKey?: string; value: PlainTextSelectionIntent } | null>(null)
  useEffect(() => {
    setSelectionIntent(null)
    const host = ports.host()?.closest('main') ?? ports.host()
    const receive = (event: Event) => {
      const value = (event as CustomEvent<{ instanceId: string; authorKey?: string; anchor?: number; focus?: number; word?: boolean; point?: GeometryPoint }>).detail
      if (value?.instanceId && latest.current.project.instances[value.instanceId]) setSelectionIntent({ instanceId: value.instanceId, authorKey: value.authorKey,
        value: { anchor: value.anchor, focus: value.focus, point: value.point, word: value.word } })
    }
    host?.addEventListener('component-author-selection', receive)
    return () => host?.removeEventListener('component-author-selection', receive)
  }, [contextKey])
  useEffect(() => {
    if (!ports.edit || ports.edit.source !== 'canvas' || field?.kind !== 'table-cell') return
    // The first render has an inline toolbar; its portal must settle before the click maps to text.
    if (pendingCaret.current && !toolbarHost) return
    const caret = pendingCaret.current
    pendingCaret.current = null
    if (caret?.instanceId === ports.edit.instanceId && caret.contextKey === contextKey && richEditor.current?.focusAtClientPoint(caret.client)) return
    const editor = editorRoot.current?.querySelector<HTMLElement>('.ProseMirror,[contenteditable="true"]')
    editor?.focus({ preventScroll: true })
  }, [ports.edit?.instanceId, ports.edit?.target.documentId, ports.edit?.source, toolbarHost, field?.childId])
  useEffect(() => { setField(null); nativeObservation.current = null }, [contextKey])
  const fieldRequest = (instanceId: string, definitionId: string, context: string, kind: Field['kind'], childId: string, client?: GeometryPoint) => {
    const currentTarget = () => {
      const ports = latest.current, project = ports.readProject?.() ?? ports.project, instance = project.instances[instanceId]
      if (latestContext.current !== context || !instance || instance.definitionId !== definitionId || instance.locked) return null
      const target = freeSurfaceTargets(project, ports.surfaceId).find(value => value.instanceId === instanceId)
      return target ? { ports, project, instance, target } : null
    }
    const read = () => {
      const current = currentTarget()
      if (!current) return undefined
      if (kind === 'table-cell') return fieldAuthorSpot(current.project, { instanceId, kind, childId, bounds: { x: 0, y: 0, width: 0, height: 0 } })
      const svg = [...(current.ports.host()?.querySelectorAll<SVGSVGElement>('svg[data-native-chart-id]') ?? [])].find(node => node.dataset.nativeChartId === instanceId)
      const text = [...(svg?.querySelectorAll<SVGTextElement>('[data-chart-text], [data-chart-category-id], [data-chart-series-id]') ?? [])].find(node =>
        kind === 'category' ? node.dataset.chartCategoryId === childId : kind === 'series' ? node.dataset.chartSeriesId === childId : node.dataset.chartText === 'title')
      if (!text) return undefined
      const box = text.getBBox()
      return fieldAuthorSpot(current.project, { instanceId, kind, childId, bounds: { x: box.x, y: box.y, width: Math.max(160, box.width), height: 32 } })
    }
    const activate = () => {
      const current = currentTarget(), spot = read()
      if (!current || !spot || !current.ports.begin(instanceId)) return false
      const field: Field = { instanceId, kind, childId, selectionIdentity: authorFieldIdentity(instanceId, spot),
        bounds: { x: spot.localBounds.transform[4], y: spot.localBounds.transform[5], width: spot.localBounds.width, height: spot.localBounds.height } }
      nativeObservation.current = { context, field, activate, read }
      current.ports.onSelectField?.(spot, activate, read)
      if (client) pendingCaret.current = { instanceId, contextKey: context, client }
      setField(field)
      return true
    }
    const select = () => {
      const current = currentTarget(), spot = read()
      if (!current || !spot) return false
      current.ports.onSelectField?.(spot, activate, read)
      return true
    }
    return { read, activate, select }
  }
  /** Capture the semantic field before a draft flush; invoking it never repeats a stale screen hit-test. */
  const capture = (instanceId: string, surfacePoint: GeometryPoint, client: GeometryPoint, selectOnly = false): (() => boolean) | null => {
    const p = latest.current, project = p.readProject?.() ?? p.project, instance = project.instances[instanceId]
    const target = freeSurfaceTargets(project, p.surfaceId).find(value => value.instanceId === instanceId)
    if (!instance || !target || instance.locked) return null
    const context = latestContext.current, definitionId = instance.definitionId
    const matrix = frameToSpaceMatrix(target.frame, target.parentToSurface), local = transformPoint(invertMatrix(matrix), surfacePoint)
    const kind = componentDefinitionPresentation(project.definitions[definitionId]).builtinKey
    if (kind === 'guoling.table') {
      const cell = layoutTable(parseTableData(instance.data), { width: target.frame.width, height: target.frame.height }).cells.find(c =>
        local.x >= c.x && local.x <= c.x + c.width && local.y >= c.y && local.y <= c.y + c.height)
      if (!cell) return null
      const request = fieldRequest(instanceId, definitionId, context, 'table-cell', cell.id, client)
      return selectOnly ? request.select : request.activate
    }
    if (kind === 'guoling.chart') {
      const svg = [...(p.host()?.querySelectorAll<SVGSVGElement>('svg[data-native-chart-id]') ?? [])].find(node => node.dataset.nativeChartId === instanceId)
      const text = [...(svg?.querySelectorAll<SVGTextElement>('[data-chart-text], [data-chart-category-id], [data-chart-series-id]') ?? [])].find(node => {
        const box = node.getBoundingClientRect()
        return client.x >= box.left - 6 && client.x <= box.right + 6 && client.y >= box.top - 6 && client.y <= box.bottom + 6
      })
      if (!text) return null
      const request = fieldRequest(instanceId, definitionId, context, text.dataset.chartCategoryId ? 'category' : text.dataset.chartSeriesId ? 'series' : 'title',
        text.dataset.chartCategoryId ?? text.dataset.chartSeriesId ?? '', client)
      return selectOnly ? request.select : request.activate
    }
    if (!selectOnly && (kind === 'guoling.text' || kind === 'guoling.formula')) return () => {
      const p = latest.current, current = (p.readProject?.() ?? p.project).instances[instanceId]
      if (latestContext.current !== context || !current || current.definitionId !== definitionId || current.locked) return false
      const edit = p.begin(instanceId)
      if (!edit) return false
      setField(null)
      if (kind === 'guoling.text') pendingCaret.current = { instanceId, contextKey: context, client }
      return true
    }
    return null
  }
  const placeCaret = (instanceId: string, client: GeometryPoint, caretOffset?: number) => { pendingCaret.current = { instanceId, contextKey: latestContext.current, client, caretOffset } }
  const begin = (instanceId: string, surfacePoint: GeometryPoint, client: GeometryPoint): boolean => capture(instanceId, surfacePoint, client)?.() ?? false
  const draft = ports.edit?.source === 'canvas' ? ports.edit : null
  useEffect(() => {
    if (!draft || draft.authorSpot || !field || field.instanceId !== draft.instanceId) return
    // Only this draft's own accepted baseline can advance its cell/label identity and value.
    const spot = fieldAuthorSpot(draft.target.editingProject, field)
    if (!spot) return
    const observation = nativeObservation.current
    if (!observation || observation.context !== contextKey || observation.field.instanceId !== field.instanceId
      || observation.field.kind !== field.kind || observation.field.childId !== field.childId) return
    latest.current.onSelectField?.(spot, observation.activate, observation.read)
    const identity = authorFieldIdentity(draft.instanceId, spot)
    setField(previous => previous && previous.instanceId === field.instanceId && previous.kind === field.kind && previous.childId === field.childId
      && previous.selectionIdentity !== identity ? { ...previous, selectionIdentity: identity } : previous)
  }, [draft?.target, field?.kind, field?.childId])
  const target = draft && freeSurfaceTargets(ports.project, ports.surfaceId).find(value => value.instanceId === draft.instanceId)
  const authoredFrame = draft?.frame === undefined ? target?.frame : draft.frame
  const outerMatrix = target && authoredFrame && frameToSpaceMatrix(authoredFrame, target.parentToSurface)
  const frame = target && authoredFrame && outerMatrix && (draft?.authorSpot
    ? { ...draft.authorSpot.localBounds, transform: [...frameToSpaceMatrix(draft.authorSpot.localBounds, outerMatrix)] as typeof target.frame.transform }
    : { ...authoredFrame, transform: [...outerMatrix] as typeof target.frame.transform })
  const reportCommit = (afterBlur = false, blurred?: EventTarget | null) => { queueMicrotask(() => {
    const current = latest.current.edit
    // A queued blur belongs to its original draft, even if navigation mounted another editor.
    if (!draft || latestContext.current !== contextKey || !current || current.target.documentId !== draft.target.documentId || current.target.epoch !== draft.target.epoch || current.instanceId !== draft.instanceId) return
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
  const advance = async (direction: 1 | -1) => {
    const current = latest.current.edit
    if (!current || !field || field.kind !== 'table-cell') return
    const identity = field.selectionIdentity
    // The professional cell draft already owns rich content. Navigation must not flatten it back to text.
    let data = parseTableData(current.data)
    const target=freeSurfaceTargets(latest.current.project,latest.current.surfaceId).find(value=>value.instanceId===current.instanceId)
    const dimensions=current.frame ?? target?.frame
    let cells = layoutTable(data,dimensions ? {width:dimensions.width,height:dimensions.height}:undefined).cells, index = cells.findIndex(cell => cell.id === field.childId)
    if (direction === 1 && index === cells.length - 1) {
      data = editTableData(data, { kind: 'insert-row', referenceRowId: data.rows.at(-1)!.id, position: 'after' })
      cells = layoutTable(data,dimensions ? {width:dimensions.width,height:dimensions.height}:undefined).cells
    }
    const next = cells[Math.max(0, Math.min(cells.length - 1, index + direction))]
    latest.current.update(data, false)
    try {
      await latest.current.commit()
      if (latestContext.current !== contextKey || identity && latest.current.fieldIsCurrent && !latest.current.fieldIsCurrent(identity)) return
      if (next) {
        const request = fieldRequest(current.instanceId, current.definitionId, contextKey, 'table-cell', next.id)
        request.activate()
      }
    } catch (error) { latest.current.report(error instanceof Error ? error.message : String(error)) }
  }
  const kind = draft && componentDefinitionPresentation(ports.project.definitions[draft.definitionId]).builtinKey
  const cellTable = draft && field?.kind === 'table-cell' ? parseTableData(draft.data) : undefined
  const cell = cellTable && layoutTable(cellTable, authoredFrame ? { width: authoredFrame.width, height: authoredFrame.height } : undefined).cells.find(value => value.id === field?.childId)
  const rich = draft && cellTable && cell ? <TextComponentEditor editorRef={richEditor}
    data={{ ...createTextComponentData(tableLayoutCellContent(cellTable, cell)), appearance: {
      ...createTextComponentData().appearance, fontFamily: cell.style.fontFamily, fontSize: cell.style.fontSize,
      color: cell.style.textColor, bold: cell.style.bold, italic: cell.style.italic, align: cell.style.horizontalAlign } }}
    revision={`${draft.target.epoch}:${draft.instanceId}:${cell.id}`} toolbarHost={toolbarHost}
    onChange={(data, operation) => {
      const current = latest.current.edit
      if (!current || !field || current.instanceId !== field.instanceId) return false
      const next = editTableData(parseTableData(current.data), { kind: 'cell-content', cellId: field.childId, content: data.content })
      latest.current.update(next, undefined, undefined, undefined, undefined, operation.historyGroup)
      return latest.current.commitInput?.().then(() => true, failure => { latest.current.report(String(failure)); return false }) ?? true
    }} onCompositionChange={active => {
      const current = latest.current.edit
      if (current) latest.current.update(current.data, active)
      if (!active) void latest.current.commitInput?.().catch(failure => latest.current.report(String(failure)))
    }} onUndo={ports.undo} onRedo={ports.redo} onDiagnostic={ports.report} /> : null
  const professional = draft && frame && (draft.authorSpot || kind === 'guoling.text' || kind === 'guoling.formula')
    ? <ProfessionalContentEditor project={ports.project} draft={draft} target={ports.host} frame={frame} floatingToolbar
      selectionIntent={selectionIntent?.instanceId === draft.instanceId && (!selectionIntent.authorKey || selectionIntent.authorKey === draft.authorSpot?.authorKey) ? selectionIntent.value : undefined}
      clientPoint={pendingCaret.current?.instanceId === draft.instanceId && pendingCaret.current.contextKey === contextKey ? pendingCaret.current.client : undefined}
      caretOffset={pendingCaret.current?.instanceId === draft.instanceId && pendingCaret.current.contextKey === contextKey ? pendingCaret.current.caretOffset : undefined}
      update={(data, composing, _height, _width, rangeProjection, historyGroup) => {
        const current = latest.current, generation = ++layoutGeneration.current
        let layoutReady: SlideContentLayoutReady | undefined
        const dom = current.host()?.ownerDocument
        if (!draft.authorSpot && authoredFrame && dom?.body && !(composing ?? current.edit?.composing)) {
          try {
            const element = kind === 'guoling.text'
              ? renderTextComponent(dom, data as Parameters<typeof renderTextComponent>[1])
              : renderFormulaComponent(dom, data as Parameters<typeof renderFormulaComponent>[1])
            const sizing = (data as Parameters<typeof renderTextComponent>[1]).sizing
            Object.assign(element.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
              left: '0', top: '0', width: `${authoredFrame.width}px`, height: `${authoredFrame.height}px` })
            let fonts: Promise<void> | undefined
            dom.body.append(element)
            try { fonts = prepareTextFonts(elementTextFontRequests(element), dom.fonts) } finally { element.remove() }
            const measure = () => {
              const active = latest.current.edit
              if (generation !== layoutGeneration.current || latestContext.current !== contextKey || !active
                || active.instanceId !== draft.instanceId || active.definitionId !== draft.definitionId
                || active.target.documentId !== draft.target.documentId || active.target.epoch !== draft.target.epoch) return undefined
              return measureTextComponent(element, authoredFrame, sizing)
            }
            layoutReady = fonts ? fonts.then(measure) : Promise.resolve(measure())
          } catch (failure) { layoutReady = Promise.reject(failure) }
          // The same rejection stays observable by the formal completion boundary, even without auto-commit.
          void layoutReady.catch(() => {})
        }
        current.update(data, composing, undefined, undefined, rangeProjection, historyGroup, layoutReady)
      }} updateSpot={(value, composing) => ports.updateSpot?.(value, composing)} commit={ports.commit} commitInput={ports.commitInput}
      cancel={ports.cancel} undo={ports.undo} redo={ports.redo} report={ports.report} /> : null
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
  return { begin, capture, placeCaret, cancel: ports.cancel, editor: professional ?? (draft && frame && field?.instanceId === draft.instanceId ? <><div ref={editorRoot} data-component-professional-editor="" className="text-edit-overlay"
    style={{ ...componentFrameStyle(frame), zIndex: 20, pointerEvents: 'auto', background: '#fff', overflow: 'visible' }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onCompositionStart={() => { if (rich) { if (latest.current.setComposing) latest.current.setComposing(true); else latest.current.update(latest.current.edit?.data ?? null, true) } }}
    onCompositionEnd={() => { if (rich) { if (latest.current.setComposing) latest.current.setComposing(false); else latest.current.update(latest.current.edit?.data ?? null, false) } }}
    onKeyDownCapture={event => {
      if (!rich || event.nativeEvent.isComposing || latest.current.edit?.composing
        || !(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return
      if ((event.key === 'Tab' || event.key === 'Enter') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); void advance(event.shiftKey ? -1 : 1)
      }
    }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || latest.current.edit?.composing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reportCommit() }
      else if (rich && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); event.stopPropagation(); reportCommit()
      }
    }}
    onBlur={event => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      // Professional toolbar is a portal. Keep its selection and IME alive.
      if (next instanceof Element && next.closest('.text-edit-toolbar,.selection-quick-bar,.palette-button__panel')) return
      if (rich) reportCommit(true, event.target)
    }}>
    {rich && <div data-author-field-identity={field?.selectionIdentity} style={{ position: 'absolute', left: field?.bounds.x, top: field?.bounds.y, width: field?.bounds.width, minHeight: field?.bounds.height }}>{rich}</div>}
    {field && field.kind !== 'table-cell' && field.instanceId === draft.instanceId && <CanvasPlainTextEditor key={field.kind + ':' + field.childId}
      bounds={field.bounds} value={fieldValue()} selectionIdentity={field.selectionIdentity} label="编辑图表文字"
      maxLength={500} onDraftChange={updateField}
      onCommit={value => { updateField(value, false); reportCommit() }} onCancel={ports.cancel}
 />}
  </div>
    {rich && <SelectionQuickBar anchor={toolbarPlace?.anchor ?? null} bounds={toolbarPlace?.bounds ?? null}
      label="文字编辑工具" selectionKey={contextKey + ':' + draft.instanceId} aboveOffset={34}>
      <div className="text-edit-toolbar native-text-toolbar-host" ref={setToolbarHost}
        style={{ maxWidth: toolbarPlace ? Math.max(0, toolbarPlace.bounds.right - toolbarPlace.bounds.left - 18) : undefined }} />
    </SelectionQuickBar>}
  </> : null) }
}
