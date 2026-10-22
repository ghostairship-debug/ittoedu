import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ComponentFrame, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import { TextComponentEditor, FormulaComponentEditor } from '../../../components/text/editor'
import { textComponentDataSchema, formulaComponentDataSchema } from '../../../components/text/data'
import type { DocumentOperation } from '../../document/editorSession'
import type { SharedDocumentEditorHandle } from '../../document/SharedDocumentEditor'
import type { SlideContentEdit } from '../../store/slices/slideAuthoringSlice'
import { componentFrameStyle } from '../../componentPlatform/surfaces/slide'
import { CanvasPlainTextEditor, type PlainTextSelectionIntent } from '../CanvasPlainTextEditor'
import { authorFieldTextData } from '../../authoring/professionalContentFields'
import { authorFieldIdentity } from '../../documents/interactionSelection'
import { SelectionQuickBar } from '../../editing/quickbar/SelectionQuickBar'
import { visibleBounds, type QuickBarBounds, type QuickBarRect } from '../../editing/quickbar/placeQuickBar'

export interface ProfessionalContentEditorProps {
  project: CourseProjectV10
  draft: SlideContentEdit
  target(): HTMLElement | undefined | null
  update(data: unknown, composing?: boolean, height?: number, width?: number, rangeProjection?: TextRangeProjection[], historyGroup?: string): void
  updateSpot(value: string, composing?: boolean): void
  commit(): Promise<void>
  commitInput?(): Promise<void>
  cancel(): unknown
  undo(): void | Promise<void>
  redo(): void | Promise<void>
  report(message: string): void
  frame?: ComponentFrame
  clientPoint?: { x: number; y: number }
  caretOffset?: number
  selectionIntent?: PlainTextSelectionIntent
  floatingToolbar?: boolean
}

