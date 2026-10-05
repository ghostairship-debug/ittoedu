import { create } from 'zustand'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'
import type { DocumentResources, DocumentSnapshot } from '../../shared/workbench/document'
import { CourseV10DocumentBridge, type CourseV10ViewState } from '../documents/CourseV10DocumentBridge'
import { createEditorStoreKernel, type EditorStoreKernel } from './editorStoreKernel'
import { createEditorShellSlice, type EditorShellOwnedState, type EditingScope } from './slices/editorShellSlice'
import { createCourseLifecycleSlice, createCourseProjectContent, type CourseLifecycleOwnedState } from './slices/courseLifecycleSlice'
import { createCourseStructureSlice } from './slices/courseStructureSlice'
import { createSlideAuthoringSlice, createInitialSlideOwnedState, hasSlideContentDraftChanges, type SlideOwnedState } from './slices/slideAuthoringSlice'
import { createFlowAuthoringSlice, createInitialFlowOwnedState, type FlowOwnedState } from './slices/flowAuthoringSlice'
import { createSpatialAuthoringSlice, createInitialSpatialOwnedState, type SpatialOwnedState } from './slices/spatialAuthoringSlice'
import { createDesignProductionActions } from '../composition/designProductionActions'
import { createCrossSurfaceCommands } from '../composition/crossSurfaceCommands'
import { flushPropertiesDrafts } from '../ui/properties/PropertyControls'

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
    connectCourseDocuments(api: DocumentHostAPI): Promise<void>
    activateCourseDocument(documentId: string): Promise<void>
    closeCourseDocument(documentId: string): Promise<boolean>
    createCourseDocument(kind: ComponentSurface['kind'], canvas?: { width: number; height: number }): Promise<void>
    createCourseDocumentFrom(project: CourseProjectV10, resources?: DocumentResources): Promise<void>
    openCourseDocument(path: string): Promise<void>
    drainCourseDocument(documentId?: string): Promise<DocumentSnapshot>
    drainAllCourseDocuments(documentIds?: readonly string[]): Promise<DocumentSnapshot[]>
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
  const patch = (value: Partial<EditorState>) => set(value)
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
    requestClipboard: async command => {
      const clipboard = window.desktopAPI?.editorClipboard
      if (!clipboard) throw new Error('当前环境无法使用系统剪贴板')
      await clipboard(command)
    },
  })
  const design = createDesignProductionActions({ kernel: courseKernel, hasContentDraft: () => selectHasDirtyCourseContentDraft(get()) })
  courseBridge.subscribe(() => {
    const view = courseBridge.read()
    patch({ flowDocumentDraft: get().flowDocumentDrafts?.[view.activeDocumentId ?? ''] ?? null,
      ...(view.activeDocumentId !== get().courseView.activeDocumentId ? { flowContextSelection: null } : {}), courseView: view, dirty: Boolean(view.snapshot?.dirty || view.pending),
      projectPath: view.snapshot?.binding.kind === 'file' ? view.snapshot.binding.path : null,
      ...(view.error ? { errorMessage: view.error } : {}) })
  })
  const flushDrafts = async (documentId: string) => {
    if (courseBridge.read().activeDocumentId === documentId && !await flushPropertiesDrafts()) throw new Error('属性编辑尚未完成，请完成输入后再继续')
    const slideResult = await slide.commitDraftForPersistence(documentId)
    if (!slideResult.ok) throw new Error(slideResult.reason)
    const flowResult = await flow.commitDraftForPersistence(documentId)
    if (!flowResult.ok) throw new Error(flowResult.reason)
  }
  const drainActive = async (documentId?: string): Promise<DocumentSnapshot> => {
    const id = documentId ?? courseBridge.read().activeDocumentId
    if (!id) throw new Error('当前没有已打开的课件')
    await flushDrafts(id)
    const [snapshot] = await courseBridge.drain([id])
    if (!snapshot) throw new Error('课件文档已关闭')
    return snapshot
  }
  return {
    ...createInitialSlideOwnedState(), ...createInitialFlowOwnedState(), ...createInitialSpatialOwnedState(),
    activeTab: 'elements', canvasMode: 'edit', editingScope: 'scene', statusMessage: null, errorMessage: null,
    editingTextNodeId: null, slideDrawTool: null, previewBackgroundColor: null,
    projectPath: null, dirty: false,
    courseView: courseBridge.read(), courseBridge, courseKernel,
    ...editorShellSlice, ...lifecycle, ...structure, ...slide, ...flow, ...spatial, ...commands, ...design,
    connectCourseDocuments: api => courseBridge.connect(api),
    async activateCourseDocument(id) { const current = courseBridge.read().activeDocumentId; if (current && current !== id) await drainActive(current); await courseBridge.activate(id) },
    async closeCourseDocument(id) { await drainActive(id); return courseBridge.close(id) },
    async openCourseDocument(path) { if (courseBridge.read().activeDocumentId) await drainActive(); await courseBridge.open(path) },
    async createCourseDocument(kind, canvas) {
      if (courseBridge.read().activeDocumentId) await drainActive()
      await courseBridge.create({ kind: 'course-v10', ...createCourseProjectContent(kind, canvas) })
    },
    async createCourseDocumentFrom(project, resources = { assets: {}, components: {} }) {
      if (courseBridge.read().activeDocumentId) await drainActive()
      await courseBridge.create({ kind: 'course-v10', project, resources })
    },
    drainCourseDocument: drainActive,
    async drainAllCourseDocuments(ids) {
      const targets = ids ?? courseBridge.read().documents.map(snapshot => snapshot.documentId)
      for (const id of targets) await flushDrafts(id)
      return courseBridge.drain(targets)
    },
    async undoLatestAgentCourseDocument() {
      const target = courseBridge.captureLatestAgentUndoTarget()
      if (!target) return false
      await drainActive(target.documentId)
      return courseBridge.undoLatestAgent(target)
    },
    async saveCourseDocument(saveAs, directory, documentId) {
      const id = documentId ?? courseBridge.read().activeDocumentId
      if (!id) return null
      await flushDrafts(id)
      if (!await courseBridge.save(saveAs, directory, id)) return null
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
export const selectCourseView = (state: EditorState) => state.courseView
export const selectActiveCourseProjectDocument = (state: EditorState) => state.courseView.project
export const selectActiveCourseLocationId = (state: EditorState) => state.courseView.surfaceId
export const selectActiveSceneId = (state: EditorState) => state.courseView.surfaceId ?? ''
export const selectActiveScene = (state: EditorState) => state.courseView.project?.surfaces.find(surface => surface.id === state.courseView.surfaceId) ?? null
let slideSceneProject: CourseProjectV10 | null = null
let slideSceneList: ComponentSurface[] = []
export const selectSlideSceneList = (state: EditorState): ComponentSurface[] => {
  const project = state.courseView.project
  if (project !== slideSceneProject) {
    slideSceneProject = project
    slideSceneList = project?.surfaces.filter(surface => surface.kind === 'slide') ?? []
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
  const project = state.courseView.editingProject, surface = project?.surfaces.find(value => value.id === state.courseView.surfaceId)
  return project && surface ? surface.childIds.flatMap(id => project.instances[id] ? [project.instances[id]!] : []) : []
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
export const selectHasUnsavedCourseChanges = (state: EditorState) => Boolean(state.courseView.snapshot?.dirty || selectHasDirtyCourseContentDraft(state))
/** Window close must also preserve unfinished input in an inactive document. */
export const selectHasUnsavedCourseDocuments = (state: EditorState) => selectHasUnsavedCourseChanges(state)
  || state.courseView.documents.some(document => document.dirty)
  || Object.values(state.flowDocumentDrafts ?? {}).some(Boolean)
export const selectMediaAssets = (state: EditorState) => state.courseView.project?.assets ?? EMPTY_ASSETS
export const selectMediaAssetFiles = (state: EditorState): Record<string, Uint8Array> => {
  const view = state.courseView
  return view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources.assets ?? EMPTY_FILES
}
export const selectCandidateGlobalLayerItems = (state: EditorState) => state.courseView.project?.global ?? null
