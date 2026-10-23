import { componentContainers } from '../../shared/contracts/component-platform/project'
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
import { COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT } from '../../shared/ipcTypes'
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
  requestClipboard?(command: 'copy' | 'cut' | 'paste', requestId?: string): Promise<void> | void
  prepareNavigation?(documentId: string): Promise<void>
}
import { prepareCourseObjectPaste, selectedRoots, courseObjectDescendants as descendants, sameContainer, courseObjectRemovalEdits, courseObjectOrderEdits, courseObjectMoveEdits, type CourseObjectClipboardSource } from '../../core/course/courseObjectEdits'
import { courseSettingsEdits } from '../../core/course/courseSemanticEdits'
import { componentDataEdits } from '../../core/course/componentDataEdits'
import { courseGeometryEdits } from '../../core/course/courseGeometryEdits'
import { insertionContainer } from '../../core/course/courseElementInsertion'
import { requestMixedGlobalGeometry } from '../ui/workspaces/mixedGlobalGeometry'
export { prepareCourseObjectPaste, type CourseObjectClipboardSource, type CourseObjectPasteDestination, type CourseObjectPastePlan } from '../../core/course/courseObjectEdits'
export { componentIsLocked } from '../../shared/contracts/component-platform/project'
import { capturedCourseViewIsCurrent } from '../documents/CourseV10DocumentBridge'
import { interactionSelectionIdentity } from '../documents/interactionSelection'
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
  const objectSelection = () => {
    const target = kernel.readView().interactionSelection
    if (target && target.kind !== 'objects') throw new Error('当前选择是内容范围，不能作为独立对象执行此操作；请编辑内容或明确选择包含它的整体。')
  }
  const surface = () => componentContainers(current()).find(value => value.id === kernel.readView().surfaceId)
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
  const write = async (edits: ComponentEdit[], target = kernel.captureTarget(), selectedIds?: readonly string[], readPaths: readonly string[][] = []) => {
    if (!edits.length) return
    await kernel.editCaptured(kernel.capture(edits, target, readPaths))
    if (selectedIds && capturedCourseViewIsCurrent(kernel.readView(), target)) kernel.selectInstances(selectedIds, target.surfaceId, target.documentId)
  }
  const flush = async () => {
    if (await content().commitTextEdit?.() === false) throw new Error('当前编辑未能应用，请完成编辑后重试')
  }
  // A draft ACK may arrive after another document, container or scope was chosen.
  // Navigation consumes that input only while its original editing context is current.
  const navigateCourseView = async (select: (documentId: string) => void | Promise<void>): Promise<boolean> => {
    const before = kernel.readView(), beforeScope = scope(), documentId = before.activeDocumentId
    if (!documentId) return false
    try {
      if (ports.prepareNavigation) await ports.prepareNavigation(documentId)
      else await flush()
      const view = kernel.readView()
      if (view.activeDocumentId !== documentId || view.snapshot?.epoch !== before.snapshot?.epoch
        || view.activation !== before.activation || view.rootInstanceId !== before.rootInstanceId
        || view.editingContainerId !== before.editingContainerId || view.editingPlane !== before.editingPlane
        || view.surfaceId !== before.surfaceId || view.activeStateId !== before.activeStateId || scope() !== beforeScope) return false
      await select(documentId)
      return true
    } catch (error) {
      if (kernel.readView().activeDocumentId === documentId) report(error)
      return false
    }
  }
  const changeCourseDirectory = async (operation: () => Promise<import('../store/slices/courseStructureSlice').CourseStructureResult>) => {
    let result: import('../store/slices/courseStructureSlice').CourseStructureResult = { ok: false, reason: '当前输入尚未保全或编辑位置已切换' }
    await navigateCourseView(async documentId => {
      const target = kernel.captureTarget(documentId)
      result = await operation()
      if (result.ok && result.activatedLocationId && capturedCourseViewIsCurrent(kernel.readView(), target)) {
        kernel.selectSurface(result.activatedLocationId, documentId)
        ports.shell.patch({ editingScope: 'scene' })
      }
    })
    return result
  }
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
    const active = document.activeElement
    if (ports.shell.read().editingTextNodeId || active instanceof HTMLElement && active.closest('input,textarea,[contenteditable="true"],.cm-editor')) {
      if (ports.requestClipboard) await ports.requestClipboard(command)
      else if (!document.execCommand(command)) throw new Error('当前输入区域无法执行系统剪贴板命令')
      return
    }
    objectSelection()
    if (command === 'paste') {
      await flush()
      if (ports.requestClipboard) await ports.requestClipboard(command)
      else if (!document.execCommand(command)) throw new Error('当前环境无法执行系统剪贴板命令，请使用画布快捷键')
      return
    }
    const requested = kernel.captureTarget(), activation = kernel.readView().activation, requestedScope = scope()
    const sameIntent = () => {
      const view = kernel.readView()
      return view.activeDocumentId === requested.documentId && view.snapshot?.epoch === requested.epoch
        && view.activation === activation && view.surfaceId === requested.surfaceId && view.activeStateId === requested.activeStateId
        && (requested.selectionIdentity === undefined || requested.selectionIdentity === interactionSelectionIdentity(view.interactionSelection))
        && scope() === requestedScope && view.selectedInstanceIds.length === requested.instanceIds.length
        && view.selectedInstanceIds.every((id, index) => id === requested.instanceIds[index])
    }
    const requireIntent = () => { if (!sameIntent()) throw new Error('剪贴板命令的文档或选择已改变，已取消操作') }
    await flush()
    requireIntent()
    // Input ACK may update this course. The intent stays bound to the original
    // session and selection; copied content includes the admitted input.
    const target = kernel.captureTarget(requested.documentId)
    const execute = () => {
      requireIntent()
      let seen = false
      const copy = (event: ClipboardEvent) => {
        seen = true
        if (commands.copyCourseClipboard(event.clipboardData, command === 'cut', target)) event.preventDefault()
      }
      window.addEventListener(command, copy, true)
      try {
        if (!document.execCommand(command) || !seen) throw new Error('系统剪贴板命令未完成，请重试')
      } finally { window.removeEventListener(command, copy, true) }
    }
    if (!ports.requestClipboard) { execute(); return }
    const requestId = crypto.randomUUID()
    const dispatch = (event: Event) => {
      const detail = (event as CustomEvent<{ command: string; requestId: string; handled: boolean; ok: boolean; reason: string }>).detail
      if (detail?.requestId !== requestId || detail.command !== command) return
      detail.handled = true
      try { execute(); detail.ok = true }
      catch (error) { detail.reason = error instanceof Error ? error.message : String(error) }
    }
    window.addEventListener(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT, dispatch)
    try { await ports.requestClipboard(command, requestId) }
    finally { window.removeEventListener(COURSE_OBJECT_CLIPBOARD_COMMAND_EVENT, dispatch) }
  })
  const remove = async (ids: readonly string[], target = kernel.captureTarget()) => {
    const roots = selectedRoots(target.project, ids)
    await write(courseObjectRemovalEdits(target.project, roots), target, target.instanceIds.filter(id => !descendants(target.project, roots, false).includes(id)))
  }
  const captureClipboard = (ids: readonly string[], target = kernel.captureTarget()): ObjectClipboard => {
    const project = structuredClone(target.project), roots = selectedRoots(project, ids)
    return { documentId: target.documentId, project, roots, resources: structuredClone(target.resources), matrices: Object.fromEntries(roots.map(id => [id, componentParentMatrix(project, id)])) }
  }
  const paste = async (source: ObjectClipboard, keepOwner: boolean) => {
    if (!source.roots.length) throw new Error('请先复制对象')
    const target = kernel.captureTarget(), project = target.editingProject
    const sourceOwner=owningContainer(source.project,source.roots[0])
    const selectedOwner=target.instanceId?owningContainer(project,target.instanceId):null
    const destination: ComponentContainer = scope()==='global' ? {kind:'global',plane:selectedOwner?.kind==='global'?selectedOwner.plane:sourceOwner?.kind==='global'?sourceOwner.plane:'overlay'} : insertionContainer(target)
    const moving = Boolean(source.moveAvailable)
    if (moving) source.moveAvailable = false
    try {
      // Freeze the destination before the cut ACK; a later tab switch cannot
      // retarget paste. Only the first successful paste restores cut IDs.
      await source.removal
      const { edits, rootIds: selected, diagnostics, readPaths } = prepareCourseObjectPaste(source, { capturedTarget: target, container: destination,
        index: containerChildIds(project, destination).length, offset: { x: 20, y: 20 }, keepOwner, identity: moving ? 'move' : 'copy' })
      await write(edits, { ...target, activeStateId: null, editingProject: target.project }, undefined, readPaths)
      if (capturedCourseViewIsCurrent(kernel.readView(), target)) kernel.selectInstances(selected, target.surfaceId, target.documentId)
      if (diagnostics.length) kernel.setFeedback({ errorMessage: [...new Set(diagnostics.map(item => item.message))].join('\n') })
    } catch (error) { if (moving) source.moveAvailable = true; throw error }
  }
  const layout = async (kind: 'left'|'center'|'right'|'top'|'middle'|'bottom'|'horizontal'|'vertical') => {
    const target = kernel.captureTarget()
    const intent = kind === 'horizontal' || kind === 'vertical' ? { kind: 'distribute' as const, axis: kind } : { kind: 'align' as const, alignment: kind }
    const shown = requestMixedGlobalGeometry({ documentId: target.documentId, surfaceId: target.surfaceId,
      project: target.editingProject, instanceIds: target.instanceIds, intent })
    await write(shown ?? courseGeometryEdits(target.editingProject, target.instanceIds, intent), target)
  }
  const commands = {
    navigateCourseView,
    setCanvasMode(canvasMode: 'edit' | 'run') { run(async () => { await flush(); ports.shell.patch({ canvasMode, editingTextNodeId: null }) }) },
    setEditingScope(editingScope: 'scene' | 'global') { if(surface()?.kind==='spatial' && ports.spatial.setSpatialEditingScope) ports.spatial.setSpatialEditingScope(editingScope==='global'?'global':'world'); else ports.shell.patch({ editingScope }); kernel.selectInstances([]) },
    activateCourseLocation(id: string) { return navigateCourseView(documentId => { kernel.selectSurface(id, documentId); kernel.selectInstances([], id, documentId) }) },
    setActiveScene(id: string) { commands.activateCourseLocation(id) },
    addCourseContent(...args: Parameters<typeof ports.structure.addCourseContent>) { return changeCourseDirectory(() => ports.structure.addCourseContent(...args)) },
    addScene() { return changeCourseDirectory(() => ports.structure.addScene()) },
    duplicateCourseLocation(surfaceId: string) { return changeCourseDirectory(() => ports.structure.duplicateCourseLocation(surfaceId)) },
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
      // Choosing an object ends the old Flow text-range intent, including a range in that same object.
      ports.shell.patch({ flowContextSelection: null })
      const ids = kernel.readView().selectedInstanceIds
      kernel.selectInstances(id === null ? [] : additive ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id])
      if (id) ports.shell.patch({ activeTab: 'properties' })
    },
    selectNodes(ids: string[]) { ports.shell.patch({ flowContextSelection: null }); kernel.selectInstances(ids); if (ids.length) ports.shell.patch({ activeTab: 'properties' }) },
    selectAllNodes() {
      const active = document.activeElement
      if (ports.shell.read().editingTextNodeId || active instanceof HTMLElement && active.closest('input,textarea,[contenteditable="true"],.cm-editor')) {
        if (!document.execCommand('selectAll')) report(new Error('请在当前输入区域使用全选快捷键'))
        return
      }
      const project = current(), view = kernel.readView(), root = view.rootInstanceId ? project.instances[view.rootInstanceId] : undefined
      commands.selectNodes(scope()==='global' ? [...project.global.underlay,...project.global.overlay] : surface()?.childIds ?? root?.childIds ?? (root ? [root.id] : []))
    },
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
    copyCourseClipboard(data: DataTransfer | null, cut = false, target = kernel.captureTarget()): boolean {
      if (!data) return false
      if (kernel.readView().interactionSelection && kernel.readView().interactionSelection?.kind !== 'objects') {
        report(new Error('当前内容不能作为独立对象复制或剪切，请进入文字编辑或明确选择整体。'))
        return true
      }
      const ids = target.instanceIds
      if (!ids.length) return false
      if (cut && ids.some(id => componentIsLocked(target.editingProject, id))) { report(new Error('锁定元素不能剪切')); return true }
      try {
        const copied = captureClipboard(ids, target)
        if (!copied.roots.length) return false
        const token = crypto.randomUUID()
        data.clearData()
        data.setData(COURSE_OBJECT_CLIPBOARD_MIME, token)
        clipboard = copied; clipboardToken = token
        if (cut) {
          copied.moveAvailable = true
          copied.removal = remove(ids, target)
          // ClipboardEvent is synchronous; retain the ACK for paste and report
          // a rejection without leaving an unhandled promise.
          void copied.removal.catch(report)
        }
        return true
      } catch (error) { report(error); return true }
    },
    pasteCourseClipboard(data: DataTransfer | null): boolean {
      if (!data || !clipboard || !clipboardToken || data.getData(COURSE_OBJECT_CLIPBOARD_MIME) !== clipboardToken) return false
      try { objectSelection() } catch (error) { report(error); return true }
      run(() => paste(clipboard!, false))
      return true
    },
    duplicateSelectedNodes() { run(() => { objectSelection(); return paste(captureClipboard(kernel.readView().selectedInstanceIds), true) }) },
    duplicateNode(id: string) { run(() => paste(captureClipboard([id]), true)) },
    deleteNode(id: string) { run(() => remove([id])) }, deleteSelectedNodes() { run(() => { objectSelection(); return remove(kernel.readView().selectedInstanceIds) }) },
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
      const view=kernel.readView(), project=view.editingProject, active=(project == null ? undefined : componentContainers(project).find(value=>value.id===view.surfaceId))
      const rootId = view.rootInstanceId
      if (!project || !active && (!rootId || !project.instances[rootId])) return null
      return { locationId:active?.id ?? rootId!,revision:project.revision,sessionGeneration:view.activation,documentId:view.activeDocumentId ?? undefined,epoch:view.snapshot?.epoch,surfaceId:active?.id,surfaceKind:active?.kind ?? 'program',stateId:view.activeStateId,
        ...(view.interactionSelection && view.interactionSelection.kind !== 'objects' ? { preciseTargetKey: interactionSelectionIdentity(view.interactionSelection) } : {}),
        scope:scope()==='global'?'global':'location', focus:typeof focus==='string'?focus:ports.shell.read().editingTextNodeId?'text':view.selectedInstanceIds.length?'layer':'none', itemIds:[...view.selectedInstanceIds],items:view.selectedInstanceIds.map(itemId=>({itemId,locked:componentIsLocked(project,itemId)})) }
    },
    routeEditorAction(actionId: EditorActionId, snapshot?: EditorSelectionSnapshot | null) {
      const live=commands.createLiveEditorSelectionSnapshot()
      if (!live || (snapshot && (snapshot.documentId!==live.documentId || snapshot.epoch!==live.epoch || snapshot.locationId!==live.locationId || snapshot.revision!==live.revision || snapshot.sessionGeneration!==live.sessionGeneration || snapshot.stateId!==live.stateId || snapshot.preciseTargetKey!==live.preciseTargetKey || snapshot.scope!==live.scope || JSON.stringify(snapshot.itemIds)!==JSON.stringify(live.itemIds)))) return {actionId,ok:false,reason:'选择或文档已改变',adapter:'none' as const}
      if (live.focus==='text') return {actionId,ok:false,reason:'文字编辑中由正文处理此操作',adapter:'none' as const}
      if (live.preciseTargetKey && ['copy','cut','paste','duplicate','delete'].includes(actionId)) return { actionId, ok: false, reason: '当前内容没有独立对象操作，请编辑内容或选择整体', adapter: 'none' as const }
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







