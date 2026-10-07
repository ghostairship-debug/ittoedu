import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentEdit, ComponentFrame, CourseProjectV10, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey,resolveComponentBackground, owningContainer, containerChildIds, isComponentVisibleAtSurface, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import { layoutTable } from '../../components/table/render'
import { parseTableData } from '../../components/table/data'
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
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { DocumentContextSelection, DocumentSelection } from '../../shared/document/ports'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentOperation } from '../document/editorSession'
import type { FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame } from '../../shared/flowParagraphAnchors'
import { createFlowViewportGeometry } from '../../shared/flowViewportGeometry'
import { isGlobalTeacherController, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, createTeacherControllerHudGeometry, teacherControllerReferenceSize, type TeacherControllerHudGeometry } from '../../shared/teacherControllerViewportGeometry'
import { FLOW_BODY_CSS, FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth, resolveFlowPaperBackground } from '../../shared/flowBodyPresentation'
import { resolveComponentOuterPresentation } from '../../shared/componentPresentation'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document'
import { prepareDocumentSelection, prepareDocumentTextEdit, requestDocumentSelection, type DocumentSelectionAdapter } from '../document/documentSelectionCommands'
import { observeFlowParagraphLayout, measureFlowParagraphLayout, flowReadingMove, flowDocumentInsertionAt, flowFloatingModeEdits, type FlowFloatingMode } from './flow/flowParagraphLayout'
import { projectFlowDocument,flowDocumentBlock } from '../componentPlatform/surfaces/flow/documentProjection'
import { flowSurface } from '../componentPlatform/surfaces/flow/model'
import { useCourseV10Runtime } from '../components/CourseV10RuntimeView'
import { componentPaintStyle,applyComponentPaintStyle } from '../../player/components/componentPlacementStyle'
import { PlaybackViewSession } from '../../player/playbackViewSession'
import { NativeSelectionContext } from '../workbench/NativeSelectionContext'
import { proEditorRailController } from './proEditorRailController'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import { SlideLayerSelectionOverlay } from './workspaces/SlideLayerSelectionOverlay'
import { FreeTransformGesture, freeSurfaceTargets, type FreeResizeHandle } from '../componentPlatform/surfaces/slide'
import type { WorkspaceMediaDropHandler } from '../lessonWorkspace/workspaceMediaDrop'
import type { ImportedImageAsset } from '../project/assetManager'
import { useEditorStore } from '../store/editorStore'
import { captureCourseInstanceSelection, captureCourseInstanceRange, workbenchSelection } from '../workbench/SelectionContextController'
import { ElementAiButton } from '../workbench/elementCards/ElementAiCard'
import { TextAiButton } from '../workbench/elementCards/ElementTextCards'
import { TextComponentEditor, FormulaComponentEditor } from '../../components/text/editor'
import { textComponentDataSchema, formulaComponentDataSchema } from '../../components/text/data'
import { textAppearanceStyles } from '../../components/text/render'
import type { SlideContentEdit } from '../store/slices/slideAuthoringSlice'
import { flowRangeDataPath } from '../componentPlatform/surfaces/flow/documentSelection'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../lessonWorkspace/workspaceMediaDrag'
import { useWorkspaceMediaSource } from '../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop } from '../lessonWorkspace/workspaceMediaDrop'
import { componentLayoutInput } from '../../components/web/measuredFragmentBox'
import type { DocumentContent } from '../../shared/document/content'
import type { DocumentResources } from '../../shared/document/resources'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../document/documentClipboardContext'
import { createFlowDocumentResourcePort, captureFlowPreparedDocumentResources,prepareFlowDocumentResourceTransaction, projectFlowPreparedResources, releaseFlowPreparedResources, retainedFlowPreparedResources, type FlowPreparedDocumentResources } from '../document/flowDocumentResources'
import { assertFlowStructureEditsAllowed, flowStructureDisabledReason } from '../authoring/flowStructureEdits'
import { registerFlowMenuCapture, registerFlowWorkspaceFlush, registerFlowWorkspaceDrain, registerFlowCaretFormat, registerFlowBlockFocus,
  registerFlowBlockSelection, type FlowBlockFocusRequest, type FlowMenuPageCapture } from '../document/flowWorkspaceRegistry'

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
  const chrome = useCourseEditorChrome()
  const bridge = useEditorStore(state => state.courseBridge)
  const kernel = useEditorStore(state => state.courseKernel)
  const mimeTypes = useMemo(() => Object.fromEntries(Object.values(project.assets).map(asset => [asset.id, asset.mimeType ?? 'application/octet-stream'])), [project.assets])
  const assetUrls = useAssetObjectUrls(runtime.resources.assets, mimeTypes)
  const draft = useEditorStore(state => state.flowDocumentDrafts?.[documentId])
  const setDraft = useEditorStore(state => state.setFlowDocumentDraft)
  const setFlowContextSelection = useEditorStore(state => state.setFlowContextSelection)
  const editingInstance = useEditorStore(state => state.flowEditingInstance)
  const contentDraft = useEditorStore(state => state.slideContentEdit)
  const beginContentEdit = useEditorStore(state => state.beginSlideDataEdit)
  const updateContentDraft = useEditorStore(state => state.updateSlideDataDraft)
  const commitContentEdit = useEditorStore(state => state.commitSlideContentEdit)
  const cancelContentEdit = useEditorStore(state => state.cancelTextEdit)
  const surface = flowSurface(project, surfaceId)
  const layout = surface.flow?.layout ?? { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#ffffff' }
  const editor = useRef<SharedDocumentEditorHandle>(null), paper = useRef<HTMLElement>(null), scroll = useRef<HTMLDivElement>(null)
  const paperPointer = useRef<{ x: number; y: number } | null>(null)
  const workspace=useRef<HTMLDivElement>(null)
  const observationMount=useRef<HTMLDivElement>(null),observationRoot=useRef<HTMLDivElement>(null),observationContent=useRef<HTMLDivElement>(null)
  const viewSession=useRef<PlaybackViewSession|null>(null),[observationHost,setObservationHost]=useState<HTMLElement|null>(null)
  const [viewport,setViewport]=useState({width:0,height:0})
  const [controllerPreview, setControllerPreview] = useState<Record<string, ComponentFrame>>({})
  const controllerGesture = useRef<{ pointerId: number; start: { x: number; y: number }; moved: boolean; captured: CapturedCourseTarget;
    original: CourseProjectV10; display: CourseProjectV10; viewport: TeacherControllerHudGeometry; offset: { x: number; y: number }; value: FreeTransformGesture; edits: ComponentEdit[] } | null>(null)
  const [, refreshNavigation] = useState(0)
  useEffect(() => runtime.navigation.subscribe?.(() => refreshNavigation(value => value + 1)), [runtime.navigation])
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
  const [selection, setSelection] = useState<DocumentSelection | null>(null)
  const [crop, setCrop] = useState<{ target: CapturedCourseTarget; instance: ComponentInstance; data: ImageData } | null>(null)
  const [caption, setCaption] = useState<{ content: FlowTextContent; confirm(value: FlowTextContent): Promise<void>; cancel(): void } | null>(null)
  const [paperLayout, setPaperLayout] = useState<{ width: number; rects: readonly FlowParagraphBlockRect[] }>({ width: 0, rects: [] })
  const bodyPaint=useRef(new WeakMap<HTMLElement,string>())
  const mediaSource = useWorkspaceMediaSource()
  const latest = useRef({ project, surfaceId, documentId, selection, runtime, mediaSource })
  latest.current = { project, surfaceId, documentId, selection, runtime, mediaSource }
  const document = useMemo(() => projectFlowDocument(project, surfaceId), [project, surfaceId])
  useLayoutEffect(()=>{
    const mount=observationMount.current;if(!mount)return
    const session=new PlaybackViewSession();viewSession.current=session
    setObservationHost(session.mount(mount))
    return()=>{viewSession.current=null;session.destroy()}
  },[documentId,surfaceId])
  useLayoutEffect(()=>{
    const session=viewSession.current,root=observationRoot.current,content=observationContent.current
    if(!observationHost || !session || !root || !content)return
    session.register({id:surfaceId,kind:'flow',root,content});session.activate(surfaceId)
    const release=runtime.registerObservation(surfaceId,{readZoom:()=>session.state.zoom,setZoom:zoom=>session.zoomTo(zoom),reset:()=>{
      if (scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0 }
      session.reset()
    }})
    const unsubscribe=session.subscribe(()=>{
      runtime.navigation.changed()
      const element=paper.current;if(!element)return
      const next={width:element.getBoundingClientRect().width/session.state.zoom,rects:measureFlowParagraphLayout(element,session.state.zoom)}
      setPaperLayout(previous=>JSON.stringify(previous)===JSON.stringify(next) ? previous:next)
    })
    runtime.navigation.changed()
    return()=>{unsubscribe();release()}
  },[observationHost,surfaceId,runtime.registerObservation,runtime.navigation])
  useLayoutEffect(()=>{viewSession.current?.refreshBounds()},[project.revision,paperLayout,viewport,observationHost])
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
  const preserveRejectedDraft=(target:CapturedCourseTarget,source:string,failure:unknown)=>{
    const message=failure instanceof Error ? failure.message:String(failure)
    setError(message)
    setDraft({surfaceId:target.surfaceId!,revision:target.project.revision,source,composing:false,preparedResources:retainedFlowPreparedResources(target,preparedResources.current),diagnostics:[{message,offset:0,endOffset:0,line:1,column:1}]},target.documentId)
  }
  const submitCaptured = async (next: MarkdownDocument, operation: DocumentOperation, target: CapturedCourseTarget): Promise<boolean> => {
    const source = serializeDocumentMarkdown(next, 'flow')
    try {
      if (target.surfaceId !== surfaceId) throw new Error('正文页面已切换，请重新编辑')
      const resources = [...new Set([...retainedFlowPreparedResources(target,preparedResources.current),
        ...(operation.preparedResourceBatches ?? (operation.preparedResources === undefined ? [] : [operation.preparedResources]))])]
      const planned = prepareFlowDocumentResourceTransaction(target, surfaceId, next.content.blocks, resources)
      assertFlowStructureEditsAllowed(target.editingProject, planned.edits, true)
      if (planned.edits.length) await bridge.editCaptured(bridge.capture(planned.edits, planned.target), operation.historyGroup)
      releaseFlowPreparedResources(planned.prepared)
      preparedResources.current = preparedResources.current.filter(value => !planned.prepared.includes(value))
      setError(null); setDraft(null, target.documentId); return true
    } catch (failure) { preserveRejectedDraft(target, source, failure); return false }
  }
  const submit = (next: MarkdownDocument, operation: DocumentOperation): Promise<boolean> => {
    const pending = composition.current
    if (pending) {
      pending.next = next; pending.operation = operation
      return new Promise(resolve => pending.pending.push(resolve))
    }
    try { return submitCaptured(next, operation, bridge.captureTarget(documentId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return Promise.resolve(false) }
  }
  const flush = useCallback(() => {
    if (composition.current) return { ok: false, reason: '请完成当前中文输入后保存。' }
    const result = editor.current?.flush()
    if (result && (!result.ready || result.diagnostics.length)) return { ok: false, reason: result.diagnostics[0]?.message ?? '正文草稿尚未完成' }
    return { ok: true }
  }, [])
  const drain = useCallback(async () => {
    if (composition.current) return { ok: false, reason: '请完成当前中文输入后保存。' }
    const result = await editor.current?.drain()
    return result && (!result.ready || result.diagnostics.length)
      ? { ok: false, reason: result.diagnostics[0]?.message ?? '正文草稿尚未完成' } : { ok: true }
  }, [])
  useEffect(() => registerFlowWorkspaceFlush(documentId, flush), [documentId, flush])
  useEffect(() => registerFlowWorkspaceDrain(documentId, drain), [documentId, drain])
  useEffect(() => registerFlowCaretFormat(documentId, style => editor.current?.applyInlineStyle(style) ?? false), [documentId])
  useLayoutEffect(() => paper.current ? observeFlowParagraphLayout(paper.current, rects => {
    const nextLayout={width:(paper.current?.getBoundingClientRect().width ?? 0)/(viewSession.current?.state.zoom ?? 1),rects}
    setPaperLayout(previous=>JSON.stringify(previous)===JSON.stringify(nextLayout) ? previous:nextLayout)
    const probe=window.document.createElement('div').style
    const style=(element:HTMLElement,values:Record<string,string|undefined>)=>{for(const [key,value]of Object.entries(values))if(value!==undefined){
      (probe as any)[key]=value;const normalized=(probe as any)[key]
      if((element.style as any)[key]!==normalized)(element.style as any)[key]=normalized
    }}
    editor.current?.paintProjection(() => {
      for (const element of paper.current?.querySelectorAll<HTMLElement>('[data-flow-block-id]') ?? []) {
        const instance = latest.current.project.instances[element.dataset.flowBlockId!]
        element.dataset.componentFlowId = instance?.id ?? ''
        if(instance){
          const definition = latest.current.project.definitions[instance.definitionId]
          const signature=JSON.stringify([componentPaintStyle(instance,definition),instance.visible])
          if(bodyPaint.current.get(element)!==signature){
            applyComponentPaintStyle(element,instance,definition)
            const display=componentPaintStyle(instance,definition).display
            element.style.display=instance.visible===false ? 'none':typeof display==='string' ? display:''
            bodyPaint.current.set(element,signature)
          }
        }
        const key = instance && latest.current.project.definitions[instance.definitionId]?.implementation
        if (key?.kind === 'builtin' && key.key === 'guoling.text' && !instance.implementationOverride) {
          const data=textComponentDataSchema.parse(instance.data),presentation=textAppearanceStyles(data.appearance,data.sizing)
          const {height:_height,display:_display,flexDirection:_direction,justifyContent:_justify,...box}=presentation.box
          const {height:_contentHeight,...content}=presentation.content
          style(element,{...box,...content})
        }
        if(key?.kind === 'builtin' && key.key === 'guoling.table' && !instance.implementationOverride) {
          const data=parseTableData(instance.data),table=element.querySelector<HTMLTableElement>('table'),measured=layoutTable(data)
          if(table)style(table,{width:`${measured.width}px`,maxWidth:'100%',borderCollapse:'collapse',tableLayout:'fixed'})
          const header=table?.querySelector<HTMLElement>('tr')
          if(header)style(header,{display:data.headerEnabled===false ? 'none':''})
          for(const row of data.rows)for(const cell of row.cells) {
            const slot=element.querySelector<HTMLElement>(`[data-document-slot="${CSS.escape(`cell:${JSON.stringify([row.id,cell.columnId])}`)}"]`),owner=slot?.closest<HTMLElement>('td,th')
            const effective=measured.cells.find(value=>value.id===cell.id)?.style,column=data.columns.find(value=>value.id===cell.columnId)
            if(owner && effective)style(owner,{width:`${column?.width ?? 200}px`,height:`${row.height}px`,padding:`${effective.cellPadding}px`,backgroundColor:effective.fillColor,color:effective.textColor,
              fontFamily:effective.fontFamily,fontSize:`${effective.fontSize}px`,fontWeight:effective.bold ? '700':'400',fontStyle:effective.italic ? 'italic':'normal',textAlign:effective.horizontalAlign,verticalAlign:effective.verticalAlign,
              border:`${effective.borderWidth}px ${effective.lineStyle} ${effective.borderColor}`})
          }
        }
        if (instance) runtime.onTargetElement(instance.id, element)
      }
    })
  },()=>viewSession.current?.state.zoom ?? 1) : undefined, [project,surfaceId, runtime.onTargetElement,observationHost])
  useEffect(() => {
    const capture = (): FlowMenuPageCapture => {
      const result = flush(); if (!result.ok) return { ok: false, reason: result.reason! }
      const value = latest.current, scale=viewSession.current?.state.zoom ?? 1, width = (paper.current?.getBoundingClientRect().width ?? 0)/scale
      if (width <= 0) return { ok: false, reason: '正文尚未完成布局' }
      const paragraphRects = paper.current ? measureFlowParagraphLayout(paper.current,scale) : []
      const paperBox = paper.current?.getBoundingClientRect(), pointer = paperPointer.current
      const y = pointer && paperBox ? (pointer.y - paperBox.top) / scale : (scroll.current?.scrollTop ?? 0) + 28
      const selectedBlockId = value.runtime.selectedInstanceIds.find(id => flowDocumentBlock(value.project, value.surfaceId, id))
        ?? (value.selection?.kind === 'text' ? value.selection.head.blockId : null)
        ?? flowParagraphAnchorAt({ x: 36, y, width: 1, height: 1 }, width, paragraphRects)?.blockId ?? null
      return { ok: true, documentId, projectId: value.project.id, revision: value.project.revision, locationId: surfaceId, surfaceId,
        generation: bridge.read().activation, selectedBlockId, selectionSignature: JSON.stringify(value.selection), paperWidth: width,
        bodyWidth: Math.max(0, width - 72), paragraphRects }
    }
    return registerFlowMenuCapture(capture)
  }, [documentId, surfaceId, bridge, flush])
  useEffect(() => {
    const focus = (request: FlowBlockFocusRequest) => {
      const value = latest.current
      if (request.documentId !== documentId || request.surfaceId !== surfaceId || request.revision !== value.project.revision) return false
      const accepted = editor.current?.focusBlock(request.blockId) ?? false
      if (accepted) value.runtime.selectInstances([request.blockId], surfaceId)
      return accepted
    }
    const releaseFocus = registerFlowBlockFocus(focus)
    const releaseSelection = registerFlowBlockSelection(documentId, surfaceId, blockId => {
      if (!latest.current.project.instances[blockId]) return false
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
    setSelection(value)
    setFlowContextSelection(value)
    const ids = value?.kind === 'text' ? [...new Set([value.anchor.blockId, value.head.blockId])] : value?.kind === 'object' ? [value.blockId] : value?.kind === 'cells' ? [value.tableId] : []
    runtime.selectInstances(ids, surfaceId)
  }
  const captureContextual = (): DocumentSelectionAdapter => {
    const captured = bridge.captureTarget(documentId)
    return (snapshot, target) => {
    if (target.mode !== 'layout' || !target.selection) throw new Error('请回到正文选择内容后修改')
    if (snapshot.model.kind !== 'course-v10' || snapshot.epoch !== captured.epoch || snapshot.model.project.id !== captured.project.id
      || target.revision !== String(snapshot.revision)) throw new Error('正文选区已改变，请重新选择')
    const selectedProject = resolveComponentPresentation(snapshot.model.project, surfaceId, captured.activeStateId)
    const range = flowRangeDataPath(selectedProject, target.selection)
    if (range) {
      return captureCourseInstanceRange(snapshot, surfaceId, range.instanceId, range.path, range.from, range.to, target.label, captured.activeStateId, range.root)
    }
    const ids = target.selection.kind === 'object' ? [target.selection.blockId] : target.selection.kind === 'cells' ? [target.selection.tableId]
      : [...new Set([target.selection.anchor.blockId, target.selection.head.blockId])]
    if (target.selection.kind === 'text') throw new Error('跨正文对象的文字范围请分段选择后修改')
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
      }
    }
    visit(content.blocks)
    return createCourseDocumentClipboardContext({ documentId: captured.documentId, project: captured.editingProject, resources: captured.resources, roots })
  }
  const clipboardResourcePort = (context: unknown) => {
    const captured = bridge.captureTarget(documentId)
    if (captured.surfaceId !== surfaceId) throw new Error('正文粘贴目标已切换')
    const source = readCourseDocumentClipboardContext(context)
    return createFlowDocumentResourcePort({ target: captured, source, pending: () => preparedResources.current,
      onPrepared: prepared => { preparedResources.current = [...preparedResources.current,prepared] },
      onDiscard: prepared => { preparedResources.current = preparedResources.current.filter(value=>value!==prepared) } })
  }
  const floating = surface.childIds.filter(id => project.instances[id]?.flowPlacement)
  const globals = [...project.global.underlay, ...project.global.overlay].filter(id=>isComponentVisibleAtSurface(project.instances[id],surfaceId))
  const teacherChrome = (id:string) => {
    return isGlobalTeacherController(project, id)
  }
  const hudGeometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(project), viewportRect: { x: 0, y: 0, width: Math.max(1, viewport.width), height: Math.max(1, viewport.height) } })
  const controllerBaseProjection = projectTeacherControllerInstances(project, hudGeometry, undefined, runtime.navigation)
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
        mode: handle === 'rotate' ? 'rotate' : 'resize', handle: handle === 'rotate' ? undefined : handle as FreeResizeHandle,
        targets: selectedControllerTargets, pointer: { x: event.clientX, y: event.clientY }, surfaceToPointer: controllerPointerMatrix() }) }
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
      gesture.display, gesture.viewport, undefined, gesture.offset, runtime.navigation), gesture.captured)
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
        const edits = flowReadingMove(target.project, id, direction)
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
      convertToOverlay: () => safe(commit([
        ...(!instance.frame ? [{type:'frame.set' as const,instanceId:id,frame:{width:400,height:240,transform:[1,0,0,1,72,72] as [number,number,number,number,number,number]}}] : []),
        {type:'instance.flowPlacement.set',instanceId:id,flowPlacement:{space:'paper',plane:'overlay'}},
        ...(owningContainer(target.project,id)?.kind==='instance' ? [{type:'instance.move' as const,instanceId:id,container:{kind:'surface' as const,surfaceId},index:containerChildIds(target.project,{kind:'surface',surfaceId}).length}]:[])])),
    } : undefined
    return { block:{instance,mediaKind:kind,structureDisabledReason},commands,replaceMedia:replace,mediaTools:tools,
      openProperties: () => {
        runtime.selectInstances([id], surfaceId)
        const state = useEditorStore.getState()
        chrome.setMode('deep'); state.setActiveTab('properties'); proEditorRailController.open('properties')
      } }
  }
  const background = resolveFlowPaperBackground(project,surface)
  const readPaperOffset = () => {
    const paperBox = paper.current?.getBoundingClientRect(), contentBox = observationContent.current?.getBoundingClientRect()
    const scale = viewSession.current?.state.zoom ?? 1
    return { x: paperBox && contentBox ? (paperBox.left - contentBox.left) / scale : 0,
      y: paperBox && contentBox ? (paperBox.top - contentBox.top) / scale : 0 }
  }
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
    onPointerDownCapture={event => {
      if (!contentDraft || contentDraft.target.documentId !== documentId || contentDraft.composing) return
      const target=event.target instanceof Element ? event.target : null
      if(target?.closest('[data-component-professional-editor],.text-edit-toolbar,.selection-quick-bar'))return
      void commitContentEdit().catch(failure=>setError(failure instanceof Error ? failure.message:String(failure)))
    }}
    onDoubleClickCapture={event => {
      if(readOnly || !(event.target instanceof Element) || event.target.closest('[data-component-professional-editor]'))return
      const id=event.target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
      const instance=id && project.instances[id]
      const block=instance && flowDocumentBlock(project,surfaceId,instance.id)
      if(!instance || block && block.type!=='course-instance')return
      const kind=componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
      if(kind!=='guoling.text' && kind!=='guoling.formula')return
      event.preventDefault();event.stopPropagation();runtime.selectInstances([instance.id],surfaceId)
      beginContentEdit(instance.id,'canvas')
    }}>
    {!readOnly && runtime.selectedInstanceIds.length > 0 && runtime.selectedInstanceIds.every(id => globals.includes(id) || floating.includes(id))
      && <NativeSelectionContext documentId={documentId} revision={project.revision} surfaceId={surfaceId} itemIds={runtime.selectedInstanceIds} enabled />}
    {!readOnly && selectedControllerTargets.length > 0 && <div data-flow-controller-selection="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 8 }}
      onPointerDown={beginControllerResize} onPointerMove={moveControllerResize} onPointerUp={event => finishControllerResize(event)}
      onPointerCancel={event => finishControllerResize(event, true)} onLostPointerCapture={event => finishControllerResize(event, true)}>
      <SlideLayerSelectionOverlay targets={selectedControllerTargets} scale={1} surfaceToPointer={controllerPointerMatrix()} />
    </div>}
    <div ref={setFormatHost} className="flow-document-format-host" style={{ left: 8, right: 8 }} />
    <div ref={observationMount} style={{position:'absolute',inset:`${formatHeight}px 0 0`}} data-page-backdrop="transparent" />
    {observationHost && createPortal(<div ref={observationRoot} data-flow-observation-root="true">
    <div ref={observationContent} data-playback-content="true" style={{position:'absolute',inset:0,transformOrigin:'0 0'}}>
    <div ref={scroll} className="flow-workspace__scroll flow-media-query-root" data-testid="flow-workspace-scroll" data-flow-paper-scroll="true"
      style={{ position: 'relative', overflow: 'auto', height: '100%', padding: FLOW_BODY_SCROLL_PADDING }}>
      <article ref={paper} className="flow-paper flow-body-content" data-testid="flow-paper" data-flow-reading-width={layout.readingWidth}
        onPointerDownCapture={event => { paperPointer.current = { x: event.clientX, y: event.clientY } }}
        onClick={event => { if (!readOnly && event.target === event.currentTarget) editor.current?.focusEndParagraph() }}
        onDragOver={event => { if (onDropWorkspaceMedia && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={drop} style={{ position: 'relative', width: '100%', maxWidth: flowPaperMaxWidth(layout), minHeight: '100%', margin: '0 auto', padding: FLOW_BODY_PAPER_PADDING, backgroundColor: background.color,
          backgroundImage: background.assetId && assetUrls[background.assetId] ? `url("${assetUrls[background.assetId]}")` : undefined,
          backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', color: '#1f2937' }}>
        <style>{FLOW_BODY_CSS}</style>
        <div style={{ position:'relative',zIndex:2 }}><SharedDocumentEditor key={`${documentId}/${surfaceId}`} ref={editor} document={document} revision={String(project.revision)} readOnly={readOnly}
          objectRevision={JSON.stringify(Object.values(project.instances).map(instance=>[instance.id,instance.definitionId,
            instance.implementationOverride ?? project.definitions[instance.definitionId]?.implementation,
            componentLayoutInput(instance,{kind:'flow',inlineSize:paperLayout.width,definition:project.definitions[instance.definitionId]}).mode,
            instance.flowLayout,instance.childIds,instance.frame,instance.style]))}
          beforeProjectionMutation={()=>runtime.world.beforeProjectionMutation()}
          afterProjectionMutation={()=>queueMicrotask(()=>runtime.world.afterProjectionMutation())}
          resolveImage={source => {const asset=Object.values(project.assets).find(asset=>asset.path===source);if(!asset)throw new Error(`素材引用不存在：${source}`);return {assetId:asset.id,source:{kind:'project'}}}}
          inlineStyleDefaults={blockId => {
            const instance = project.instances[blockId]
            const key = instance && project.definitions[instance.definitionId]?.implementation
            if (key?.kind !== 'builtin' || key.key !== 'guoling.text' || instance.implementationOverride) return undefined
            const appearance = (instance.data as any).appearance
            return appearance ? Object.fromEntries(Object.entries(appearance).filter(([key]) => ['fontFamily','fontSize','color','bold','italic','underline','strike','emphasis','highlightColor'].includes(key))) : undefined
          }}
          target="flow" toolbarHost={toolbarContainer ?? formatHost} sourceDraft={draft?.surfaceId === surfaceId ? draft.source : undefined}
          sourceDiagnostics={draft?.surfaceId===surfaceId ? draft.diagnostics:undefined}
          clipboardContext={clipboardContext} clipboardResourcePort={clipboardResourcePort}
          onDiscardDraft={()=>{releaseFlowPreparedResources(preparedResources.current);preparedResources.current=[];setDraft(null,documentId);setError(null)}}
          onChange={submit} onUndo={async () => { const ready = await drain(); if (!ready.ok) throw new Error(ready.reason); await bridge.undo(documentId) }}
          onRedo={async () => { const ready = await drain(); if (!ready.ok) throw new Error(ready.reason); await bridge.redo(documentId) }}
          onDraft={(source, diagnostics) => {
            if (composition.current) return
            const owner = preparedResources.current.find(value=>value.target.documentId===documentId && value.target.surfaceId===surfaceId)?.target
            setDraft(diagnostics.length ? { surfaceId, revision: project.revision, source, diagnostics, composing:false,
              preparedResources:owner ? retainedFlowPreparedResources(owner,preparedResources.current) : [] } : null,documentId)
          }}
          onCompositionChange={(active, source) => {
            if (active) { if (!composition.current) composition.current = { target: bridge.captureTarget(documentId), next: null, pending: [] }; setDraft({ surfaceId, revision: project.revision, source, diagnostics: [], composing: true },documentId) }
            else setTimeout(async () => {
              const pending = composition.current; composition.current = null
              if (!pending) return
              const accepted = pending.next && pending.operation ? await submitCaptured(pending.next, pending.operation, pending.target) : true
              if (accepted) setDraft(null,pending.target.documentId)
              pending.pending.forEach(resolve => resolve(accepted))
            }, 0)
          }} onSelection={selectDocument}
          onContextualTargetChange={target => { if (target?.mode === 'layout') void contextual(target).then(value => workbenchSelection.observe(documentId, project.revision, () => value)).catch(() => {}) }}
          onContextualCommand={async (instruction, target) => { await requestDocumentSelection(documentId, target, instruction, captureContextual()) }}
          renderAiButton={(target, issue) => {
            const range = target.selection && flowRangeDataPath(project, target.selection)
            if (range && range.to > range.from) return <TextAiButton documentId={documentId} selectionIdentity={JSON.stringify([project.revision,target.selection])}
              disabledReason={issue} start={() => prepareDocumentTextEdit(documentId, target, captureContextual())} />
            const id = target.selection?.kind === 'object' ? target.selection.blockId : null
            return id ? <ElementAiButton documentId={documentId} target={{ kind:'course-instance',surfaceId,instanceId:id }} label={target.label}
              disabledReason={issue} capture={() => contextual(target)} /> : undefined
          }}
          objectMenu={id => { const value=actions(id); return value ? flowBlockCommands(value.block,value.commands,value.replaceMedia,value.mediaTools) : [] }}
          renderQuickBarActions={target => { const id=target.selection?.kind === 'object' ? target.selection.blockId : null, value=id && actions(id); return value ? <FlowBlockQuickActions {...value}/> : null }}
          renderQuickBarMenu={target => { const id=target.selection?.kind === 'object' ? target.selection.blockId : null, value=id && actions(id); return value ? <FlowBlockQuickMenu {...value}/> : null }}
          renderObject={(block, host) => {
            const objectProject = project.instances[block.id] ? project : projectFlowPreparedResources(bridge.captureTarget(documentId), preparedResources.current)
            let disposed=false
            const shell = host.closest<HTMLElement>('[data-flow-block-id]') ?? host
            shell.dataset.componentFlowId = block.id
            shell.dataset.componentInstance = block.id
            shell.dataset.componentPlacement = 'flow'
            runtime.onTargetElement(block.id, shell)
            const instance = objectProject.instances[block.id]
            if (!instance) throw new Error(`正文引用的正式实例已不存在：${block.id}`)
            const bodyLayout = instance?.flowLayout
            const children=instance?.childIds?.length ? window.document.createElement('div') : null
            const root=children ? createRoot(children) : null
            const stage=window.document.createElement('div')
            shell.prepend(stage); stage.append(host); if(children) stage.append(children)
            let resize:ResizeObserver|undefined
            let presentation = resolveComponentOuterPresentation(objectProject, instance, { placement: 'flow', purpose: 'author', inlineSize: paperLayout.width, flowLayout: layout })
            const place=()=>{
              Object.assign(shell.style,presentation.outerStyle)
              presentation=resolveComponentOuterPresentation(objectProject,instance,{placement:'flow',purpose:'author',inlineSize:shell.clientWidth || paperLayout.width,flowLayout:layout})
              Object.assign(stage.style,presentation.stageStyle)
              Object.assign(host.style,presentation.contentStyle)
              if(children)Object.assign(children.style,presentation.childrenStyle)
            }
            place()
            if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(place);resize.observe(shell)}
            if(children) {
              root!.render(<>{instance.childIds!.map(id=>runtime.renderInstance(id,objectProject,presentation.childrenPlacement))}</>)
            }
            // Attach and size the NodeView shell before moving its retained runtime root.
            queueMicrotask(()=>{if(!disposed && host.isConnected){place();runtime.onElement(block.id,host);runtime.world.afterProjectionMutation()}})
            const note=block.type==='course-instance' && bodyLayout?.caption ? window.document.createElement('figcaption') : null
            if(note) {note.innerHTML=renderDocumentText(bodyLayout!.caption!);shell.append(note)}
            return () => {disposed=true;runtime.onElement(block.id,null);runtime.onTargetElement(block.id,null);resize?.disconnect();if(root) queueMicrotask(() => root.unmount());children?.remove();note?.remove();stage?.remove() }
          }} /></div>
        {!readOnly && <button type="button" aria-label="继续输入正文" title="点击继续输入正文" data-flow-document-end="true"
          onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.focusEndParagraph()}
          style={{ display: 'block', width: '100%', minHeight: 80, padding: 0, border: 0, background: 'transparent', cursor: 'text' }} />}
        {error && <p role="alert">{error}</p>}
        {floating.filter(id => project.instances[id].flowPlacement?.space === 'paper').map(id => <FlowFloatingInstance key={id} project={project} instanceId={id}
          readPaperOffset={readPaperOffset}
          readObservationScale={()=>viewSession.current?.state.zoom ?? 1}
          selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
          onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
      </article>
    </div>
    {[...globals.filter(id=>!teacherChrome(id)), ...floating.filter(id => project.instances[id].flowPlacement?.space === 'viewport')].map(id => <FlowFloatingInstance key={id} project={project} instanceId={id}
      readPaperOffset={readPaperOffset}
      readObservationScale={()=>viewSession.current?.state.zoom ?? 1}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay' : project.global.overlay.includes(id) ? 'overlay':undefined}
      viewport={viewport}
      onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
    </div>
    {globals.filter(teacherChrome).map(id=><FlowFloatingInstance key={id} project={controllerProjection} instanceId={id}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay':'overlay'} viewport={viewport}
      onSelect={()=>runtime.selectInstances([id],surfaceId)} onEdits={edits => edit(restoreTeacherControllerFrameEdits(edits, project, controllerProjection, hudGeometry,
        undefined, runtime.navigation.placement?.() ?? { x: 0, y: 0 }, runtime.navigation))} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement}/>)}
    </div>,observationHost)}
    {!readOnly && contentDraft?.source==='canvas' && contentDraft.target.documentId===documentId && contentDraft.target.surfaceId===surfaceId
      && <FlowProfessionalDraftEditor key={`${contentDraft.target.epoch}:${contentDraft.instanceId}`} project={project} draft={contentDraft}
        target={()=>runtime.world.targetElement(contentDraft.instanceId)} update={updateContentDraft} commit={commitContentEdit} cancel={cancelContentEdit}
        undo={async ()=>{await commitContentEdit();await bridge.undo(contentDraft.target.documentId)}}
        redo={async ()=>{await commitContentEdit();await bridge.redo(contentDraft.target.documentId)}} report={setError} />}
    {crop && <div className="flow-media-modal" style={{position:'absolute',inset:24,zIndex:20,background:'#fff',padding:24,overflow:'auto'}}><FlowMediaCropEditor instance={crop.instance} imageData={crop.data} url={assetUrls[crop.data.assetId]}
      onCancel={() => setCrop(null)} onConfirm={async patch => {
        const value=crop
        await kernel.editCaptured(kernel.capture([{type:'data.set',instanceId:value.instance.id,path:[],value:{...value.data,...patch} as unknown as JsonValue}],value.target))
        setCrop(current=>current===value ? null:current)
      }}/></div>}
    {caption && <FlowMediaCaptionEditor content={caption.content} resources={document.resources} onConfirm={caption.confirm} onCancel={caption.cancel} />}
  </div>
}

/** The existing runtime target owns all Flow/free-group geometry; this portal owns only the captured field input. */
function FlowProfessionalDraftEditor({project,draft,target,update,commit,cancel,undo,redo,report}:{
  project:CourseProjectV10;draft:SlideContentEdit;target():HTMLElement|undefined
  update(data:unknown,composing?:boolean):void;commit():Promise<void>;cancel():unknown;undo():void|Promise<void>;redo():void|Promise<void>;report(message:string):void
}) {
  const [host,setHost]=useState<HTMLElement|null>(null),[toolbar,setToolbar]=useState<HTMLDivElement|null>(null)
  const root=useRef<HTMLDivElement>(null),latest=useRef({draft,commit,report})
  latest.current={draft,commit,report}
  useLayoutEffect(()=>{setHost(target() ?? null)},[draft.instanceId,target])
  useLayoutEffect(()=>{root.current?.querySelector<HTMLElement>('.ProseMirror')?.focus({preventScroll:true})},[host])
  const kind=componentDefinitionBuiltinKey(draft.target.editingProject.definitions[draft.definitionId])
  if(!host || (kind!=='guoling.text' && kind!=='guoling.formula'))return null
  const owner={revision:`${draft.target.epoch}:${draft.instanceId}`,toolbarHost:toolbar,onUndo:undo,onRedo:redo,onDiagnostic:report,
    onCompositionChange:(active:boolean)=>update(latest.current.draft.data,active),onChange:(data:unknown)=>{update(data);return true}}
  return createPortal(<div ref={root} data-component-professional-editor="" className="text-edit-overlay"
    style={{position:'absolute',inset:0,zIndex:20,pointerEvents:'auto',background:'#fff',overflow:'visible'}}
    onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}
    onKeyDown={event=>{if(event.key==='Escape' && !event.nativeEvent.isComposing && !latest.current.draft.composing){event.stopPropagation();cancel()}}}
    onBlur={event=>{
      const next=event.relatedTarget
      if(next instanceof Node && event.currentTarget.contains(next))return
      if(next instanceof Element && next.closest('.text-edit-toolbar,.selection-quick-bar'))return
      const blurred=event.target
      queueMicrotask(()=>{
        const active=window.document.activeElement
        if(active && (root.current?.contains(active) || active.closest('.text-edit-toolbar,.selection-quick-bar')))return
        if(blurred instanceof Node && !blurred.isConnected && root.current?.isConnected){root.current.querySelector<HTMLElement>('.ProseMirror')?.focus({preventScroll:true});return}
        if(!latest.current.draft.composing)void latest.current.commit().catch(failure=>latest.current.report(failure instanceof Error ? failure.message:String(failure)))
      })
    }}>
    <div className="text-edit-toolbar" ref={setToolbar}/>
    {kind==='guoling.text' ? <TextComponentEditor {...owner} data={textComponentDataSchema.parse(draft.data)}/>
      : <FormulaComponentEditor {...owner} data={formulaComponentDataSchema.parse(draft.data)}/>}
  </div>,host)
}

function FlowFloatingInstance({ project, instanceId, selected, readOnly, paperWidth, paragraphRects, onSelect, onEdits, onElement, onTargetElement,globalPlane,viewport,readObservationScale,readPaperOffset }: {
  project: CourseProjectV10; instanceId: string; selected: boolean; readOnly: boolean; paperWidth: number; paragraphRects: readonly FlowParagraphBlockRect[];
  onSelect(): void; onEdits(edits: ComponentEdit[]): void; onElement(id: string, element: HTMLElement | null): void; onTargetElement(id: string, element: HTMLElement | null): void
  globalPlane?:'underlay'|'overlay'
  viewport?:{width:number;height:number}
  readObservationScale?():number
  readPaperOffset?():{x:number;y:number}
}) {
  const runtime=useCourseV10Runtime()
  const instance = project.instances[instanceId], placement = instance?.flowPlacement
  const definition=project.definitions[instance.definitionId]
  const controller = isGlobalTeacherController(project, instanceId)
  const [preview, setPreview] = useState<typeof instance.frame | null>(null)
  const drag = useRef<{ x: number; y: number; frame: NonNullable<typeof instance.frame>; resize: boolean; point(value:{x:number;y:number}):{x:number;y:number}; preview?: NonNullable<typeof instance.frame> } | null>(null)
  const bind = useCallback((element: HTMLDivElement | null) => onElement(instanceId, element), [instanceId, onElement])
  const target = useCallback((element: HTMLDivElement | null) => onTargetElement(instanceId, element), [instanceId, onTargetElement])
  if (!instance?.frame) return null
  const stored = preview ?? instance.frame
  const anchored = placement?.space === 'paper' && placement.paragraphAnchor
    ? flowParagraphAnchoredFrame(placement.paragraphAnchor, { x: stored.transform[4], y: stored.transform[5], width: stored.width, height: stored.height }, paperWidth, paragraphRects) : null
  const frame = anchored && !preview ? { ...stored, transform: [...stored.transform.slice(0, 4), anchored.x, anchored.y] as typeof stored.transform } : stored
  const structureDisabledReason = flowStructureDisabledReason(project, instanceId)
  const updatePlacement = (value: typeof placement | null) => onEdits([{ type: 'instance.flowPlacement.set', instanceId, flowPlacement: value ?? null }])
  const changeMode = (mode: FlowFloatingMode) => {
    if (!placement) return
    onEdits(flowFloatingModeEdits(instanceId, frame, placement, mode, paperWidth, paragraphRects, readPaperOffset?.() ?? { x: 0, y: 0 }))
  }
  const begin = (event: React.PointerEvent, resize: boolean) => {
    if (readOnly || structureDisabledReason) return
    event.stopPropagation(); event.preventDefault(); onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    const geometry=createFlowViewportGeometry({viewportClientRect:{x:0,y:0,width:0,height:0},layoutViewportSize:{width:0,height:0},paperOriginLayout:{x:0,y:0},paperScrollLayout:{x:0,y:0},playbackZoom:readObservationScale?.() ?? 1})
    const point=geometry.clientToViewport({x:event.clientX,y:event.clientY})
    drag.current = { ...point, frame, resize,point:geometry.clientToViewport }
  }
  const moveController = (event: React.PointerEvent) => {
    const start = drag.current; if (!controller || !start) return
    const point = start.point({ x: event.clientX, y: event.clientY })
    if (Math.hypot(point.x - start.x, point.y - start.y) < 3 && !start.preview) return
    start.preview = { ...start.frame, transform: [...start.frame.transform.slice(0, 4), start.frame.transform[4] + point.x - start.x, start.frame.transform[5] + point.y - start.y] as typeof frame.transform }
    setPreview(start.preview)
  }
  const finishController = (cancel = false) => {
    if (!controller || !drag.current) return
    const next = drag.current.preview; drag.current = null; setPreview(null)
    if (!cancel && next) onEdits([{ type: 'frame.set', instanceId, frame: next }])
  }
  return <div ref={target} data-flow-overlay-id={instanceId} data-component-instance={instanceId} data-controller-authoring-id={controller ? instanceId : undefined} data-component-placement="free" data-playback-bounds="true"
    style={{ ...componentPaintStyle(instance,project.definitions[instance.definitionId]), position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height,
      transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0', zIndex: (globalPlane ?? placement?.plane) === 'underlay' ? 1 : 4,
      display: instance.visible === false ? 'none' : undefined, outline: selected ? '2px solid #2563eb' : undefined }}
    onPointerDownCapture={event => { if (controller && !readOnly && event.button === 0) begin(event, false) }}
    onPointerMove={moveController} onPointerUp={() => finishController()} onPointerCancel={() => finishController(true)} onLostPointerCapture={() => finishController(true)}
    onPointerDown={event => { if (!readOnly) { event.stopPropagation(); onSelect() } }}>
    <div ref={bind} data-component-render={instanceId} style={{ width: '100%', height: '100%' }} />
    {instance.childIds?.map(id=>runtime.renderInstance(id,project,'free'))}
    {!readOnly && selected && !controller && <>
      <div className="flow-overlay-toolbar" data-flow-selection-preserving-target="true" style={{ position: 'absolute', top: -28, display: 'flex', gap: 4, background: '#fff', whiteSpace: 'nowrap' }}>
        <button type="button" disabled={Boolean(structureDisabledReason)} title={structureDisabledReason ?? undefined} onPointerDown={event => begin(event, false)} onPointerMove={event => {
          const start = drag.current; if (!start) return
          const point=start.point({x:event.clientX,y:event.clientY})
          setPreview({ ...start.frame, transform: [...start.frame.transform.slice(0, 4), start.frame.transform[4] + point.x - start.x, start.frame.transform[5] + point.y - start.y] as typeof frame.transform })
        }} onPointerUp={event => {
          if (!drag.current) return; const shown = preview ?? frame, next={...instance.frame!,transform:shown.transform}; drag.current = null; setPreview(null)
          const anchor = placement?.space === 'paper' && placement.paragraphAnchor ? flowParagraphAnchorAt({ x: next.transform[4], y: next.transform[5], width: next.width, height: next.height }, paperWidth, paragraphRects) : undefined
          onEdits([{ type: 'frame.set', instanceId, frame: next }, ...(placement && anchor ? [{ type: 'instance.flowPlacement.set' as const, instanceId, flowPlacement: { ...placement, paragraphAnchor: anchor } }] : [])])
        }} onPointerCancel={() => { drag.current = null; setPreview(null) }}>移动</button>
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
        onPointerDown={event => begin(event, true)} onPointerMove={event => {
          const start = drag.current; if (!start) return
          const [a,b,c,d] = start.frame.transform, determinant = a*d-b*c
          if (!determinant) return
          const point=start.point({x:event.clientX,y:event.clientY}),x=point.x-start.x,y=point.y-start.y
          setPreview({ ...start.frame,width:Math.max(12,start.frame.width+(d*x-c*y)/determinant),height:Math.max(12,start.frame.height+(-b*x+a*y)/determinant) })
        }}
        onPointerUp={() => { if (!drag.current) return; const next = preview ?? frame; drag.current = null; setPreview(null); onEdits([{ type: 'frame.set', instanceId, frame: next }]) }}
        onPointerCancel={() => { drag.current = null; setPreview(null) }} />
    </>}
  </div>
}
