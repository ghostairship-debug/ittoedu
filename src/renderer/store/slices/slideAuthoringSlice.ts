import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { CourseAssetSidecar } from '../../project/v9AssetAdapter'
import { emptyCourseAssetSidecar } from '../../project/v9AssetAdapter'
import { createBlankCourseProject } from '../../project/createCourseProject'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
  slideAuthoringGeneration,
  type SlideAuthoringBackend,
  type SlideAuthoringSession,
  type SlideAuthoringSnapshot,
  type SlideCommandResult,
} from '../../course/slideAuthoringBackend'
import {
  commitSlideAuthoringHistory,
  commitSlideEditorTransactionHistory,
  commitSlideProjectMutation,
  slideAuthoringLegacyHistoryEntryCount,
} from '../../course/slideEditorCommands'
import {
  addSlideFormulaLayer,
  addSlideShapeLayer,
  addSlideTextLayer,
} from '../../course/v9SlideContentCommands'
import {
  beginV9SlideContentEdit,
  cancelV9SlideContentEdit,
  commitV9SlideContentEdit,
  updateV9SlideContentTextDraft,
} from '../../authoring/v9SlideContentEdit'
import { MAX_SCENE_NODES } from '../../../shared/constants'
import {
  findGlobalTeacherController,
  locateCourseLayer,
  restoreDefaultTeacherController,
  type LayerCommandResult,
} from '../../course/effectiveLayerCommands'
import type { CourseMediaCommandResult } from '../../course/v9MediaAudioCommands'
import type { ShapeType } from '../../../shared/projectTypes'
import { createFormulaNode, createShapeNode, createTextNode } from '../../project/nativeNodeFactories'
import { normalizeNewNodeGeometry, sessionFromLayerResult } from '../v9LayerMutations'
import type { TextRun } from '../../../shared/projectTypes'
import type { V9SlideClipboardPayload } from '../../course/v9SlideClipboard'
import {
  isV9SlideContentDraftDirty,
  type V9SlideContentEditSession,
  type V9SlideTextContentDraft,
} from '../../authoring/v9SlideContentEdit'
import {
  createSessionToken,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringSession,
} from '../../authoring/courseAuthoringSession'
import type { EditorTransactionStep } from '../../authoring/editorTransaction'
import {
  exclusiveInactiveSurfaces,
} from '../../composition/surfaceRouter'
import { executeSlideAuthoringCommand, isSlideAuthoringBackend, type SlideBackend } from '../slideBackendPort'
import {
  SESSIONLESS_COURSE_REASON,
  commitSurfaceResourcePersist,
  type EditorStoreKernel,
} from '../editorStoreKernel'
import {
  continuedCourseResourceStacks,
  readCourseResourceState,
  type CourseResourceHistoryContinuation,
  type CourseResourceState,
} from '../courseResourceState'
import { createSlideOwnedCommands } from './slideOwnedCommands'
import { buildCandidateEffectiveLayers } from '../../course/activeSurfaceProjection'

export type SlideOwnedState = {
  slideBackend: SlideBackend
  slideCandidateSnapshot: SlideAuthoringSnapshot | null
  slideCandidateClipboard: V9SlideClipboardPayload | null
  v9ContentEdit: V9SlideContentEditSession | null
}

export type SlidePersistExtra = {
  clipboard?: V9SlideClipboardPayload | null
  statusMessage?: string | null
  clearContentEdit?: boolean
  sidecar?: CourseAssetSidecar
  sidecarDirection?: 'undo' | 'redo'
  componentPackages?: Record<string, ComponentPackageData>
  transactionStep?: EditorTransactionStep
  courseAuthoringSession?: CourseAuthoringSession
}

export type SlidePersistSnapshot = SlideOwnedState & {
  resources: CourseResourceState
  dirty: boolean
  authoringSession: CourseAuthoringSession | null
}

export type SlidePersistCommit = Record<string, unknown>

export type SlideApplyBackendExtra = {
  sidecar?: CourseAssetSidecar
  path?: string | null
  dirty?: boolean
  statusMessage?: string | null
  componentPackages?: Record<string, ComponentPackageData>
  clearClipboard?: boolean
  canvasMode?: 'edit' | 'run'
  resourceHistory?: CourseResourceHistoryContinuation
}

