import { synchronizeCourseTeacherControllerControls } from '../../../shared/teacherControllerConsistency'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { GlobalLayerItem } from '../../../shared/projectTypes'
import type { SlidePresentationState } from '../../../shared/courseProjectTypes'
import { rotatedRectangleAabb } from '../../../shared/geometry'
export type AlignmentMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
import { commitTeacherControllerAuthoringFrame } from '../../authoring/v9TeacherControllerAuthoring'
import { commitV9SlideContentEdit, commitV9SlideTextRunStyle } from '../../authoring/v9SlideContentEdit'
import {
  deleteEffectiveLayerItems,
  patchEffectiveLayerItem,
  patchEffectiveLayerItems,
  reorderEffectiveLayerItems,
  setGlobalLayerLocationVisibility,
  type EffectiveLayerPropertyPatch,
} from '../../course/effectiveLayerCommands'
import { setGlobalLayerScenePlane } from '../../course/globalLayerCommands'
import { buildCandidateEffectiveLayers } from '../../course/activeSurfaceProjection'
import {
  copySlideGlobalClipboard,
} from '../../course/v9SlideClipboard'
import {
  deleteSlideSceneLayers,
  duplicateSlideGlobalLayers,
  executeSlideSceneAction,
  pasteSlideGlobalLayers,
  shouldIgnoreSlideLayerDeleteForFocus,
  SLIDE_DELETE_FOCUS_GUARD_REASON,
  type SlideSceneActionId,
} from '../../course/v9SlideActionCommands'
import { transformSlideNativeLayers } from '../../course/slideAuthoringBackend'
import { createSlideAuthoringBackend } from '../../course/slideAuthoringBackend'
import { updateSlideNativeLayerContent } from '../../course/v9SlideContentCommands'
import { commitSlideAuthoringHistory, commitSlideProjectMutation } from '../../course/slideEditorCommands'
import { isSlideAuthoringBackend } from '../slideBackendPort'
import { SESSIONLESS_COURSE_REASON, type EditorStoreKernel } from '../editorStoreKernel'
import { projectV9EditingNodes, courseLayerItemToEditorCanvasNode } from '../slideEditorProjection'
import type { EditorCanvasNodePatch } from '../../phaser/editorCanvasNode'
import {
  applySceneNodePatchToCourseOverride,
  applySceneNodePatchToLayerItem,
  commandTargetForRow,
  constrainRoundTripTeacherControllerFrame,
  findCourseSlideScene,
  findMutableCourseLayerItem,
  locationVisibilityFromScenePatch,
  sessionFromLayerResult,
  slideSurfaceLayerPropertyPatch,
  v9NodePatchNeedsRoundTrip,
} from '../v9LayerMutations'
import type { SlideAuthoringPorts, SlidePersistExtra } from './slideAuthoringSlice'
import type { SlideAuthoringBackend, SlideAuthoringSession, SlideCommandResult } from '../../course/slideAuthoringBackend'
import type { TextRunStyle } from '../../../shared/projectTypes'


