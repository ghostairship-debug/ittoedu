import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentEdit, CourseProjectV10, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform'
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
import { resolveFlowMediaLayoutProjection } from '../../shared/flowMediaLayout'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { DocumentContextSelection, DocumentSelection } from '../../shared/document/ports'
import { serializeDocumentMarkdown, type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentOperation } from '../document/editorSession'
import type { FlowParagraphBlockRect } from '../../shared/flowParagraphAnchors'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame } from '../../shared/flowParagraphAnchors'
import { createFlowViewportGeometry, projectFlowComponentControllerFrame } from '../../shared/flowViewportGeometry'
import { FLOW_BODY_CSS, FLOW_BODY_PAPER_PADDING, FLOW_BODY_SCROLL_PADDING, flowPaperMaxWidth } from '../../shared/flowBodyPresentation'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../document'
import { observeFlowParagraphLayout, measureFlowParagraphLayout } from './flow/flowParagraphLayout'
import { flowBodyIds, projectFlowDocument,flowObjectExtent,flowDocumentBlock } from '../componentPlatform/surfaces/flow/documentProjection'
import { flowSurface } from '../componentPlatform/surfaces/flow/model'
import { useCourseV10Runtime } from '../components/CourseV10RuntimeView'
import { componentPaintStyle,applyComponentPaintStyle } from '../../player/components/componentPlacementStyle'
import { PlaybackViewSession } from '../../player/playbackViewSession'
import { TeacherControllerAuthoringChrome } from './TeacherControllerAuthoringChrome'
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
import type { TextRunStyle } from '../../shared/contracts/native-v1'
import { useWorkspaceMediaSource } from '../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop } from '../lessonWorkspace/workspaceMediaDrop'
import { flowMediaDropAfterBlock } from './flow/flowMediaDropPosition'
import { componentLayoutInput } from '../../components/web/measuredFragmentBox'
import type { DocumentContent } from '../../shared/document/content'
import type { DocumentResources } from '../../shared/document/resources'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../document/documentClipboardContext'
import { createFlowDocumentResourcePort, captureFlowPreparedDocumentResources,prepareFlowDocumentResourceTransaction, projectFlowPreparedResources, releaseFlowPreparedResources, retainedFlowPreparedResources, type FlowPreparedDocumentResources } from '../document/flowDocumentResources'

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
export interface FlowBlockFocusRequest { documentId: string; surfaceId: string; blockId: string; revision: number }
export type FlowMenuPageCapture = { ok: false; reason: string } | { ok: true; documentId: string; projectId: string; revision: number;
  locationId: string; surfaceId: string; generation: number; selectedBlockId: string | null; selectionSignature: string;
  paperWidth: number; bodyWidth: number; paragraphRects: readonly FlowParagraphBlockRect[] }
const flowMenuCaptureListeners = new Set<() => FlowMenuPageCapture>()
const focusListeners = new Set<(request: FlowBlockFocusRequest) => boolean>()
const selectionListeners = new Set<() => void>()
const flushListeners = new Map<string, () => { ok: boolean; reason?: string }>()
const drainListeners = new Map<string, () => Promise<{ ok: boolean; reason?: string }>>()
const caretFormatListeners = new Map<string, (style: TextRunStyle) => boolean>()
let pendingSelection: { documentId: string; surfaceId: string; blockId: string; expires: number } | null = null
export function captureFlowMenuPage(): FlowMenuPageCapture {
  return flowMenuCaptureListeners.size === 1 ? [...flowMenuCaptureListeners][0]() : { ok: false, reason: '当前 Flow 页面尚未就绪' }
}
export function flushFlowWorkspace(documentId: string): { ok: boolean; reason?: string } { return flushListeners.get(documentId)?.() ?? { ok: true } }
export async function drainFlowWorkspace(documentId: string): Promise<{ ok: boolean; reason?: string }> { return drainListeners.get(documentId)?.() ?? flushFlowWorkspace(documentId) }
export function applyFlowCaretStyle(documentId: string, style: TextRunStyle): boolean { return caretFormatListeners.get(documentId)?.(style) ?? false }
export function requestFlowBlockFocus(request: FlowBlockFocusRequest): boolean { return [...focusListeners].some(listener => listener(request)) }
export function requestFlowBlockSelection(request: { documentId: string; surfaceId: string; blockId: string }): void {
  pendingSelection = { ...request, expires: Date.now() + 2000 }; selectionListeners.forEach(listener => listener())
}

