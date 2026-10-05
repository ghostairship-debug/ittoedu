import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react'
import type { ComponentEdit } from '../../../../shared/contracts/component-platform/operations'
import type { ComponentInstance, CourseProjectV10 } from '../../../../shared/contracts/component-platform/project'
import { textComponentDataSchema, type TextComponentData } from '../../../../components/text/data'
import { textDataFromEditor, textEditorDocument } from '../../../../components/text/editor'
import { SharedDocumentEditor } from '../../../document/SharedDocumentEditor'
import type { DocumentCommitResult, DocumentOperation } from '../../../document/editorSession'
import type { DocumentContextSelection } from '../../../../shared/document/ports'
import { renderDocumentText } from '../../../../shared/document/render'
import { componentPaintStyle } from '../../../../player/components/componentPlacementStyle'
import { containerChildIds } from '../../../../shared/contracts/component-platform/project'
import { flowInstanceIds, flowIsHeadless, flowMoveEdit, flowParent, flowSurface, flowTextEdits } from './model'
import { captureFlowReadingPosition, jumpToFlowInstance, restoreFlowReadingPosition, type FlowReadingPosition } from './readingAnchor'
import './flow.css'

export interface ComponentFlowSurfaceProps {
  project: CourseProjectV10
  surfaceId: string
  selectedInstanceId?: string | null
  readOnly?: boolean
  onSelect(instanceId: string): void
  /** Host routes every edit to the same DocumentProjection/Session. */
  onEdits(edits: ComponentEdit[], operation?: DocumentOperation): DocumentCommitResult
  onUndo(): void
  onRedo(): void
  /** Non-text roots are mounted by the shared R0 owner. Null retires the root. */
  onElement(instanceId: string, root: HTMLElement | null): void
  onTargetElement?(instanceId: string, element: HTMLElement | null): void
  onComposition?(instanceId: string, composing: boolean): void
  onDiagnostic?(message: string): void
  onRange?(instanceId: string, target: DocumentContextSelection | null): void
  renderRangeActions?(instanceId: string, target: DocumentContextSelection): ReactNode
  renderEditor?(instance: ComponentInstance): ReactNode
  toolbarHost?: HTMLElement | null
}

export interface ComponentFlowSurfaceHandle {
  jumpTo(instanceId: string): boolean
  setCollapsed(instanceId: string, collapsed: boolean): void
  captureReadingPosition(): FlowReadingPosition
}

function RuntimeRoot({ id, onElement }: { id: string; onElement: ComponentFlowSurfaceProps['onElement'] }) {
  const bind = useCallback((root: HTMLDivElement | null) => onElement(id, root), [id, onElement])
  return <div ref={bind} className="component-flow-runtime" data-component-runtime-root={id} />
}

function BlockShell({ instanceId, onTargetElement, children, ...attributes }: HTMLAttributes<HTMLElement> & {
  instanceId: string; onTargetElement?: ComponentFlowSurfaceProps['onTargetElement']
}) {
  const bind = useCallback((element: HTMLElement | null) => onTargetElement?.(instanceId, element), [instanceId, onTargetElement])
  return <section {...attributes} ref={bind}>{children}</section>
}

/** One editable field projection. It owns no content History or persistent object IDs. */
function FlowTextEditor({ instance, data, props }: { instance: ComponentInstance; data: TextComponentData; props: ComponentFlowSurfaceProps }) {
  const composing = useRef(false)
  const pinnedData = useRef(data)
  if (!composing.current) pinnedData.current = data
  return <SharedDocumentEditor document={textEditorDocument(pinnedData.current)} revision={String(props.project.revision)}
    target="flow" toolbarHost={props.toolbarHost} onUndo={props.onUndo} onRedo={props.onRedo}
    onDraft={(_source, diagnostics) => { if (diagnostics.length) props.onDiagnostic?.(diagnostics[0].message) }}
    onContextualTargetChange={target => props.onRange?.(instance.id, target)}
    renderQuickBarActions={target => props.renderRangeActions?.(instance.id, target)}
    onCompositionChange={value => {
      composing.current = value
      // The PM compositionend publication is queued in the same event turn.
      // End the host field buffer only after that final publication has run.
      if (value) props.onComposition?.(instance.id, true)
      else setTimeout(() => props.onComposition?.(instance.id, false), 0)
    }}
    onChange={async (document, operation) => {
      try {
        const after = textDataFromEditor(pinnedData.current, document)
        const edits = flowTextEdits(instance.id, pinnedData.current, after)
        const result = edits.length ? await props.onEdits(edits, operation) : undefined
        if (result !== false) pinnedData.current = after
        return result
      } catch (error) { props.onDiagnostic?.(error instanceof Error ? error.message : String(error)); return false }
    }} />
}

