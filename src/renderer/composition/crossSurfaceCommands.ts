import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentPresentation, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { translateFrame, rotateFrame, reparentFrame, transformVector, invertMatrix, composeMatrices, IDENTITY_MATRIX, type AffineMatrix } from '../../core/components/geometry'
import type { EditorCanvasNodePatch } from '../phaser/editorCanvasNode'
import type { TextRun } from '../../shared/contracts/native-v1'
import type { EditorActionId, EditorFocusKind, EditorSelectionSnapshot } from '../course/editorActionTypes'
import type { createCourseLifecycleSlice } from '../store/slices/courseLifecycleSlice'
import type { createCourseStructureSlice } from '../store/slices/courseStructureSlice'
import type { DocumentResources } from '../../shared/workbench/document'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { rebindComponentLibraryImplementation } from '../../core/components/library/rebindSource'
import { componentAssetIds, rebindDeclaredTargets, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from '../../core/components/library/references'
import type { LibraryDiagnostic } from '../../core/components/library/types'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { componentRuleEdits, createComponentInteractionCopyIdentities, interactionBehavior, interactionRules, remapComponentInteractionData } from '../interactions/componentInteractionAuthoring'
import { remapComponentInputData } from '../../components/input/authoring'
import { inputDataSchema } from '../../components/input/data'
import type { InteractionRule } from '../../shared/interactionTypes'
import { componentParentMatrix, equalComponentValue } from '../../core/drivers/courseV10Operations'
export { componentParentMatrix } from '../../core/drivers/courseV10Operations'

/** Surface-owned content commands; generic objects use the common canonical writer below. */
export interface CrossSurfaceContentPorts {
  addTextNode?(x?: number, y?: number): unknown
  addFormulaNode?(x?: number, y?: number): unknown
  addRectangleNode?(x?: number, y?: number): unknown
  addShapeNode?(shape: string, x?: number, y?: number): unknown
  addTableNode?(x?: number, y?: number): unknown
  addChartNode?(chart: 'bar' | 'line' | 'area' | 'pie' | 'donut', x?: number, y?: number): unknown
  beginTextEdit?(id: string, source?: 'canvas' | 'properties'): unknown
  updateTextEditDraft?(id: string, text: string, runs: TextRun[], height?: number, width?: number): unknown
  commitTextEdit?(): unknown
  cancelTextEdit?(): unknown
  ensureTeacherController?(): unknown
  setSpatialEditingScope?(scope: 'global' | 'world' | 'surface'): unknown
  readSpatialView?(): {scope: 'global'|'world'|'surface'}
}
export interface CrossSurfaceCommandPorts {
  kernel: EditorStoreKernel
  slide: CrossSurfaceContentPorts
  flow: CrossSurfaceContentPorts
  spatial: CrossSurfaceContentPorts
  shell: { read(): { canvasMode: 'edit' | 'run'; editingTextNodeId: string | null; editingScope?: 'scene' | 'global' }; patch(patch: Record<string, unknown>): void | Promise<void> }
  structure: ReturnType<typeof createCourseStructureSlice>
  lifecycle: ReturnType<typeof createCourseLifecycleSlice>
  /** Existing desktop editorClipboard bridge; commands and shortcuts share native events. */
  requestClipboard?(command: 'copy' | 'cut' | 'paste'): Promise<void> | void
}
import { prepareCourseObjectPaste, selectedRoots, courseObjectDescendants as descendants, sameContainer, courseObjectRemovalEdits, courseObjectOrderEdits, courseObjectMoveEdits, type CourseObjectClipboardSource } from '../../core/course/courseObjectEdits'
import { courseSettingsEdits } from '../../core/course/courseSemanticEdits'
import { componentDataEdits } from '../../core/course/componentDataEdits'
import { courseGeometryEdits } from '../../core/course/courseGeometryEdits'
export { prepareCourseObjectPaste, type CourseObjectClipboardSource, type CourseObjectPasteDestination, type CourseObjectPastePlan } from '../../core/course/courseObjectEdits'
export { componentIsLocked } from '../../shared/contracts/component-platform/project'
interface ObjectClipboard extends CourseObjectClipboardSource {
  matrices: Record<string, AffineMatrix>
  moveAvailable?: boolean
  removal?: Promise<void>
}
export const COURSE_OBJECT_CLIPBOARD_MIME = 'application/x-guoling-course-objects'
/** Clipboard is transient user input; selection/history remain solely in Bridge/Session. */
export function createCrossSurfaceCommands(ports: CrossSurfaceCommandPorts) {
  const { kernel } = ports
  let clipboard: ObjectClipboard | null = null
  let clipboardToken: string | null = null
  const report = (error: unknown) => kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error), statusMessage: null })
  const current = () => kernel.readEditingDocument()
  const surface = () => current().surfaces.find(value => value.id === kernel.readView().surfaceId)
  const content = () => surface()?.kind === 'flow' ? ports.flow : surface()?.kind === 'spatial' ? ports.spatial : ports.slide
  const scope = () => surface()?.kind==='spatial' && ports.spatial.readSpatialView ? ports.spatial.readSpatialView().scope==='global'?'global':'scene' : ports.shell.read().editingScope??'scene'
  const delegate = <K extends keyof CrossSurfaceContentPorts>(name: K, ...args: Parameters<NonNullable<CrossSurfaceContentPorts[K]>>) => {
    const fn = content()[name]
    if (!fn) { report(new Error('当前表面尚未接入此操作')); return }
    try {
      const result = (fn as (...values: unknown[]) => unknown)(...args)
      void Promise.resolve(result).catch(report)
      return result
    } catch (error) { report(error) }
  }
  const write = async (edits: ComponentEdit[], target = kernel.captureTarget(), selectedIds?: readonly string[]) => {
    if (!edits.length) return
    await kernel.editCaptured(kernel.capture(edits, target))
    if (selectedIds) kernel.selectInstances(selectedIds, target.surfaceId, target.documentId)
  }
  const flush = () => content().commitTextEdit?.()
  const run = (operation: () => Promise<void> | void) => { try { void Promise.resolve(operation()).catch(report) } catch (error) { report(error) } }
  const navigateHistory = async (direction: 'undo' | 'redo'): Promise<boolean> => {
    // Local draft submission can await Main. Retain its document even if the
    // user browses another document while that ACK is pending.
    const documentId = kernel.readView().activeDocumentId
    if (!documentId) { report(new Error('当前会话没有课程工程')); return false }
    try {
      await flush()
      await kernel.bridge[direction](documentId)
      return true
    } catch (error) { report(error); return false }
  }
  const requestClipboard = (command: 'copy' | 'cut' | 'paste') => run(async () => {
    await flush()
    if (ports.requestClipboard) await ports.requestClipboard(command)
    else if (!document.execCommand(command)) throw new Error('当前环境无法执行系统剪贴板命令，请使用画布快捷键')
  })
  const remove = async (ids: readonly string[]) => {
    const target = kernel.captureTarget(), roots = selectedRoots(target.project, ids)
    await write(courseObjectRemovalEdits(target.project, roots), target, target.instanceIds.filter(id => !descendants(target.project, roots, false).includes(id)))
  }
  const captureClipboard = (ids: readonly string[]): ObjectClipboard => {
    const project = structuredClone(kernel.readDocument()), roots = selectedRoots(project, ids)
    return { documentId: kernel.readView().activeDocumentId ?? undefined, project, roots, resources: structuredClone(kernel.readResources()), matrices: Object.fromEntries(roots.map(id => [id, componentParentMatrix(project, id)])) }
  }
  const paste = async (source: ObjectClipboard, keepOwner: boolean) => {
    if (!source.roots.length) throw new Error('请先复制对象')
    const target = kernel.captureTarget(), project = target.editingProject
    const sourceOwner=owningContainer(source.project,source.roots[0])
    const selectedOwner=target.instanceId?owningContainer(project,target.instanceId):null
    const destination: ComponentContainer = scope()==='global' ? {kind:'global',plane:selectedOwner?.kind==='global'?selectedOwner.plane:sourceOwner?.kind==='global'?sourceOwner.plane:'overlay'} : { kind: 'surface', surfaceId: target.surfaceId ?? project.surfaces[0]?.id ?? '' }
    const moving = Boolean(source.moveAvailable)
    if (moving) source.moveAvailable = false
    try {
      // Freeze the destination before the cut ACK; a later tab switch cannot
      // retarget paste. Only the first successful paste restores cut IDs.
      await source.removal
      const { edits, rootIds: selected, diagnostics } = prepareCourseObjectPaste(source, { capturedTarget: target, container: destination,
        index: containerChildIds(project, destination).length, offset: { x: 20, y: 20 }, keepOwner, identity: moving ? 'move' : 'copy' })
      await write(edits, { ...target, activeStateId: null, editingProject: target.project }, selected)
      if (diagnostics.length) kernel.setFeedback({ errorMessage: [...new Set(diagnostics.map(item => item.message))].join('\n') })
    } catch (error) { if (moving) source.moveAvailable = true; throw error }
  }
  const layout = async (kind: 'left'|'center'|'right'|'top'|'middle'|'bottom'|'horizontal'|'vertical') => {
    const target = kernel.captureTarget()
    await write(courseGeometryEdits(target.editingProject, target.instanceIds, kind === 'horizontal' || kind === 'vertical'
      ? { kind: 'distribute', axis: kind } : { kind: 'align', alignment: kind }), target)
  }
  const commands = {
    setCanvasMode(canvasMode: 'edit' | 'run') { run(async () => { await flush(); ports.shell.patch({ canvasMode, editingTextNodeId: null }) }) },
    setEditingScope(editingScope: 'scene' | 'global') { if(surface()?.kind==='spatial' && ports.spatial.setSpatialEditingScope) ports.spatial.setSpatialEditingScope(editingScope==='global'?'global':'world'); else ports.shell.patch({ editingScope }); kernel.selectInstances([]) },
    activateCourseLocation(id: string) { run(async () => { await flush(); kernel.selectSurface(id); kernel.selectInstances([], id) }) },
    setActiveScene(id: string) { commands.activateCourseLocation(id) },
    async addCourseContent(...args: Parameters<typeof ports.structure.addCourseContent>) { const result = await ports.structure.addCourseContent(...args); if (result.ok && result.activatedLocationId) kernel.selectSurface(result.activatedLocationId); return result },
    async addScene() { const result = await ports.structure.addScene(); if (result.ok && result.activatedLocationId) kernel.selectSurface(result.activatedLocationId); return result },
    reorderCourseSurfaces(ids: string[]) { return ports.structure.reorderCourseSurfaces(ids) },
    deleteCourseSurface(...args: Parameters<typeof ports.structure.deleteCourseSurface>) { return ports.structure.deleteCourseSurface(...args) },

    deleteScene(id: string) { return ports.structure.deleteCourseSurface(id) },
    undo() { return navigateHistory('undo') },
    redo() { return navigateHistory('redo') },
    setEditingTextNode(id: string | null) { ports.shell.patch({ editingTextNodeId: id }) },
    beginTextEdit(id: string, source: 'canvas' | 'properties' = 'canvas') { delegate('beginTextEdit', id, source) },
    updateTextEditDraft(id: string, text: string, runs: TextRun[], height?: number, width?: number) { delegate('updateTextEditDraft', id, text, runs, height, width) },
    async commitTextEdit() { await flush() }, cancelTextEdit() { return delegate('cancelTextEdit') },
    renameProject(title: string) { run(() => kernel.edit(courseSettingsEdits(kernel.readDocument(), { title })).then(() => {})) },
    addTextNode(x?: number, y?: number) { return delegate('addTextNode', x, y) },
    addFormulaNode(x?: number, y?: number) { return delegate('addFormulaNode', x, y) },
    addRectangleNode(x?: number, y?: number) { return delegate('addRectangleNode', x, y) },
    addShapeNode(shape: string, x?: number, y?: number) { return delegate('addShapeNode', shape, x, y) },
    addTableNode(x?: number, y?: number) { return delegate('addTableNode', x, y) },
    addChartNode(chart: 'bar' | 'line' | 'area' | 'pie' | 'donut', x?: number, y?: number) { return delegate('addChartNode', chart, x, y) },
    ensureTeacherController() { return delegate('ensureTeacherController') },
    selectNode(id: string | null, additive = false) {
      const ids = kernel.readView().selectedInstanceIds
      kernel.selectInstances(id === null ? [] : additive ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id])
      if (id) ports.shell.patch({ activeTab: 'properties' })
    },
    selectNodes(ids: string[]) { kernel.selectInstances(ids); if (ids.length) ports.shell.patch({ activeTab: 'properties' }) },
    selectAllNodes() { commands.selectNodes(scope()==='global'?[...current().global.underlay,...current().global.overlay]:surface()?.childIds??[]) },
    updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>) { run(async () => {
      const target = kernel.captureTarget(), edits: ComponentEdit[] = []
      for (const { nodeId, patch } of patches) {
        const item = target.editingProject.instances[nodeId]
        if (!item) throw new Error('对象已不存在')
        const statePatch = { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.visible !== undefined ? { visible: patch.visible } : {}), ...(patch.locked !== undefined ? { locked: patch.locked } : {}) }
        if (Object.keys(statePatch).length) edits.push({ type: 'instance.patch', instanceId: nodeId, patch: statePatch })
        const geometry = patch.frame !== undefined || ['x','y','width','height','rotation'].some(key => patch[key] !== undefined)
        if (geometry && componentIsLocked(target.editingProject,nodeId)) continue
        if (geometry && (item.frame || patch.frame)) {
          let frame = structuredClone(((patch.frame as ComponentFrame | undefined) ?? item.frame)!)
          if (patch.x !== undefined || patch.y !== undefined) frame = translateFrame(frame, { x: (patch.x ?? frame.transform[4]) - frame.transform[4], y: (patch.y ?? frame.transform[5]) - frame.transform[5] }) as ComponentFrame
          if (patch.width !== undefined) frame.width = patch.width
          if (patch.height !== undefined) frame.height = patch.height
          if (patch.rotation !== undefined) frame = rotateFrame(frame, (patch.rotation - Math.atan2(frame.transform[1], frame.transform[0]) * 180 / Math.PI) * Math.PI / 180, { x: 0, y: 0 }) as ComponentFrame
          edits.push({ type: 'frame.set', instanceId: nodeId, frame })
        }
        if (componentIsLocked(target.editingProject,nodeId)) continue
        if (patch.data !== undefined) edits.push(...componentDataEdits(target.project, { surfaceId: target.surfaceId, instanceId: nodeId, stateId: target.activeStateId }, { kind: 'replace', data: structuredClone(patch.data) as JsonValue }))
        if (patch.opacity !== undefined) edits.push({ type: 'style.set', instanceId: nodeId, path: ['opacity'], value: patch.opacity })
        if (patch.style && typeof patch.style === 'object') for (const [key,value] of Object.entries(patch.style)) edits.push({ type: 'style.set', instanceId: nodeId, path: [key], value: value as JsonValue })
      }
      await write(edits, target)
    }) },
    updateNode(nodeId: string, patch: EditorCanvasNodePatch) { commands.updateNodes([{ nodeId, patch }]) },
    nudgeSelection(dx: number, dy: number) { run(async () => {
      const target = kernel.captureTarget()
      await write(selectedRoots(target.editingProject, target.instanceIds).filter(id => !componentIsLocked(target.editingProject,id) && target.editingProject.instances[id].frame).map(instanceId => {
        const delta = transformVector(invertMatrix(componentParentMatrix(target.editingProject, instanceId)), { x: dx, y: dy })
        return { type: 'frame.set', instanceId, frame: translateFrame(target.editingProject.instances[instanceId].frame!, delta) as ComponentFrame }
      }), target)
    }) },
    alignSelectedNodes(mode: 'left'|'center'|'right'|'top'|'middle'|'bottom') { run(() => layout(mode)) },
    distributeSelectedNodes(direction: 'horizontal'|'vertical') { run(() => layout(direction)) },
    copySelectedNodes() { requestClipboard('copy') },
    cutSelectedNodes() { requestClipboard('cut') },
    pasteNodes() { requestClipboard('paste') },
    copyCourseClipboard(data: DataTransfer | null, cut = false): boolean {
      if (!data) return false
      const ids = kernel.readView().selectedInstanceIds
      if (!ids.length) return false
      if (cut && ids.some(id => componentIsLocked(current(), id))) { report(new Error('锁定元素不能剪切')); return true }
      try {
        const copied = captureClipboard(ids)
        if (!copied.roots.length) return false
        const token = crypto.randomUUID()
        data.clearData()
        data.setData(COURSE_OBJECT_CLIPBOARD_MIME, token)
        clipboard = copied; clipboardToken = token
        if (cut) {
          copied.moveAvailable = true
          copied.removal = remove(ids)
          // ClipboardEvent is synchronous; retain the ACK for paste and report
          // a rejection without leaving an unhandled promise.
          void copied.removal.catch(report)
        }
        return true
      } catch (error) { report(error); return true }
    },
    pasteCourseClipboard(data: DataTransfer | null): boolean {
      if (!data || !clipboard || !clipboardToken || data.getData(COURSE_OBJECT_CLIPBOARD_MIME) !== clipboardToken) return false
      run(() => paste(clipboard!, false))
      return true
    },
    duplicateSelectedNodes() { run(() => paste(captureClipboard(kernel.readView().selectedInstanceIds), true)) },
    duplicateNode(id: string) { run(() => paste(captureClipboard([id]), true)) },
    deleteNode(id: string) { run(() => remove([id])) }, deleteSelectedNodes() { run(() => remove(kernel.readView().selectedInstanceIds)) },
    reorderNodes(ids: string[]) { run(async () => {
      const target = kernel.captureTarget()
      await write(courseObjectOrderEdits(target.editingProject, ids), target)
    }) },
    moveCandidateLayerOwner(id: string, targetId: string) { run(async () => {
      const target = kernel.captureTarget(), owner = owningContainer(target.project,targetId)
      if (!owner) throw new Error('目标图层已不存在')
      const reparent = !sameContainer(owningContainer(target.project, id), owner), project = reparent ? target.project : target.editingProject
      await write(courseObjectMoveEdits(project, id, owner, containerChildIds(project, owner).indexOf(targetId)),
        reparent ? { ...target, activeStateId: null, editingProject: target.project } : target)
    }) },
    createLiveEditorSelectionSnapshot(focus?: EditorFocusKind | EventTarget | null): EditorSelectionSnapshot | null {
      const view=kernel.readView(), project=view.editingProject, active=project?.surfaces.find(value=>value.id===view.surfaceId)
      if (!project || !active) return null
      return { locationId:active.id,revision:project.revision,sessionGeneration:view.activation,documentId:view.activeDocumentId ?? undefined,epoch:view.snapshot?.epoch,surfaceId:active.id,surfaceKind:active.kind,stateId:view.activeStateId,scope:scope()==='global'?'global':'location', focus:typeof focus==='string'?focus:ports.shell.read().editingTextNodeId?'text':view.selectedInstanceIds.length?'layer':'none', itemIds:[...view.selectedInstanceIds],items:view.selectedInstanceIds.map(itemId=>({itemId,locked:componentIsLocked(project,itemId)})) }
    },
    routeEditorAction(actionId: EditorActionId, snapshot?: EditorSelectionSnapshot | null) {
      const live=commands.createLiveEditorSelectionSnapshot()
      if (!live || (snapshot && (snapshot.documentId!==live.documentId || snapshot.epoch!==live.epoch || snapshot.locationId!==live.locationId || snapshot.revision!==live.revision || snapshot.sessionGeneration!==live.sessionGeneration || snapshot.stateId!==live.stateId || snapshot.scope!==live.scope || JSON.stringify(snapshot.itemIds)!==JSON.stringify(live.itemIds)))) return {actionId,ok:false,reason:'选择或文档已改变',adapter:'none' as const}
      if (live.focus==='text') return {actionId,ok:false,reason:'文字编辑中由正文处理此操作',adapter:'none' as const}
      if (['cut','delete'].includes(actionId) && live.items?.some(item=>item.locked)) return {actionId,ok:false,reason:'锁定元素不能删除，请先解锁',adapter:'none' as const}
      switch(actionId) {
        case 'select-all': commands.selectAllNodes();break
        case 'copy':commands.copySelectedNodes();break
        case 'cut':commands.cutSelectedNodes();break
        case 'paste':commands.pasteNodes();break
        case 'duplicate':commands.duplicateSelectedNodes();break
        case 'delete':commands.deleteSelectedNodes();break
        case 'undo':commands.undo();break
        case 'redo':commands.redo();break
      }
      return {actionId,ok:true,reason:'已受理编辑操作',adapter:live.surfaceKind}
    },
    prepareCourseProjectPersistence() { return ports.lifecycle.prepareCourseProjectPersistence() },
    captureCourseProjectRecoverySnapshot() { return ports.lifecycle.captureCourseProjectRecoverySnapshot() },
    acknowledgeCourseProjectSaved(path: string, token: Parameters<typeof ports.lifecycle.acknowledgeCourseProjectSaved>[1]) { return ports.lifecycle.acknowledgeCourseProjectSaved(path, token) },
  }
  return commands
}
export type CrossSurfaceCommands = ReturnType<typeof createCrossSurfaceCommands>