/** Original paper/editor/chrome, projected directly from V10. The shared editor keeps text focus and IME. */
export function FlowWorkspace({ documentId, project, surfaceId, toolbarContainer, readOnly = false, onDropWorkspaceMedia, onSelectImageAsset, onSelectMediaAsset, onStatus }: FlowWorkspaceProps) {
  const runtime = useCourseV10Runtime()
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
  const workspace=useRef<HTMLDivElement>(null)
  const observationMount=useRef<HTMLDivElement>(null),observationRoot=useRef<HTMLDivElement>(null),observationContent=useRef<HTMLDivElement>(null)
  const viewSession=useRef<PlaybackViewSession|null>(null),[observationHost,setObservationHost]=useState<HTMLElement|null>(null)
  const [viewport,setViewport]=useState({width:0,height:0})
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
    const release=runtime.registerObservation(surfaceId,{readZoom:()=>session.state.zoom,setZoom:zoom=>session.zoomTo(zoom),reset:()=>session.reset()})
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
    const measure=()=>setViewport(previous=>{const next={width:element.clientWidth,height:element.clientHeight};return previous.width===next.width && previous.height===next.height ? previous:next})
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()
  },[])
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
  useEffect(() => { flushListeners.set(documentId, flush); return () => { flushListeners.delete(documentId) } }, [documentId, flush])
  useEffect(() => { drainListeners.set(documentId, drain); return () => { drainListeners.delete(documentId) } }, [documentId, drain])
  useEffect(() => {
    caretFormatListeners.set(documentId, style => editor.current?.applyInlineStyle(style) ?? false)
    return () => { caretFormatListeners.delete(documentId) }
  }, [documentId])
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
      const selectedBlockId = value.runtime.selectedInstanceIds[0] ?? flowBodyIds(value.project, value.surfaceId)[0] ?? null
      return { ok: true, documentId, projectId: value.project.id, revision: value.project.revision, locationId: surfaceId, surfaceId,
        generation: bridge.read().activation, selectedBlockId, selectionSignature: JSON.stringify(value.selection), paperWidth: width,
        bodyWidth: Math.max(0, width - 72), paragraphRects: paper.current ? measureFlowParagraphLayout(paper.current,scale) : [] }
    }
    flowMenuCaptureListeners.add(capture); return () => { flowMenuCaptureListeners.delete(capture) }
  }, [documentId, surfaceId, bridge, flush])
  useEffect(() => {
    const focus = (request: FlowBlockFocusRequest) => {
      const value = latest.current
      if (request.documentId !== documentId || request.surfaceId !== surfaceId || request.revision !== value.project.revision) return false
      const accepted = editor.current?.focusBlock(request.blockId) ?? false
      if (accepted) value.runtime.selectInstances([request.blockId], surfaceId)
      return accepted
    }
    const select = () => {
      const request = pendingSelection
      if (!request || request.expires < Date.now()) { pendingSelection = null; return }
      if (request.documentId !== documentId || request.surfaceId !== surfaceId || !latest.current.project.instances[request.blockId]) return
      latest.current.runtime.selectInstances([request.blockId], surfaceId)
      editor.current?.selectBlock(request.blockId)
      paper.current?.querySelector<HTMLElement>(`[data-flow-block-id="${CSS.escape(request.blockId)}"]`)?.scrollIntoView({ block: 'nearest' })
      pendingSelection = null
    }
    focusListeners.add(focus); selectionListeners.add(select); select()
    return () => { focusListeners.delete(focus); selectionListeners.delete(select) }
  }, [documentId, surfaceId, project.revision])
  const edit = async (edits: ComponentEdit[]) => {
    const target = bridge.captureTarget(documentId)
    const ready = await drain()
    if (!ready.ok) { setError(ready.reason ?? '请先完成当前正文输入'); return }
    try { await bridge.editCaptured(bridge.capture(edits,target)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const selectDocument = (value: DocumentSelection | null) => {
    setSelection(value)
    setFlowContextSelection(value)
    const ids = value?.kind === 'text' ? [...new Set([value.anchor.blockId, value.head.blockId])] : value?.kind === 'object' ? [value.blockId] : value?.kind === 'cells' ? [value.tableId] : []
    runtime.selectInstances(ids, surfaceId)
  }
  const contextual = async (target: DocumentContextSelection) => {
    const captured = bridge.captureTarget(documentId)
    const snapshot = await workbenchSelection.prepare(documentId)
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
    const instance=project.instances[id],definition=project.definitions[instance.definitionId]
    return globals.includes(id) && componentDefinitionBuiltinKey(definition)==='guoling.navigation'
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
    const safe = (promise: Promise<unknown>) => { void promise.catch(failure => setError(String(failure))) }
    const replace = () => {
      const picker = onSelectMediaAsset && kind ? onSelectMediaAsset(kind) : kind === 'image' ? onSelectImageAsset() : Promise.reject(new Error('媒体选择入口尚未接入'))
      void picker.then(item => { if (item) safe(replaceCourseMediaAtTarget(kernel,target,item)) }).catch(failure => setError(String(failure)))
    }
    const commands = {
      moveSelectedBlock(direction: 'up'|'down') {
        const container = owningContainer(target.project,id); if (!container) return
        const siblings = containerChildIds(target.project,container), index = siblings.indexOf(id), next = index + (direction === 'up' ? -1 : 1)
        if (next >= 0 && next < siblings.length) safe(kernel.editCaptured(kernel.capture([{type:'instance.move',instanceId:id,container,index:next}],target)))
      },
      deleteSelectedBlocks() { safe(kernel.editCaptured(kernel.capture([{type:'instance.remove',instanceId:id}],target))) },
    }
    const tools: FlowMediaToolPort | undefined = kind ? {
      openCrop: () => setCrop({target,instance,data:imageDataSchema.parse(instance.data)}),
      patchMedia: patch => { const pending=patchCourseFlowMediaLayout(kernel,target,id,patch);safe(pending);return pending },
      openCaption: (content,draft) => {
        const opened = {content:content ?? {inlines:[]},confirm: async (value: FlowTextContent) => {
          await draft.confirm(value)
          setCaption(current => current === opened ? null : current)
        },cancel: () => {draft.cancel();setCaption(current => current === opened ? null : current)}}
        setCaption(opened)
      },
      convertToOverlay: () => safe(kernel.editCaptured(kernel.capture([
        ...(!instance.frame ? [{type:'frame.set' as const,instanceId:id,frame:{width:400,height:240,transform:[1,0,0,1,72,72] as [number,number,number,number,number,number]}}] : []),
        {type:'instance.flowPlacement.set',instanceId:id,flowPlacement:{space:'paper',plane:'overlay'}},
        ...(owningContainer(target.project,id)?.kind==='instance' ? [{type:'instance.move' as const,instanceId:id,container:{kind:'surface' as const,surfaceId},index:containerChildIds(target.project,{kind:'surface',surfaceId}).length}]:[])],target))),
    } : undefined
    return { block:{instance,mediaKind:kind},commands,replaceMedia:replace,mediaTools:tools }
  }
  const background = resolveComponentBackground(project,surface)
  const drop = (event: React.DragEvent<HTMLElement>) => {
    if (!onDropWorkspaceMedia || !event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) return
    event.preventDefault(); event.stopPropagation()
    if (readOnly || !flush().ok || !paper.current) { setError('请先完成当前正文输入'); return }
    const afterBlockId = flowMediaDropAfterBlock(paper.current, flowBodyIds(project, surfaceId), event.clientY)
    const captured = bridge.captureTarget(documentId)
    const target = { documentId:captured.documentId, projectId:captured.project.id, revision:captured.project.revision, locationId:surfaceId, surfaceId, sessionGeneration:bridge.read().activation, captured }
    void deliverWorkspaceMediaDrop(event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE), mediaSource, { surface: 'flow', afterBlockId }, target, onDropWorkspaceMedia,
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
      if(!instance || instance.locked || block && block.type!=='course-instance')return
      const kind=componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
      if(kind!=='guoling.text' && kind!=='guoling.formula')return
      event.preventDefault();event.stopPropagation();runtime.selectInstances([instance.id],surfaceId)
      beginContentEdit(instance.id,'canvas')
    }}>
    <div ref={setFormatHost} className="flow-document-format-host" style={{ left: 8, right: 8 }} />
    <div ref={observationMount} style={{position:'absolute',inset:`${formatHeight}px 0 0`}} data-page-backdrop="transparent" />
    {observationHost && createPortal(<div ref={observationRoot} data-flow-observation-root="true">
    <div ref={observationContent} data-playback-content="true" style={{position:'absolute',inset:0,transformOrigin:'0 0'}}>
    <div ref={scroll} className="flow-workspace__scroll flow-media-query-root" data-testid="flow-workspace-scroll" data-flow-paper-scroll="true"
      style={{ position: 'relative', overflow: 'auto', height: '100%', padding: FLOW_BODY_SCROLL_PADDING, backgroundColor:background.color,
        backgroundImage:background.assetId && assetUrls[background.assetId] ? `url("${assetUrls[background.assetId]}")` : undefined,
        backgroundSize:background.fit === 'fill' ? '100% 100%' : background.fit, backgroundPosition:'center',backgroundRepeat:'no-repeat' }}>
      <article ref={paper} className="flow-paper flow-body-content" data-testid="flow-paper" data-flow-reading-width={layout.readingWidth}
        onClick={event => { if (!readOnly && event.target === event.currentTarget) editor.current?.focusEndParagraph() }}
        onDragOver={event => { if (onDropWorkspaceMedia && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={drop} style={{ position: 'relative', width: '100%', maxWidth: flowPaperMaxWidth(layout), minHeight: '100%', margin: '0 auto', padding: FLOW_BODY_PAPER_PADDING, background: layout.paperBackgroundColor, color: '#1f2937' }}>
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
          onContextualCommand={async (instruction, target) => { await workbenchSelection.request(await contextual(target), instruction, true) }}
          renderAiButton={(target, issue) => {
            const range = target.selection && flowRangeDataPath(project, target.selection)
            if (range && range.to > range.from) return <TextAiButton documentId={documentId} selectionIdentity={JSON.stringify([project.revision,target.selection])}
              disabledReason={issue} start={async () => { const capture = await contextual(target); return { target: capture.targets[0], label: capture.label, content: null } }} />
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
            const definitionImplementation=instance && objectProject.definitions[instance.definitionId]?.implementation
            const section=definitionImplementation?.kind==='builtin' && definitionImplementation.key==='guoling.document-block'
            const key = objectProject.definitions[instance.definitionId]?.implementation
            const media = key?.kind === 'builtin' && ['guoling.image','guoling.video','guoling.audio'].includes(key.key) ? key.key.slice(8) : undefined
            const bodyLayout = instance?.flowLayout
            if (media) {
              const projection=resolveFlowMediaLayoutProjection(bodyLayout?.width ?? 'content-width',layout), wrap=bodyLayout?.wrap
              Object.assign(shell.style,{width:wrap && wrap !== 'none' ? '48%' : projection.inlineSize,maxWidth:projection.maxInlineSize,
                float:wrap && wrap !== 'none' ? wrap : 'none',margin:wrap === 'left' ? '8px 20px 8px 0' : wrap === 'right' ? '8px 0 8px 20px' : '16px auto'})
            }
            const children=instance?.childIds?.length ? window.document.createElement('div') : null
            const root=children ? createRoot(children) : null
            let stage:HTMLElement|null=null
            let resize:ResizeObserver|undefined
            const extent=flowObjectExtent(objectProject,block.id)
            const place=()=>{
              const available=shell.clientWidth || paperLayout.width
              const input=componentLayoutInput(instance,{kind:'flow',inlineSize:available,
                definition:objectProject.definitions[instance.definitionId],
                ...(extent ? {viewport:{width:extent.width,height:extent.height}}:{})})
              Object.assign(shell.style,{position:'relative',height:'auto'})
              if(input.mode==='flow-viewport') {
                const width=extent?.width ?? input.inlineSize,height=extent?.height ?? input.blockSize
                const scale=width>0 ? Math.min(1,available/width):1
                if(!stage){stage=window.document.createElement('div');shell.prepend(stage);stage.append(host);if(children)stage.append(children)}
                Object.assign(stage.style,{position:'relative',height:`${height*scale}px`})
                const geometry={position:'absolute',left:'0',top:'0',width:`${width}px`,height:`${height}px`,
                  transform:`scale(${scale}) translate(${-(extent?.x ?? 0)}px,${-(extent?.y ?? 0)}px)`,transformOrigin:'0 0'}
                Object.assign(host.style,geometry);if(children)Object.assign(children.style,geometry)
              } else {
                Object.assign(host.style,{position:'relative',width:'100%',height:'var(--component-flow-height, auto)'})
              }
            }
            place()
            if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(place);resize.observe(shell)}
            if(children) {
              if(!stage){Object.assign(children.style,{position:'relative'});shell.append(children)}
              root!.render(<>{instance.childIds!.map(id=>runtime.renderInstance(id,objectProject,section ? 'flow':undefined))}</>)
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
          readObservationScale={()=>viewSession.current?.state.zoom ?? 1}
          selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
          onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
      </article>
    </div>
    {[...globals.filter(id=>!teacherChrome(id)), ...floating.filter(id => project.instances[id].flowPlacement?.space === 'viewport')].map(id => <FlowFloatingInstance key={id} project={project} instanceId={id}
      readObservationScale={()=>viewSession.current?.state.zoom ?? 1}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay' : project.global.overlay.includes(id) ? 'overlay':undefined}
      viewport={viewport}
      onSelect={() => runtime.selectInstances([id], surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement} />)}
    </div>
    {globals.filter(teacherChrome).map(id=><FlowFloatingInstance key={id} project={project} instanceId={id}
      selected={runtime.selectedInstanceIds.includes(id)} readOnly={readOnly} paperWidth={paperLayout.width} paragraphRects={paperLayout.rects}
      globalPlane={project.global.underlay.includes(id) ? 'underlay':'overlay'} viewport={viewport}
      onSelect={()=>runtime.selectInstances([id],surfaceId)} onEdits={edit} onElement={runtime.onElement} onTargetElement={runtime.onTargetElement}/>)}
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

function FlowFloatingInstance({ project, instanceId, selected, readOnly, paperWidth, paragraphRects, onSelect, onEdits, onElement, onTargetElement,globalPlane,viewport,readObservationScale }: {
  project: CourseProjectV10; instanceId: string; selected: boolean; readOnly: boolean; paperWidth: number; paragraphRects: readonly FlowParagraphBlockRect[];
  onSelect(): void; onEdits(edits: ComponentEdit[]): void; onElement(id: string, element: HTMLElement | null): void; onTargetElement(id: string, element: HTMLElement | null): void
  globalPlane?:'underlay'|'overlay'
  viewport?:{width:number;height:number}
  readObservationScale?():number
}) {
  const runtime=useCourseV10Runtime()
  const instance = project.instances[instanceId], placement = instance?.flowPlacement
  const definition=project.definitions[instance.definitionId]
  const authorController=!readOnly && !instance.implementationOverride && definition?.implementation.kind==='builtin' && definition.implementation.key==='guoling.navigation'
  const [preview, setPreview] = useState<typeof instance.frame | null>(null)
  const drag = useRef<{ x: number; y: number; frame: NonNullable<typeof instance.frame>; resize: boolean; point(value:{x:number;y:number}):{x:number;y:number} } | null>(null)
  const bind = useCallback((element: HTMLDivElement | null) => onElement(instanceId, authorController ? null:element), [instanceId, onElement,authorController])
  const target = useCallback((element: HTMLDivElement | null) => onTargetElement(instanceId, element), [instanceId, onTargetElement])
  if (!instance?.frame) return null
  const stored = preview ?? instance.frame
  const anchored = placement?.space === 'paper' && placement.paragraphAnchor
    ? flowParagraphAnchoredFrame(placement.paragraphAnchor, { x: stored.transform[4], y: stored.transform[5], width: stored.width, height: stored.height }, paperWidth, paragraphRects) : null
  const implementation=project.definitions[instance.definitionId]?.implementation
  const controller=globalPlane && implementation?.kind==='builtin' && implementation.key==='guoling.navigation' && viewport && viewport.width>0 && viewport.height>0
    ? projectFlowComponentControllerFrame({x:stored.transform[4],y:stored.transform[5],width:stored.width,height:stored.height},viewport):null
  const frame = controller && !preview ? {...stored,width:controller.width,height:controller.height,transform:[...stored.transform.slice(0,4),controller.x,controller.y] as typeof stored.transform}
    : anchored && !preview ? { ...stored, transform: [...stored.transform.slice(0, 4), anchored.x, anchored.y] as typeof stored.transform } : stored
  const updatePlacement = (value: typeof placement | null) => onEdits([{ type: 'instance.flowPlacement.set', instanceId, flowPlacement: value ?? null }])
  const begin = (event: React.PointerEvent, resize: boolean) => {
    if (readOnly || instance.locked) return
    event.stopPropagation(); event.preventDefault(); onSelect()
    event.currentTarget.setPointerCapture(event.pointerId)
    const geometry=createFlowViewportGeometry({viewportClientRect:{x:0,y:0,width:0,height:0},layoutViewportSize:{width:0,height:0},paperOriginLayout:{x:0,y:0},paperScrollLayout:{x:0,y:0},playbackZoom:readObservationScale?.() ?? 1})
    const point=geometry.clientToViewport({x:event.clientX,y:event.clientY})
    drag.current = { ...point, frame, resize,point:geometry.clientToViewport }
  }
  return <div ref={target} data-flow-overlay-id={instanceId} data-component-render={instanceId} data-component-instance={instanceId} data-component-placement="free" data-playback-bounds="true"
    style={{ ...componentPaintStyle(instance,project.definitions[instance.definitionId]), position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height,
      transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0', zIndex: (globalPlane ?? placement?.plane) === 'underlay' ? 1 : 4,
      display: instance.visible === false ? 'none' : undefined, outline: selected ? '2px solid #2563eb' : undefined }}
    onPointerDown={event => { event.stopPropagation(); onSelect() }}>
    <div ref={bind} style={{ width: '100%', height: '100%' }}>{authorController && <TeacherControllerAuthoringChrome item={instance} definition={definition}/>}</div>
    {instance.childIds?.map(id=>runtime.renderInstance(id,project,'free'))}
    {!readOnly && selected && <>
      <div className="flow-overlay-toolbar" data-flow-selection-preserving-target="true" style={{ position: 'absolute', top: -28, display: 'flex', gap: 4, background: '#fff', whiteSpace: 'nowrap' }}>
        <button type="button" onPointerDown={event => begin(event, false)} onPointerMove={event => {
          const start = drag.current; if (!start) return
          const point=start.point({x:event.clientX,y:event.clientY})
          setPreview({ ...start.frame, transform: [...start.frame.transform.slice(0, 4), start.frame.transform[4] + point.x - start.x, start.frame.transform[5] + point.y - start.y] as typeof frame.transform })
        }} onPointerUp={event => {
          if (!drag.current) return; const shown = preview ?? frame, next={...instance.frame!,transform:shown.transform}; drag.current = null; setPreview(null)
          const anchor = placement?.space === 'paper' ? flowParagraphAnchorAt({ x: next.transform[4], y: next.transform[5], width: next.width, height: next.height }, paperWidth, paragraphRects) : undefined
          onEdits([{ type: 'frame.set', instanceId, frame: next }, ...(placement && anchor ? [{ type: 'instance.flowPlacement.set' as const, instanceId, flowPlacement: { ...placement, paragraphAnchor: anchor } }] : [])])
        }} onPointerCancel={() => { drag.current = null; setPreview(null) }}>移动</button>
        {placement && <>
          <button type="button" onClick={() => updatePlacement({ ...placement, space: placement.space === 'paper' ? 'viewport' : 'paper' })}>{placement.space === 'paper' ? '改为视口浮层' : '放到纸面上'}</button>
          <button type="button" onClick={() => updatePlacement({ ...placement, plane: placement.plane === 'overlay' ? 'underlay' : 'overlay' })}>{placement.plane === 'overlay' ? '移到正文下方' : '移到正文上方'}</button>
          <button type="button" onClick={() => updatePlacement(null)}>转为正文</button>
        </>}
        <button type="button" onClick={() => onEdits([{ type: 'instance.remove', instanceId }])}>删除</button>
      </div>
      <span role="button" aria-label="调整浮层大小" style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: '#2563eb', cursor: 'nwse-resize' }}
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