export type SlideAuthoringPorts = {
  read(): SlideOwnedState
  patch(patch: Partial<SlideOwnedState>): void
  persist(result: SlideCommandResult, extra?: SlidePersistExtra): SlideCommandResult
  applyBackend(backend: SlideAuthoringBackend, extra?: SlideApplyBackendExtra): void
}

export function persistSlideCandidateResult(
  snapshot: SlidePersistSnapshot,
  commit: (patch: SlidePersistCommit) => void,
  result: SlideCommandResult,
  extra: SlidePersistExtra = {},
): SlideCommandResult {
  if (!isSlideAuthoringBackend(snapshot.slideBackend)) return result
  if (!result.ok) {
    if (result.reason) {
      commit({ errorMessage: result.reason, statusMessage: null })
    }
    return result
  }
  let nextBackend = result.nextSession
    ? createSlideAuthoringBackend(result.nextSession)
    : snapshot.slideBackend
  const editedLayerItemId = extra.clearContentEdit
    ? snapshot.v9ContentEdit?.target.layerItemId
    : undefined
  if (editedLayerItemId) {
    const liveSnapshot = nextBackend.getSnapshot()
    if (!liveSnapshot.selection.selectionIds.includes(editedLayerItemId)) {
      const restored = nextBackend.selectLayers([editedLayerItemId], false, {
        expectedRevision: liveSnapshot.revision,
      })
      if (restored.ok && restored.nextSession) {
        nextBackend = createSlideAuthoringBackend(restored.nextSession)
      }
    }
  }
  const nextSnapshot = nextBackend.getSnapshot()
  const generation = slideAuthoringGeneration(nextSnapshot.sessionId)
  const documentChanged =
    nextBackend.getSession().history.present !== snapshot.slideBackend.getSession().history.present
  const keepEdit = extra.clearContentEdit
    ? null
    : snapshot.v9ContentEdit && snapshot.v9ContentEdit.target.generation === generation
      && (
        !documentChanged
        || snapshot.v9ContentEdit.composing
        || isV9SlideContentDraftDirty(snapshot.v9ContentEdit)
      )
      ? snapshot.v9ContentEdit
      : null
  const nextHistory = nextBackend.getSession().history
  if (
    extra.transactionStep &&
    result.resourceTransition &&
    extra.transactionStep.resourceChanges !== result.resourceTransition.resourceChanges
  ) {
    throw new Error('Slide 历史资源增量与编辑事务不一致')
  }
  const resourceAware = result.resourceTransition !== undefined || extra.transactionStep !== undefined
  const committed = commitSurfaceResourcePersist(snapshot.resources, {
    document: nextHistory.present,
    applyDocument: snapshot.slideBackend.getSession().history.present,
    transactionStep: extra.transactionStep,
    resourceTransition: result.resourceTransition,
    sidecar: resourceAware ? undefined : extra.sidecar,
    sidecarDirection: resourceAware ? undefined : extra.sidecarDirection,
    componentPackages: resourceAware ? undefined : extra.componentPackages,
    historyEntry: result.historyEntry,
    legacyPastCount: slideAuthoringLegacyHistoryEntryCount(nextHistory.past),
    legacyFutureCount: slideAuthoringLegacyHistoryEntryCount(nextHistory.future),
  })
  const historyDirection = extra.sidecarDirection ?? (
    result.resourceTransition
      ? result.resourceTransition.resourceDirection === 'inverse' ? 'undo' : 'redo'
      : undefined
  )
  const nextCourseAuthoringSession = extra.courseAuthoringSession ?? (
    historyDirection && snapshot.authoringSession
      ? updateCourseAuthoringSessionItems({
          token: createSessionToken({
            locationId: nextSnapshot.locationId,
            surfaceType: 'slide',
            revision: nextHistory.present.revision,
          }, snapshot.authoringSession.token.generation + 1),
          itemIds: snapshot.authoringSession.itemIds,
        }, result.resourceTransition
          ? snapshot.authoringSession.itemIds
          : nextSnapshot.selection.selectionIds)
      : undefined
  )
  commit({
    slideBackend: nextBackend,
    slideCandidateSnapshot: nextSnapshot,
    ...committed,
    dirty: resourceAware || extra.sidecarDirection || result.historyEntry
      ? true
      : snapshot.dirty,
    ...(extra.clipboard !== undefined
      ? { slideCandidateClipboard: extra.clipboard }
      : {}),
    v9ContentEdit: keepEdit,
    ...(extra.clearContentEdit || (snapshot.v9ContentEdit && !keepEdit)
      ? { editingTextNodeId: null }
      : {}),
    errorMessage: null,
    ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
    ...(nextCourseAuthoringSession
      ? { courseAuthoringSession: nextCourseAuthoringSession }
      : {}),
  })
  return result
}

