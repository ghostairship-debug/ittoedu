import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CourseResourceState } from '../store/courseResourceState'
import { projectedAssetFiles } from '../store/courseResourceState'
import type { SlidePersistExtra, SlideApplyBackendExtra } from '../store/slices/slideAuthoringSlice'
import type { FlowPersistExtra } from '../store/slices/flowAuthoringSlice'
import type { SpatialPersistExtra, SpatialGraphSelection } from '../store/slices/spatialAuthoringSlice'
import type {
  SpatialAuthoringIntent,
  SpatialAuthoringReceipt,
} from '../authoring/spatialAuthoringIntents'
import type { EditorShellOwnedState } from '../store/slices/editorShellSlice'
import type { CourseLifecycleOwnedState } from '../store/slices/courseLifecycleSlice'
import type { createCourseStructureSlice } from '../store/slices/courseStructureSlice'
import type {
  SlideAuthoringBackend,
  SlideAuthoringSnapshot,
  SlideCommandResult,
} from '../course/slideAuthoringBackend'
import { createSlideAuthoringBackend, openSlideAuthoringSession } from '../course/slideAuthoringBackend'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import { createFlowEditorHistory, selectFlowEditorBlock } from '../course/flowEditorSlice'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type { FlowCommandResult } from '../course/flowEditorCommands'
import type { FlowSharedAuthoringResult } from '../course/flowSharedAuthoringAdapters'
import type { SpatialAuthoringSession, SpatialCommandResult } from '../course/spatialEditorCommands'
import { openSpatialAuthoringSession } from '../course/spatialEditorCommands'
import { freezeSpatialSession, succeedSpatialCommand, commitSpatialAuthoringHistory } from '../course/spatialAuthoringHistory'
import { commitSlideAuthoringHistory, commitSlideProjectMutation } from '../course/slideEditorCommands'
import {
  detectActiveSurface,
  dispatchActiveSurface,
  planActivateCourseLocation,
  type ActiveSurfaceKind,
} from './surfaceRouter'
import {
  buildCourseAuthoringSessionForProject,
  updateCourseAuthoringSessionItems,
  type CourseAuthoringSession,
} from '../authoring/courseAuthoringSession'
import { emptyCourseAssetSidecar } from '../project/v9AssetAdapter'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  type CourseEditorDropdownAction,
  type CourseEditorPrimaryAction,
} from '../course/courseEditorLayout'
import type {
  CaptureCourseProjectRecoveryResult,
  CourseProjectPersistenceSnapshot,
  CourseProjectPersistenceToken,
  PrepareCourseProjectPersistenceResult,
} from '../store/editorStore'
import type { EditorCanvasNodePatch } from '../phaser/editorCanvasNode'
import type { TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
import {
  findCourseSlideScene,
  type GlobalLayerSettingsPatch,
} from '../store/v9LayerMutations'
import {
  findGlobalTeacherController,
  type LayerCommandResult,
} from '../course/effectiveLayerCommands'
import type { EffectiveLayerProjection } from '../course/effectiveLayerProjection'
import type { V9SlideContentEditSession } from '../authoring/v9SlideContentEdit'
import type { FlowTextEditSession } from '../authoring/flowTextEdit'
import type { SpatialWorldContentEditSession } from '../authoring/spatialWorldAuthoring'
import {
  createEditorSelectionSnapshot,
  routeEditorAction as routeEditorActionCore,
  type EditorFocusKind,
  type EditorSelectionSnapshot,
} from '../course/editorActionRouting'
import { selectionSnapshotFromSession } from '../authoring/courseAuthoringSession'
import type { EditorActionId } from '../course/editorActionTypes'
import { LAYER_REJECT_STALE_REVISION } from '../course/effectiveLayerCommands'
import { updateCourseAuthoringSessionRevision } from '../authoring/courseAuthoringSession'

type SurfaceNodeCommands = {
  selectNodes(nodeIds: string[]): void
  updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>): void
  updateNode(nodeId: string, patch: EditorCanvasNodePatch): void
  copySelectedNodes(): void
  pasteNodes(): void
  deleteNode(nodeId: string): void
  deleteSelectedNodes(): void
  duplicateSelectedNodes(): void
  duplicateNode(nodeId: string): void
}

