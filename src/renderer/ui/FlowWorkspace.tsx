import { visibleComponentAuthorHit } from '../components/componentAuthorHit'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Hand, Maximize2, Minus, Plus } from 'lucide-react'
import { ImageSafeAreaGuides } from './workspaces/ImageSafeAreaGuides'
import { useComponentAuthorInteraction } from './workspaces/useComponentAuthorInteraction'
import type { ComponentEdit, ComponentFrame, CourseProjectV10, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform'
import { owningContainer, componentDefinitionBuiltinKey, componentContainerForInstance, isComponentVisibleAtSurface, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import { createFlowInlineStyleDefaults } from './flow/flowInlineStyleDefaults'
import { createFlowObjectVersions } from './flow/flowObjectVersions'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { renderDocumentText } from '../../shared/document/render'
import type { FlowTextContent } from '../../shared/document/content'
import { imageDataSchema, type ImageData } from '../../components/image/data'
import { useAssetObjectUrls } from './useAssetObjectUrls'
import { FlowMediaCropEditor } from './flow/FlowMediaCropEditor'
import { FlowMediaCaptionEditor } from './flow/FlowMediaCaptionEditor'
import { FlowBlockQuickActions, FlowBlockQuickMenu, flowBlockCommands, type FlowMediaKind } from './flow/FlowBlockQuickActions'
import type { FlowMediaToolPort } from './flow/flowMediaCommands'
import { patchCourseFlowMediaLayout, replaceCourseMediaAtTarget } from '../media/commitCourseMediaAuthoring'
import { settleCourseComponentInput, type CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { DocumentContextSelection, DocumentSelection } from '../../shared/document/ports'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentOperation } from '../document/editorSession'
import type { FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame } from '../../shared/flowParagraphAnchors'
import { createFlowViewportGeometry } from '../../shared/flowViewportGeometry'
import { isViewportComponent, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, createTeacherControllerHudGeometry, teacherControllerReferenceSize, type TeacherControllerHudGeometry } from '../../shared/teacherControllerViewportGeometry'
import { createFlowReadingNavigation, observeFlowReading } from '../../shared/flowReading'
import { resolveFlowChapterEntry } from '../../shared/flowChapterEntry'
import { FLOW_BODY_CSS, flowPaperPadding, flowScrollPadding, flowPaperMaxWidth, resolveFlowBodyWidth } from '../../shared/flowBodyPresentation'
import { resolveComponentBackground, resolveComponentSurfaceBackground } from '../../shared/contracts/component-platform/project'
import { ComponentBackgroundPaint } from '../components/ComponentBackgroundPaint'
import { resolveComponentOuterPresentation, applyComponentPresentationStyle } from '../../shared/componentPresentation'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document'
import { prepareDocumentSelection, prepareDocumentTextEdit, requestDocumentSelection, type DocumentSelectionAdapter } from '../document/documentSelectionCommands'
import { createFlowBlockPaint } from './flow/flowBlockPaint'
import { observeFlowParagraphLayout, measureFlowParagraphLayout, flowDocumentInsertionAt, flowFloatingModeEdits, flowContentClientMatrix, type FlowFloatingMode } from './flow/flowParagraphLayout'
import { flowPlacementEdits, flowReadingOrderEdits } from '../../core/course/courseFlowEdits'
import { prepareCourseFlowColumns } from '../../core/course/courseFlowLayoutEdits'
import { projectFlowDocument,flowDocumentBlock } from '../componentPlatform/surfaces/flow/documentProjection'
import { flowSurface } from '../componentPlatform/surfaces/flow/model'
import { useCourseV10Runtime } from '../components/CourseV10RuntimeView'
import { componentPaintStyle,applyComponentPaintStyle } from '../../player/components/componentPlacementStyle'
import { PlaybackViewSession } from '../../player/playbackViewSession'
import { EDITOR_PAGE_INSETS, formatPageInsets } from '../../shared/pageFrame'
import { NativeSelectionContext } from '../workbench/NativeSelectionContext'
import { proEditorRailController } from './proEditorRailController'
import { SlideLayerSelectionOverlay } from './workspaces/SlideLayerSelectionOverlay'
import { FreeTransformGesture, freeSurfaceTargets, type FreeResizeHandle } from '../componentPlatform/surfaces/slide'
import type { WorkspaceMediaDropHandler } from '../lessonWorkspace/workspaceMediaDrop'
import type { ImportedImageAsset } from '../project/assetManager'
import { selectActiveSlideContentEdit, useEditorStore } from '../store/editorStore'
import { captureCourseInstanceSelection, captureFlowSelection, workbenchSelection } from '../workbench/SelectionContextController'
import { ElementAiButton } from '../workbench/elementCards/ElementAiCard'
import { TextAiButton } from '../workbench/elementCards/ElementTextCards'
import { frameContainsPoint, invertMatrix, multiplyMatrices, transformPoint } from '../../core/components/geometry'
import { MIXED_GLOBAL_GEOMETRY, mixedGlobalGeometryEdits, type MixedGlobalGeometryRequest } from './workspaces/mixedGlobalGeometry'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../lessonWorkspace/workspaceMediaDrag'
import { useWorkspaceMediaSource } from '../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop } from '../lessonWorkspace/workspaceMediaDrop'
import type { DocumentContent } from '../../shared/document/content'
import type { DocumentResources } from '../../shared/document/resources'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../document/documentClipboardContext'
import { createFlowDocumentResourcePort, captureFlowPreparedDocumentResources,prepareFlowDocumentResourceTransaction, projectFlowPreparedResources, releaseFlowPreparedResources, retainedFlowPreparedResources, type FlowPreparedDocumentResources } from '../document/flowDocumentResources'
import { assertFlowStructureEditsAllowed, flowStructureDisabledReason } from '../authoring/flowStructureEdits'
import { registerFlowMenuCapture, registerFlowWorkspaceFlush, registerFlowWorkspaceDrain, registerFlowCaretFormat, registerFlowBlockFocus,
  registerFlowBlockSelection, captureFlowBlockFrame, type FlowBlockFocusRequest, type FlowMenuPageCapture } from '../document/flowWorkspaceRegistry'
import { flowFrameFromClientElement } from './flow/flowOverlayPlacement'
import { allDocumentTextSlots, inlineComponentIds, documentInlineChildIds } from '../../shared/document/textInteraction'
import { FlowTextInteractionActions } from './flow/FlowTextInteractionActions'
import './flow/flowWorkspaceLayout.css'
import { mountComponentFlowToc } from '../../player/componentPlatform/flowToc'
import { settleRetainedContentInput, type RetainedContentInput } from '../authoring/acceptedContentInput'

export interface FlowWorkspaceProps {
  documentId: string
  project: CourseProjectV10
  surfaceId: string
  toolbarContainer?: HTMLElement | null
  readOnly?: boolean
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
  onSelectMediaAsset?(kind: FlowMediaKind): Promise<ImportedImageAsset | null>
  onStatus?(message: string): void
}
/** Original paper/editor/chrome, projected directly from V10. The shared editor keeps text focus and IME. */
export function FlowWorkspace({ documentId, project, surfaceId, toolbarContainer, readOnly = false, onDropWorkspaceMedia, onSelectImageAsset, onSelectMediaAsset, onStatus }: FlowWorkspaceProps) {
  const runtime = useCourseV10Runtime()
  const bridge = useEditorStore(state => state.courseBridge)
  const interactionSelection = useEditorStore(state => state.courseView.activeDocumentId === documentId ? state.courseView.interactionSelection : null)
  const kernel = useEditorStore(state => state.courseKernel)
  const editingScope = useEditorStore(state => state.editingScope)
  const globalEditing = !readOnly && editingScope === 'global'
  const mimeTypes = useMemo(() => Object.fromEntries(Object.values(project.assets).map(asset => [asset.id, asset.mimeType ?? 'application/octet-stream'])), [project.assets])
  const assetUrls = useAssetObjectUrls(runtime.resources.assets, mimeTypes)
  const draft = useEditorStore(state => state.flowDocumentDrafts?.[documentId])
  const setDraft = useEditorStore(state => state.setFlowDocumentDraft)
  const setFlowContextSelection = useEditorStore(state => state.setFlowContextSelection)
  const editingInstance = useEditorStore(state => state.flowEditingInstance)
  const contentDraft = useEditorStore(state => {
    const edit = selectActiveSlideContentEdit(state)
    return edit?.target.documentId === documentId && edit.target.surfaceId === surfaceId ? edit : null
  })
  const beginContentEdit = useEditorStore(state => state.beginSlideDataEdit)
  const commitContentEdit = useEditorStore(state => state.commitSlideContentEdit)
  const surface = flowSurface(project, surfaceId)
  const layout = surface.flow?.layout ?? { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 }
  const editor = useRef<SharedDocumentEditorHandle>(null), paper = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null)
  const paperPointer = useRef<{ x: number; y: number } | null>(null)
  const workspace=useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!workspace.current || globalEditing || surface.flow?.layout.toc === 'hidden') return
    const navigation = runtime.navigation.editorPort()
    const toc = mountComponentFlowToc(workspace.current, surfaceId, project.rootIds.includes(surfaceId) ? navigation : navigation.forContainer?.(surfaceId) ?? navigation, {
      beforeNavigate: () => commitContentEdit(), onError: onStatus,
    })
    return () => toc.destroy()
  }, [surfaceId, surface.flow?.layout.toc, runtime.navigation, commitContentEdit, onStatus, globalEditing])
  const observationMount=useRef<HTMLDivElement>(null),observationRoot=useRef<HTMLDivElement>(null),observationContent=useRef<HTMLDivElement>(null)
  const viewSession=useRef<PlaybackViewSession|null>(null),[observationHost,setObservationHost]=useState<HTMLElement|null>(null)
  const readBaseScale = () => viewSession.current?.fitScale(surfaceId) ?? 1
  const readContentScale = () => readBaseScale() * (viewSession.current?.state.zoom ?? 1)
  const [viewport,setViewport]=useState({width:0,height:0})
  const [viewZoom, setViewZoom] = useState(1)
  const [paperMinimumHeight, setPaperMinimumHeight] = useState(0)
  const [layoutBody, setLayoutBody] = useState<HTMLElement | null>(null)
  const [controllerPreview, setControllerPreview] = useState<Record<string, ComponentFrame>>({})
  const controllerGesture = useRef<{ pointerId: number; start: { x: number; y: number }; moved: boolean; captured: CapturedCourseTarget;
    original: CourseProjectV10; display: CourseProjectV10; viewport: TeacherControllerHudGeometry; offset: { x: number; y: number }; value: FreeTransformGesture; edits: ComponentEdit[] } | null>(null)
  const [, refreshNavigation] = useState(0)
  useEffect(() => runtime.navigation.subscribe?.(() => refreshNavigation(value => value + 1)), [runtime.navigation])
  useEffect(() => runtime.navigation.subscribePlacement?.(() => refreshNavigation(value => value + 1)), [runtime.navigation])
  const [formatHost, setFormatHost] = useState<HTMLDivElement | null>(null)
  const [formatHeight, setFormatHeight] = useState(0)
  useLayoutEffect(() => {
    if (toolbarContainer || !formatHost) { setFormatHeight(0); return }
    const measure = () => setFormatHeight(Math.ceil(formatHost.getBoundingClientRect().height) + 8)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(formatHost)
    return () => observer.disconnect()
  }, [toolbarContainer, formatHost])
  const [error, setError] = useState<string | null>(null)
  const authorInteraction = useComponentAuthorInteraction({ root: workspace, documentId, surfaceId,
    enabled: !readOnly, contextKey: globalEditing ? 'global' : 'body', selectImage: onSelectImageAsset, report: setError })
  const selectedAuthorSpot = runtime.selectedInstanceIds.length === 1
    && authorInteraction.selectedSpot?.instanceId === runtime.selectedInstanceIds[0] ? authorInteraction.selectedSpot : undefined
  const [selection, setSelection] = useState<DocumentSelection | null>(null)
  const [crop, setCrop] = useState<{ target: CapturedCourseTarget; instance: ComponentInstance; data: ImageData } | null>(null)
  const [caption, setCaption] = useState<{ content: FlowTextContent; confirm(value: FlowTextContent): Promise<void>; cancel(): void } | null>(null)
  const [paperLayout, setPaperLayout] = useState<{ width: number; rects: readonly FlowParagraphBlockRect[] }>({ width: 0, rects: [] })
  const containerRoots = useRef(new Map<string, { root: ReturnType<typeof createRoot>; project: CourseProjectV10; render: typeof runtime.renderContainer; place(project: CourseProjectV10): void }>())
  const mediaSource = useWorkspaceMediaSource()
  const latest = useRef({ project, surfaceId, documentId, selection, runtime, mediaSource, globalEditing })
  latest.current = { project, surfaceId, documentId, selection, runtime, mediaSource, globalEditing }
  useLayoutEffect(() => {
    for (const [id, entry] of containerRoots.current) if (project.instances[id]?.container && (entry.project !== project || entry.render !== runtime.renderContainer)) {
      entry.project = project; entry.render = runtime.renderContainer; entry.place(project)
      entry.root.render(<>{entry.render(id, project, 'flow')}</>)
    }
  }, [project, runtime.renderContainer])
  const document = useMemo(() => projectFlowDocument(project, surfaceId), [project, surfaceId])
  const readObjectVersions = useMemo(() => createFlowObjectVersions(), [documentId, surfaceId])
  const objectVersions = useMemo(() => readObjectVersions(project, document.content.blocks, layout, paperLayout.width, surfaceId),
    [readObjectVersions, project, document, layout, paperLayout.width, surfaceId])
  const readInlineDefaults = useMemo(() => createFlowInlineStyleDefaults(), [documentId, surfaceId])
  const inlineDefaults = useMemo(() => readInlineDefaults(project, document.content.blocks), [readInlineDefaults, project, document])
  const renderReadingGroup = (instanceId: string, wrapper: HTMLElement, contentDOM: HTMLElement) => {
    const instance = project.instances[instanceId]
    if (!instance) return
    const presentation = resolveComponentOuterPresentation(project, instance, {
      placement: 'flow', purpose: 'author', inlineSize: paperLayout.width, flowLayout: layout,
    })
    wrapper.dataset.componentInstance = instanceId
    wrapper.dataset.componentFlowId = instanceId
    wrapper.dataset.componentPlacement = 'flow'
    applyComponentPaintStyle(wrapper, instance, project.definitions[instance.definitionId])
    applyComponentPresentationStyle(wrapper, { ...presentation.outerStyle, ...(instance.visible === false ? { display: 'none' } : {}) })
    // The PM contentDOM is the direct native layout holder. PM owns every child.
    applyComponentPresentationStyle(contentDOM, { ...presentation.childrenStyle, pointerEvents: 'auto' })
    runtime.onTargetElement(instanceId, wrapper)
  }
  useLayoutEffect(()=>{
    const mount=observationMount.current;if(!mount)return
    const session=new PlaybackViewSession();viewSession.current=session
    setObservationHost(session.mount(mount))
    return()=>{viewSession.current=null;session.destroy()}
  },[documentId,surfaceId])
  useLayoutEffect(()=>{
    const session=viewSession.current,root=observationRoot.current,content=observationContent.current
    if(!observationHost || !session || !root || !content)return
    session.register({id:surfaceId,kind:'flow',root,content,onObservationChange:()=>root.style.setProperty('--flow-observation-transform',content.style.transform),fitViewport:()=>{
      const shell=workspace.current?.closest<HTMLElement>('.workspace')
      return shell && shell.clientWidth > 0 && shell.clientHeight > 0
        ? {width:shell.clientWidth,height:shell.clientHeight}:session.state.viewport
    }});session.activate(surfaceId)
    root.style.setProperty('--flow-observation-transform',content.style.transform)
    const view = runtime.containerViewState?.(surfaceId), element = scroll.current
    if (view) {
      if (view.zoom !== undefined) session.zoomTo(view.zoom)
      if (view.pan) session.panTo(view.pan)
      if (element) { element.scrollTop = view.scrollTop ?? 0; element.scrollLeft = view.scrollLeft ?? 0 }
    }
    const readingBody = () => paper.current?.querySelector<HTMLElement>('.ProseMirror')
    const readingTarget = (id: string) => paper.current?.querySelector<HTMLElement>(`[data-flow-block-id="${CSS.escape(id)}"],[data-component-instance="${CSS.escape(id)}"]`)
    const reading = createFlowReadingNavigation(() => {
      const body = readingBody(), host = scroll.current
      return body && host ? { scroll: host, body } : null
    }, (id, kind) => readingTarget(kind === 'chapter' ? resolveFlowChapterEntry(latest.current.project, surfaceId, id) : id))
    const release=runtime.registerObservation(surfaceId,{readZoom:()=>session.state.zoom,setZoom:zoom=>session.zoomTo(zoom),reset:()=>{
      reading.goToInstance(null)
      session.reset()
    },...reading})
    const unsubscribe=session.subscribe(()=>{
      setViewZoom(session.state.zoom)
      runtime.navigation.changed()
      const element=paper.current;if(!element)return
      const scale = session.fitScale(surfaceId) * session.state.zoom
      const next={width:element.getBoundingClientRect().width/scale,rects:measureFlowParagraphLayout(element,scale)}
      setPaperLayout(previous=>JSON.stringify(previous)===JSON.stringify(next) ? previous:next)
    })
    runtime.navigation.changed()
    return()=>{
      if (view) {
        const observation = session.state
        view.zoom = observation.zoom; view.pan = observation.pan
        if (element) { view.scrollTop = element.scrollTop; view.scrollLeft = element.scrollLeft }
      }
      unsubscribe();release();reading.dispose()
    }
  },[observationHost,surfaceId,runtime.registerObservation,runtime.navigation,runtime.containerViewState])
  useEffect(() => {
    const host = scroll.current
    if (host && layoutBody) return observeFlowReading(host, layoutBody, runtime.navigation.changed)
  }, [observationHost, layoutBody, runtime.navigation])
  useLayoutEffect(()=>{viewSession.current?.refreshBounds()},[project.revision,paperLayout,viewport,observationHost])
  useLayoutEffect(() => { setPaperMinimumHeight(0) }, [documentId, surfaceId])
  useLayoutEffect(() => {
    if (!readOnly && scroll.current) setPaperMinimumHeight(height => Math.max(height, scroll.current!.clientHeight * 2))
  }, [documentId, surfaceId, readOnly, viewport, viewZoom, observationHost])
  useLayoutEffect(()=>{
    const element=workspace.current;if(!element)return
    const measure=()=>setViewport(previous=>{const next={width:element.clientWidth,height:Math.max(0,element.clientHeight-formatHeight)};return previous.width===next.width && previous.height===next.height ? previous:next})
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()
  },[formatHeight])
  useEffect(() => {
    if (editingInstance?.documentId === documentId && flowDocumentBlock(project,surfaceId,editingInstance.instanceId)) editor.current?.focusBlock(editingInstance.instanceId)
  }, [editingInstance, documentId, surfaceId])
  const preparedResources = useRef<readonly FlowPreparedDocumentResources[]>(draft?.surfaceId === surfaceId ? draft.preparedResources ?? [] : [])
  if (draft?.surfaceId === surfaceId && draft.preparedResources?.length) preparedResources.current = [...new Set([...preparedResources.current,...draft.preparedResources])]
  const composition = useRef<{ target: CapturedCourseTarget; next: MarkdownDocument | null; operation?: DocumentOperation; pending: ((accepted: boolean) => void)[] } | null>(null)
  const submissionSequence = useRef(0), appliedPreparations = useRef(new WeakSet<object>())
  type FlowInputValue = { document: MarkdownDocument; rangeProjection: DocumentOperation['rangeProjection']; prepared: readonly unknown[] }
  const failedInput = useRef<(RetainedContentInput<FlowInputValue> & { prepared: readonly FlowPreparedDocumentResources[] }) | undefined>(undefined)
  const releaseAccepted = (batches: readonly FlowPreparedDocumentResources[]) => {
    batches.forEach(batch => appliedPreparations.current.add(batch))
    releaseFlowPreparedResources(batches)
    preparedResources.current = preparedResources.current.filter(batch => !batches.includes(batch))
  }
  const settleBeforeExit = async () => {
    const previous = failedInput.current
    if (!previous) return true
    const outcome = await settleCourseComponentInput(previous.error)
    if (outcome === 'pending') return false
    if (outcome === 'applied') releaseAccepted(previous.prepared)
    if (failedInput.current === previous) failedInput.current = undefined
    return true
  }
  const preserveRejectedDraft=(target:CapturedCourseTarget,source:string,failure:unknown)=>{
    const message=failure instanceof Error ? failure.message:String(failure)
    setError(message)
    setDraft({surfaceId:target.surfaceId!,revision:target.project.revision,source,composing:false,preparedResources:retainedFlowPreparedResources(target,preparedResources.current),diagnostics:[{message,offset:0,endOffset:0,line:1,column:1}]},target.documentId)
  }
  const submitCaptured = async (next: MarkdownDocument, operation: DocumentOperation, target: CapturedCourseTarget): Promise<boolean> => {
    const sequence = ++submissionSequence.current
    const submittedSource = serializeDocumentMarkdown(next, 'flow')
    const value: FlowInputValue = { document: next, rangeProjection: operation.rangeProjection,
      prepared: operation.preparedResourceBatches ?? (operation.preparedResources === undefined ? [] : [operation.preparedResources]) }
    const current = () => {
      if (sequence !== submissionSequence.current || composition.current) return false
      const raw = useEditorStore.getState().flowDocumentDrafts?.[target.documentId]
      return !raw || raw.surfaceId !== target.surfaceId || raw.source === submittedSource
    }
    const complete = () => { if (current()) { setError(null); setDraft(null, target.documentId, target.surfaceId) } }
    const previous = failedInput.current
    if (previous) {
      try {
        const resolution = await settleRetainedContentInput(previous, value, bridge)
        if (resolution.outcome === 'pending') {
          if (current()) preserveRejectedDraft(target, serializeDocumentMarkdown(next, 'flow'), previous.error)
          return false
        }
        if (failedInput.current === previous) failedInput.current = undefined
        if (resolution.outcome === 'applied') {
          releaseAccepted(previous.prepared)
          target = resolution.target
          if (resolution.sameValue) { complete(); return true }
        } else target = previous.target
      } catch (failure) {
        if (current()) preserveRejectedDraft(target, serializeDocumentMarkdown(next, 'flow'), failure)
        return false
      }
    }
    let command: RetainedContentInput['command'] | undefined, prepared: readonly FlowPreparedDocumentResources[] = []
    try {
      if (target.surfaceId !== surfaceId) throw new Error('正文页面已切换，请重新编辑')
      const resources = [...new Set([...retainedFlowPreparedResources(target,preparedResources.current),
        ...value.prepared.filter(batch => !batch || typeof batch !== 'object' || !appliedPreparations.current.has(batch))])]
      const planned = prepareFlowDocumentResourceTransaction(target, surfaceId, next.content.blocks, resources, operation.rangeProjection, operation.changedBlockIds)
      assertFlowStructureEditsAllowed(target.editingProject, planned.edits, true)
      target = planned.target; prepared = planned.prepared
      command = bridge.capture(planned.edits, target, planned.readPaths)
      if (planned.edits.length) await bridge.editCaptured(command, operation.historyGroup)
      releaseAccepted(prepared)
      complete(); return true
    } catch (failure) {
      if (current()) preserveRejectedDraft(target, serializeDocumentMarkdown(next, 'flow'), failure)
      const retained = { error: failure, target, command: command ?? bridge.capture([], target), value, prepared }
      try {
        const resolution = await settleRetainedContentInput(retained, value, bridge)
        if (resolution.outcome === 'applied') { releaseAccepted(prepared); complete(); return true }
        if (resolution.outcome === 'pending' || !failedInput.current) failedInput.current = retained
      } catch {
        failedInput.current = retained
      }
      return false
    }
  }
  const submit = (next: MarkdownDocument, operation: DocumentOperation): Promise<boolean> => {
    const pending = composition.current
    if (pending) {
      pending.next = next; pending.operation = operation
      return new Promise(resolve => pending.pending.push(resolve))
    }
    try { return submitCaptured(next, operation, bridge.captureOwnedTarget(documentId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return Promise.resolve(false) }
  }
  const flush = useCallback(() => {
    if (composition.current) return { ok: false, reason: '请完成当前中文输入后保存。' }
    const result = editor.current?.flush()
    if (result && !result.ready) return { ok: false, reason: result.diagnostics[0]?.message ?? '正文草稿尚未完成' }
    return { ok: true }
  }, [])
  const drain = useCallback(async () => {
    if (composition.current) return { ok: false, reason: '请完成当前中文输入后保存。' }
    const result = await editor.current?.drain()
    if (!result || result.ready) return { ok: true }
    const raw = useEditorStore.getState().flowDocumentDrafts?.[documentId]
    const preservable = editor.current?.canPreserveDraft() === true && raw?.surfaceId === surfaceId && raw.source === result.source
      && !raw.composing && !preparedResources.current.length
    return { ok: false, reason: result.diagnostics[0]?.message ?? '正文草稿尚未完成', preservable, surfaceId }
  }, [documentId, surfaceId])
  useEffect(() => registerFlowWorkspaceFlush(documentId, flush), [documentId, flush])
  useEffect(() => registerFlowWorkspaceDrain(documentId, drain), [documentId, drain])
  useEffect(() => registerFlowCaretFormat(documentId, style => editor.current?.applyInlineStyle(style) ?? false), [documentId])
  const paragraphObservation = useRef<{ stop: ReturnType<typeof observeFlowParagraphLayout>; paint: ReturnType<typeof createFlowBlockPaint> } | null>(null)
  useLayoutEffect(() => {
    const element = paper.current
    if (!element || !layoutBody) return
    const paint = createFlowBlockPaint(element, surfaceId, () => latest.current.project,
      (id, target) => latest.current.runtime.onTargetElement(id, target), update => editor.current?.paintProjection(update))
    const stop = observeFlowParagraphLayout(element, (rects, change) => {
      paint.retire(change.retired)
      const painted = new Set(paint.paint(change.paint))
      for (const target of change.moved) {
        const instance = latest.current.project.instances[target.dataset.flowBlockId!]
        if (instance && !instance.container && !painted.has(target))
          latest.current.runtime.onTargetElement(instance.id, target)
      }
      const nextLayout = { width: element.getBoundingClientRect().width / readContentScale(), rects }
      setPaperLayout(previous => previous.width === nextLayout.width && previous.rects === rects ? previous : nextLayout)
    }, readContentScale)
    paragraphObservation.current = { stop, paint }
    return () => { stop(); paint.destroy(); paragraphObservation.current = null }
  }, [documentId, surfaceId, layoutBody, observationHost])
  useLayoutEffect(() => {
    const observation = paragraphObservation.current
    const changed = observation?.paint.refresh()
    if (changed?.length) observation!.stop.invalidate(changed)
  }, [project])
  useEffect(() => {
    const capture = (captureInsertion = false): FlowMenuPageCapture => {
      const value = latest.current, scale=readContentScale(), width = (paper.current?.getBoundingClientRect().width ?? 0)/scale
      if (width <= 0) return { ok: false, reason: '正文尚未完成布局' }
      const paragraphRects = paper.current ? measureFlowParagraphLayout(paper.current,scale) : []
      const paperBox = paper.current?.getBoundingClientRect(), pointer = paperPointer.current
      const y = pointer && paperBox ? (pointer.y - paperBox.top) / scale : (scroll.current?.scrollTop ?? 0) + 28
      const selectedBlockId = value.runtime.selectedInstanceIds.find(id => flowDocumentBlock(value.project, value.surfaceId, id))
        ?? (value.selection?.kind === 'text' ? value.selection.head.blockId : null)
        ?? flowParagraphAnchorAt({ x: 36, y, width: 1, height: 1 }, width, paragraphRects)?.blockId ?? null
      let insertionSelection
      try { if (captureInsertion) insertionSelection = editor.current?.captureInsertionSelection() }
      catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
      return { ok: true, documentId, epoch: bridge.read().documents.find(item => item.documentId === documentId)?.epoch,
        insertionSelection, projectId: value.project.id, revision: value.project.revision, locationId: surfaceId, surfaceId,
        generation: bridge.read().activation, selectedBlockId, selectionSignature: JSON.stringify(value.selection), paperWidth: width,
        bodyWidth: resolveFlowBodyWidth(layout, width), paragraphRects,
        readFrame: id => flowFrameFromClientElement(value.runtime.world.contentElement(id) ?? value.runtime.world.targetElement(id), paper.current) }
    }
    return registerFlowMenuCapture(capture)
  }, [documentId, surfaceId, bridge, flush])
  useEffect(() => {
    const focus = (request: FlowBlockFocusRequest) => {
      const value = latest.current
      if (value.globalEditing || request.documentId !== documentId || request.surfaceId !== surfaceId || request.revision !== value.project.revision) return false
      const accepted = editor.current?.focusBlock(request.blockId) ?? false
      if (accepted) value.runtime.selectInstances([request.blockId], surfaceId)
      return accepted
    }
    const releaseFocus = registerFlowBlockFocus(focus)
    const releaseSelection = registerFlowBlockSelection(documentId, surfaceId, blockId => {
      if (latest.current.globalEditing || !latest.current.project.instances[blockId]) return false
      latest.current.runtime.selectInstances([blockId], surfaceId)
      editor.current?.selectBlock(blockId)
      paper.current?.querySelector<HTMLElement>(`[data-flow-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'nearest' })
      return true
    })
    return () => { releaseFocus(); releaseSelection() }
  }, [documentId, surfaceId, project.revision])
  const edit = async (edits: ComponentEdit[], target = bridge.captureTarget(documentId)) => {
    const ready = await drain()
    if (!ready.ok) { setError(ready.reason ?? '请先完成当前正文输入'); return }
    try { assertFlowStructureEditsAllowed(target.editingProject, edits); await bridge.editCaptured(bridge.capture(edits,target)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const selectDocument = (value: DocumentSelection | null) => {
    if (latest.current.globalEditing) return
    setSelection(value)
    setFlowContextSelection(value)
    bridge.selectInteraction(documentId, value ? { kind: 'document', selection: value } : null, surfaceId)
  }
  const captureContextual = (): DocumentSelectionAdapter => {
    const current = bridge.read()
    const captured = { epoch: current.snapshot?.epoch, projectId: current.project?.id, activeStateId: current.activeStateId }
    return (snapshot, target) => {
    if (target.mode !== 'layout' || !target.selection) throw new Error('请回到正文选择内容后修改')
    if (snapshot.model.kind !== 'course-v10' || snapshot.epoch !== captured.epoch || snapshot.model.project.id !== captured.projectId
      || target.revision !== String(snapshot.revision)) throw new Error('正文选区已改变，请重新选择')
    if (target.selection.kind === 'text' || target.selection.kind === 'cells') return captureFlowSelection(snapshot, surfaceId, target, captured.activeStateId)
    const ids = [target.selection.blockId]
    return captureCourseInstanceSelection(snapshot, surfaceId, ids, target.label, captured.activeStateId)
    }
  }
  const contextual = async (target: DocumentContextSelection) => (await prepareDocumentSelection(documentId, target, captureContextual())).selection
  const clipboardContext = (_resources: DocumentResources, content: DocumentContent) => {
    const captured = captureFlowPreparedDocumentResources(bridge.captureTarget(documentId),preparedResources.current)
    if (captured.surfaceId !== surfaceId) throw new Error('正文复制目标已切换')
    const roots: string[] = []
    const visit = (blocks: readonly import('../../shared/document/content').DocumentBlock[]) => {
      for (const block of blocks) {
        if (captured.project.instances[block.id]) roots.push(block.id)
        else if (block.type === 'section') visit(block.blocks)
        else if (block.type === 'course-instance' && block.blocks) visit(block.blocks)
      }
    }
    visit(content.blocks)
    return createCourseDocumentClipboardContext({ documentId: captured.documentId, project: captured.project, resources: captured.resources, roots })
  }
  const clipboardResourcePort = (context: unknown) => {
    const captured = bridge.captureTarget(documentId)
    if (captured.surfaceId !== surfaceId) throw new Error('正文粘贴目标已切换')
    const source = readCourseDocumentClipboardContext(context)
    return createFlowDocumentResourcePort({ target: captured, source, pending: () => preparedResources.current,
      onPrepared: prepared => { preparedResources.current = [...preparedResources.current,prepared] },
      onDiscard: prepared => { preparedResources.current = preparedResources.current.filter(value=>value!==prepared) } })
  }
  const floating = globalEditing ? [] : surface.childIds.filter(id => project.instances[id]?.flowPlacement)
  const globals = project.rootIds.includes(surfaceId) || editingScope === 'global'
    ? [...project.global.underlay, ...project.global.overlay].filter(id=>isComponentVisibleAtSurface(project.instances[id],surfaceId)) : []
  const teacherChrome = (id:string) => {
    return isViewportComponent(project, id)
  }
  const hudGeometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project), viewportRect: { x: 0, y: 0, width: Math.max(1, viewport.width), height: Math.max(1, viewport.height) } })
  useEffect(() => {
    const request = (event: Event) => {
      const input = (event as CustomEvent<MixedGlobalGeometryRequest>).detail
      if (!input || input.edits || input.documentId !== documentId || input.surfaceId !== surfaceId || !observationRoot.current?.isConnected || !observationContent.current) return
      const hudMatrix = flowContentClientMatrix(observationRoot.current), contentMatrix = flowContentClientMatrix(observationContent.current)
      if (!hudMatrix || !contentMatrix) return
      input.edits = mixedGlobalGeometryEdits(input.project, input.instanceIds, input.intent,
        multiplyMatrices(invertMatrix(hudMatrix), contentMatrix), hudGeometry, runtime.navigation)
    }
    window.addEventListener(MIXED_GLOBAL_GEOMETRY, request)
    return () => window.removeEventListener(MIXED_GLOBAL_GEOMETRY, request)
  }, [documentId, surfaceId, viewport.width, viewport.height, runtime.navigation, project])
  const controllerBaseProjection = projectTeacherControllerInstances(project, hudGeometry, runtime.navigation)
  const controllerProjection = Object.keys(controllerPreview).length ? { ...controllerBaseProjection,
    instances: Object.fromEntries(Object.entries(controllerBaseProjection.instances).map(([id, instance]) =>
      [id, controllerPreview[id] ? { ...instance, frame: controllerPreview[id] } : instance])) } : controllerBaseProjection
  const selectedControllerTargets = freeSurfaceTargets(controllerProjection, surfaceId).filter(target => runtime.selectedInstanceIds.includes(target.instanceId)
    && teacherChrome(target.instanceId) && !flowStructureDisabledReason(project, target.instanceId))
  const controllerPointerMatrix = (): [number, number, number, number, number, number] => {
    const box = workspace.current?.getBoundingClientRect()
    return [1, 0, 0, 1, box?.left ?? 0, (box?.top ?? 0) + formatHeight]
  }
  const beginControllerResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') : null
    if (readOnly || event.button !== 0 || !handle || !selectedControllerTargets.length) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    controllerGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false,
      captured: bridge.captureTarget(documentId), original: project, display: controllerBaseProjection, viewport: hudGeometry,
      offset: runtime.navigation.placement?.() ?? { x: 0, y: 0 }, edits: [], value: new FreeTransformGesture({
        mode: handle === 'move' ? 'drag' : handle === 'rotate' ? 'rotate' : 'resize', handle: handle === 'rotate' || handle === 'move' ? undefined : handle as FreeResizeHandle,
        targets: selectedControllerTargets, pointer: { x: event.clientX, y: event.clientY }, surfaceToPointer: controllerPointerMatrix() }) }
  }
  const beginControllerDrag = (event: React.PointerEvent<HTMLDivElement>, instanceId: string) => {
    const targets = freeSurfaceTargets(controllerBaseProjection, surfaceId).filter(target => target.instanceId === instanceId)
    if (readOnly || event.button !== 0 || flowStructureDisabledReason(project, instanceId) || !targets.length) return
    event.preventDefault(); event.stopPropagation()
    controllerGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false,
      captured: bridge.captureTarget(documentId), original: project, display: controllerBaseProjection, viewport: hudGeometry,
      offset: runtime.navigation.placement?.() ?? { x: 0, y: 0 }, edits: [], value: new FreeTransformGesture({
        mode: 'drag', targets, pointer: { x: event.clientX, y: event.clientY }, surfaceToPointer: controllerPointerMatrix() }) }
  }
  const moveControllerResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = controllerGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (!gesture.moved && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 3) return
    gesture.moved = true
    gesture.edits = gesture.value.update({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey }).edits
    setControllerPreview(Object.fromEntries(gesture.edits.flatMap(value => value.type === 'frame.set' && value.frame ? [[value.instanceId, value.frame]] : [])))
  }
  const finishControllerResize = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const gesture = controllerGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (!cancel) moveControllerResize(event)
    controllerGesture.current = null; setControllerPreview({})
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel && gesture.moved && gesture.edits.length) void edit(restoreTeacherControllerFrameEdits(gesture.edits, gesture.original,
      gesture.display, gesture.viewport, gesture.offset, runtime.navigation), gesture.captured)
  }
  const mediaKind = (instance: ComponentInstance,owner=project): FlowMediaKind | undefined => {
    const key = componentDefinitionBuiltinKey(owner.definitions[instance.definitionId])
    return key && ['guoling.image','guoling.video','guoling.audio'].includes(key) ? key.slice(8) as FlowMediaKind : undefined
  }
  const actions = (id: string) => {
    const target = { ...bridge.captureTarget(documentId), instanceId:id, instanceIds:[id] }
    const instance = target.editingProject.instances[id]
    if (!instance) return null
    const kind = mediaKind(instance,target.editingProject)
    const structureDisabledReason = flowStructureDisabledReason(target.editingProject, id)
    const commit = async (edits: ComponentEdit[]) => {
      assertFlowStructureEditsAllowed(target.editingProject, edits)
      await kernel.editCaptured(kernel.capture(edits, target))
    }
    const safe = (promise: Promise<unknown>) => { void promise.catch(failure => setError(String(failure))) }
    const replace = () => {
      const picker = onSelectMediaAsset && kind ? onSelectMediaAsset(kind) : kind === 'image' ? onSelectImageAsset() : Promise.reject(new Error('媒体选择入口尚未接入'))
      void picker.then(item => { if (item) safe(replaceCourseMediaAtTarget(kernel,target,item)) }).catch(failure => setError(String(failure)))
    }
    const commands = {
      moveSelectedBlock(direction: 'up'|'down') {
        const edits = flowReadingOrderEdits(target.editingProject, id, direction)
        if (edits.length) safe(commit(edits))
      },
      deleteSelectedBlocks() { safe(commit([{type:'instance.remove',instanceId:id}])) },
    }
    const tools: FlowMediaToolPort | undefined = kind ? {
      openCrop: () => setCrop({target,instance,data:imageDataSchema.parse(instance.data)}),
      patchMedia: patch => {
        const pending = Promise.resolve().then(() => {
          if ((patch.width !== undefined || patch.wrap !== undefined) && structureDisabledReason) throw new Error(structureDisabledReason)
          return patchCourseFlowMediaLayout(kernel,target,id,patch)
        })
        safe(pending);return pending
      },
      openCaption: (content,draft) => {
        const opened = {content:content ?? {inlines:[]},confirm: async (value: FlowTextContent) => {
          await draft.confirm(value)
          setCaption(current => current === opened ? null : current)
        },cancel: () => {draft.cancel();setCaption(current => current === opened ? null : current)}}
        setCaption(opened)
      },
      convertToOverlay: () => {
        const frame = captureFlowBlockFrame(target, id)
        return safe(commit(flowPlacementEdits(target.editingProject, id, { kind: 'overlay', surfaceId,
          ...(frame ? { frame } : {}), placement: { space: 'paper', plane: 'overlay' }, origin: 'quickbar' })))
      },
    } : undefined
    return { block:{instance,mediaKind:kind,structureDisabledReason},commands,replaceMedia:replace,mediaTools:tools,
      openProperties: () => {
        runtime.selectInstances([id], surfaceId)
        const state = useEditorStore.getState()
        state.setActiveTab('properties'); proEditorRailController.open('properties')
      } }
  }
  const background = resolveComponentSurfaceBackground(project,surface)
  const readPaperOffset = () => {
    const paperBox = paper.current?.getBoundingClientRect(), contentBox = observationContent.current?.getBoundingClientRect()
    const scale = readContentScale()
    return { x: paperBox && contentBox ? (paperBox.left - contentBox.left) / scale : 0,
      y: paperBox && contentBox ? (paperBox.top - contentBox.top) / scale : 0 }
  }
  const beginRegisteredSpot = authorInteraction.beginRegisteredSpot
  const drop = (event: React.DragEvent<HTMLElement>) => {
    if (!onDropWorkspaceMedia || !event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) return
    event.preventDefault(); event.stopPropagation()
    if (readOnly || !flush().ok || !paper.current) { setError('请先完成当前正文输入'); return }
    const position = flowDocumentInsertionAt(paper.current, project, surfaceId, { x: event.clientX, y: event.clientY })
    const captured = bridge.captureTarget(documentId)
    const target = { documentId:captured.documentId, projectId:captured.project.id, revision:captured.project.revision, locationId:surfaceId, surfaceId, sessionGeneration:bridge.read().activation, captured }
    void deliverWorkspaceMediaDrop(event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE), mediaSource, { surface: 'flow', ...position }, target, onDropWorkspaceMedia,
      () => latest.current.documentId === documentId && latest.current.mediaSource.directory === mediaSource.directory)
      .then(result => { if (!result.ok) setError(result.reason ?? '媒体未插入') })
  }
  return <div ref={workspace} className="flow-workspace" data-testid="flow-workspace" data-flow-project-id={project.id} data-flow-surface-id={surfaceId}
    data-flow-location-id={surfaceId} data-observation-source="authoring" data-observation-revision={project.revision}
    data-observation-project-id={project.id} data-observation-surface-id={surfaceId} data-observation-ready="true"
    style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', isolation: 'isolate' }}
    onContextMenuCapture={event => { authorInteraction.contextMenuFromElement(event) }}
    onPointerDownCapture={event => {
      if (authorInteraction.pointerFromElement(event)) return
      if (!contentDraft || contentDraft.target.documentId !== documentId || contentDraft.composing) return
      const target=event.target instanceof Element ? event.target : null
      if(target?.closest('[data-component-professional-editor],.text-edit-toolbar,.selection-quick-bar'))return
      void commitContentEdit().catch(failure=>setError(failure instanceof Error ? failure.message:String(failure)))
    }}
    onDoubleClickCapture={async event => {
      if(readOnly || !(event.target instanceof Element) || event.target.closest('[data-component-professional-editor]')
        || event.target.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true')return
      const id=event.target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
      const instance=id && project.instances[id]
      if(instance) {
        const content=runtime.world.contentElement?.(instance.id), matrix=content && flowContentClientMatrix(content)
        if(matrix) {
          const point=transformPoint(invertMatrix(matrix),{x:event.clientX,y:event.clientY})
          if(await beginRegisteredSpot(instance.id,point)) {
            event.preventDefault();event.stopPropagation()
            return
          }
        }
      }
      const block=instance && flowDocumentBlock(project,surfaceId,instance.id)
      if(!instance || block && block.type!=='course-instance')return
      const kind=componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
      if(kind!=='guoling.text' && kind!=='guoling.formula')return
      event.preventDefault();event.stopPropagation();runtime.selectInstances([instance.id],surfaceId)
      beginContentEdit(instance.id,'canvas')
    }}>
    {!readOnly && runtime.selectedInstanceIds.length > 0 && (Boolean(selectedAuthorSpot) || runtime.selectedInstanceIds.every(id => globals.includes(id) || floating.includes(id)))
      && <NativeSelectionContext documentId={documentId} revision={project.revision} surfaceId={surfaceId} itemIds={runtime.selectedInstanceIds} enabled textEditing={Boolean(contentDraft)} authorSpot={selectedAuthorSpot} authorBounds={authorInteraction.authorBounds} />}
    {!readOnly && selectedControllerTargets.length > 0 && <div data-flow-controller-selection="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 8 }}
      onPointerDown={beginControllerResize} onPointerMove={moveControllerResize} onPointerUp={event => finishControllerResize(event)}
      onPointerCancel={event => finishControllerResize(event, true)} onLostPointerCapture={event => finishControllerResize(event, true)}>
      <SlideLayerSelectionOverlay targets={selectedControllerTargets} scale={1} surfaceToPointer={controllerPointerMatrix()} movable />
    </div>}
    <div ref={setFormatHost} className="flow-document-format-host" style={{ left: 8, right: 8 }} />
    <div ref={observationMount} style={{position:'absolute',inset:`${formatHeight}px 0 0`}} data-page-insets={formatPageInsets(EDITOR_PAGE_INSETS)} data-page-backdrop="transparent" />
    {observationHost && createPortal(<div ref={observationRoot} data-flow-observation-root="true"
      data-canvas-width={surface.designSize?.width ?? 1280} data-canvas-height={surface.designSize?.height ?? 720}>
    <ComponentBackgroundPaint background={project.rootIds.includes(surfaceId) ? resolveComponentBackground(project) : undefined} resolveAsset={id => assetUrls[id]} />
    <div ref={observationContent} data-playback-content="true" style={{position:'absolute',inset:0,transformOrigin:'0 0',zIndex:2}}>
    {!globalEditing && <div data-surface-background={surface.id} style={{ position: 'absolute', inset: 0, zIndex: 2, isolation: 'isolate', pointerEvents: 'none' }}><ComponentBackgroundPaint background={background} resolveAsset={id => assetUrls[id]} /></div>}
    <div ref={scroll} className="flow-workspace__scroll flow-media-query-root" data-testid="flow-workspace-scroll" data-flow-paper-scroll="true"
      onScroll={event => {
        const element = event.currentTarget
        if (!readOnly && paper.current && element.scrollTop + element.clientHeight >= element.scrollHeight - element.clientHeight / 2)
          setPaperMinimumHeight(height => Math.max(height, paper.current!.offsetHeight) + element.clientHeight)
      }}
      style={{ display: globalEditing ? 'none' : undefined, position: 'relative', isolation: 'isolate', zIndex: 4, overflow: 'auto', height: '100%', padding: flowScrollPadding(layout) }}>
      <article ref={paper} className="flow-paper flow-body-content" data-testid="flow-paper" data-flow-reading-width={layout.readingWidth}
        onPointerDownCapture={event => { paperPointer.current = { x: event.clientX, y: event.clientY } }}
        onClick={event => { if (!readOnly && event.target === event.currentTarget) editor.current?.focusEndParagraph() }}
        onDragOver={event => { if (onDropWorkspaceMedia && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={drop} style={{ position: 'relative', isolation: 'isolate', width: '100%', maxWidth: flowPaperMaxWidth(layout), containerType: 'inline-size', minHeight: readOnly ? '100%' : paperMinimumHeight || '200%', margin: '0 auto', padding: flowPaperPadding(layout), color: '#1f2937' }}>
        <style>{FLOW_BODY_CSS}</style>
        <div style={{ position:'relative',zIndex:2 }}><SharedDocumentEditor key={`${documentId}/${surfaceId}`} ref={editor} cardDocumentId={documentId ?? undefined} document={document} revision={String(project.revision)} readOnly={readOnly || globalEditing || Boolean(contentDraft)} active={!globalEditing}
          objectRevision={objectVersions.revision} objectRevisionFor={objectVersions.forBlock} objectChangedIds={objectVersions.changedSince}
          onLayoutMount={setLayoutBody}
          beforeProjectionMutation={()=>runtime.world.beforeProjectionMutation()}
          afterProjectionMutation={()=>queueMicrotask(()=>runtime.world.afterProjectionMutation())}
          resolveImage={source => {const asset=Object.values(project.assets).find(asset=>asset.path===source);if(!asset)throw new Error(`素材引用不存在：${source}`);return {assetId:asset.id,source:{kind:'project'}}}}
          hiddenBlockIds={Object.values(project.instances).filter(instance => instance.visible === false).map(instance => instance.id)}
          inlineStyleDefaults={inlineDefaults}
          renderGroup={renderReadingGroup}
          isMultiColumnLayout={id => {
            const element = paper.current?.querySelector<HTMLElement>(`[data-flow-reading-group-content="${CSS.escape(id)}"]`)
            if (!element) return false
            const style = getComputedStyle(element)
            return style.display === 'grid' ? style.gridTemplateColumns.trim().split(/\s+/).length > 1
              : style.display === 'flex' && !style.flexDirection.startsWith('column')
          }}
          onColumns={async instanceIds => {
            const ready = await drain()
            if (!ready.ok) throw new Error(ready.reason ?? '请先完成当前正文输入')
            const target = bridge.captureTarget(documentId)
            const prepared = prepareCourseFlowColumns(target.editingProject, { surfaceId, instanceIds })
            assertFlowStructureEditsAllowed(target.editingProject, prepared.edits)
            await bridge.editCaptured(bridge.capture(prepared.edits, target))
            latest.current.runtime.selectInstances([prepared.groupId], surfaceId)
          }}
          contextualCardSuppressed={interactionSelection?.kind !== 'document'}
          target="flow" deferLayoutSource toolbarHost={toolbarContainer ?? formatHost} sourceDraft={draft?.surfaceId === surfaceId ? draft.source : undefined}
          sourceDiagnostics={draft?.surfaceId===surfaceId ? draft.diagnostics:undefined}
          clipboardContext={clipboardContext} clipboardResourcePort={clipboardResourcePort}
          onDiscardDraft={async () => {
            if (!await settleBeforeExit()) return false
            failedInput.current = undefined
            releaseFlowPreparedResources(preparedResources.current); preparedResources.current = []
            setDraft(null, documentId, surfaceId); setError(null); return true
          }}
          onPreserveDraft={async () => {
            if (!await settleBeforeExit()) return false
            if (composition.current || preparedResources.current.length) {
              setError('这份正文仍有正在输入的文字或尚未接入工程的素材，请先完成或撤销该次输入；原稿继续保留。')
              return false
            }
            if (!await useEditorStore.getState().courseInputs.prepare([documentId], 'preserve')) return false
            useEditorStore.getState().parkFlowDocumentDraft(documentId, surfaceId)
            failedInput.current = undefined; setError(null); return true
          }}
          onChange={submit} onUndo={async () => { const ready = await drain(); if (!ready.ok) throw new Error(ready.reason); await bridge.undo(documentId) }}
          onRedo={async () => { const ready = await drain(); if (!ready.ok) throw new Error(ready.reason); await bridge.redo(documentId) }}
          onDraft={(source, diagnostics) => {
            if (composition.current) return
            const owner = preparedResources.current.find(value=>value.target.documentId===documentId && value.target.surfaceId===surfaceId)?.target
            setDraft(diagnostics.length ? { surfaceId, revision: project.revision, source, diagnostics, composing:false,
              preparedResources:owner ? retainedFlowPreparedResources(owner,preparedResources.current) : [] } : null,documentId,surfaceId)
          }}
          onCompositionChange={(active, source) => {
            if (active) { ++submissionSequence.current; if (!composition.current) composition.current = { target: bridge.captureOwnedTarget(documentId), next: null, pending: [] }; setDraft({ surfaceId, revision: project.revision, source, diagnostics: [], composing: true },documentId) }
            else setTimeout(async () => {
              const pending = composition.current; composition.current = null
              if (!pending) return
              const accepted = pending.next && pending.operation ? await submitCaptured(pending.next, pending.operation, pending.target) : true
              if (accepted) setDraft(null,pending.target.documentId,pending.target.surfaceId)
              pending.pending.forEach(resolve => resolve(accepted))
            }, 0)
          }} onSelection={selectDocument}
          onContextualTargetChange={target => { if (target?.mode === 'layout') {
            // Passive selection observation must not drain or close a newly opened component draft.
            const capture = captureContextual()
            workbenchSelection.observeSnapshot(documentId, project.revision, bridge.read().snapshot, snapshot => capture(snapshot, target))
          } }}
          onContextualCommand={async (instruction, target) => { await requestDocumentSelection(documentId, target, instruction, captureContextual()) }}
          renderAiButton={(target, issue) => {
            if (target.selection?.kind === 'text' || target.selection?.kind === 'cells') return <TextAiButton documentId={documentId} selectionIdentity={JSON.stringify([project.revision,target.selection])}
              disabledReason={issue} start={() => prepareDocumentTextEdit(documentId, target, captureContextual())} />
            const id = target.selection?.kind === 'object' ? target.selection.blockId : null
            return id ? <ElementAiButton documentId={documentId} target={{ kind:'course-instance',surfaceId,instanceId:id }} label={target.label}
              disabledReason={issue} capture={() => contextual(target)} /> : undefined
          }}
          objectMenu={id => { const value=actions(id); return value ? flowBlockCommands(value.block,value.commands,value.replaceMedia,value.mediaTools) : [] }}
          renderTextActions={selection => <FlowTextInteractionActions project={project} surfaceId={surfaceId} selection={selection} drain={drain}
            commit={async (edits, revision) => { const target = bridge.captureTarget(documentId); if (target.project.revision !== revision) throw new Error('正文在操作期间已改变，请重新选择'); await bridge.editCaptured(bridge.capture(edits, target)) }} select={id => runtime.selectInstances([id], surfaceId)} report={message => setError(message)} />}
          renderInline={(id, host) => { runtime.onElement(id, host); runtime.onTargetElement(id, host); return () => { if (runtime.world.contentElement(id) === host) { runtime.onElement(id, null); runtime.onTargetElement(id, null) } } }}
          renderQuickBarActions={target => { const id=target.selection?.kind === 'object' ? target.selection.blockId : null, value=id && actions(id); return value ? <FlowBlockQuickActions {...value}/> : null }}
          renderQuickBarMenu={target => { const id=target.selection?.kind === 'object' ? target.selection.blockId : null, value=id && actions(id); return value ? <FlowBlockQuickMenu {...value}/> : null }}
          renderObject={(block, host) => {
            let objectProject = project.instances[block.id] ? project : projectFlowPreparedResources(bridge.captureOwnedTarget(documentId), preparedResources.current)
            let disposed=false
            const shell = host.closest<HTMLElement>('[data-flow-block-id]') ?? host
            shell.dataset.componentFlowId = block.id
            shell.dataset.componentInstance = block.id
            shell.dataset.componentPlacement = 'flow'
            let instance = objectProject.instances[block.id]
            if (!instance) throw new Error(`正文引用的正式实例已不存在：${block.id}`)
            const ownsBody = () => {
              const current = latest.current, active = current.project.instances[block.id]
              return current.documentId === documentId && current.surfaceId === surfaceId
                && !(active ?? instance).flowPlacement
                && (!active || componentContainerForInstance(current.project, block.id)?.id === surfaceId)
            }
            if (!ownsBody()) return
            if (!instance.container) runtime.onTargetElement(block.id, shell)
            const bodyLayout = instance.flowLayout
            // A deferred React unmount must own a disposable target, never the
            // host that the NodeView will reuse for the next render.
            const content=instance.container ? window.document.createElement('div') : null
            if(content){Object.assign(content.style,{width:'100%',height:'100%'});host.append(content)}
            const children=!instance.container && instance.childIds?.length ? window.document.createElement('div') : null
            const root=content ? createRoot(content) : children ? createRoot(children) : null
            const stage=window.document.createElement('div')
            shell.prepend(stage); stage.append(host); if(children) stage.append(children)
            let resize:ResizeObserver|undefined
            let presentation = resolveComponentOuterPresentation(objectProject, instance, { placement: 'flow', purpose: 'author', inlineSize: paperLayout.width, flowLayout: layout })
            const place=(nextProject?: CourseProjectV10)=>{
              if(nextProject){objectProject=nextProject;instance=nextProject.instances[block.id] ?? instance}
              const currentLayout=flowSurface(objectProject,surfaceId).flow?.layout ?? { widthMode:'reading' as const,readingWidth:860,wideContentWidth:1100 }
              presentation=resolveComponentOuterPresentation(objectProject,instance,{placement:'flow',purpose:'author',inlineSize:paperLayout.width,flowLayout:currentLayout})
              applyComponentPresentationStyle(shell,presentation.outerStyle)
              presentation=resolveComponentOuterPresentation(objectProject,instance,{placement:'flow',purpose:'author',inlineSize:shell.clientWidth || paperLayout.width,flowLayout:currentLayout})
              applyComponentPresentationStyle(stage,presentation.stageStyle)
              applyComponentPresentationStyle(host,presentation.contentStyle)
              if(children)applyComponentPresentationStyle(children,presentation.childrenStyle)
            }
            place()
            if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(()=>place());resize.observe(shell)}
            if (instance.container) {
              containerRoots.current.set(block.id, { root: root!, project: objectProject, render: runtime.renderContainer, place })
              root!.render(<>{runtime.renderContainer(block.id, objectProject, 'flow')}</>)
            }
            else if(children) {
              const inlineIds = new Set(allDocumentTextSlots(instance.data).flatMap(slot => inlineComponentIds(slot.content)))
              const documentInlineIds = new Set(documentInlineChildIds(objectProject, instance.id))
              root!.render(<>{instance.childIds!.filter(id => !inlineIds.has(id)
                && !(!objectProject.instances[id]?.frame && !objectProject.instances[id]?.flowPlacement && documentInlineIds.has(id))).map(id=>runtime.renderInstance(id,objectProject,presentation.childrenPlacement))}</>)
            }
            // Attach and size the NodeView shell before moving its retained runtime root.
            queueMicrotask(()=>{if(!disposed && host.isConnected && ownsBody()){place();if(!instance.container)runtime.onElement(block.id,host);runtime.world.afterProjectionMutation()}})
            const note=block.type==='course-instance' && bodyLayout?.caption ? window.document.createElement('figcaption') : null
            if(note) {note.innerHTML=renderDocumentText(bodyLayout!.caption!);shell.append(note)}
            return () => {
              disposed=true
              if(containerRoots.current.get(block.id)?.root===root)containerRoots.current.delete(block.id)
              if(!instance.container){runtime.onElement(block.id,null,host);runtime.onTargetElement(block.id,null,shell)}
              resize?.disconnect()
              if(root)queueMicrotask(()=>root.unmount())
              runtime.world.beforeProjectionRemoval(stage)
              // Restore the reusable NodeView host before discarding this render's
              // stage. Children stay its siblings so their selection is unchanged.
              stage.before(host)
              content?.remove();children?.remove();note?.remove();stage.remove()
            }
          }} /></div>
        {!readOnly && <button type="button" aria-label="继续输入正文" title="点击继续输入正文" data-flow-document-end="true"
          onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.focusEndParagraph()}
          style={{ display: 'block', width: '100%', minHeight: 80, padding: 0, border: 0, background: 'transparent', cursor: 'text' }} />}
        {error && <p role="alert">{error}</p>}
        {floating.filter(id => project.instances[id].flowPlacement?.space === 'paper').map(id => <FlowFloatingInstance key={id} project={project} instanceId={id}
          readPaperOffset={readPaperOffset}
          readObservationScale={readContentScale}
          selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
          onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
      </article>
    </div>
    {floating.filter(id => project.instances[id].flowPlacement?.space === 'viewport').map(id => <FlowFloatingInstance key={id} project={project} instanceId={id}
      readPaperOffset={readPaperOffset}
      readObservationScale={readContentScale}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay' : project.global.overlay.includes(id) ? 'overlay':undefined}
      viewport={{ width: viewport.width / readBaseScale(), height: viewport.height / readBaseScale() }}
      onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
    </div>
    {globals.map(id=><FlowFloatingInstance key={id} project={teacherChrome(id) ? controllerProjection : project} instanceId={id}
      readObservationScale={teacherChrome(id) ? undefined : readContentScale}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay':'overlay'} viewport={teacherChrome(id) ? viewport : { width: viewport.width / readBaseScale(), height: viewport.height / readBaseScale() }}
      controllerDrag={{ start: beginControllerDrag, move: moveControllerResize, finish: finishControllerResize }}
      onSelect={()=>runtime.selectInstances([id],surfaceId)} onEdits={edits => edit(restoreTeacherControllerFrameEdits(edits, project, controllerProjection, hudGeometry,
        runtime.navigation.placement?.() ?? { x: 0, y: 0 }, runtime.navigation))} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement}/>)}
    </div>,observationHost)}
    {!readOnly && <div className="canvas-view-controls" role="group" aria-label="画布视图">
      <button type="button" aria-label="缩小画布" onClick={() => viewSession.current?.zoomTo(viewZoom - 0.1)}><Minus size={14} /></button>
      <output aria-label="画布缩放比例">{Math.round(viewZoom * 100)}%</output>
      <button type="button" aria-label="放大画布" onClick={() => viewSession.current?.zoomTo(viewZoom + 0.1)}><Plus size={14} /></button>
      <button type="button" aria-label="适合窗口" title="重置缩放与平移" onClick={() => viewSession.current?.reset()}><Maximize2 size={14} /></button>
      <span title="Ctrl+滚轮缩放；按住空格或鼠标中键拖动画布"><Hand size={13} /></span>
    </div>}
    {authorInteraction.editor}
    {crop && <div className="flow-media-modal" style={{position:'absolute',inset:24,zIndex:20,background:'#fff',padding:24,overflow:'auto'}}><FlowMediaCropEditor instance={crop.instance} imageData={crop.data} url={assetUrls[crop.data.assetId]}
      onCancel={() => setCrop(null)} onConfirm={async patch => {
        const value=crop
        await kernel.editCaptured(kernel.capture([{type:'data.set',instanceId:value.instance.id,path:[],value:{...value.data,...patch} as unknown as JsonValue}],value.target))
        setCrop(current=>current===value ? null:current)
      }}/></div>}
    {caption && <FlowMediaCaptionEditor content={caption.content} resources={document.resources} onConfirm={caption.confirm} onCancel={caption.cancel} />}
  </div>
}

function FlowFloatingInstance({ project, instanceId, selected, readOnly, paperWidth, paragraphRects, onSelect, onEdits, onElement, onTargetElement,globalPlane,viewport,readObservationScale,readPaperOffset,controllerDrag }: {
  project: CourseProjectV10; instanceId: string; selected: boolean; readOnly: boolean; paperWidth: number; paragraphRects: readonly FlowParagraphBlockRect[];
  onSelect(): void; onEdits(edits: ComponentEdit[]): void; onElement(id: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void; onTargetElement(id: string, element: HTMLElement | null, expectedDefault?: HTMLElement): void
  globalPlane?:'underlay'|'overlay'
  viewport?:{width:number;height:number}
  readObservationScale?():number
  readPaperOffset?():{x:number;y:number}
  controllerDrag?: {
    start(event: React.PointerEvent<HTMLDivElement>, instanceId: string): void
    move(event: React.PointerEvent<HTMLDivElement>): void
    finish(event: React.PointerEvent<HTMLDivElement>, cancel?: boolean): void
  }
}) {
  const runtime=useCourseV10Runtime()
  const instance = project.instances[instanceId], placement = instance?.flowPlacement
  const definition=project.definitions[instance.definitionId]
  const controller = isViewportComponent(project, instanceId)
  const [preview, setPreview] = useState<typeof instance.frame | null>(null)
  const drag = useRef<{ x: number; y: number; frame: NonNullable<typeof instance.frame>; storedFrame: NonNullable<typeof instance.frame>; resize: boolean; point(value:{x:number;y:number}):{x:number;y:number} } | null>(null)
  const pendingController = useRef<{ input: React.PointerEvent<HTMLDivElement>; latest: React.PointerEvent<HTMLDivElement>; ended: boolean; cancel?: boolean } | null>(null)
  const freezePointer = (event: React.PointerEvent<HTMLDivElement>) => ({ ...event, currentTarget: event.currentTarget,
    preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() })
  const visibleAt = (element: HTMLElement, point: { x: number; y: number }) => visibleComponentAuthorHit(
    element.closest<HTMLElement>('.flow-workspace') ?? element.ownerDocument.body, point, id => runtime.world.contentElement?.(id))
  const boundContent = useRef<HTMLDivElement | null>(null), boundTarget = useRef<HTMLDivElement | null>(null)
  const bind = useCallback((element: HTMLDivElement | null) => {
    const previous = boundContent.current; boundContent.current = element
    onElement(instanceId, element, element ? undefined : previous ?? undefined)
  }, [instanceId, onElement])
  const target = useCallback((element: HTMLDivElement | null) => {
    const previous = boundTarget.current; boundTarget.current = element
    onTargetElement(instanceId, element, element ? undefined : previous ?? undefined)
  }, [instanceId, onTargetElement])
  if (!instance?.frame) return null
  const originalFrame = instance.frame
  const stored = preview ?? originalFrame
  const anchored = placement?.space === 'paper' && placement.paragraphAnchor
    ? flowParagraphAnchoredFrame(placement.paragraphAnchor, { x: stored.transform[4], y: stored.transform[5], width: stored.width, height: stored.height }, paperWidth, paragraphRects) : null
  const frame = anchored && !preview ? { ...stored, transform: [...stored.transform.slice(0, 4), anchored.x, anchored.y] as typeof stored.transform } : stored
  const structureDisabledReason = flowStructureDisabledReason(project, instanceId)
  const owner = componentContainerForInstance(project, instanceId)
  const surfaceId = owner?.kind === 'flow' ? owner.id : undefined
  const updatePlacement = (value: typeof placement | null) => {
    if (!surfaceId) return
    onEdits(flowPlacementEdits(project, instanceId, value ? { kind: 'overlay', surfaceId, placement: value } : { kind: 'document', surfaceId }))
  }
  const changeMode = (mode: FlowFloatingMode) => {
    if (!placement || !surfaceId) return
    const measured = flowFloatingModeEdits(instanceId, frame, placement, mode, paperWidth, paragraphRects, readPaperOffset?.() ?? { x: 0, y: 0 })
    const nextFrame = measured.find(value => value.type === 'frame.set')
    const nextPlacement = measured.find(value => value.type === 'instance.flowPlacement.set')
    if (nextFrame?.type === 'frame.set' && nextFrame.frame && nextPlacement?.type === 'instance.flowPlacement.set' && nextPlacement.flowPlacement)
      onEdits(flowPlacementEdits(project, instanceId, { kind: 'overlay', surfaceId, frame: nextFrame.frame, placement: nextPlacement.flowPlacement }))
  }
  const begin = (event: React.PointerEvent, resize: boolean) => {
    if (readOnly || structureDisabledReason) return
    event.stopPropagation(); event.preventDefault(); onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    const geometry=createFlowViewportGeometry({viewportClientRect:{x:0,y:0,width:0,height:0},layoutViewportSize:{width:0,height:0},paperOriginLayout:{x:0,y:0},paperScrollLayout:{x:0,y:0},playbackZoom:readObservationScale?.() ?? 1})
    const point=geometry.clientToViewport({x:event.clientX,y:event.clientY})
    drag.current = { ...point, frame, storedFrame: originalFrame, resize,point:geometry.clientToViewport }
  }
  const sampleDrag = (start: NonNullable<typeof drag.current>, event: React.PointerEvent) => {
    const point = start.point({ x: event.clientX, y: event.clientY }), x = point.x - start.x, y = point.y - start.y
    if (!x && !y) return start.frame
    if (!start.resize) return { ...start.frame, transform: [...start.frame.transform.slice(0, 4), start.frame.transform[4] + x, start.frame.transform[5] + y] as typeof frame.transform }
    const [a,b,c,d] = start.frame.transform, determinant = a*d-b*c
    return determinant ? { ...start.frame, width: Math.max(12, start.frame.width + (d*x-c*y)/determinant), height: Math.max(12, start.frame.height + (-b*x+a*y)/determinant) } : null
  }
  const moveDrag = (event: React.PointerEvent) => { const start = drag.current; if (start) setPreview(sampleDrag(start, event)) }
  const finishDrag = (event: React.PointerEvent) => {
    const start = drag.current; if (!start) return
    const shown = sampleDrag(start, event); drag.current = null; setPreview(null)
    if (!shown || shown.width === start.frame.width && shown.height === start.frame.height && shown.transform.every((value, index) => value === start.frame.transform[index])) return
    const next = start.resize ? { ...start.storedFrame, width: shown.width, height: shown.height } : { ...start.storedFrame, transform: shown.transform }
    if (start.resize) { onEdits([{ type: 'frame.set', instanceId, frame: next }]); return }
    const anchor = placement?.space === 'paper' && placement.paragraphAnchor ? flowParagraphAnchorAt({ x: next.transform[4], y: next.transform[5], width: next.width, height: next.height }, paperWidth, paragraphRects) : undefined
    onEdits(placement && surfaceId ? flowPlacementEdits(project, instanceId, { kind: 'overlay', surfaceId, frame: next,
      placement: anchor ? { ...placement, paragraphAnchor: anchor } : placement }) : [{ type: 'frame.set', instanceId, frame: next }])
  }
  return <div ref={target} data-flow-overlay-id={instanceId} data-component-instance={instanceId} data-controller-authoring-id={controller ? instanceId : undefined} data-component-placement="free" data-playback-bounds="true"
    style={{ ...componentPaintStyle(instance,project.definitions[instance.definitionId]), position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height,
      transform: `${globalPlane && !controller ? 'var(--flow-observation-transform, translate(0px, 0px)) ' : ''}matrix(${frame.transform.join(',')})`, transformOrigin: '0 0', zIndex: globalPlane ? globalPlane === 'underlay' ? 1 : 6 : placement?.space === 'viewport' ? placement.plane === 'underlay' ? 3 : 5 : placement?.plane === 'underlay' ? 1 : 4,
      display: instance.visible === false ? 'none' : undefined, outline: selected ? '2px solid #2563eb' : undefined }}
    onPointerDownCapture={event => { if (controller && !readOnly && event.button === 0) {
      event.preventDefault(); event.stopPropagation()
      const input = freezePointer(event), pending = { input, latest: input, ended: false, cancel: false }; pendingController.current = pending
      input.currentTarget.setPointerCapture(input.pointerId)
      void visibleAt(input.currentTarget, { x: input.clientX, y: input.clientY }).then(hit => {
        if (pendingController.current !== pending) return
        pendingController.current = null
        if (pending.cancel || !input.currentTarget.isConnected || hit?.instanceId !== instanceId) return
        onSelect(); controllerDrag?.start(input, instanceId)
        controllerDrag?.move(pending.latest)
        if (pending.ended) controllerDrag?.finish(pending.latest, pending.cancel)
      })
    } }}
    onPointerMove={event => { if (pendingController.current) pendingController.current.latest = freezePointer(event); else controllerDrag?.move(event) }}
    onPointerUp={event => { if (pendingController.current) { pendingController.current.latest = freezePointer(event); pendingController.current.ended = true } else controllerDrag?.finish(event) }}
    onPointerCancel={event => { if (pendingController.current) { pendingController.current.latest = freezePointer(event); pendingController.current.ended = true; pendingController.current.cancel = true } else controllerDrag?.finish(event, true) }}
    onLostPointerCapture={event => { if (pendingController.current) { if (!pendingController.current.ended) pendingController.current.cancel = true } else controllerDrag?.finish(event, true) }}
    onPointerDown={event => { if (!readOnly) {
      event.stopPropagation()
      const element = event.currentTarget, point = { x: event.clientX, y: event.clientY }
      void visibleAt(element, point).then(hit => {
        if (element.isConnected && hit?.instanceId === instanceId) onSelect()
      })
    } }}>
    <div ref={bind} data-component-render={instanceId} style={{ width: '100%', height: '100%' }} />
    {!readOnly && <ImageSafeAreaGuides instance={{ ...instance, frame }} project={project} />}
    {instance.childIds?.map(id=>runtime.renderInstance(id,project,'free'))}
    {!readOnly && selected && !controller && <>
      <div className="flow-overlay-toolbar" data-flow-selection-preserving-target="true" style={{ position: 'absolute', top: -28, display: 'flex', gap: 4, background: '#fff', whiteSpace: 'nowrap' }}>
        <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} onPointerDown={event => begin(event, false)} onPointerMove={moveDrag}
          onPointerUp={finishDrag} onPointerCancel={() => { drag.current = null; setPreview(null) }}>移动</button>
        {placement && <>
          <select aria-label="浮层定位模式" disabled={Boolean(structureDisabledReason)} value={placement.space === 'viewport' ? 'viewport' : placement.paragraphAnchor ? 'paragraph' : 'fixed'}
            onChange={event => changeMode(event.target.value as FlowFloatingMode)}>
            <option value="fixed">固定在纸面</option><option value="paragraph">随段落移动</option><option value="viewport">固定在视口</option>
          </select>
          <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} onClick={() => updatePlacement({ ...placement, plane: placement.plane === 'overlay' ? 'underlay' : 'overlay' })}>{placement.plane === 'overlay' ? '移到正文下方' : '移到正文上方'}</button>
          <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} onClick={() => updatePlacement(null)}>转为正文</button>
        </>}
        <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} onClick={() => onEdits([{ type: 'instance.remove', instanceId }])}>删除</button>
      </div>
      <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} aria-label="调整浮层大小" style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, padding: 0, border: 0, background: '#2563eb', cursor: 'nwse-resize' }}
        onPointerDown={event => begin(event, true)} onPointerMove={moveDrag} onPointerUp={finishDrag}
        onPointerCancel={() => { drag.current = null; setPreview(null) }} />
    </>}
  </div>
}