/** One professional input host. The target renderer keeps geometry; the Session keeps accepted History. */
export function ProfessionalContentEditor(props: ProfessionalContentEditorProps) {
  const { draft, target, frame } = props
  const [host, setHost] = useState<HTMLElement | null>(null), [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const [toolbarPlace, setToolbarPlace] = useState<{ anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  const root = useRef<HTMLDivElement>(null), rich = useRef<SharedDocumentEditorHandle>(null), latest = useRef(props)
  latest.current = props
  const identity = draft.authorSpot ? authorFieldIdentity(draft.instanceId, draft.authorSpot) : draft.instanceId
  const kind = componentDefinitionBuiltinKey(draft.target.editingProject.definitions[draft.definitionId])
  const richField = draft.authorSpot ? authorFieldTextData(draft.authorSpot, draft.spotValue ?? draft.authorSpot.initialValue) : undefined
  const ordinary = kind !== 'guoling.formula' || Boolean(draft.authorSpot)
  const reportCommit = (afterBlur = false, blurred?: EventTarget | null) => queueMicrotask(() => {
    const current = latest.current
    if (current.draft.instanceId !== draft.instanceId || current.draft.target.documentId !== draft.target.documentId
      || current.draft.target.epoch !== draft.target.epoch || (current.draft.authorSpot ? authorFieldIdentity(current.draft.instanceId, current.draft.authorSpot) : current.draft.instanceId) !== identity
      || !root.current?.isConnected) return
    if (afterBlur) {
      const active = root.current.ownerDocument.activeElement
      if (active && (root.current.contains(active) || active.closest('.text-edit-toolbar,.selection-quick-bar,.palette-button__panel'))) return
      if (blurred instanceof Node && !blurred.isConnected) { root.current.querySelector<HTMLElement>('.ProseMirror,input,textarea,[contenteditable="true"]')?.focus({ preventScroll: true }); return }
    }
    if (!current.draft.composing) void current.commit().catch(failure => current.report(failure instanceof Error ? failure.message : String(failure)))
  })
  useLayoutEffect(() => { setHost(target() ?? null) }, [draft.instanceId, identity, target])
  useLayoutEffect(() => {
    const authorKey = draft.authorSpot?.authorKey
    if (!host || !authorKey || richField) return
    const notify = (active: boolean) => host.dispatchEvent(new CustomEvent('component-author-input-state', { bubbles: true,
      detail: { instanceId: draft.instanceId, authorKey, active } }))
    notify(true)
    return () => { notify(false) }
  }, [host, identity, Boolean(richField)])
  useEffect(() => {
    if (props.clientPoint && rich.current?.focusAtClientPoint(props.clientPoint)) return
    root.current?.querySelector<HTMLElement>('.ProseMirror,textarea,input,[contenteditable="true"]')?.focus({ preventScroll: true })
  }, [host, identity, toolbar])
  useLayoutEffect(() => {
    const element = root.current
    if (!props.floatingToolbar || !element || !host) { setToolbarPlace(null); return }
    const position = () => {
      const bounds = visibleBounds(host), rect = element.getBoundingClientRect()
      const next = bounds.right > bounds.left && bounds.bottom > bounds.top
        ? { anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, bounds } : null
      setToolbarPlace(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    position()
    window.addEventListener('scroll', position, true); window.addEventListener('resize', position)
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    const changed = typeof MutationObserver === 'undefined' ? null : new MutationObserver(position)
    for (let parent: HTMLElement | null = element; parent && parent !== document.body; parent = parent.parentElement) {
      resized?.observe(parent); changed?.observe(parent, { attributes: true, attributeFilter: ['style', 'class'] })
    }
    return () => { window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); resized?.disconnect(); changed?.disconnect() }
  }, [host, identity, props.floatingToolbar])
  if (!host || !draft.authorSpot && kind !== 'guoling.text' && kind !== 'guoling.formula') return null
  const onChange = (data: unknown, operation: DocumentOperation) => {
    latest.current.update(data, undefined, undefined, undefined, operation.dataRangeProjection, operation.historyGroup)
    if (latest.current.commitInput && !latest.current.draft.composing && !latest.current.draft.authorSpot?.sourceRegion)
      return latest.current.commitInput().then(() => true, failure => { latest.current.report(failure instanceof Error ? failure.message : String(failure)); return false })
    return true
  }
  const composition = (active: boolean) => {
    const current = latest.current.draft
    latest.current.update(current.authorSpot ? authorFieldTextData(current.authorSpot, current.spotValue ?? current.authorSpot.initialValue) ?? current.data : current.data, active)
    if (!active && latest.current.commitInput && !current.authorSpot?.sourceRegion)
      void latest.current.commitInput().catch(failure => latest.current.report(failure instanceof Error ? failure.message : String(failure)))
  }
  const common = { revision: `${draft.target.epoch}:${identity}`, toolbarHost: toolbar,
    onUndo: props.undo, onRedo: props.redo, onDiagnostic: props.report, onCompositionChange: composition, onChange }
  const richData = richField ?? (!draft.authorSpot && kind === 'guoling.text' ? textComponentDataSchema.parse(draft.data) : undefined)
  return <>{createPortal(<div ref={root} data-component-professional-editor="" data-author-field-identity={draft.authorSpot ? identity : undefined} className="text-edit-overlay"
    style={{ ...(frame ? componentFrameStyle(frame) : draft.authorSpot ? componentFrameStyle(draft.authorSpot.localBounds) : { position: 'absolute' as const, inset: 0 }),
      zIndex: 20, pointerEvents: 'auto', background: draft.authorSpot && !richData ? 'transparent' : '#fff', overflow: 'visible',
      ...(draft.authorSpot && !richData ? { border: 0, boxShadow: 'none', minWidth: 0, minHeight: 0, margin: 0, padding: 0 } : {}) }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || latest.current.draft.composing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (ordinary) reportCommit(); else props.cancel() }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); reportCommit() }
    }} onBlur={event => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      reportCommit(true, event.target)
    }}>
    {!props.floatingToolbar && (richData || !draft.authorSpot) && <div className="text-edit-toolbar" ref={setToolbar} />}
    {richData ? <TextComponentEditor {...common} editorRef={rich} data={richData} />
      : draft.authorSpot ? <CanvasPlainTextEditor key={identity} bounds={{ x: 0, y: 0, width: draft.authorSpot.localBounds.width, height: draft.authorSpot.localBounds.height }}
        value={draft.spotText ?? ''} multiline label="编辑此处文字" initialCaret={props.caretOffset} initialPoint={props.clientPoint}
        presentation="inline" textStyle={draft.authorSpot.textStyle} selectionIntent={props.selectionIntent}
        onDraftChange={(value, composing) => { props.updateSpot(value, composing); if (!composing && !draft.authorSpot?.sourceRegion && props.commitInput) void props.commitInput().catch(failure => props.report(String(failure))) }}
        onCommit={value => { props.updateSpot(value, false); reportCommit() }} onCancel={() => reportCommit()} />
        : <FormulaComponentEditor {...common} data={formulaComponentDataSchema.parse(draft.data)} />}
  </div>, host)}
    {props.floatingToolbar && (richData || !draft.authorSpot) && <SelectionQuickBar
      anchor={toolbarPlace?.anchor ?? null} bounds={toolbarPlace?.bounds ?? null} label="文字编辑工具"
      selectionKey={`${draft.target.epoch}:${identity}`} aboveOffset={34}>
      <div className="text-edit-toolbar native-text-toolbar-host" ref={setToolbar}
        style={{ maxWidth: toolbarPlace ? Math.max(0, toolbarPlace.bounds.right - toolbarPlace.bounds.left - 18) : undefined }} />
    </SelectionQuickBar>}
  </>
}