export type CrossSurfaceSlidePorts = {
  read(): {
    slideBackend: SlideAuthoringBackend | null
    slideCandidateSnapshot: SlideAuthoringSnapshot | null
    v9ContentEdit: V9SlideContentEditSession | null
  }
  patch(patch: { v9ContentEdit?: null }): void
  persist(result: SlideCommandResult, extra?: SlidePersistExtra): SlideCommandResult
  applyBackend(backend: SlideAuthoringBackend, extra?: SlideApplyBackendExtra): void
  commitDraft(): SlideAuthoringBackend | null
  undo(): void
  redo(): void
  activateState(stateId: string | null): void
  activateScene(sceneId: string): void
  setScope(scope: 'global' | 'scene'): void
  renameProject(title: string): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: string, x?: number, y?: number): void
  beginTextEdit(nodeId: string, source?: 'canvas' | 'properties'): void
  updateTextEditDraft(nodeId: string, text: string, runs: TextRun[], height?: number, width?: number): void
  commitTextEdit(): void
  cancelTextEdit(): void
  selectNode(nodeId: string | null, additive?: boolean): void
  ensureTeacherController(): void
  commitSlideCandidateTextRunStyle(input: {
    layerItemId: string
    selectionStart: number
    selectionEnd: number
    patch: TextRunStyle
    source?: 'canvas' | 'properties'
  }): SlideCommandResult
  updateGlobalLayerSettings(
    nodeId: string,
    patch: GlobalLayerSettingsPatch,
  ): void
  reorderNodes(nodeIds: string[]): void
  moveGlobalLayerOwner(fromId: string, toId: string): void
  setCandidateGlobalLayerLocationVisibility(nodeId: string, visibility: { mode: 'all' | 'include' | 'exclude'; locationIds: string[] }): void
  setCandidateGlobalLayerVisibleAtLocation(nodeId: string, visible: boolean): void
  deriveFocus(focus?: EditorFocusKind | EventTarget | null, shellEditingTextNodeId?: boolean): EditorFocusKind
  executeAction(actionId: EditorActionId, live: EditorSelectionSnapshot): { ok: boolean; reason: string }
  executeGlobalAction(actionId: EditorActionId, live: EditorSelectionSnapshot): { ok: boolean; reason: string }
} & SurfaceNodeCommands

export type CrossSurfaceFlowPorts = {
  read(): {
    flowSession: FlowAuthoringSession | null
    flowTextEdit: FlowTextEditSession | null
  }
  persist(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: FlowPersistExtra,
  ): FlowCommandResult | FlowSharedAuthoringResult
  applyBackend(session: FlowAuthoringSession, extra?: SlideApplyBackendExtra): void
  commitDraft(): boolean
  undo(): void
  redo(): void
  setScope(scope: 'global' | 'scene'): void
  renameProject(title: string): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: string, x?: number, y?: number): void
  beginTextEdit(nodeId: string, source?: 'canvas' | 'properties'): void
  updateTextEditDraft(nodeId: string, text: string, runs: TextRun[], height?: number, width?: number): void
  commitTextEdit(): void
  cancelTextEdit(): void
  selectNode(nodeId: string | null, additive?: boolean): void
  ensureTeacherController(): void
  patch(patch: { flowTextEdit?: null }): void
  activateBlock(locationId: string): boolean
  updateGlobalLayerSettings(nodeId: string, patch: GlobalLayerSettingsPatch): void
  reorderNodes(nodeIds: string[]): void
  moveGlobalLayerOwner(fromId: string, toId: string): void
  setCandidateGlobalLayerLocationVisibility(nodeId: string, visibility: { mode: 'all' | 'include' | 'exclude'; locationIds: string[] }): void
  setCandidateGlobalLayerVisibleAtLocation(nodeId: string, visible: boolean): void
  deriveFocus(): EditorFocusKind
  executeAction(actionId: EditorActionId, live: EditorSelectionSnapshot): { ok: boolean; reason: string }
  executeGlobalAction(actionId: EditorActionId, live: EditorSelectionSnapshot): { ok: boolean; reason: string }
} & SurfaceNodeCommands

export type CrossSurfaceSpatialPorts = {
  read(): {
    spatialSession: SpatialAuthoringSession | null
    spatialContentEdit: SpatialWorldContentEditSession | null
    spatialGraphSelection: SpatialGraphSelection | null
    courseAuthoringSession: CourseAuthoringSession | null
  }
  persist(result: SpatialCommandResult, extra?: SpatialPersistExtra): SpatialCommandResult
  applyBackend(session: SpatialAuthoringSession, extra?: SlideApplyBackendExtra): void
  runAuthoringIntent(
    target: import('../authoring/courseAuthoringSession').CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ): SpatialAuthoringReceipt
  commitDraft(): SpatialAuthoringSession | null
  undo(): void
  redo(): void
  setScope(scope: 'global' | 'world'): void
  renameProject(title: string): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: string, x?: number, y?: number): void
  beginTextEdit(nodeId: string, source?: 'canvas' | 'properties'): void
  updateTextEditDraft(nodeId: string, text: string, runs: TextRun[], height?: number, width?: number): void
  commitTextEdit(): void
  cancelTextEdit(): void
  selectNode(nodeId: string | null, additive?: boolean): void
  ensureTeacherController(): void
  commitSlideCandidateTextRunStyle(input: {
    layerItemId: string
    selectionStart: number
    selectionEnd: number
    patch: TextRunStyle
    source?: 'canvas' | 'properties'
  }): SpatialCommandResult
  patch(patch: Partial<{
    spatialContentEdit: null
    spatialGraphSelection: SpatialGraphSelection | null
    spatialPlaybackPathId: string | null
  }>): void
  activateCameraFrame(frameId: string): boolean
  setSpatialGraphSelection(selection: SpatialGraphSelection | null): void
  setScope(scope: 'global' | 'world'): void
  updateGlobalLayerSettings(nodeId: string, patch: GlobalLayerSettingsPatch): void
  reorderNodes(nodeIds: string[]): void
  moveGlobalLayerOwner(fromId: string, toId: string): void
  setCandidateGlobalLayerLocationVisibility(nodeId: string, visibility: { mode: 'all' | 'include' | 'exclude'; locationIds: string[] }): void
  setCandidateGlobalLayerVisibleAtLocation(nodeId: string, visible: boolean): void
  deriveFocus(shellEditingTextNodeId?: boolean): EditorFocusKind
  executeAction(actionId: EditorActionId, live: EditorSelectionSnapshot, shellEditingTextNodeId?: boolean): { ok: boolean; reason: string }
  executeGlobalAction(actionId: EditorActionId, live: EditorSelectionSnapshot): { ok: boolean; reason: string }
} & SurfaceNodeCommands

