import type { FlowOwnedState, FlowAuthoringIntent, FlowAuthoringReceipt, FlowDocumentDraft } from './flowAuthoringTypes'
export type { FlowOwnedState, FlowAuthoringIntent, FlowAuthoringReceipt, FlowDocumentDraft } from './flowAuthoringTypes'
import type { EditorStoreKernel } from '../editorStoreKernel'
import type { CourseAuthoringTarget } from '../../authoring/courseAuthoringSession'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { ComponentEdit, JsonValue } from '../../../shared/contracts/component-platform'
import { surfaceSettingsEdits } from '../../../core/course/courseSemanticEdits'
import { flowPlacementEdits, flowReadingOrderEdits } from '../../../core/course/courseFlowEdits'
import type { FlowBlock } from '../../../shared/courseProjectTypes'
import type { DocumentBlock } from '../../../shared/document/content'
import type { DocumentSelection } from '../../../shared/document/ports'
import type { FlowTextEditSession } from '../../authoring/flowTextInput'
import type { ChartType } from '../../course/chartContentOperations'
import type { FlowBlockFormatSpec } from '../../authoring/flowTextInput'
import { flowDocumentDraftSaveBlock } from '../../authoring/flowDocumentDraft'
import { flowDocumentEdits, projectFlowDocument, flowDocumentBlock } from '../../componentPlatform/surfaces/flow/documentProjection'
import { applyFlowCaretStyle, drainFlowWorkspace, flushFlowWorkspace, requestFlowBlockSelection } from '../../document/flowWorkspaceRegistry'
import { prepareFlowDocumentResourceTransaction, releaseFlowPreparedResources } from '../../document/flowDocumentResources'
import { applyDocumentBlockCommand } from '../../document/documentBlockCommands'
import { documentTextSlots } from '../../../shared/document/content'
import { createTextComponentData, formatTextComponentRange } from '../../../components/text/data'
import { flowRangeDataPath,flowTextStyleEdits,flowProfessionalTextStyleEdits } from '../../componentPlatform/surfaces/flow/documentSelection'
import { insertCourseElement, type CourseElementKind, type CourseInsertionOptions } from '../../media/commitCourseMediaAuthoring'
import { assertFlowStructureEditsAllowed } from '../../authoring/flowStructureEdits'
export function createInitialFlowOwnedState(): FlowOwnedState {
  return { flowDocumentDraft: null, flowDocumentDrafts: {}, flowSession: null, flowTextEdit: null, flowClipboard: null, flowContextSelection: null, flowEditingInstance: null }
}
export interface FlowV10AuthoringPorts {
  read(): FlowOwnedState
  patch(patch: Partial<FlowOwnedState>): void
  readEditingScope?(): 'scene' | 'global'
  content?: { begin(instanceId: string, source?: 'canvas' | 'properties'): unknown; commit(): Promise<boolean | void>; cancel(): void }
}
/** Formal writes and History belong to the shared V10 Session. Only local input drafts live in this slice. */
export function createFlowAuthoringSlice(kernel: EditorStoreKernel, flow: FlowV10AuthoringPorts) {
  const setDraft = (draft: FlowDocumentDraft | null, documentId = kernel.readView().activeDocumentId ?? '') => {
    if (!documentId) return
    const drafts = { ...flow.read().flowDocumentDrafts }
    if (draft) drafts[documentId] = draft; else delete drafts[documentId]
    flow.patch({ flowDocumentDrafts: drafts, ...(documentId === kernel.readView().activeDocumentId ? { flowDocumentDraft: draft } : {}) })
  }
  const report = (error: unknown) => kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error) })
  const commit = async (edits: ComponentEdit[], historyGroup?: string, target = kernel.captureTarget(), documentProjection = false): Promise<FlowAuthoringReceipt> => {
    if (!edits.length) return { ok: true, historyEntry: false }
    try {
      assertFlowStructureEditsAllowed(target.editingProject, edits, documentProjection)
      const captured = kernel.capture(edits, target)
      await kernel.editCaptured(captured, historyGroup)
      return { ok: true, historyEntry: true }
    } catch (error) { report(error); return { ok: false, reason: String(error), historyEntry: false } }
  }
  const active = () => { const target = kernel.captureTarget(); if (!target.surfaceId || target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind !== 'flow') throw new Error('当前表面不是讲义'); return target }
  const flush = (documentId = kernel.readView().activeDocumentId ?? '') => {
    const result = flushFlowWorkspace(documentId)
    if (!result.ok) return { ok: false as const, reason: result.reason ?? '正文草稿尚未完成' }
    const draft = flow.read().flowDocumentDrafts?.[documentId]
    return flowDocumentDraftSaveBlock(draft) ?? { ok: true as const }
  }
  const drain = async (documentId = kernel.readView().activeDocumentId ?? '') => {
    const result = await drainFlowWorkspace(documentId)
    if (!result.ok) return { ok: false as const, reason: result.reason ?? '正文草稿尚未完成' }
    return flowDocumentDraftSaveBlock(flow.read().flowDocumentDrafts?.[documentId]) ?? { ok: true as const }
  }
  const add = async (kind: CourseElementKind, options: CourseInsertionOptions = {}) => {
    const target = active()
    if (!(await drain(target.documentId)).ok) return {ok:false,reason:'请完成当前正文输入',historyEntry:false}
    const insertion = flow.readEditingScope?.() === 'global'
      ? { ...options, container: { kind: 'global' as const, plane: 'overlay' as const } } : options
    try { await insertCourseElement(kernel,target,kind,insertion); return {ok:true,historyEntry:true} }
    catch (error) { report(error); return {ok:false,reason:String(error),historyEntry:false} }
  }
  const documentEdit = (blocks: FlowBlock[], historyGroup?: string, target = active()) => commit(flowDocumentEdits(target.editingProject, target.surfaceId!, blocks), historyGroup, target, true)
  const renameHeading = async (instanceId: string, title: string) => {
    const target = active(), instance = target.project.instances[instanceId]
    if (!instance) throw new Error('标题对象不存在')
    const data = instance.data as Record<string, JsonValue>
    const field = data.type === 'section' ? 'title' : 'content'
    await kernel.editCaptured(kernel.capture([{ type: 'data.set', instanceId, path: [field], value: { inlines: [{ type: 'text', text: title }] } }], target))
  }
  const formatBlock = (target: CapturedCourseTarget, instanceId: string, spec: FlowBlockFormatSpec): Promise<FlowAuthoringReceipt> => {
    let content = projectFlowDocument(target.editingProject, target.surfaceId!).content
    const find = (blocks: DocumentBlock[]): DocumentBlock | undefined => { for (const block of blocks) { if (block.id === instanceId) return block; if (block.type === 'section') { const child = find(block.blocks); if (child) return child } } }
    const block = find(content.blocks)
    if (!block) throw new Error('请选择正文块')
    if(block.type==='course-instance' && spec.kind==='text-style')return commit(flowProfessionalTextStyleEdits(target.editingProject,instanceId,spec.style,spec.range),'flow-property-format',target)
    if (spec.kind === 'convert-heading' || spec.kind === 'convert-paragraph' || spec.kind === 'convert-quote') {
      content = applyDocumentBlockCommand(content, { action:'convert',blockId:instanceId,kind:spec.kind === 'convert-heading' ? 'heading' : spec.kind === 'convert-quote' ? 'quote' : 'paragraph' })
      const converted = find(content.blocks)
      if (converted?.type === 'heading' && spec.kind === 'convert-heading') converted.level = spec.level
    } else if (spec.kind === 'heading-level') { if (block.type !== 'heading') throw new Error('请选择标题'); block.level = spec.level }
    else if (spec.kind === 'list-ordered') { if (block.type !== 'list') throw new Error('请选择列表'); block.ordered = spec.ordered }
    else if (spec.kind === 'text-style') {
      for (const slot of documentTextSlots(block)) {
        const length = slot.content.inlines.reduce((size, inline) => size + (inline.type === 'math' ? 1 : Array.from(inline.text).length),0)
        const from = typeof spec.range === 'object' ? spec.range.start : 0, to = typeof spec.range === 'object' ? spec.range.end : length
        slot.content.inlines = formatTextComponentRange(createTextComponentData(slot.content),from,to,spec.style).content.inlines
      }
    }
    return documentEdit(content.blocks,spec.kind === 'text-style' ? 'flow-property-format' : undefined,target)
  }
  const runFlowAuthoringIntent = async (legacy: CourseAuthoringTarget | CapturedCourseTarget, intent: FlowAuthoringIntent): Promise<FlowAuthoringReceipt> => {
    try {
      const target = 'documentId' in legacy ? legacy : active()
      if (!('documentId' in legacy) && (legacy.projectId !== target.project.id || legacy.documentRevision !== target.project.revision || legacy.surfaceId !== target.surfaceId)) throw new Error('讲义目标已变化，请重新选择')
      const instanceId = 'itemId' in legacy ? legacy.itemId : target.instanceId
      const instance = instanceId ? target.editingProject.instances[instanceId] : undefined
      switch (intent.kind) {
        case 'select-blocks': kernel.selectInstances(intent.blockIds, target.surfaceId, target.documentId); return { ok: true, historyEntry: false }
        case 'select-overlay': kernel.selectInstances(intent.layerItemIds, target.surfaceId, target.documentId); return { ok: true, historyEntry: false }
        case 'clear-selection': kernel.selectInstances([], target.surfaceId, target.documentId); return { ok: true, historyEntry: false }
        case 'document-history': if (!(await drain(target.documentId)).ok) throw new Error('请完成当前正文输入'); await kernel.bridge[intent.direction](target.documentId); return { ok: true, historyEntry: false }
        case 'replace-document-content': {
          const planned = prepareFlowDocumentResourceTransaction(target,target.surfaceId!,intent.blocks,intent.preparedResources === undefined ? [] : [intent.preparedResources])
          const receipt = await commit(planned.edits,intent.historyGroup,planned.target,true)
          if (receipt.ok) releaseFlowPreparedResources(planned.prepared)
          return receipt
        }
        case 'format-block': if (!instance) throw new Error('请选择正文块'); return formatBlock(target,instance.id,intent.spec)
        case 'format-text-style': {
          if (!instance) throw new Error('请选择正文文字')
          const selection = flow.read().flowContextSelection
          const range = selection ? flowRangeDataPath(target.editingProject,selection) : null
          if (!range) return formatBlock(target,instance.id,{ kind:'text-style',style:intent.style,range:'all' })
          if(range.instanceId!==instance.id)throw new Error('文字范围已切换，请重新选择')
          if (range.from === range.to) {
            if (!applyFlowCaretStyle(target.documentId,intent.style)) throw new Error('请回到正文插入点后设置待输入格式')
            return {ok:true,historyEntry:false}
          }
          return commit(flowTextStyleEdits(target.editingProject,selection!,intent.style),undefined,target)
        }
        case 'update-document-draft': setDraft({ surfaceId: target.surfaceId!, revision: target.project.revision, source: intent.source, diagnostics: intent.diagnostics, composing: intent.composing },target.documentId); return { ok: true, historyEntry: false }
        case 'clear-document-draft': setDraft(null,target.documentId); return { ok: true, historyEntry: false }
        case 'rename-page': return commit(surfaceSettingsEdits(target.editingProject, target.surfaceId!, { title: intent.title }), undefined, target)
        case 'set-width-mode': case 'set-paper-background': {
          return commit(surfaceSettingsEdits(target.editingProject, target.surfaceId!, { flowLayout: intent.kind === 'set-width-mode'
            ? { widthMode: intent.widthMode } : { paperBackgroundColor: intent.backgroundColor } }), undefined, target)
        }
        case 'delete-blocks': return commit(intent.blockIds.map(id => ({ type: 'instance.remove', instanceId: id })), undefined, target)
        case 'patch-block': case 'patch-overlay-properties': if (!instance) throw new Error('请选择讲义对象'); return commit(Object.entries(intent.patch).map(([key,value]) => ({ type: 'data.set', instanceId: instance.id, path: [key], value: JSON.parse(JSON.stringify(value)) as JsonValue })), undefined, target)
        case 'transform-overlay-frame': if (!instance?.frame) throw new Error('浮层没有自由frame'); return commit([{ type: 'frame.set', instanceId: instance.id, frame: { ...instance.frame, width: intent.frame.width, height: intent.frame.height, transform: [...instance.frame.transform.slice(0,4),intent.frame.x,intent.frame.y] as [number,number,number,number,number,number] } }], undefined, target)
        case 'patch-overlay-paper-space': case 'patch-overlay-body-plane': case 'convert-overlay-to-document': case 'convert-block-to-overlay': {
          if (!instance) throw new Error('请选择讲义对象')
          const placement = instance.flowPlacement ?? { space: 'paper' as const, plane: 'overlay' as const }
          const edits = flowPlacementEdits(target.editingProject, instance.id, intent.kind === 'convert-overlay-to-document'
            ? { kind: 'document', surfaceId: target.surfaceId! }
            : { kind: 'overlay', surfaceId: target.surfaceId!, placement: {
              ...placement, ...(intent.kind === 'patch-overlay-paper-space' ? { space: intent.paperSpace }
                : intent.kind === 'patch-overlay-body-plane' ? { plane: intent.bodyPlane }
                : intent.kind === 'convert-block-to-overlay' && intent.paragraphAnchor ? { paragraphAnchor: intent.paragraphAnchor } : {}) },
              ...(intent.kind === 'convert-block-to-overlay' && intent.frame ? { frame: { width: intent.frame.width, height: intent.frame.height,
                transform: [1,0,0,1,intent.frame.x,intent.frame.y] } } : {}) })
          return commit(edits, undefined, target)
        }
        case 'move-block': {
          if (!instance) throw new Error('请选择正文对象')
          return commit(flowReadingOrderEdits(target.editingProject, instance.id, intent.direction), undefined, target)
        }
        default: throw new Error(`当前讲义操作需要对应专业编辑入口：${intent.kind}`)
      }
    } catch (error) { report(error); return { ok: false, reason: error instanceof Error ? error.message : String(error), historyEntry: false } }
  }
  return {
    runFlowAuthoringIntent,
    setFlowDocumentDraft: setDraft,
    setFlowContextSelection: (selection: DocumentSelection | null) => flow.patch({ flowContextSelection: selection }),
    beginTextEdit(instanceId: string, source?: 'canvas' | 'properties') {
      const target = active()
      kernel.selectInstances([instanceId],target.surfaceId,target.documentId)
      const block=flowDocumentBlock(target.editingProject,target.surfaceId!,instanceId)
      if (!block || block.type==='course-instance') return flow.content?.begin(instanceId,source)
      flow.patch({ flowEditingInstance:{ documentId:target.documentId,instanceId } })
      requestFlowBlockSelection({documentId:target.documentId,surfaceId:target.surfaceId!,blockId:instanceId})
    },
    async commitTextEdit() {
      const editing = flow.read().flowEditingInstance, documentId = editing?.documentId ?? kernel.readView().activeDocumentId ?? ''
      if (!(await drain(documentId)).ok) return false
      if (await flow.content?.commit() === false) return false
      if (flow.read().flowEditingInstance === editing) flow.patch({flowEditingInstance:null})
      return true
    },
    cancelTextEdit() { flow.content?.cancel(); flow.patch({flowEditingInstance:null}) },
    restoreFlowDocumentDraft(draft: FlowDocumentDraft) { const view = kernel.readView(); if (view.activeDocumentId && !flow.read().flowDocumentDrafts?.[view.activeDocumentId] && draft.surfaceId === view.surfaceId && draft.revision === view.project?.revision) setDraft(draft,view.activeDocumentId) },
    commitDraft: () => flush().ok,
    commitDraftForPersistence: drain,
    async commitDraftForPersistenceAsync(documentId = kernel.readView().activeDocumentId ?? '') { const result = await drain(documentId); if (result.ok) await kernel.bridge.drain([documentId]); return result },
    undo: async () => { const documentId = kernel.readView().activeDocumentId; if (documentId && (await drain(documentId)).ok) await kernel.bridge.undo(documentId) },
    redo: async () => { const documentId = kernel.readView().activeDocumentId; if (documentId && (await drain(documentId)).ok) await kernel.bridge.redo(documentId) },
    renameProject: (title: string) => commit([{ type: 'project.title.set', title }]),
    renameFlowPage: (surfaceId: string, title: string) => commit(surfaceSettingsEdits(kernel.readDocument(), surfaceId, { title })),
    renameFlowHeading: renameHeading,
    activateFlowHeading(surfaceId: string, instanceId: string) { const target = kernel.captureTarget(); kernel.selectInstances([instanceId], surfaceId, target.documentId); requestFlowBlockSelection({ documentId: target.documentId, surfaceId, blockId: instanceId }); return true },
    activateBlock(instanceId: string) { const target = active(); kernel.selectInstances([instanceId], target.surfaceId, target.documentId); requestFlowBlockSelection({ documentId: target.documentId, surfaceId: target.surfaceId!, blockId: instanceId }); return true },
    addTextNode: (x?: number,y?: number) => add('text',{x,y,text:'',destination:x !== undefined || y !== undefined ? 'paper':'document'}),
    addFormulaNode: (x?: number,y?: number) => add('formula',{x,y,destination:x !== undefined || y !== undefined ? 'paper':'document'}),
    addTableNode: () => add('table'),
    addChartNode: (chartType?: ChartType) => add('chart',{chartType}),
    addRectangleNode: (x?: number,y?: number) => add('shape',{x,y,destination:'paper'}),
    addShapeNode: (shapeType: string,x?: number,y?: number) => add('shape',{x,y,shapeType:shapeType as CourseInsertionOptions['shapeType'],destination:'paper'}),
    selectNode: (id: string | null, additive = false) => { const view = kernel.readView(); kernel.selectInstances(id ? additive ? [...new Set([...view.selectedInstanceIds,id])] : [id] : [],view.surfaceId) },
    selectNodes: (ids: string[]) => kernel.selectInstances(ids,kernel.readView().surfaceId),
    deleteNode: (id: string) => commit([{ type:'instance.remove',instanceId:id }]),
    deleteSelectedNodes: () => commit(kernel.readView().selectedInstanceIds.map(id => ({ type:'instance.remove',instanceId:id }))),
    setFlowTextEdit: (edit: FlowTextEditSession | null) => flow.patch({flowTextEdit:edit}),
  }
}

