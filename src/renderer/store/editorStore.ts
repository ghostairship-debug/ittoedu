import { componentSurface, componentContainers, componentSurfaces } from '../../shared/contracts/component-platform/project'
import { create } from 'zustand'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'
import type { DocumentResources, DocumentSnapshot } from '../../shared/workbench/document'
import { CourseV10DocumentBridge, type CourseV10ViewState, type CourseDocumentActivationResult } from '../documents/CourseV10DocumentBridge'
import { createEditorStoreKernel, type EditorStoreKernel } from './editorStoreKernel'
import { createEditorShellSlice, type EditorShellOwnedState, type EditingScope } from './slices/editorShellSlice'
import { createCourseLifecycleSlice, createCourseProjectContent, type CourseLifecycleOwnedState } from './slices/courseLifecycleSlice'
import { createCourseStructureSlice } from './slices/courseStructureSlice'
import { createSlideAuthoringSlice, createInitialSlideOwnedState, hasSlideContentDraftChanges, slideContentEditInScope, type SlideOwnedState } from './slices/slideAuthoringSlice'
import { createFlowAuthoringSlice, createInitialFlowOwnedState, type FlowOwnedState } from './slices/flowAuthoringSlice'
import { createSpatialAuthoringSlice, createInitialSpatialOwnedState, type SpatialOwnedState } from './slices/spatialAuthoringSlice'
import { createDesignProductionActions } from '../composition/designProductionActions'
import { createCrossSurfaceCommands } from '../composition/crossSurfaceCommands'
import { discardPropertiesDrafts, flushPropertiesDrafts, hasPropertiesDrafts, subscribePropertiesDrafts, preservePropertiesDrafts, restorePropertiesDrafts, suspendPropertiesDrafts, resumePropertiesDrafts } from '../ui/properties/PropertyControls'
import { courseDraftLifecycle, createCourseInputLifecycle, type CourseInputRecoveryAdapter } from '../authoring/courseDraftLifecycle'

export type { SidebarTab, EditingScope, CanvasMode, TextEditSource } from './slices/editorShellSlice'
export type { AlignmentMode } from './slices/slideOwnedCommands'
export type {
  CourseProjectPersistenceSnapshot, CourseProjectPersistenceToken,
  PrepareCourseProjectPersistenceResult, CaptureCourseProjectRecoveryResult,
} from './slices/courseLifecycleSlice'
export type SpatialGraphSelection = { readonly kind: 'path' | 'relation'; readonly id: string }

export interface EditorRootOwnedState {
  readonly courseView: CourseV10ViewState
  readonly courseBridge: CourseV10DocumentBridge
  readonly courseKernel: EditorStoreKernel
  readonly courseInputs: ReturnType<typeof createCourseInputLifecycle>
  /** Notification of local input owners; content and History remain in DocumentSession. */
  readonly localDraftVersion: number
}
export type EditorOwnedState = EditorRootOwnedState & EditorShellOwnedState & CourseLifecycleOwnedState
  & SlideOwnedState & FlowOwnedState & SpatialOwnedState
/** Match the actual object spread order, including shared actions overriding surface helpers. */
type ComposedActions<Slices extends readonly object[]> = Slices extends readonly [infer First extends object, ...infer Rest extends readonly object[]]
  ? Omit<First, keyof ComposedActions<Rest>> & ComposedActions<Rest> : {}