export function createSlideOwnedCommands(
  kernel: EditorStoreKernel,
  slide: SlideAuthoringPorts,
) {
  const persistLayer = (
    result: Parameters<typeof sessionFromLayerResult>[1],
    extra?: SlidePersistExtra,
  ): SlideCommandResult => {
    const backend = slide.read().slideBackend
    if (!isSlideAuthoringBackend(backend)) {
      return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
    }
    return slide.persist(sessionFromLayerResult(backend.getSession(), result), extra)
  }

  const runCandidateSession = (
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: SlidePersistExtra,
  ): SlideCommandResult => {
    const backend = slide.read().slideBackend
    if (!isSlideAuthoringBackend(backend)) {
      return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
    }
    return slide.persist(run(backend.getSession()), extra)
  }

  const runV9DocumentMutation = (
    recipe: (draft: Parameters<typeof commitSlideProjectMutation>[0]) => void,
    extra: SlidePersistExtra & { selectionIds?: readonly string[]; scope?: 'global' | 'scene' } = {},
  ): SlideCommandResult => {
    return runCandidateSession((session) => {
      try {
        const project = commitSlideProjectMutation(session.history.present, recipe)
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
            ...(extra.scope ? { scope: extra.scope } : {}),
          },
          selection: extra.selectionIds
            ? { ...session.selection, selectionIds: [...extra.selectionIds] }
            : session.selection,
        }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : '无法写入当前课件',
          historyEntry: false,
          nextSession: session,
          selection: session.selection,
        }
      }
    }, extra)
  }

  const runCandidateAction = (
    actionId: SlideSceneActionId,
    extra: { orderedLayerItemIds?: readonly string[] } = {},
  ) => {
    const owned = slide.read()
    const backend = owned.slideBackend
    if (!isSlideAuthoringBackend(backend)) {
      return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false as const }
    }
    const execution = executeSlideSceneAction(actionId, backend.getSession(), {
      clipboard: owned.slideCandidateClipboard,
      expectedRevision: backend.getSnapshot().revision,
      orderedLayerItemIds: extra.orderedLayerItemIds,
      focus: {
        textEditSession: Boolean(owned.v9ContentEdit?.kind === 'text'),
        formulaEditSession: owned.v9ContentEdit?.kind === 'formula',
      },
    })
    slide.persist(execution, {
      clipboard: execution.clipboard,
      statusMessage: execution.ok ? execution.reason ?? null : undefined,
    })
    return execution
  }

  const slideRow = (layerItemId: string) => {
    const backend = slide.read().slideBackend
    if (!isSlideAuthoringBackend(backend)) return null
    return buildCandidateEffectiveLayers({
      slideBackend: backend,
      spatialSession: null,
      flowSession: null,
    })?.unifiedRows.find((row) => row.id === layerItemId) ?? null
  }

  const commitDraftIfNeeded = (nextSelectionIds: readonly string[]): SlideAuthoringBackend | null => {
    const owned = slide.read()
    const backend = owned.slideBackend
    const edit = owned.v9ContentEdit
    if (!isSlideAuthoringBackend(backend)) return null
    if (!edit) return backend
    const keep = nextSelectionIds.length === 1 && nextSelectionIds[0] === edit.target.layerItemId
    if (keep) return backend
    slide.persist(commitV9SlideContentEdit(backend.getSession(), edit), { clearContentEdit: true })
    const next = slide.read().slideBackend
    return isSlideAuthoringBackend(next) ? next : null
  }

  const api = {
    setInitialPresentationState(stateId: string) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const sceneId = backend.getSnapshot().sceneId
      runCandidateSession((session) => {
        const current = findCourseSlideScene(session.history.present, sceneId)
        if (!current?.presentation?.states.some((item) => item.id === stateId)) {
          return {
            ok: false,
            reason: '找不到当前状态',
            historyEntry: false,
            nextSession: session,
            selection: session.selection,
          }
        }
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const scene = findCourseSlideScene(draft, sceneId)
          if (scene?.presentation) scene.presentation.initialStateId = stateId
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
      }, { statusMessage: '已设为运行时初始状态' })
    },

    setThumbnailPresentationState(stateId: string) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const sceneId = backend.getSnapshot().sceneId
      runCandidateSession((session) => {
        const current = findCourseSlideScene(session.history.present, sceneId)
        if (!current?.presentation?.states.some((item) => item.id === stateId)) {
          return {
            ok: false,
            reason: '找不到当前状态',
            historyEntry: false,
            nextSession: session,
            selection: session.selection,
          }
        }
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const scene = findCourseSlideScene(draft, sceneId)
          if (scene?.presentation) scene.presentation.thumbnailStateId = stateId
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
      }, { statusMessage: '已设为场景缩略图状态' })
    },

    updatePresentationState(
      stateId: string,
      patch: Partial<Pick<SlidePresentationState, 'name' | 'description' | 'backgroundColor' | 'backgroundAssetId'>>,
    ) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (patch.name !== undefined) {
        slide.persist(backend.renameState(stateId, patch.name, {
          expectedRevision: backend.getSnapshot().revision,
        }))
      }
      const remaining = patch.description !== undefined
        || patch.backgroundColor !== undefined
        || patch.backgroundAssetId !== undefined
      if (!remaining) return
      const sceneId = backend.getSnapshot().sceneId
      runCandidateSession((session) => {
        const current = findCourseSlideScene(session.history.present, sceneId)
        if (!current?.presentation?.states.some((item) => item.id === stateId)) {
          return {
            ok: false,
            reason: '找不到当前状态',
            historyEntry: false,
            nextSession: session,
            selection: session.selection,
          }
        }
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const scene = findCourseSlideScene(draft, sceneId)
          const state = scene?.presentation?.states.find((item) => item.id === stateId)
          if (!scene || !state) return
          if (patch.description !== undefined) {
            state.description = patch.description.trim() || undefined
          }
          if (patch.backgroundColor !== undefined) {
            state.backgroundColor = patch.backgroundColor === scene.backgroundColor
              ? undefined
              : patch.backgroundColor
          }
          if (patch.backgroundAssetId !== undefined) {
            state.backgroundAssetId = patch.backgroundAssetId === scene.backgroundAssetId
              ? undefined
              : patch.backgroundAssetId
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

    clearNodePresentationOverride(nodeId: string) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const stateId = backend.getSnapshot().stateId
      const scene = findCourseSlideScene(backend.getSession().history.present, backend.getSnapshot().sceneId)
      if (!scene || stateId === null || !scene.presentation?.states.some((item) => item.id === stateId
        && Object.hasOwn(item.layerItemOverrides, nodeId))) {
        return
      }
      const sceneId = backend.getSnapshot().sceneId
      runCandidateSession((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const target = findCourseSlideScene(draft, sceneId)
          const state = target?.presentation?.states.find((item) => item.id === stateId)
          if (state) delete state.layerItemOverrides[nodeId]
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
      }, { statusMessage: '已恢复此元素在当前状态中的基础值' })
    },

    clearPresentationStateOverrides(stateId: string) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const sceneId = backend.getSnapshot().sceneId
      const scene = findCourseSlideScene(backend.getSession().history.present, sceneId)
      if (!scene?.presentation?.states.some((item) => item.id === stateId)) return
      runCandidateSession((session) => {
        const project = commitSlideProjectMutation(session.history.present, (draft) => {
          const target = findCourseSlideScene(draft, sceneId)
          const state = target?.presentation?.states.find((item) => item.id === stateId)
          if (!state) return
          state.layerItemOverrides = {}
          state.layerItemOrder = undefined
          state.backgroundColor = undefined
          state.backgroundAssetId = undefined
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
      }, { statusMessage: '当前状态已恢复为基础场景' })
    },

    selectNodes(nodeIds: string[]) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const available = new Set(
        (buildCandidateEffectiveLayers({
          slideBackend: backend,
          spatialSession: null,
          flowSession: null,
        })?.unifiedRows ?? []).map((row) => row.id),
      )
      const selectedNodeIds = [...new Set(nodeIds)].filter((id) => available.has(id))
      const nextBackend = commitDraftIfNeeded(selectedNodeIds)
      if (!nextBackend) return
      slide.persist(nextBackend.selectLayers(selectedNodeIds, false, {
        expectedRevision: nextBackend.getSnapshot().revision,
      }))
      if (selectedNodeIds.length > 0) {
        kernel.setFeedback({ errorMessage: null })
      }
    },

    deleteNode(nodeId: string) {
      const owned = slide.read()
      const backend = owned.slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (shouldIgnoreSlideLayerDeleteForFocus({
        textEditSession: Boolean(owned.v9ContentEdit?.kind === 'text'),
        formulaEditSession: owned.v9ContentEdit?.kind === 'formula',
      })) {
        kernel.setFeedback({
          errorMessage: SLIDE_DELETE_FOCUS_GUARD_REASON,
          statusMessage: null,
        })
        return
      }
      const row = slideRow(nodeId)
      if (!row) return
      if (row.owner === 'scene') {
        slide.persist(deleteSlideSceneLayers(backend.getSession(), [nodeId], {
          expectedRevision: backend.getSnapshot().revision,
        }))
        return
      }
      persistLayer(deleteEffectiveLayerItems(
        backend.getSession().history.present,
        [commandTargetForRow(row)],
        { expectedRevision: backend.getSnapshot().revision },
      ))
    },

    deleteSelectedNodes() {
      const ids = [...kernel.readSelection().selectedNodeIds]
      for (const nodeId of ids) api.deleteNode(nodeId)
    },

    duplicateNode(nodeId: string) {
      api.selectNodes([nodeId])
      api.duplicateSelectedNodes()
    },

    duplicateSelectedNodes() {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (backend.getSnapshot().scope === 'global') {
        runCandidateSession((session) => duplicateSlideGlobalLayers(
          session,
          session.selection.selectionIds,
          { expectedRevision: session.history.present.revision },
        ), { statusMessage: '已重复所选元素' })
        return
      }
      runCandidateAction('duplicate')
    },

    copySelectedNodes() {
      const owned = slide.read()
      const backend = owned.slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (backend.getSnapshot().scope !== 'global') {
        runCandidateAction('copy')
        return
      }
      const ids = kernel.readSelection().selectedNodeIds
      if (ids.length === 0) return
      try {
        const clipboard = copySlideGlobalClipboard(backend.getSession(), ids)
        slide.patch({ slideCandidateClipboard: clipboard })
        kernel.setFeedback({
          errorMessage: null,
          statusMessage: `已复制 ${clipboard.items.length} 个全局元素到剪贴板`,
        })
      } catch (error) {
        kernel.setFeedback({
          errorMessage: error instanceof Error ? error.message : '无法复制全局图层',
          statusMessage: null,
        })
      }
    },

    pasteNodes() {
      const owned = slide.read()
      const backend = owned.slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (backend.getSnapshot().scope !== 'global') {
        runCandidateAction('paste')
        return
      }
      const clipboard = owned.slideCandidateClipboard
      runCandidateSession((session) => pasteSlideGlobalLayers(
        session,
        clipboard,
        { expectedRevision: session.history.present.revision },
      ), {
        statusMessage: clipboard?.sourceScope === 'global'
          ? `已粘贴 ${clipboard.items.length} 个全局元素`
          : undefined,
      })
    },

    updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      if (patches.length === 0) return
      const snapshot = backend.getSnapshot()
      const packages = kernel.readResources().componentPackages as Record<string, ComponentPackageData>
      if (snapshot.scope === 'scene' && snapshot.stateId !== null) {
        runV9DocumentMutation((draft) => {
          for (const item of patches) {
            applySceneNodePatchToCourseOverride(
              draft,
              snapshot.sceneId,
              snapshot.stateId!,
              item.nodeId,
              item.patch,
              packages,
            )
          }
        })
        return
      }
      const document = backend.getSession().history.present
      if (snapshot.scope === 'surface') {
        const updates = [] as Array<{
          target: ReturnType<typeof commandTargetForRow>
          patch: EffectiveLayerPropertyPatch
        }>
        for (const item of patches) {
          const row = slideRow(item.nodeId)
          if (!row || row.owner !== 'surface') {
            persistLayer({
              ok: false,
              reason: '当前表面图层已失效，请重新选择。',
              historyEntry: false,
            })
            return
          }
          const planned = slideSurfaceLayerPropertyPatch(
            row.item,
            courseLayerItemToEditorCanvasNode(row.item),
            item.patch,
          )
          if (!planned.ok) {
            persistLayer({ ok: false, reason: planned.reason, historyEntry: false })
            return
          }
          updates.push({ target: commandTargetForRow(row), patch: planned.patch })
        }
        persistLayer(patchEffectiveLayerItems(document, updates, {
          expectedRevision: snapshot.revision,
        }), { statusMessage: `已更新 ${updates.length} 个图层属性` })
        return
      }
      const globalIds = new Set(document.globalLayerItems.map((entry) => entry.item.layerItemId))
      const roundTripPatches = patches.filter((item) => (
        globalIds.has(item.nodeId) || v9NodePatchNeedsRoundTrip(item.patch)
      ))
      if (roundTripPatches.length > 0) {
        runV9DocumentMutation((draft) => {
          for (const item of roundTripPatches) {
            const layer = findMutableCourseLayerItem(draft, item.nodeId)
            if (!layer || (layer.locked && item.patch.locked !== false)) continue
            applySceneNodePatchToLayerItem(layer, item.patch, packages)
            constrainRoundTripTeacherControllerFrame(layer, item.patch)
          }
          synchronizeCourseTeacherControllerControls(draft)
        })
      }
      const remaining = patches.filter((item) => (
        !roundTripPatches.some((candidate) => candidate.nodeId === item.nodeId)
      ))
      if (remaining.length === 0) return
      const revision = slide.read().slideBackend
      const live = isSlideAuthoringBackend(revision) ? revision : backend
      const lockPatches = remaining.filter((item) => item.patch.locked !== undefined)
      const visiblePatches = remaining.filter((item) => item.patch.visible !== undefined)
      const framePatches = remaining.filter((item) => (
        item.patch.x !== undefined ||
        item.patch.y !== undefined ||
        item.patch.width !== undefined ||
        item.patch.height !== undefined ||
        item.patch.rotation !== undefined
      ))
      for (const item of lockPatches) {
        const row = slideRow(item.nodeId)
        if (!row) continue
        persistLayer(patchEffectiveLayerItem(
          live.getSession().history.present,
          commandTargetForRow(row),
          { locked: Boolean(item.patch.locked) },
          { expectedRevision: live.getSnapshot().revision },
        ))
      }
      const controllerPatches = framePatches.filter((item) => slideRow(item.nodeId)?.isTeacherController)
      const sceneFramePatches = framePatches.filter((item) => !slideRow(item.nodeId)?.isTeacherController)
      for (const item of controllerPatches) {
        const row = slideRow(item.nodeId)
        if (!row || row.item.kind !== 'native') continue
        slide.persist(commitTeacherControllerAuthoringFrame(live.getSession(), {
          layerItemId: item.nodeId,
          frame: {
            x: typeof item.patch.x === 'number' ? item.patch.x : row.item.frame.x,
            y: typeof item.patch.y === 'number' ? item.patch.y : row.item.frame.y,
            width: typeof item.patch.width === 'number' ? item.patch.width : row.item.frame.width,
            height: typeof item.patch.height === 'number' ? item.patch.height : row.item.frame.height,
          },
          rotation: typeof item.patch.rotation === 'number' ? item.patch.rotation : row.item.rotation,
        }, { expectedRevision: live.getSnapshot().revision }))
      }
      const contentPatches = remaining.filter((item) => (
        ('text' in item.patch && item.patch.text !== undefined) ||
        ('style' in item.patch && item.patch.style !== undefined) ||
        item.patch.name !== undefined
      ))
      if (sceneFramePatches.length > 0 || contentPatches.length > 0) {
        const neededIds = [...new Set([
          ...sceneFramePatches.map((item) => item.nodeId),
          ...contentPatches.map((item) => item.nodeId),
        ])]
        const liveForSelect = isSlideAuthoringBackend(slide.read().slideBackend)
          ? slide.read().slideBackend
          : live
        if (!isSlideAuthoringBackend(liveForSelect)) return
        const selected = new Set(liveForSelect.getSnapshot().selection.selectionIds)
        if (neededIds.some((id) => !selected.has(id))) {
          slide.persist(liveForSelect.selectLayers(neededIds, false, {
            expectedRevision: liveForSelect.getSnapshot().revision,
          }))
        }
        runCandidateSession((session) => {
          let next = session
          if (sceneFramePatches.length > 0) {
            const current = new Map(
              projectV9EditingNodes(createSlideAuthoringBackend(next)).map((node) => [node.id, node]),
            )
            const transformed = transformSlideNativeLayers(next, {
              nodes: sceneFramePatches.flatMap((item) => {
                const node = current.get(item.nodeId)
                if (!node) return []
                return [{
                  nodeId: item.nodeId,
                  x: typeof item.patch.x === 'number' ? item.patch.x : node.x,
                  y: typeof item.patch.y === 'number' ? item.patch.y : node.y,
                  width: typeof item.patch.width === 'number' ? item.patch.width : node.width,
                  height: typeof item.patch.height === 'number' ? item.patch.height : node.height,
                  rotation: typeof item.patch.rotation === 'number'
                    ? item.patch.rotation
                    : node.rotation,
                }]
              }),
            }, { expectedRevision: next.history.present.revision })
            if (!transformed.ok) return transformed
            next = transformed.nextSession ?? next
          }
          for (const item of contentPatches) {
            const nativeData: Record<string, unknown> = {}
            if ('text' in item.patch && typeof item.patch.text === 'string') {
              nativeData.text = item.patch.text
            }
            if ('style' in item.patch && item.patch.style) {
              nativeData.style = item.patch.style
            }
            const contentResult = updateSlideNativeLayerContent(
              next,
              item.nodeId,
              {
                nativeData,
                ...(typeof item.patch.name === 'string' ? { label: item.patch.name } : {}),
              },
              { expectedRevision: next.history.present.revision },
            )
            if (!contentResult.ok) return contentResult
            next = contentResult.nextSession ?? next
          }
          if (next.history.present === session.history.present) {
            return {
              ok: true,
              historyEntry: false,
              nextSession: next,
              selection: next.selection,
            }
          }
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...next,
              history: commitSlideAuthoringHistory(session.history, next.history.present),
            },
            selection: next.selection,
          }
        })
      }
      for (const item of visiblePatches) {
        const row = slideRow(item.nodeId)
        if (!row) continue
        const current = slide.read().slideBackend
        if (!isSlideAuthoringBackend(current)) continue
        persistLayer(patchEffectiveLayerItem(
          current.getSession().history.present,
          commandTargetForRow(row),
          { visible: Boolean(item.patch.visible) },
          { expectedRevision: current.getSnapshot().revision },
        ))
      }
    },

    updateNode(nodeId: string, patch: EditorCanvasNodePatch) {
      api.updateNodes([{ nodeId, patch }])
    },

    nudgeSelection(dx: number, dy: number) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const nodes = projectV9EditingNodes(backend).filter(
        (node) => kernel.readSelection().selectedNodeIds.includes(node.id) && !node.locked,
      )
      api.updateNodes(nodes.map((node) => ({
        nodeId: node.id,
        patch: { x: node.x + dx, y: node.y + dy },
      })))
    },

    alignSelection(mode: AlignmentMode) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const nodes = projectV9EditingNodes(backend).filter(
        (node) => kernel.readSelection().selectedNodeIds.includes(node.id) && !node.locked,
      )
      if (nodes.length < 2) return
      const boundsById = new Map(nodes.map((node) => [node.id, rotatedRectangleAabb(node)]))
      const bounds = [...boundsById.values()]
      const left = Math.min(...bounds.map((item) => item.left))
      const right = Math.max(...bounds.map((item) => item.right))
      const top = Math.min(...bounds.map((item) => item.top))
      const bottom = Math.max(...bounds.map((item) => item.bottom))
      api.updateNodes(nodes.map((node) => {
        const visual = boundsById.get(node.id)!
        let dx = 0
        let dy = 0
        if (mode === 'left') dx = left - visual.left
        else if (mode === 'center') dx = (left + right) / 2 - visual.centerX
        else if (mode === 'right') dx = right - visual.right
        else if (mode === 'top') dy = top - visual.top
        else if (mode === 'middle') dy = (top + bottom) / 2 - visual.centerY
        else dy = bottom - visual.bottom
        return { nodeId: node.id, patch: { x: node.x + dx, y: node.y + dy } }
      }))
      kernel.setFeedback({ statusMessage: `已对齐 ${nodes.length} 个图层` })
    },

    distributeSelection(axis: 'horizontal' | 'vertical') {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const nodes = projectV9EditingNodes(backend).filter(
        (node) => kernel.readSelection().selectedNodeIds.includes(node.id) && !node.locked,
      )
      if (nodes.length < 3) return
      const boundsById = new Map(nodes.map((node) => [node.id, rotatedRectangleAabb(node)]))
      const sorted = [...nodes].sort((a, b) => {
        const aBounds = boundsById.get(a.id)!
        const bBounds = boundsById.get(b.id)!
        return axis === 'horizontal' ? aBounds.left - bBounds.left : aBounds.top - bBounds.top
      })
      const firstBounds = boundsById.get(sorted[0]!.id)!
      const lastBounds = boundsById.get(sorted.at(-1)!.id)!
      const span = axis === 'horizontal'
        ? lastBounds.right - firstBounds.left
        : lastBounds.bottom - firstBounds.top
      const totalSize = sorted.reduce((sum, node) => {
        const visual = boundsById.get(node.id)!
        return sum + (axis === 'horizontal' ? visual.width : visual.height)
      }, 0)
      const gap = (span - totalSize) / (sorted.length - 1)
      let cursor = axis === 'horizontal' ? firstBounds.left : firstBounds.top
      const translations = new Map<string, number>()
      for (const node of sorted) {
        const visual = boundsById.get(node.id)!
        const current = axis === 'horizontal' ? visual.left : visual.top
        translations.set(node.id, cursor - current)
        cursor += (axis === 'horizontal' ? visual.width : visual.height) + gap
      }
      api.updateNodes(nodes.map((node) => {
        const delta = translations.get(node.id) ?? 0
        return {
          nodeId: node.id,
          patch: axis === 'horizontal' ? { x: node.x + delta } : { y: node.y + delta },
        }
      }))
      kernel.setFeedback({ statusMessage: `已等距分布 ${nodes.length} 个图层` })
    },

    updateGlobalLayerSettings(
      nodeId: string,
      patch: Partial<Pick<GlobalLayerItem, 'layer' | 'visibility'>>,
    ) {
      if (patch.layer !== undefined) {
        const backend = slide.read().slideBackend
        if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
        const row = slideRow(nodeId)
        if (row?.owner === 'global') {
          persistLayer(setGlobalLayerScenePlane(
            backend.getSession().history.present,
            commandTargetForRow(row),
            patch.layer,
            { expectedRevision: backend.getSnapshot().revision },
          ))
        }
      }
      if (patch.visibility) {
        const backend = slide.read().slideBackend
        if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
        const row = slideRow(nodeId)
        if (!row || row.owner !== 'global') return
        persistLayer(setGlobalLayerLocationVisibility(
          backend.getSession().history.present,
          commandTargetForRow(row),
          locationVisibilityFromScenePatch(backend.getSession().history.present, patch.visibility),
          { expectedRevision: backend.getSnapshot().revision },
        ))
      }
    },

    reorderNodes(nodeIds: string[]) {
      const backend = slide.read().slideBackend
      if (!isSlideAuthoringBackend(backend)) kernel.failSessionless()
      const first = slideRow(nodeIds[0] ?? '')
      if (first && first.owner !== 'scene') {
        persistLayer(reorderEffectiveLayerItems(
          backend.getSession().history.present,
          commandTargetForRow(first),
          nodeIds,
          { expectedRevision: backend.getSnapshot().revision },
        ))
        return
      }
      runCandidateAction('reorder', { orderedLayerItemIds: nodeIds })
    },

    commitSlideCandidateTextRunStyle(input: {
      layerItemId: string
      selectionStart: number
      selectionEnd: number
      patch: TextRunStyle
      source?: 'canvas' | 'properties'
    }) {
      return runCandidateSession(
        (session) => commitV9SlideTextRunStyle(session, {
          layerItemId: input.layerItemId,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          patch: input.patch,
          source: input.source ?? 'properties',
        }),
        { clearContentEdit: true },
      )
    },
  }

  return api
}