export function applyV9BackendState(
  backend: SlideAuthoringBackend,
  extra: {
    sidecar?: CourseAssetSidecar
    path?: string | null
    dirty?: boolean
    statusMessage?: string | null
    componentPackages?: Record<string, ComponentPackageData>
    clearClipboard?: boolean
    canvasMode?: 'edit' | 'run'
    resourceHistory?: CourseResourceHistoryContinuation
    currentClipboard?: V9SlideClipboardPayload | null
  } = {},
): SlidePersistCommit {
  const snapshot = backend.getSnapshot()
  const sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
  const courseProject = backend.getSession().history.present
  return {
    ...exclusiveInactiveSurfaces('slide'),
    slideBackend: backend,
    slideCandidateSnapshot: snapshot,
    slideCandidateClipboard: extra.clearClipboard === false
      ? extra.currentClipboard ?? null
      : null,
    v9ContentEdit: null,
    ...continuedCourseResourceStacks(extra.resourceHistory),
    courseAssetSidecar: sidecar,
    editingTextNodeId: null,
    canvasMode: extra.canvasMode ?? 'edit',
    errorMessage: null,
    dirty: extra.dirty ?? false,
    projectPath: extra.path === undefined ? null : extra.path,
    statusMessage: extra.statusMessage ?? `已打开“${courseProject.title}”`,
    componentPackages: extra.componentPackages ?? {},
  }
}