export type EditorState = EditorOwnedState
  & ComposedActions<[
    ReturnType<typeof createEditorShellSlice>, ReturnType<typeof createCourseLifecycleSlice>,
    ReturnType<typeof createCourseStructureSlice>, ReturnType<typeof createSlideAuthoringSlice>,
    ReturnType<typeof createFlowAuthoringSlice>, ReturnType<typeof createSpatialAuthoringSlice>,
    ReturnType<typeof createCrossSurfaceCommands>, ReturnType<typeof createDesignProductionActions>,
  ]>
  & {
    connectCourseDocuments(api: DocumentHostAPI, recovery?: CourseInputRecoveryAdapter): Promise<void>
    activateCourseDocument(documentId: string, activateIf?: () => boolean): Promise<boolean>
    closeCourseDocument(documentId: string): Promise<boolean>
    retainTextEdit(): Promise<boolean>
    createCourseDocument(kind: ComponentSurface['kind'], canvas?: { width: number; height: number }, activateIf?: () => boolean): Promise<void | boolean | CourseDocumentActivationResult>
    createCourseDocumentFrom(project: CourseProjectV10, resources?: DocumentResources, activateIf?: () => boolean): Promise<void | boolean | CourseDocumentActivationResult>
    openCourseDocument(path: string, activateIf?: () => boolean): Promise<void | boolean | CourseDocumentActivationResult>
    drainCourseDocument(documentId?: string): Promise<DocumentSnapshot>
    drainAllCourseDocuments(documentIds?: readonly string[]): Promise<DocumentSnapshot[]>
    flushAllCourseDocuments(documentIds?: readonly string[]): Promise<void>
    undoLatestAgentCourseDocument(): Promise<boolean>
    saveCourseDocument(saveAs?: boolean, directory?: SaveDirectoryContext, documentId?: string): Promise<DocumentSnapshot | null>
    restoreCourseDocument(documentId: string): Promise<void>
    listCourseRecovery(): Promise<DocumentSnapshot[]>
    discardCourseRecovery(documentId: string): Promise<void>
    editComponents(edits: ComponentEdit[], historyGroup?: string, documentId?: string): ReturnType<CourseV10DocumentBridge['edit']>
  }