export type CrossSurfaceCommandPorts = {
  detect(): ActiveSurfaceKind | null
  kernel: EditorStoreKernel
  slide: CrossSurfaceSlidePorts
  flow: CrossSurfaceFlowPorts
  spatial: CrossSurfaceSpatialPorts
  structure: ReturnType<typeof createCourseStructureSlice>
  shell: {
    read(): EditorShellOwnedState
    patch(patch: Partial<EditorShellOwnedState> & Record<string, unknown>): void
  }
  lifecycle: {
    read(): CourseLifecycleOwnedState
    patch(patch: Partial<CourseLifecycleOwnedState> & Record<string, unknown>): void
    prepareCourseProjectPersistence(): PrepareCourseProjectPersistenceResult
    captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult
    acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean
    reopenArchive(bytes: Uint8Array): boolean
    exportArchive(): Uint8Array | null
  }
  readResources(): CourseResourceState
  readActiveLocationId(): string | null
  hasDirtyContentDraft(): boolean
  readProjection(): EffectiveLayerProjection | null
  persistLayer: {
    slide(result: LayerCommandResult, extra?: { statusMessage?: string | null }): unknown
    spatial(result: LayerCommandResult, extra?: { statusMessage?: string | null; selectionIds?: readonly string[] }): unknown
    flow(result: LayerCommandResult, extra?: { statusMessage?: string | null }): unknown
  }
}

function openFlowAuthoringSessionAtLocation(
  project: CourseProjectDocument,
  locationId: string,
): FlowAuthoringSession {
  const parsed = courseProjectDocumentSchema.parse(structuredClone(project))
  const location = parsed.locations.find(
    (candidate) => candidate.id === locationId && candidate.kind === 'flow-block',
  )
  if (!location || location.kind !== 'flow-block') {
    throw new Error(`找不到 Flow 位置：${locationId}`)
  }
  return {
    history: createFlowEditorHistory(parsed),
    selection: selectFlowEditorBlock(parsed, location.id, location.blockId),
  }
}

function sameEditorSelectionSnapshot(
  left: EditorSelectionSnapshot,
  right: EditorSelectionSnapshot | null,
): boolean {
  const leftRange = left.textRange ?? null
  const rightRange = right?.textRange ?? null
  const sameTextRange = leftRange === null
    ? rightRange === null
    : rightRange !== null
      && leftRange.blockId === rightRange.blockId
      && leftRange.start === rightRange.start
      && leftRange.end === rightRange.end
      && leftRange.listItemId === rightRange.listItemId
      && leftRange.tableRowId === rightRange.tableRowId
      && leftRange.tableColumnId === rightRange.tableColumnId
  return right !== null
    && left.locationId === right.locationId
    && left.revision === right.revision
    && left.sessionGeneration === right.sessionGeneration
    && left.surfaceKind === right.surfaceKind
    && (left.stateId ?? null) === (right.stateId ?? null)
    && left.scope === right.scope
    && left.focus === right.focus
    && sameTextRange
    && left.itemIds.length === right.itemIds.length
    && left.itemIds.every((itemId, index) => itemId === right.itemIds[index])
}