/** Ordered DOM is a replaceable projection of V10; the host keeps History and R0 instances. */
export const ComponentFlowSurface = forwardRef<ComponentFlowSurfaceHandle, ComponentFlowSurfaceProps>(function ComponentFlowSurface(props, ref) {
  const surface = flowSurface(props.project, props.surfaceId)
  const viewport = useRef<HTMLDivElement | null>(null)
  const reading = useRef<FlowReadingPosition>([])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [composingId, setComposingId] = useState<string | null>(null)
  const retainReading = useCallback(() => { if (viewport.current) reading.current = captureFlowReadingPosition(viewport.current) }, [])
  const changeCollapse = useCallback((id: string, value: boolean) => {
    retainReading()
    setCollapsed(previous => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next })
  }, [retainReading])
  useImperativeHandle(ref, () => ({
    jumpTo: id => {
      if (!viewport.current || !flowInstanceIds(props.project, surface.id).includes(id)) return false
      // Open canonical ancestors before the post-render scroll request.
      const parents: string[] = []
      let owner = flowParent(props.project, id)
      while (owner?.kind === 'instance') { parents.push(owner.instanceId); owner = flowParent(props.project, owner.instanceId) }
      if (parents.some(parent => collapsed.has(parent))) {
        setCollapsed(previous => new Set([...previous].filter(parent => !parents.includes(parent))))
        requestAnimationFrame(() => { if (viewport.current) { jumpToFlowInstance(viewport.current, id); retainReading() } })
        return true
      }
      const found = jumpToFlowInstance(viewport.current, id); retainReading(); return found
    },
    setCollapsed: changeCollapse,
    captureReadingPosition: () => viewport.current ? captureFlowReadingPosition(viewport.current) : [],
  }), [props.project, surface.id, collapsed, changeCollapse, retainReading])

  useLayoutEffect(() => {
    if (viewport.current) { restoreFlowReadingPosition(viewport.current, reading.current); retainReading() }
  }, [props.project, props.selectedInstanceId, collapsed, editingId, retainReading])

  useLayoutEffect(() => {
    if (!composingId && editingId && (!props.project.instances[editingId] || props.selectedInstanceId !== editingId)) setEditingId(null)
  }, [props.selectedInstanceId, props.project, composingId, editingId])

  const renderInstance = (id: string): ReactNode => {
    const instance = props.project.instances[id]
    if (!instance) return null
    const definition = props.project.definitions[instance.definitionId]
    const parsedText = definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.text'
      && !instance.implementationOverride ? textComponentDataSchema.safeParse(instance.data) : null
    const text = parsedText?.success ? parsedText.data : null
    const children = instance.childIds ?? []
    const isCollapsed = collapsed.has(id)
    const selected = props.selectedInstanceId === id
    const hidden = flowIsHeadless(props.project, instance)
    const professionalEditor = selected && !props.readOnly ? props.renderEditor?.(instance) : null
    const parent = flowParent(props.project, id)
    const siblings = parent ? containerChildIds(props.project, parent) : []
    const index = siblings.indexOf(id)
    const move = (destination: number) => {
      retainReading()
      try { const edits = flowMoveEdit(props.project, surface.id, id, destination); if (edits.length) props.onEdits(edits) }
      catch (error) { props.onDiagnostic?.(error instanceof Error ? error.message : String(error)) }
    }
    return <BlockShell key={id} instanceId={id} onTargetElement={props.onTargetElement} data-component-flow-id={id} data-selected={selected || undefined}
      className="component-flow-block" style={{ ...componentPaintStyle(instance,definition), display: hidden ? 'none' : undefined, width: instance.frame?.width,
        maxWidth: '100%', minHeight: text?.sizing.mode === 'fixed' ? undefined : instance.frame?.height,
        height: text?.sizing.mode === 'fixed' ? instance.frame?.height : undefined,
        overflow: text?.sizing.overflow === 'clip' ? 'hidden' : undefined }}
      onClick={event => { event.stopPropagation(); if (!props.readOnly) props.onSelect(id) }}>
      {!props.readOnly && selected && <div className="component-flow-block-actions" contentEditable={false}>
        <button type="button" disabled={index <= 0 || composingId !== null} onClick={event => { event.stopPropagation(); move(index - 1) }}>上移</button>
        <button type="button" disabled={index < 0 || index >= siblings.length - 1 || composingId !== null} onClick={event => { event.stopPropagation(); move(index + 1) }}>下移</button>
        {text && <button type="button" disabled={composingId !== null && composingId !== id} onClick={event => { event.stopPropagation(); retainReading(); setEditingId(id) }}>编辑正文</button>}
      </div>}
      {text ? <div className="component-flow-text" style={{ fontFamily: text.appearance.fontFamily, fontSize: text.appearance.fontSize,
        color: text.appearance.color, textAlign: text.appearance.align, lineHeight: text.appearance.lineHeight }}>
        {editingId === id || composingId === id ? <FlowTextEditor key={id} instance={instance} data={text} props={{ ...props,
          onComposition: (targetId, value) => { setComposingId(value ? targetId : null); props.onComposition?.(targetId, value) } }} />
          : <div onDoubleClick={() => { if (!props.readOnly && composingId === null) { retainReading(); props.onSelect(id); setEditingId(id) } }} dangerouslySetInnerHTML={{ __html: renderDocumentText(text.content) }} />}
      </div> : <><RuntimeRoot id={id} onElement={props.onElement} />{professionalEditor}</>}
      {children.length > 0 && <>
        <button type="button" className="component-flow-collapse" aria-expanded={!isCollapsed} aria-label={isCollapsed ? '展开随文内容' : '收起随文内容'}
          onClick={event => { event.stopPropagation(); changeCollapse(id, !isCollapsed) }}>{isCollapsed ? '展开' : '收起'}</button>
        <div className="component-flow-children" hidden={isCollapsed}>{children.map(renderInstance)}</div>
      </>}
    </BlockShell>
  }
  return <div ref={viewport} className="component-flow-viewport" data-component-flow-surface={surface.id}
    onScroll={retainReading}><article className="component-flow-paper">{surface.childIds.map(renderInstance)}</article></div>
})