/** A view subscription only. The Bridge owns selection; Main DocumentSession owns content/history. */
export const useEditorStore = create<EditorState>((set, get) => {
  const courseBridge = new CourseV10DocumentBridge()
  const advancedDrafts = courseDraftLifecycle(courseBridge)
  let projectionFeedback: string | null = null, observedProjectionError: string | null = null
  const patch = (value: Partial<EditorState>) => {
    if (Object.hasOwn(value, 'errorMessage')) projectionFeedback = null
    set(value)
  }
  const notifyLocalDrafts = () => patch({ localDraftVersion: (get().localDraftVersion ?? 0) + 1 })
  advancedDrafts.subscribe(notifyLocalDrafts)
  subscribePropertiesDrafts(notifyLocalDrafts)
  const courseKernel = createEditorStoreKernel({ bridge: courseBridge, commit: patch })
  const shellPorts = { read: get, patch }
  const editorShellSlice = createEditorShellSlice(courseKernel, shellPorts)
  const lifecycle = createCourseLifecycleSlice(courseKernel, { bridge: courseBridge, read: get, patch })
  const structure = createCourseStructureSlice(courseKernel, { readActiveLocationId: () => courseBridge.read().surfaceId })
  const contentPorts = { read: get, patch, readEditingScope: () => selectEditingScope(get()) }
  const slide = createSlideAuthoringSlice(courseKernel, contentPorts)
  const flow = createFlowAuthoringSlice(courseKernel, { ...contentPorts,
    content: { begin: slide.beginSlideDataEdit, commit: slide.commitSlideContentEdit, cancel: slide.cancelTextEdit } })
  const spatial = createSpatialAuthoringSlice(courseKernel, { read: get, patch, openPropertiesTab: () => patch({ activeTab: 'properties' }),
    content: { begin: slide.beginSlideDataEdit, commit: slide.commitSlideContentEdit, cancel: slide.cancelTextEdit } })
  const commands = createCrossSurfaceCommands({ kernel: courseKernel, shell: shellPorts, slide, flow, spatial: { ...slide, ...spatial }, structure, lifecycle,
    prepareNavigation: async documentId => {
      await retainBeforeNavigation(documentId)
    },
    requestClipboard: async (command, requestId) => {
      const clipboard = window.desktopAPI?.editorClipboard
      if (!clipboard) throw new Error('当前环境无法使用系统剪贴板')
      await clipboard(requestId && command !== 'paste' ? { command, requestId } : command)
    },
  })
  const design = createDesignProductionActions({ kernel: courseKernel, hasContentDraft: () => selectHasDirtyCourseContentDraft(get()) })
  courseBridge.subscribe(() => {
    const view = courseBridge.read()
    const closed = get().courseView.documents.filter(old => !view.documents.some(value => value.documentId === old.documentId))
    const drafts = { ...get().flowDocumentDrafts }
    for (const snapshot of closed) {
      advancedDrafts.release(snapshot.documentId); discardPropertiesDrafts(snapshot.documentId)
      delete drafts[snapshot.documentId]
    }
    const activeFlowDraft = drafts[view.activeDocumentId ?? '']
    const errorIdentity = view.error ? JSON.stringify([view.activeDocumentId, view.snapshot?.epoch, view.error]) : null
    const feedback: Partial<EditorState> = {}
    if (errorIdentity !== observedProjectionError) {
      if (view.error) { feedback.errorMessage = view.error; projectionFeedback = view.error }
      else { if (projectionFeedback && get().errorMessage === projectionFeedback) feedback.errorMessage = null; projectionFeedback = null }
      observedProjectionError = errorIdentity
    }
    set({ flowDocumentDrafts: drafts, flowDocumentDraft: activeFlowDraft?.surfaceId === view.surfaceId ? activeFlowDraft : null,
      ...(closed.some(value => value.documentId === get().slideContentEdit?.target.documentId) ? { slideContentEdit: null } : {}),
      ...(view.activeDocumentId !== get().courseView.activeDocumentId ? { flowContextSelection: null } : {}), courseView: view, dirty: Boolean(view.snapshot?.dirty || view.pending),
      projectPath: view.snapshot?.binding.kind === 'file' ? view.snapshot.binding.path : null,
      ...feedback })
  })
  const flushDrafts = async (documentId: string, mode: 'save' | 'preserve' = 'save') => {
    const issues: string[] = []
    const advanced = await advancedDrafts.prepare(documentId, mode === 'preserve' ? 'preserve' : 'apply')
    if (!advanced.ready) issues.push(...advanced.issues.map(issue => issue.message))
    if (!await flushPropertiesDrafts(documentId, mode === 'preserve' ? 'preserve' : 'apply')) issues.push('属性编辑尚未完成，当前输入已保留')
    const slideResult = await slide.commitDraftForPersistence(documentId, mode)
    if (!slideResult.ok) issues.push(slideResult.reason)
    const flowResult = await flow.commitDraftForPersistence(documentId, mode)
    if (!flowResult.ok) issues.push(flowResult.reason)
    if (issues.length) throw new Error(issues.join('；'))
  }
  const retainBeforeNavigation = async (documentId: string) => {
    const draft = get().flowDocumentDrafts?.[documentId], content = get().slideContentEdit
    if (draft?.composing || content?.target.documentId === documentId && content.composing)
      throw new Error('请先完成正在输入的文字')
    if (draft?.preparedResources?.length) throw new Error('这份正文还有尚未接入工程的素材，请先完成或撤销该次粘贴；原稿仍保留')
    if (!await courseInputs.prepare([documentId])) throw new Error(`当前编辑未能应用，${get().errorMessage ?? '当前输入尚未保全，已保留原文档'}`)
    slide.parkSlideContentEdit(documentId)
    flow.parkFlowDocumentDraft(documentId)
  }
  const flushDocumentDrafts = async (documentIds?: readonly string[]) => {
    const targets = documentIds ?? courseBridge.read().documents.map(snapshot => snapshot.documentId)
    for (const id of targets) { await courseInputs.restore(id); await flushDrafts(id) }
    return targets
  }
  const drainActive = async (documentId?: string, mode: 'save' | 'preserve' = 'save'): Promise<DocumentSnapshot> => {
    const id = documentId ?? courseBridge.read().activeDocumentId
    if (!id) throw new Error('当前没有已打开的课件')
    await courseInputs.restore(id)
    await flushDrafts(id, mode)
    const [snapshot] = await courseBridge.drain([id])
    if (!snapshot) throw new Error('课件文档已关闭')
    return snapshot
  }
  const courseInputs = createCourseInputLifecycle(courseBridge, {
    capture(documentId) {
      const snapshot = courseBridge.read().documents.find(value => value.documentId === documentId)
      if (!snapshot) throw new Error('保全输入时文档已关闭')
      return { snapshot, records: { advanced: advancedDrafts.preserve(documentId), properties: preservePropertiesDrafts(documentId) },
        flowDraft: get().flowDocumentDrafts?.[documentId] }
    },
    drain: drainActive,
    restore(documentId, epoch, records) {
      const result = advancedDrafts.restore(documentId, records.advanced)
      const properties = restorePropertiesDrafts(documentId, records.properties, epoch)
      if (result.issues.length) get().setStatus('有上次未应用的输入已保留，当前内容可继续编辑。')
      else if (properties.ambiguous) get().setStatus('属性恢复稿已保留，当前内容可继续编辑。')
      return { advanced: result.adopted, properties: properties.adopted }
    },
    suspend(ids) { courseBridge.suspendForClose(ids); suspendPropertiesDrafts(ids) },
    resume(ids) { courseBridge.resumeAfterCloseCancelled(ids); resumePropertiesDrafts(ids) },
    error: message => get().setError(message), status: message => get().setStatus(message),
  })
  return {
    ...createInitialSlideOwnedState(), ...createInitialFlowOwnedState(), ...createInitialSpatialOwnedState(),
    activeTab: 'elements', canvasMode: 'edit', editingScope: 'scene', statusMessage: null, errorMessage: null,
    editingTextNodeId: null, slideDrawTool: null, previewBackgroundColor: null,
    projectPath: null, dirty: false,
    courseView: courseBridge.read(), courseBridge, courseKernel, courseInputs, localDraftVersion: 0,
    ...editorShellSlice, ...lifecycle, ...structure, ...slide, ...flow, ...spatial, ...commands, ...design,
    connectCourseDocuments: (api, recovery) => courseBridge.connect(api, () => courseInputs.connect(api, recovery)),
    async retainTextEdit() {
      const edit = get().slideContentEdit
      if (!edit) return true
      try { await retainBeforeNavigation(edit.target.documentId); return true }
      catch (error) { get().setStatus(error instanceof Error ? error.message : String(error)); return false }
    },
    async activateCourseDocument(id, activateIf) {
      const current = courseBridge.read().activeDocumentId; if (current && current !== id) await retainBeforeNavigation(current)
      if (activateIf && !activateIf()) return false
      return await courseBridge.activate(id, activateIf)
    },
    async closeCourseDocument(id) {
      if (!await courseBridge.close(id)) return false
      advancedDrafts.release(id); discardPropertiesDrafts(id)
      const drafts = { ...get().flowDocumentDrafts }; delete drafts[id]
      patch({ flowDocumentDrafts: drafts, ...(get().slideContentEdit?.target.documentId === id ? { slideContentEdit: null } : {}) })
      return true
    },
    async openCourseDocument(path, activateIf) {
      const current = courseBridge.read().activeDocumentId; if (current) await retainBeforeNavigation(current)
      if (activateIf && !activateIf()) return false
      return await courseBridge.open(path, activateIf)
    },
    async createCourseDocument(kind, canvas, activateIf) {
      const current = courseBridge.read().activeDocumentId; if (current) await retainBeforeNavigation(current)
      if (activateIf && !activateIf()) return false
      return await courseBridge.create({ kind: 'course-v10', ...createCourseProjectContent(kind, canvas) }, activateIf)
    },
    async createCourseDocumentFrom(project, resources = { assets: {}, components: {} }, activateIf) {
      const current = courseBridge.read().activeDocumentId; if (current) await retainBeforeNavigation(current)
      if (activateIf && !activateIf()) return false
      return await courseBridge.create({ kind: 'course-v10', project, resources }, activateIf)
    },
    drainCourseDocument: drainActive,
    async drainAllCourseDocuments(ids) {
      const targets = await flushDocumentDrafts(ids)
      return courseBridge.drain(targets)
    },
    async flushAllCourseDocuments(ids) { await courseBridge.flushInput(await flushDocumentDrafts(ids)) },
    async undoLatestAgentCourseDocument() {
      const target = courseBridge.captureLatestAgentUndoTarget()
      if (!target) return false
      await drainActive(target.documentId)
      return courseBridge.undoLatestAgent(target)
    },
    async saveCourseDocument(saveAs, directory, documentId) {
      const id = documentId ?? courseBridge.read().activeDocumentId
      if (!id) return null
      await courseInputs.restore(id)
      const draft = get().flowDocumentDrafts?.[id], edit = get().slideContentEdit
      if (draft?.composing || edit?.target.documentId === id && edit.composing) throw new Error('请先完成正在输入的文字')
      if (draft?.preparedResources?.length) throw new Error('这份正文还有尚未接入工程的素材，请先完成或撤销该次粘贴；原稿仍保留')
      // This ACK includes current raw input as well as canonical changes; retained raw is not a failed file save.
      if (!await courseInputs.prepare([id], 'preserve')) return null
      if (!await courseBridge.save(saveAs, directory, id)) return null
      if (advancedDrafts.hasDirty(id) || hasPropertiesDrafts(id) || get().flowDocumentDrafts?.[id])
        get().setStatus('当前工程内容已保存，另有尚未应用的原稿已保留。')
      return (await courseBridge.drain([id]))[0] ?? null
    },
    restoreCourseDocument: id => courseBridge.restore(id),
    listCourseRecovery: () => courseBridge.recoverable(),
    discardCourseRecovery: id => courseBridge.discardRecovery(id),
    editComponents: (edits, historyGroup, documentId) => courseBridge.edit(edits, historyGroup, documentId),
  }
})