export function createSlideAuthoringSlice(
  kernel: EditorStoreKernel,
  slide: SlideAuthoringPorts,
): {
  injectV9SlideCandidateBackend(backend: SlideAuthoringBackend): void
  clearV9SlideCandidateBackend(): void
  runSlideCandidateCommand(
    run: (backend: SlideAuthoringBackend) => SlideCommandResult,
  ): SlideCommandResult
  applySlideCandidateSession(session: SlideAuthoringSession): void
  applySlideCandidateCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult
  duplicateScene(sceneId: string): void
  reorderScenes(sceneIds: string[]): void
  commitDraft(): SlideAuthoringBackend | null
  commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }
  materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
  undo(): void
  redo(): void
  activateState(stateId: string | null): void
  activateScene(sceneId: string): void
  setScope(scope: 'global' | 'scene'): void
  renameProject(title: string): void
  updateScene(sceneId: string, patch: {
    name?: string
    backgroundColor?: string
    backgroundAssetId?: string | null
  }): void
  setActivePresentationState(stateId: string | null): void
  addPresentationState(name?: string): void
  duplicatePresentationState(stateId: string): void
  renamePresentationState(stateId: string, name: string): void
  deletePresentationState(stateId: string): boolean
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
  persistLayerCommand(result: LayerCommandResult, extra?: SlidePersistExtra): SlideCommandResult
  persistMediaResult(result: CourseMediaCommandResult, currentErrorMessage?: string | null): CourseMediaCommandResult
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistDocument(document: CourseProjectDocument, options?: { statusMessage?: string | null; historyEntry?: boolean }): boolean
} & ReturnType<typeof createSlideOwnedCommands> {
  const runCandidateSession = (
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult => {
    const backend = slide.read().slideBackend
    if (!isSlideAuthoringBackend(backend)) {
      return {
        ok: false,
        reason: 'not-slide-authoring-backend',
        historyEntry: false,
      }
    }
    return slide.persist(run(backend.getSession()), extra)
  }

  const commitDraft = (): SlideAuthoringBackend | null => {
    const owned = slide.read()
    const backend = owned.slideBackend
    if (!isSlideAuthoringBackend(backend)) return null
    if (!owned.v9ContentEdit) return backend
    slide.persist(
      commitV9SlideContentEdit(backend.getSession(), owned.v9ContentEdit),
      { clearContentEdit: true },
    )
    const next = slide.read().slideBackend
    return isSlideAuthoringBackend(next) ? next : null
  }

  const commitTextEdit = (): void => {
    const owned = slide.read()
    const backend = owned.slideBackend
    if (!isSlideAuthoringBackend(backend) || !owned.v9ContentEdit) return
    slide.persist(
      commitV9SlideContentEdit(backend.getSession(), owned.v9ContentEdit),
      { clearContentEdit: true },
    )
  }

  const addShapeNode = (shapeType: string, x?: number, y?: number): void => {
    const packages = kernel.readResources().componentPackages
    const placed = typeof x === 'number' || typeof y === 'number'
      ? normalizeNewNodeGeometry(createShapeNode(shapeType as ShapeType, { x, y }), packages)
      : null
    runCandidateSession(
      (session) => addSlideShapeLayer(session, {
        shapeType: shapeType as ShapeType,
        ...(placed ? { x: placed.x, y: placed.y } : {}),
      }, { expectedRevision: session.history.present.revision }),
      { statusMessage: '已添加形状' },
    )
  }

  const selectNode = (nodeId: string | null, additive = false): void => {
    const backend = slide.read().slideBackend
    if (!isSlideAuthoringBackend(backend)) {
      kernel.failSessionless()
    }
    commitDraft()
    const live = slide.read().slideBackend
    if (!isSlideAuthoringBackend(live)) return
    if (nodeId === null) {
      slide.persist(live.selectLayers([], additive, {
        expectedRevision: live.getSnapshot().revision,
      }))
      return
    }
    const projection = buildCandidateEffectiveLayers({
      slideBackend: live,
      spatialSession: null,
      flowSession: null,
    })
    const row = projection?.unifiedRows.find((candidate) => candidate.id === nodeId)
    const nextScope = row?.owner === 'global' || row?.owner === 'surface' || row?.owner === 'scene'
      ? row.owner
      : live.getSession().scope
    if (nextScope !== live.getSession().scope) {
      slide.persist(live.setScope(nextScope, {
        expectedRevision: live.getSnapshot().revision,
      }))
      const scoped = slide.read().slideBackend
      if (!isSlideAuthoringBackend(scoped)) return
      slide.persist(scoped.selectLayers([nodeId], additive, {
        expectedRevision: scoped.getSnapshot().revision,
      }))
      return
    }
    slide.persist(live.selectLayers([nodeId], additive, {
      expectedRevision: live.getSnapshot().revision,
    }))
  }

  return {
    injectV9SlideCandidateBackend(backend) {
      if (!isSlideAuthoringBackend(backend)) return
      slide.applyBackend(backend, {
        sidecar: emptyCourseAssetSidecar(),
        dirty: false,
        statusMessage: null,
        path: null,
      })
    },
    clearV9SlideCandidateBackend() {
      slide.applyBackend(
        createSlideAuthoringBackend(openSlideAuthoringSession(createBlankCourseProject())),
        {
          sidecar: emptyCourseAssetSidecar(),
          dirty: false,
          statusMessage: null,
          path: null,
        },
      )
    },
    runSlideCandidateCommand(run) {
      return slide.persist(
        executeSlideAuthoringCommand(slide.read().slideBackend, run),
      )
    },
    applySlideCandidateSession(session) {
      if (!isSlideAuthoringBackend(slide.read().slideBackend)) return
      slide.persist({
        ok: true,
        nextSession: session,
        historyEntry: false,
      })
    },
    applySlideCandidateCommand(run, extra) {
      return runCandidateSession(run, extra)
    },
    duplicateScene(sceneId) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.setFeedback({ errorMessage: SESSIONLESS_COURSE_REASON, statusMessage: null })
        return
      }
      slide.persist(backend.duplicateScene(sceneId, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    reorderScenes(sceneIds) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.setFeedback({ errorMessage: SESSIONLESS_COURSE_REASON, statusMessage: null })
        return
      }
      slide.persist(backend.reorderScenes(sceneIds, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    commitDraft,
    commitDraftForPersistence(): { ok: true } | { ok: false; reason: string } {
      const owned = slide.read()
      const backend = owned.slideBackend
      const edit = owned.v9ContentEdit
      if (!edit || !isSlideAuthoringBackend(backend)) return { ok: true }
      if (edit.composing) return { ok: false, reason: 'composing' }
      if (isV9SlideContentDraftDirty(edit)) {
        if (edit.target.revision !== backend.getSession().history.present.revision) {
          return { ok: false, reason: 'stale-revision' }
        }
        const result = commitV9SlideContentEdit(backend.getSession(), edit)
        if (!result.ok) {
          return { ok: false, reason: result.reason ?? '无法提交活动文字草稿' }
        }
        slide.persist(result, { clearContentEdit: true })
      } else {
        slide.patch({ v9ContentEdit: null })
      }
      return { ok: true }
    },
    materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string } {
      const owned = slide.read()
      const edit = owned.v9ContentEdit
      if (!edit || edit.kind !== 'text') return { ok: true, document }
      const clone = structuredClone(document)
      const located = locateCourseLayer(clone, edit.target.layerItemId)
      const item = located?.item
      if (item && item.kind === 'native' && item.content.nativeType === 'text') {
        const draft = edit.draft as V9SlideTextContentDraft
        const data = item.content.data as { text: string; runs?: unknown }
        data.text = draft.text
        if (draft.runs) data.runs = structuredClone(draft.runs)
        if (draft.width !== undefined) item.frame.width = draft.width
        if (draft.height !== undefined) item.frame.height = draft.height
      }
      return { ok: true, document: clone }
    },
    undo() {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) return
      const before = backend.getSession().history.present
      const result = backend.undo()
      const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
      slide.persist(result, {
        clearContentEdit: true,
        ...(moved && !result.resourceTransition ? { sidecarDirection: 'undo' as const } : {}),
      })
    },
    redo() {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) return
      const before = backend.getSession().history.present
      const result = backend.redo()
      const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
      slide.persist(result, {
        clearContentEdit: true,
        ...(moved && !result.resourceTransition ? { sidecarDirection: 'redo' as const } : {}),
      })
    },
    activateState(stateId) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      slide.persist(backend.activateState(stateId, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    activateScene(sceneId) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      slide.persist(backend.activateScene(sceneId, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    setScope(scope) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      slide.persist(backend.setScope(scope, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    renameProject(title) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      if (title === backend.getSession().history.present.title) return
      runCandidateSession((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          draft.title = title
        })
        return {
          ok: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          historyEntry: true,
          selection: session.selection,
        }
      }, { statusMessage: `课件已重命名为“${title}”` })
    },
    updateScene(sceneId, patch) {
      runCandidateSession((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          for (const surface of draft.surfaces) {
            if (surface.type !== 'slide') continue
            const scene = surface.scenes.find((item) => item.id === sceneId)
            if (!scene) continue
            if (patch.name !== undefined && patch.name.trim()) scene.name = patch.name.trim()
            if (patch.backgroundColor !== undefined) scene.backgroundColor = patch.backgroundColor
            if (patch.backgroundAssetId !== undefined) scene.backgroundAssetId = patch.backgroundAssetId
            draft.locations.forEach((location) => {
              if (location.kind === 'slide-scene' && location.sceneId === sceneId && location.stateId === undefined) {
                location.label = `${surface.title} · ${scene.name}`
              }
            })
          }
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
          },
          selection: session.selection,
        }
      })
    },
    setActivePresentationState(stateId) {
      const live = commitDraft() ?? slide.read().slideBackend
      if (!isSlideAuthoringBackend(live)) {
        kernel.failSessionless()
      }
      slide.persist(live.activateState(stateId, {
        expectedRevision: live.getSnapshot().revision,
      }))
    },
    addPresentationState(name) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      const nextName = name?.trim() || '状态'
      slide.persist(backend.addState(nextName, {
        expectedRevision: backend.getSnapshot().revision,
      }), { statusMessage: `已新增状态“${nextName}”` })
    },
    duplicatePresentationState(stateId) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      slide.persist(backend.duplicateState(stateId, {
        expectedRevision: backend.getSnapshot().revision,
      }), { statusMessage: '已复制状态' })
    },
    renamePresentationState(stateId, name) {
      const nextName = name.trim()
      if (!nextName) return
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      slide.persist(backend.renameState(stateId, nextName, {
        expectedRevision: backend.getSnapshot().revision,
      }))
    },
    deletePresentationState(stateId) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) return false
      const result = slide.persist(backend.deleteState(stateId, {
        expectedRevision: backend.getSnapshot().revision,
      }), { statusMessage: '状态已删除' })
      return result.ok
    },
    addTextNode(x, y) {
      const packages = kernel.readResources().componentPackages
      const placed = typeof x === 'number' || typeof y === 'number'
        ? normalizeNewNodeGeometry(createTextNode(x, y), packages)
        : null
      runCandidateSession(
        (session) => addSlideTextLayer(session, {
          ...(placed ? { x: placed.x, y: placed.y } : {}),
        }, { expectedRevision: session.history.present.revision }),
        { statusMessage: '已添加文本' },
      )
    },
    addFormulaNode(x, y) {
      const packages = kernel.readResources().componentPackages
      const placed = typeof x === 'number' || typeof y === 'number'
        ? normalizeNewNodeGeometry(createFormulaNode({ x, y }), packages)
        : null
      runCandidateSession(
        (session) => addSlideFormulaLayer(session, {
          ...(placed ? { x: placed.x, y: placed.y } : {}),
        }, { expectedRevision: session.history.present.revision }),
        { statusMessage: '已添加公式' },
      )
    },
    addRectangleNode(x, y) {
      addShapeNode('rectangle', x, y)
    },
    addShapeNode,
    beginTextEdit(nodeId, source = 'canvas') {
      const owned = slide.read()
      const backend = owned.slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.failSessionless()
      }
      if (
        owned.v9ContentEdit?.target.layerItemId === nodeId &&
        owned.v9ContentEdit.source === source
      ) {
        return
      }
      if (owned.v9ContentEdit) commitTextEdit()
      const next = slide.read().slideBackend
      if (!isSlideAuthoringBackend(next)) return
      const begun = beginV9SlideContentEdit({
        backend: next,
        layerItemId: nodeId,
        source,
      })
      if (!begun.ok) {
        kernel.setFeedback({ errorMessage: begun.reason, statusMessage: null })
        return
      }
      slide.patch({ v9ContentEdit: begun.edit })
    },
    updateTextEditDraft(nodeId, text, runs, height, width) {
      const edit = slide.read().v9ContentEdit
      if (!edit || edit.target.layerItemId !== nodeId || edit.kind !== 'text') return
      slide.patch({
        v9ContentEdit: updateV9SlideContentTextDraft(edit, {
          text,
          runs,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        }),
      })
    },
    commitTextEdit,
    cancelTextEdit() {
      const owned = slide.read()
      const backend = owned.slideBackend
      if (isSlideAuthoringBackend(backend) && owned.v9ContentEdit) {
        cancelV9SlideContentEdit(backend.getSession(), owned.v9ContentEdit)
      }
      slide.patch({ v9ContentEdit: null })
    },
    selectNode,
    ensureTeacherController() {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) {
        kernel.setFeedback({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return
      }
      const document = backend.getSession().history.present
      const result = restoreDefaultTeacherController(document, {
        expectedRevision: document.revision,
        preserveAuthoringLock: true,
      })
      if (!result.ok || !result.nextDocument) {
        kernel.setFeedback({ errorMessage: result.reason, statusMessage: null })
        return
      }
      const mapped = sessionFromLayerResult(backend.getSession(), result)
      const controllerId = result.createdLayerItemId
        ?? findGlobalTeacherController(result.nextDocument)?.item.layerItemId
        ?? null
      if (!mapped.ok || !mapped.nextSession) {
        kernel.setFeedback({ errorMessage: mapped.reason ?? result.reason, statusMessage: null })
        return
      }
      slide.persist({
        ...mapped,
        nextSession: {
          ...mapped.nextSession,
          scope: 'global',
          selection: {
            ...mapped.nextSession.selection,
            selectionIds: controllerId
              ? [controllerId]
              : mapped.nextSession.selection.selectionIds,
          },
        },
      }, { statusMessage: result.reason })
    },
    persistLayerCommand(result: LayerCommandResult, extra: SlidePersistExtra = {}): SlideCommandResult {
      return persistSlideLayerCommand(slide, result, extra)
    },
    persistMediaResult(result: CourseMediaCommandResult, currentErrorMessage?: string | null): CourseMediaCommandResult {
      return persistSlideMediaResult(kernel, slide, result, currentErrorMessage ?? null)
    },
    persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean {
      return persistSlideTransaction(kernel, slide, step, statusMessage)
    },
    persistDocument(document: CourseProjectDocument, options?: { statusMessage?: string | null; historyEntry?: boolean }): boolean {
      return persistSlideDocument(slide, document, options)
    },
    ...createSlideOwnedCommands(kernel, slide),
  }
}