export function createCrossSurfaceCommands(ports: CrossSurfaceCommandPorts) {
  /** 内核根选区镜像已删除：编辑范围一律从各 Surface 自有 session 派生。 */
  const readSessionEditingScope = (): 'scene' | 'global' => {
    const spatialSession = ports.spatial.read().spatialSession
    if (spatialSession) return spatialSession.scope === 'global' ? 'global' : 'scene'
    const flowSession = ports.flow.read().flowSession
    if (flowSession) return flowSession.selection.authoringScope === 'global' ? 'global' : 'scene'
    const slideSnapshot = ports.slide.read().slideCandidateSnapshot
    if (slideSnapshot) return slideSnapshot.scope === 'global' ? 'global' : 'scene'
    return 'scene'
  }
  const commands = {
    setCanvasMode(canvasMode: 'edit' | 'run') {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => {
          if (
            canvasMode === 'run'
            && ports.spatial.read().spatialContentEdit
            && !ports.spatial.commitDraft()
          ) return
          ports.spatial.patch({
            spatialGraphSelection: canvasMode === 'run' ? null : ports.spatial.read().spatialGraphSelection,
          })
          ports.shell.patch({
            canvasMode,
            editingTextNodeId: null,
            statusMessage: canvasMode === 'run'
              ? '正在运行当前课件；切回编辑可直接修改元素'
              : '已返回无限画布编辑',
          })
          if (canvasMode === 'run') {
            ports.spatial.selectNode(null)
          }
        },
        flow: () => {
          if (
            canvasMode === 'run'
            && ports.flow.read().flowTextEdit
            && !ports.flow.commitDraft()
          ) return
          ports.shell.patch({
            canvasMode,
            statusMessage: canvasMode === 'run'
              ? '正在运行当前流式讲义；切回编辑可继续改稿纸'
              : '已返回流式讲义编辑',
          })
        },
        slide: () => {
          ports.slide.commitDraft()
          const backend = ports.slide.read().slideBackend as SlideAuthoringBackend | null
          if (backend && typeof backend.getSession === 'function') {
            const session = backend.getSession()
            const currentStateId = session.selection.stateId
            const scene = findCourseSlideScene(session.history.present, backend.getSnapshot().sceneId)
            const nextStateId =
              canvasMode === 'run' && currentStateId === null
                ? scene?.presentation?.initialStateId ?? currentStateId
                : currentStateId
            if (nextStateId !== session.selection.stateId) {
              ports.slide.activateState(nextStateId)
            }
          }
          const slideSnapshot = ports.slide.read().slideCandidateSnapshot
          ports.shell.patch({
            canvasMode,
            editingTextNodeId: null,
            statusMessage: canvasMode === 'run'
              ? '正在运行当前课件；切回编辑可直接修改元素'
              : '已返回状态编辑画布',
          })
          if (canvasMode === 'run' && slideSnapshot) {
            ports.slide.selectNode(null)
          }
        },
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    setEditingScope(editingScope: 'scene' | 'global') {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.setScope(editingScope === 'global' ? 'global' : 'world'),
        flow: () => ports.flow.setScope(editingScope === 'global' ? 'global' : 'scene'),
        slide: () => ports.slide.setScope(editingScope === 'global' ? 'global' : 'scene'),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    setSpatialGraphSelection(selection: SpatialGraphSelection | null) {
      ports.spatial.setSpatialGraphSelection(selection)
    },

    activateCourseLocation(locationId: string) {
      if (
        ports.flow.read().flowTextEdit
        && !ports.flow.commitDraft()
      ) return
      if (
        ports.spatial.read().spatialContentEdit
        && !ports.spatial.commitDraft()
      ) return
      const project = ports.kernel.tryReadDocument()
      if (!project) return
      const slide = ports.slide.read()
      const flow = ports.flow.read()
      const spatial = ports.spatial.read()
      const shell = ports.shell.read()
      const requestedLocation = project.locations.find((candidate) => candidate.id === locationId)
      if (
        requestedLocation?.kind === 'spatial-camera'
        && spatial.spatialSession?.selection.surfaceId === requestedLocation.surfaceId
        && spatial.spatialSession.scope !== 'global'
        && !shell.editingTextNodeId
      ) {
        ports.spatial.activateCameraFrame(requestedLocation.cameraFrameId)
        return
      }
      const plan = planActivateCourseLocation({
        project,
        locationId,
        snapshot: {
          spatialLocationId: spatial.spatialSession?.selection.locationId ?? null,
          flowLocationId: flow.flowSession?.selection.locationId ?? null,
          slideLocationId: slide.slideCandidateSnapshot?.locationId ?? null,
          editingScope: readSessionEditingScope(),
          composing: Boolean(
            flow.flowTextEdit?.composing ||
            slide.v9ContentEdit ||
            spatial.spatialContentEdit ||
            shell.editingTextNodeId,
          ),
        },
        authoringSession: ports.kernel.readAuthoringSession(),
        buildSession: (id) => buildCourseAuthoringSessionForProject(project, id),
      })
      if (!plan.ok) {
        ports.kernel.setFeedback({ errorMessage: plan.reason, statusMessage: null })
        return
      }
      const nextAuthoringSession = plan.authoringSession
      const canonicalHistory = spatial.spatialSession?.history
        ?? flow.flowSession?.history
        ?? (slide.slideBackend && typeof (slide.slideBackend as SlideAuthoringBackend).getSession === 'function'
          ? (slide.slideBackend as SlideAuthoringBackend).getSession().history
          : null)
      if (!canonicalHistory) return
      const resources = ports.readResources()
      const lifecycle = ports.lifecycle.read()
      const preserve = {
        sidecar: resources.courseAssetSidecar ?? emptyCourseAssetSidecar(),
        path: lifecycle.projectPath,
        dirty: lifecycle.dirty,
        componentPackages: resources.componentPackages,
        statusMessage: null as string | null,
        resourceHistory: {
          sidecarPast: resources.courseAssetSidecarPast,
          sidecarFuture: resources.courseAssetSidecarFuture,
          componentPackagesPast: resources.courseComponentPackagesPast,
          componentPackagesFuture: resources.courseComponentPackagesFuture,
        },
        ...(shell.canvasMode === 'run' ? { canvasMode: 'run' as const } : {}),
      }

      if (plan.kind === 'noop-same-location') {
        ports.kernel.writeAuthoringSession(updateCourseAuthoringSessionItems(nextAuthoringSession, []))
        if (plan.surface === 'spatial') ports.spatial.selectNode(null)
        else if (plan.surface === 'flow') ports.flow.selectNode(null)
        else ports.slide.selectNode(null)
        if (plan.surface === 'spatial') {
          ports.spatial.patch({ spatialContentEdit: null })
          ports.shell.patch({ editingTextNodeId: null })
        }
        return
      }
      if (plan.kind === 'open-flow') {
        const fresh = openFlowAuthoringSessionAtLocation(project, locationId)
        ports.flow.applyBackend({ ...fresh, history: canonicalHistory }, preserve)
        ports.kernel.writeAuthoringSession(nextAuthoringSession)
        return
      }
      if (plan.kind === 'open-spatial') {
        const fresh = openSpatialAuthoringSession(project, { locationId })
        ports.spatial.applyBackend(freezeSpatialSession({ ...fresh, history: canonicalHistory }), preserve)
        ports.kernel.writeAuthoringSession(nextAuthoringSession)
        return
      }
      if (plan.kind === 'open-slide') {
        ports.slide.applyBackend(
          createSlideAuthoringBackend({
            ...openSlideAuthoringSession(project, { locationId }),
            history: canonicalHistory,
          }),
          preserve,
        )
        ports.kernel.writeAuthoringSession(nextAuthoringSession)
        return
      }
      if (plan.kind === 'activate-slide-scene' && plan.sceneId) {
        ports.slide.commitDraft()
        ports.slide.activateScene(plan.sceneId)
        ports.kernel.writeAuthoringSession(updateCourseAuthoringSessionItems(nextAuthoringSession, []))
        ports.slide.selectNode(null)
      }
    },

    addCourseContent(
      action: CourseEditorPrimaryAction | CourseEditorDropdownAction,
      options: { surfaceId?: string } = {},
    ) {
      const result = ports.structure.addCourseContent(action, options)
      if (result.ok && result.activatedLocationId) {
        commands.activateCourseLocation(result.activatedLocationId)
      }
    },

    addScene() {
      const result = ports.structure.addScene()
      if (result.ok && result.activatedLocationId) {
        commands.activateCourseLocation(result.activatedLocationId)
      }
    },

    reorderCourseSurfaces(surfaceIds: string[]) {
      ports.structure.reorderCourseSurfaces(surfaceIds)
    },

    deleteCourseSurface(surfaceId: string) {
      const project = ports.kernel.tryReadDocument()
      const activeLocationId = ports.readActiveLocationId() ?? undefined
      const active = activeLocationId && project
        ? project.locations.find((location) => location.id === activeLocationId)
        : undefined
      if (active?.surfaceId === surfaceId && project) {
        const fallback = project.locations.find((location) => location.surfaceId !== surfaceId)
        if (fallback) commands.activateCourseLocation(fallback.id)
      }
      const result = ports.structure.deleteCourseSurface(surfaceId)
      if (result.ok && result.activatedLocationId) {
        commands.activateCourseLocation(result.activatedLocationId)
      }
    },

    moveCourseSlideScene(locationId: string, targetSurfaceId: string, toIndex?: number) {
      const result = ports.structure.moveCourseSlideScene(locationId, targetSurfaceId, toIndex)
      if (result.ok && result.activatedLocationId) {
        commands.activateCourseLocation(result.activatedLocationId)
      }
    },

    setActiveScene(activeSceneId: string) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.activateCameraFrame(activeSceneId),
        flow: () => ports.flow.activateBlock(activeSceneId),
        slide: () => {
          ports.slide.commitDraft()
          ports.slide.activateScene(activeSceneId)
        },
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    undo() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.undo(),
        flow: () => ports.flow.undo(),
        slide: () => ports.slide.undo(),
        sessionless: () => undefined,
      })
    },

    redo() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.redo(),
        flow: () => ports.flow.redo(),
        slide: () => ports.slide.redo(),
        sessionless: () => undefined,
      })
    },

    setEditingTextNode(editingTextNodeId: string | null) {
      if (editingTextNodeId) commands.beginTextEdit(editingTextNodeId, 'canvas')
      else commands.commitTextEdit()
    },

    beginTextEdit(nodeId: string, source: 'canvas' | 'properties' = 'canvas') {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.beginTextEdit(nodeId, source),
        flow: () => ports.flow.beginTextEdit(nodeId, source),
        slide: () => ports.slide.beginTextEdit(nodeId, source),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    updateTextEditDraft(
      nodeId: string,
      text: string,
      runs: TextRun[],
      height?: number,
      width?: number,
    ) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.updateTextEditDraft(nodeId, text, runs, height, width),
        flow: () => ports.flow.updateTextEditDraft(nodeId, text, runs, height, width),
        slide: () => ports.slide.updateTextEditDraft(nodeId, text, runs, height, width),
        sessionless: () => undefined,
      })
    },

    commitTextEdit() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.commitTextEdit(),
        flow: () => ports.flow.commitTextEdit(),
        slide: () => ports.slide.commitTextEdit(),
        sessionless: () => undefined,
      })
    },

    cancelTextEdit() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.cancelTextEdit(),
        flow: () => ports.flow.cancelTextEdit(),
        slide: () => ports.slide.cancelTextEdit(),
        sessionless: () => undefined,
      })
    },

    renameProject(title: string) {
      const normalized = title.trim().slice(0, 80)
      if (!normalized) {
        ports.kernel.setFeedback({ errorMessage: '课件名称不能为空。' })
        return
      }
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.renameProject(normalized),
        flow: () => ports.flow.renameProject(normalized),
        slide: () => ports.slide.renameProject(normalized),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    addTextNode(x?: number, y?: number) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.addTextNode(x, y),
        flow: () => ports.flow.addTextNode(x, y),
        slide: () => ports.slide.addTextNode(x, y),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    addFormulaNode(x?: number, y?: number) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.addFormulaNode(x, y),
        flow: () => ports.flow.addFormulaNode(x, y),
        slide: () => ports.slide.addFormulaNode(x, y),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    addRectangleNode(x?: number, y?: number) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.addRectangleNode(x, y),
        flow: () => ports.flow.addRectangleNode(x, y),
        slide: () => ports.slide.addRectangleNode(x, y),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    addShapeNode(shapeType: string, x?: number, y?: number) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.addShapeNode(shapeType, x, y),
        flow: () => ports.flow.addShapeNode(shapeType, x, y),
        slide: () => ports.slide.addShapeNode(shapeType, x, y),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    selectNode(nodeId: string | null, additive = false) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.selectNode(nodeId, additive),
        flow: () => ports.flow.selectNode(nodeId, additive),
        slide: () => ports.slide.selectNode(nodeId, additive),
        sessionless: () => ports.kernel.failSessionless(),
      })
      if (nodeId) ports.shell.patch({ activeTab: 'properties' })
    },

    ensureTeacherController() {
      const existed = Boolean(
        ports.kernel.tryReadDocument()
        && findGlobalTeacherController(ports.kernel.tryReadDocument()!),
      )
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.ensureTeacherController(),
        flow: () => ports.flow.ensureTeacherController(),
        slide: () => ports.slide.ensureTeacherController(),
        sessionless: () => ports.kernel.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        }),
      })
      if (existed) ports.shell.patch({ activeTab: 'properties' })
    },

    selectNodes(nodeIds: string[]) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.selectNodes(nodeIds),
        flow: () => ports.flow.selectNodes(nodeIds),
        slide: () => ports.slide.selectNodes(nodeIds),
        sessionless: () => ports.kernel.failSessionless(),
      })
      if (nodeIds.length > 0) ports.shell.patch({ activeTab: 'properties' })
    },
    updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.updateNodes(patches),
        flow: () => ports.flow.updateNodes(patches),
        slide: () => ports.slide.updateNodes(patches),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    updateNode(nodeId: string, patch: EditorCanvasNodePatch) {
      commands.updateNodes([{ nodeId, patch }])
    },
    updateGlobalLayerSettings(
      nodeId: string,
      patch: GlobalLayerSettingsPatch,
    ) {
      dispatchActiveSurface(ports.detect(), {
        slide: () => ports.slide.updateGlobalLayerSettings(nodeId, patch),
        spatial: () => ports.spatial.updateGlobalLayerSettings(nodeId, patch),
        flow: () => ports.flow.updateGlobalLayerSettings(nodeId, patch),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    copySelectedNodes() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.copySelectedNodes(),
        flow: () => ports.flow.copySelectedNodes(),
        slide: () => ports.slide.copySelectedNodes(),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    pasteNodes() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.pasteNodes(),
        flow: () => ports.flow.pasteNodes(),
        slide: () => ports.slide.pasteNodes(),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    reorderNodes(nodeIds: string[]) {
      dispatchActiveSurface(ports.detect(), {
        slide: () => ports.slide.reorderNodes(nodeIds),
        spatial: () => ports.spatial.reorderNodes(nodeIds),
        flow: () => ports.flow.reorderNodes(nodeIds),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    deleteNode(nodeId: string) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.deleteNode(nodeId),
        flow: () => ports.flow.deleteNode(nodeId),
        slide: () => ports.slide.deleteNode(nodeId),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    deleteSelectedNodes() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.deleteSelectedNodes(),
        flow: () => ports.flow.deleteSelectedNodes(),
        slide: () => ports.slide.deleteSelectedNodes(),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    duplicateSelectedNodes() {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.duplicateSelectedNodes(),
        flow: () => ports.flow.duplicateSelectedNodes(),
        slide: () => ports.slide.duplicateSelectedNodes(),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },
    duplicateNode(nodeId: string) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.duplicateNode(nodeId),
        flow: () => ports.flow.duplicateNode(nodeId),
        slide: () => ports.slide.duplicateNode(nodeId),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    commitSlideCandidateTextRunStyle(input: {
      layerItemId: string
      selectionStart: number
      selectionEnd: number
      patch: TextRunStyle
      source?: 'canvas' | 'properties'
    }): SlideCommandResult | SpatialCommandResult {
      return dispatchActiveSurface<SlideCommandResult | SpatialCommandResult>(ports.detect(), {
        spatial: () => ports.spatial.commitSlideCandidateTextRunStyle(input),
        flow: () => ports.slide.commitSlideCandidateTextRunStyle(input),
        slide: () => ports.slide.commitSlideCandidateTextRunStyle(input),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    moveCandidateLayerOwner(fromId: string, toId: string) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.moveGlobalLayerOwner(fromId, toId),
        flow: () => ports.flow.moveGlobalLayerOwner(fromId, toId),
        slide: () => ports.slide.moveGlobalLayerOwner(fromId, toId),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    setCandidateGlobalLayerLocationVisibility(
      nodeId: string,
      visibility: { mode: 'all' | 'include' | 'exclude'; locationIds: string[] },
    ) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.setCandidateGlobalLayerLocationVisibility(nodeId, visibility),
        flow: () => ports.flow.setCandidateGlobalLayerLocationVisibility(nodeId, visibility),
        slide: () => ports.slide.setCandidateGlobalLayerLocationVisibility(nodeId, visibility),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    setCandidateGlobalLayerVisibleAtLocation(nodeId: string, visible: boolean) {
      dispatchActiveSurface(ports.detect(), {
        spatial: () => ports.spatial.setCandidateGlobalLayerVisibleAtLocation(nodeId, visible),
        flow: () => ports.flow.setCandidateGlobalLayerVisibleAtLocation(nodeId, visible),
        slide: () => ports.slide.setCandidateGlobalLayerVisibleAtLocation(nodeId, visible),
        sessionless: () => ports.kernel.failSessionless(),
      })
    },

    exportV9SlideCandidateArchive() {
      return ports.lifecycle.exportArchive()
    },

    reopenV9SlideCandidateArchive(bytes: Uint8Array) {
      return ports.lifecycle.reopenArchive(bytes)
    },

    createLiveEditorSelectionSnapshot(focus?: EditorFocusKind | EventTarget | null) {
      const project = ports.kernel.tryReadDocument()
      if (!project) return null
      const locationId = ports.readActiveLocationId()
      if (!locationId) return null
      let session = ports.kernel.readAuthoringSession()
      const slide = ports.slide.read()
      const flow = ports.flow.read()
      const spatial = ports.spatial.read()
      const shell = ports.shell.read()
      const itemIds = flow.flowSession
        ? (
          flow.flowSession.selection.selectedOverlayIds.length > 0
            ? flow.flowSession.selection.selectedOverlayIds
            : flow.flowSession.selection.selectedBlockIds
        )
        : spatial.spatialSession
          ? [...spatial.spatialSession.selection.selectionIds]
          : [...(slide.slideCandidateSnapshot?.selection.selectionIds ?? [])]
      if (!session) {
        try {
          session = buildCourseAuthoringSessionForProject(project, locationId, itemIds)
        } catch {
          return null
        }
      } else if (session.token.revision !== project.revision) {
        session = updateCourseAuthoringSessionRevision(session, project.revision)
      }
      const scope = readSessionEditingScope() === 'global' ? 'global' : 'location'
      let focusKind: EditorFocusKind
      if (focus === 'text' || focus === 'block' || focus === 'overlay' || focus === 'layer' || focus === 'none') {
        focusKind = focus
      } else if (flow.flowSession) {
        focusKind = ports.flow.deriveFocus()
      } else if (spatial.spatialSession) {
        focusKind = ports.spatial.deriveFocus(Boolean(shell.editingTextNodeId))
      } else if (slide.slideBackend && typeof (slide.slideBackend as SlideAuthoringBackend).getSession === 'function') {
        focusKind = ports.slide.deriveFocus(focus, Boolean(shell.editingTextNodeId))
      } else {
        focusKind = shell.editingTextNodeId ? 'text'
          : itemIds.length > 0 ? 'layer' : 'none'
      }
      const stateId = slide.slideCandidateSnapshot?.stateId ?? null
      return createEditorSelectionSnapshot({
        ...selectionSnapshotFromSession(
          updateCourseAuthoringSessionItems(session, itemIds),
          { scope, focus: focusKind, stateId },
        ),
        textRange: flow.flowSession?.selection.textRange ?? null,
      })
    },

    routeEditorAction(actionId: EditorActionId, snapshot?: EditorSelectionSnapshot | null) {
      const live = snapshot ?? commands.createLiveEditorSelectionSnapshot()
      if (!live) {
        const reason = '当前没有可路由的编辑会话'
        ports.kernel.setFeedback({ errorMessage: reason, statusMessage: null })
        return { actionId, ok: false, reason, adapter: 'none' as const }
      }
      const currentLive = commands.createLiveEditorSelectionSnapshot()
      if (!sameEditorSelectionSnapshot(live, currentLive)) {
        ports.kernel.setFeedback({ errorMessage: LAYER_REJECT_STALE_REVISION, statusMessage: null })
        return {
          actionId,
          ok: false,
          reason: LAYER_REJECT_STALE_REVISION,
          adapter: 'none' as const,
        }
      }
      const result = routeEditorActionCore({
        actionId,
        snapshot: live,
        adapters: {
          slide: {
            execute: (id) => ports.slide.executeAction(id, live),
          },
          flow: {
            execute: (id) => ports.flow.executeAction(id, live),
          },
          spatial: {
            execute: (id) => ports.spatial.executeAction(id, live, Boolean(ports.shell.read().editingTextNodeId)),
          },
          global: {
            execute: (id) => {
              if (id !== 'delete') return { ok: false, reason: `全局层尚未接入${id}` }
              if (ports.flow.read().flowSession) {
                return ports.flow.executeGlobalAction(id, live)
              }
              const backend = ports.slide.read().slideBackend
              if (backend && typeof (backend as SlideAuthoringBackend).getSession === 'function') {
                return ports.slide.executeGlobalAction(id, live)
              }
              if (ports.spatial.read().spatialSession) {
                return ports.spatial.executeGlobalAction(id, live)
              }
              return { ok: false, reason: '没有可删除的选择' }
            },
          },
        },
      })
      if (!result.ok) {
        ports.kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
      } else {
        ports.kernel.setFeedback({ statusMessage: result.reason, errorMessage: null })
      }
      return result
    },

    deleteScene(sceneId: string) {
      const project = ports.kernel.tryReadDocument()
      const location = project?.locations.find((candidate) =>
        candidate.kind === 'slide-scene' &&
        candidate.sceneId === sceneId &&
        candidate.stateId === undefined,
      )
      if (!project || !location) return false
      const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
      const lastSceneOnSurface = surface?.type === 'slide' && surface.scenes.length <= 1
      const remainingElsewhere = project.locations.some(
        (candidate) => candidate.surfaceId !== location.surfaceId,
      )
      if (lastSceneOnSurface) {
        if (!remainingElsewhere) return false
        const activeLocationId = ports.readActiveLocationId()
        const active = activeLocationId
          ? project.locations.find((candidate) => candidate.id === activeLocationId)
          : undefined
        if (active?.surfaceId === location.surfaceId) {
          const fallbackLocation = project.locations.find(
            (candidate) => candidate.surfaceId !== location.surfaceId,
          )
          if (fallbackLocation) commands.activateCourseLocation(fallbackLocation.id)
        }
        const liveProject = ports.kernel.tryReadDocument() ?? project
        const liveLocation = liveProject.locations.find((candidate) =>
          candidate.kind === 'slide-scene' &&
          candidate.sceneId === sceneId &&
          candidate.stateId === undefined,
        )
        if (!liveLocation) return false
        const result = ports.structure.deleteCourseLocation(liveLocation.id)
        if (result.ok && result.activatedLocationId) {
          commands.activateCourseLocation(result.activatedLocationId)
        }
        return result.ok
      }
      const backend = ports.slide.read().slideBackend as SlideAuthoringBackend | null
      if (!backend || typeof backend.getSession !== 'function') return false
      const session = backend.getSession()
      const projectAfterVisibility = commitSlideProjectMutation(session.history.present, (draft) => {
        const removing = new Set(
          draft.locations
            .filter((candidate) => candidate.kind === 'slide-scene' && candidate.sceneId === sceneId)
            .map((candidate) => candidate.id),
        )
        const remaining = draft.locations
          .filter((candidate) => candidate.kind === 'slide-scene' && candidate.sceneId !== sceneId)
          .map((candidate) => candidate.id)
        for (const entry of draft.globalLayerItems) {
          if (entry.visibility.mode !== 'include') continue
          const nextIds = entry.visibility.locationIds.filter((id) => !removing.has(id))
          if (nextIds.length === 0 && remaining[0]) {
            entry.visibility = { mode: 'include', locationIds: [remaining[0]] }
          }
        }
      })
      ports.slide.persist({
        ok: true,
        historyEntry: true,
        nextSession: {
          ...session,
          history: commitSlideAuthoringHistory(session.history, projectAfterVisibility),
        },
        selection: session.selection,
      })
      const live = ports.slide.read().slideBackend as SlideAuthoringBackend | null
      if (!live || typeof live.getSession !== 'function') return false
      const result = ports.slide.persist(live.deleteScene(sceneId, {
        expectedRevision: live.getSnapshot().revision,
      }))
      return result.ok
    },

    prepareCourseProjectPersistence(): PrepareCourseProjectPersistenceResult {
      return ports.lifecycle.prepareCourseProjectPersistence()
    },

    captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult {
      return ports.lifecycle.captureCourseProjectRecoverySnapshot()
    },

    acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean {
      return ports.lifecycle.acknowledgeCourseProjectSaved(path, token)
    },
  }

  return commands
}