const EMPTY_IDS: readonly string[] = Object.freeze([])
const EMPTY_ASSETS = Object.freeze({})
const EMPTY_FILES: Record<string, Uint8Array> = Object.freeze({})
const EMPTY_RESOURCES: DocumentResources = { assets: EMPTY_FILES, components: Object.freeze({}) }
export const selectCourseView = (state: EditorState) => state.courseView
export const selectActiveSlideContentEdit = (state: EditorState) => slideContentEditInScope(state.slideContentEdit, {
  documentId: state.courseView.activeDocumentId, epoch: state.courseView.snapshot?.epoch,
  surfaceId: state.courseView.surfaceId, activeStateId: state.courseView.activeStateId,
})
export const selectActiveCourseProjectDocument = (state: EditorState) => state.courseView.project
export const selectActiveCourseLocationId = (state: EditorState) => state.courseView.surfaceId
export const selectActiveSceneId = (state: EditorState) => state.courseView.surfaceId ?? ''
let activeSceneProject: CourseProjectV10 | null = null
let activeSceneId: string | null = null
let activeSceneView: Readonly<ComponentSurface> | null = null
export const selectActiveScene = (state: EditorState) => {
  const project = state.courseView.project, id = state.courseView.surfaceId
  if (project !== activeSceneProject || id !== activeSceneId) {
    activeSceneProject = project; activeSceneId = id
    activeSceneView = project && id ? componentSurface(project, id) ?? null : null
  }
  return activeSceneView
}
let slideSceneProject: CourseProjectV10 | null = null
let slideSceneList: ComponentSurface[] = []
export const selectSlideSceneList = (state: EditorState): ComponentSurface[] => {
  const project = state.courseView.project
  if (project !== slideSceneProject) {
    slideSceneProject = project
    slideSceneList = (project == null ? undefined : componentSurfaces(project).filter(surface => surface.kind === 'slide')) ?? []
  }
  return slideSceneList
}
export const selectSelectedNodeIds = (state: EditorState): readonly string[] => state.courseView.selectedInstanceIds ?? EMPTY_IDS
export const selectSelectedNodeId = (state: EditorState) => state.courseView.selectedInstanceId
export const selectSelectedNode = (state: EditorState): ComponentInstance | null => {
  const id = state.courseView.selectedInstanceId
  return id ? state.courseView.editingProject?.instances[id] ?? null : null
}
export const selectSelectedNodes = (state: EditorState): ComponentInstance[] => {
  const project = state.courseView.editingProject
  return project ? state.courseView.selectedInstanceIds.flatMap(id => project.instances[id] ? [project.instances[id]!] : []) : []
}
export const selectEditingNodes = (state: EditorState): ComponentInstance[] => {
  const project = state.courseView.editingProject, surface = (project == null ? undefined : componentContainers(project).find(value => value.id === state.courseView.surfaceId))
  if (!project) return []
  const root = state.courseView.rootInstanceId ? project.instances[state.courseView.rootInstanceId] : undefined
  return (surface?.childIds ?? root?.childIds ?? (root ? [root.id] : [])).flatMap(id => project.instances[id] ? [project.instances[id]!] : [])
}
export const selectEditingScope = (state: EditorState): EditingScope => {
  const surface = selectActiveScene(state)
  if (surface?.kind === 'spatial') return state.readSpatialView().scope === 'global' ? 'global' : 'scene'
  return state.editingScope
}
export const selectCanUndoActiveSurface = (state: EditorState) => Boolean(state.courseView.snapshot?.undoDepth && !state.courseView.error)
export const selectCanRedoActiveSurface = (state: EditorState) => Boolean(state.courseView.snapshot?.redoDepth && !state.courseView.error)
export const selectHasDirtyCourseContentDraft = (state: EditorState) => state.courseView.pending > 0 || Boolean(state.flowDocumentDraft)
  || Boolean(state.slideContentEdit && hasSlideContentDraftChanges(state.slideContentEdit))
  || Boolean(state.courseView.activeDocumentId && (courseDraftLifecycle(state.courseBridge).hasDirty(state.courseView.activeDocumentId)
    || hasPropertiesDrafts(state.courseView.activeDocumentId)))
export const selectHasUnsavedCourseChanges = (state: EditorState) => Boolean(state.courseView.snapshot?.dirty || selectHasDirtyCourseContentDraft(state))
/** Window close must also preserve unfinished input in an inactive document. */
export const selectHasUnsavedCourseDocuments = (state: EditorState) => selectHasUnsavedCourseChanges(state)
  || state.courseView.documents.some(document => document.dirty)
  || Object.values(state.flowDocumentDrafts ?? {}).some(Boolean)
  || state.courseView.documents.some(document => courseDraftLifecycle(state.courseBridge).hasDirty(document.documentId)
    || hasPropertiesDrafts(document.documentId))
export const selectActiveCourseResources = (state: EditorState): DocumentResources => {
  const view = state.courseView
  return view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources ?? EMPTY_RESOURCES
}
export const selectMediaAssets = (state: EditorState) => state.courseView.project?.assets ?? EMPTY_ASSETS
export const selectMediaAssetFiles = (state: EditorState): Record<string, Uint8Array> => {
  const view = state.courseView
  return view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources.assets ?? EMPTY_FILES
}
export const selectCandidateGlobalLayerItems = (state: EditorState) => state.courseView.project?.global ?? null