export function persistSlideLayerCommand(
  slide: SlideAuthoringPorts,
  result: LayerCommandResult,
  extra: SlidePersistExtra = {},
): SlideCommandResult {
  const backend = slide.read().slideBackend
  if (!isSlideAuthoringBackend(backend)) {
    return {
      ok: false,
      reason: 'not-slide-authoring-backend',
      historyEntry: false,
    }
  }
  return slide.persist(sessionFromLayerResult(backend.getSession(), result), extra)
}

export function persistSlideMediaResult(
  kernel: EditorStoreKernel,
  slide: SlideAuthoringPorts,
  result: CourseMediaCommandResult,
  currentErrorMessage: string | null,
): CourseMediaCommandResult {
  const capacityError =
    `当前场景已达到或将超过 ${MAX_SCENE_NODES} 个节点上限。请删除不需要的节点，或新建场景后继续。`
  const keepCapacityError = currentErrorMessage === capacityError
  slide.persist({
    ok: result.ok,
    reason: result.reason,
    nextSession: result.nextSession,
    historyEntry: result.historyEntry,
    selection: result.selection,
  }, {
    sidecar: result.sidecar,
    statusMessage: result.ok ? result.reason ?? null : undefined,
  })
  if (result.ok && (result.libraryFallback === 'scene-capacity' || keepCapacityError)) {
    kernel.setFeedback({ errorMessage: capacityError })
  }
  return result
}

export function slidePersistSnapshotFrom(
  owned: SlideOwnedState,
  resources: CourseResourceState,
  dirty: boolean,
  authoringSession: CourseAuthoringSession | null,
): SlidePersistSnapshot {
  return {
    ...owned,
    resources: readCourseResourceState(resources),
    dirty,
    authoringSession,
  }
}

export function persistSlideTransaction(
  kernel: EditorStoreKernel,
  slide: SlideAuthoringPorts,
  step: EditorTransactionStep,
  statusMessage: string,
): boolean {
  const backend = slide.read().slideBackend
  if (!isSlideAuthoringBackend(backend)) return false
  const session = backend.getSession()
  const authoringSession = kernel.readAuthoringSession()
  slide.persist({
    ok: true,
    nextSession: {
      ...session,
      history: commitSlideEditorTransactionHistory(session.history, step),
    },
    historyEntry: true,
    selection: session.selection,
    resourceTransition: {
      resourceChanges: step.resourceChanges,
      resourceDirection: 'forward',
    },
  }, {
    transactionStep: step,
    statusMessage,
    ...(authoringSession
      ? {
          courseAuthoringSession: updateCourseAuthoringSessionItems(
            updateCourseAuthoringSessionRevision(
              authoringSession,
              step.nextDocument.revision,
            ),
            authoringSession.itemIds,
          ),
        }
      : {}),
  })
  return true
}

export function persistSlideDocument(
  slide: SlideAuthoringPorts,
  document: CourseProjectDocument,
  options?: { statusMessage?: string | null; historyEntry?: boolean },
): boolean {
  const backend = slide.read().slideBackend
  if (!isSlideAuthoringBackend(backend)) return false
  const session = backend.getSession()
  const history = options?.historyEntry
    ? commitSlideAuthoringHistory(session.history, document)
    : { ...session.history, present: document }
  slide.persist({
    ok: true,
    nextSession: { ...session, history },
    historyEntry: Boolean(options?.historyEntry),
    selection: session.selection,
  }, {
    statusMessage: options?.statusMessage,
  })
  return true
}
