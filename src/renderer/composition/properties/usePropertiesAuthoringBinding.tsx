import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import type { TextNode } from '../../../shared/contracts/native-v1'
import { rotatedRectangleAabb } from '../../../shared/geometry'
import { renderTextNodeCanvas } from '../../../shared/textLayout'
import { remapTextRuns } from '../../../shared/textRuns'
import type { EditorCanvasNodePatch } from '../../phaser/editorCanvasNode'
import {
  patchEffectiveLayerPropertiesAtTargets,
  type EffectiveLayerCommandTarget,
} from '../../course/effectiveLayerCommands'
import {
  executeFlowDelete,
} from '../../course/flowEditorCommands'
import {
  captureSpatialEditorAuthoringTarget,
} from '../../course/spatialEditorView'
import {
  addSlideSceneInteractionRule,
  deleteSlideSceneInteractionRule,
} from '../../course/v9SlideActionCommands'
import {
  commitSlideMultiLayerIntentAtTargets,
  patchSlideLayerPropertiesAtTarget,
  setSlideSimpleEntranceAnimation,
  type SlideMultiLayerPropertiesIntent,
} from '../../course/v9SlideContentCommands'
import type { SlideAuthoringTarget } from '../../course/slideEditorCommands'
import { interactionLayerTargetFromItem } from '../../course/slideInteractionView'
import {
  commitTeacherControllerPropertiesAtTarget,
  teacherControllerPropertiesPreview,
} from '../../authoring/v9TeacherControllerAuthoring'
import type {
  SpatialAuthoringIntent,
} from '../../authoring/spatialAuthoringIntents'
import type {
  SpatialWorldContentEditSession,
  V9SlideTextContentDraft,
} from '../../authoring/spatialWorldAuthoring'
import type { CourseAuthoringTarget } from '../../authoring/courseAuthoringSession'
import { COURSE_AUTHORING_STALE_SESSION_REASON } from '../../authoring/courseAuthoringSession'
import {
  applyV9SlideContentEditRunStyle,
  commitV9SlideContentEdit,
} from '../../authoring/v9SlideContentEdit'
import type { InteractionAuthoringTarget } from '../../interactions/interactionAuthoringCommands'
import { useEditorStore } from '../../store/editorStore'
import type { InteractionEditorProps } from '../../ui/InteractionEditor'
import type { PropertiesContext } from '../../ui/properties/PropertiesContext'
import {
  selectPropertiesAuthoringReadModel,
  type PropertiesOwnerReadModel,
} from './PropertiesAuthoringReadModel'
import { buildFlowPropertiesOwner } from '../../ui/properties/FlowPropertiesContextBuilder'
import { buildRuntimePropertiesContexts } from '../../ui/properties/RuntimePropertiesContextBuilder'
import { buildSpatialPropertiesOwner } from '../../ui/properties/SpatialPropertiesContextBuilder'
import type {
  CourseGlobalPropertiesContext,
} from '../../ui/properties/CourseGlobalPropertiesPanel'
import type {
  MultiSelectionAlignment,
  MultiSelectionPropertiesContext,
} from '../../ui/properties/MultiSelectionPropertiesPanel'
import {
  effectivePatchFromProperties,
  normalizePropertiesPatch,
} from '../../ui/properties/propertiesItemView'
import type {
  PropertiesItemView,
  PropertiesPatch,
  SlideNativePropertiesContext,
  SlideNativeTextCommands,
} from '../../ui/properties/SlideNativePropertiesPanel'

const STALE_PROPERTY_TARGET = '属性编辑目标已经改变，未写入工程。请重新选择后重试。'

function ownerIdentityKey(read: PropertiesOwnerReadModel): string {
  const { identity } = read
  return JSON.stringify([
    identity.projectId,
    identity.revision,
    identity.generation,
    identity.locationId,
    identity.owner,
    identity.stateId,
    read.selectedNodeIds,
    read.selectedRows.map((row) => [
      row.id,
      row.authoringAddress,
      row.owner,
      row.ownerKey,
      row.scopeToken.locationId,
      row.scopeToken.stateId,
    ]),
  ])
}

function propertyDraftBindingKey(
  read: PropertiesOwnerReadModel,
  itemId?: string,
): string {
  return JSON.stringify([
    ownerIdentityKey(read),
    itemId ?? null,
  ])
}

function makeSlideTarget(
  read: PropertiesOwnerReadModel,
): SlideAuthoringTarget | null {
  const row = read.selectedRow
  const session = read.slideSessionIdentity
  if (
    !row
    || !session
    || row.owner === 'world'
    || session.scope !== row.owner
    || session.locationId !== row.scopeToken.locationId
    || session.stateId !== row.scopeToken.stateId
    || session.revision !== read.identity.revision
  ) return null
  return Object.freeze({
    sessionId: session.sessionId,
    revision: session.revision,
    generation: session.generation,
    authoringAddress: row.authoringAddress,
    scope: session.scope,
    layerItemId: row.id,
  })
}

function sameSlideTarget(
  read: PropertiesOwnerReadModel,
  target: SlideAuthoringTarget,
): boolean {
  const current = makeSlideTarget(read)
  return Boolean(current
    && current.sessionId === target.sessionId
    && current.revision === target.revision
    && current.generation === target.generation
    && current.authoringAddress === target.authoringAddress
    && current.scope === target.scope
    && current.layerItemId === target.layerItemId)
}

function sameSlideContentTarget(
  read: PropertiesOwnerReadModel,
  itemTarget: SlideAuthoringTarget,
  contentTarget: SlideAuthoringTarget,
  field: string,
): boolean {
  const row = read.selectedRow
  const projectId = read.identity.projectId
  if (
    !row
    || !projectId
    || !sameSlideTarget(read, itemTarget)
    || contentTarget.sessionId !== itemTarget.sessionId
    || contentTarget.revision !== itemTarget.revision
    || contentTarget.generation !== itemTarget.generation
    || contentTarget.scope !== itemTarget.scope
    || contentTarget.layerItemId !== itemTarget.layerItemId
  ) return false
  return contentTarget.authoringAddress === makeAuthoringAddress({
    projectId,
    scope: contentTarget.scope,
    surfaceId: contentTarget.scope === 'global' ? undefined : row.scopeToken.surfaceId,
    sceneId: contentTarget.scope === 'scene' ? row.scopeToken.sceneId ?? undefined : undefined,
    carrier: 'native',
    layerItemId: contentTarget.layerItemId,
    field,
  })
}

function dummyTextCommands(): SlideNativeTextCommands {
  return {
    beginEdit: () => undefined,
    commitEdit: () => undefined,
    cancelEdit: () => undefined,
    updateDraft: () => undefined,
    toggleStyle: () => undefined,
  }
}

function videoDiagnostics(read: PropertiesOwnerReadModel, node: PropertiesItemView): string[] {
  if (node.type !== 'video') return []
  return Object.values(read.interactionWarnings)
    .flatMap((messages) => messages)
    .filter((message, index, all) => all.indexOf(message) === index)
}

function componentPort(read: PropertiesOwnerReadModel, node: PropertiesItemView) {
  if (node.type !== 'external-component') return null
  const packed = read.componentManifests[node.component.packageId]
  return packed ? { manifest: packed.manifest, assets: read.assets } : null
}

function presentationView(read: PropertiesOwnerReadModel) {
  return read.identity.owner === 'scene'
    ? {
        stateName: read.activeState?.name ?? null,
        overriddenCount: read.selectedRows.filter((row) => row.stateOverrideApplied).length,
      }
    : null
}

function computedMultiUpdates(
  items: readonly PropertiesItemView[],
  mode: MultiSelectionAlignment | 'distribute-horizontal' | 'distribute-vertical',
): Array<{ nodeId: string; patch: EditorCanvasNodePatch }> {
  const unlocked = items.filter((item) => !item.locked)
  if (mode.startsWith('distribute-') ? unlocked.length < 3 : unlocked.length < 2) return []
  const boundsById = new Map(unlocked.map((item) => [item.id, rotatedRectangleAabb(item)]))
  if (mode === 'distribute-horizontal' || mode === 'distribute-vertical') {
    const horizontal = mode === 'distribute-horizontal'
    const sorted = [...unlocked].sort((left, right) => {
      const leftBounds = boundsById.get(left.id)!
      const rightBounds = boundsById.get(right.id)!
      return horizontal
        ? leftBounds.left - rightBounds.left
        : leftBounds.top - rightBounds.top
    })
    const first = boundsById.get(sorted[0]!.id)!
    const last = boundsById.get(sorted.at(-1)!.id)!
    const span = horizontal ? last.right - first.left : last.bottom - first.top
    const totalSize = sorted.reduce((sum, item) => {
      const bounds = boundsById.get(item.id)!
      return sum + (horizontal ? bounds.width : bounds.height)
    }, 0)
    const gap = (span - totalSize) / (sorted.length - 1)
    let cursor = horizontal ? first.left : first.top
    const translations = new Map<string, number>()
    for (const item of sorted) {
      const bounds = boundsById.get(item.id)!
      const current = horizontal ? bounds.left : bounds.top
      translations.set(item.id, cursor - current)
      cursor += (horizontal ? bounds.width : bounds.height) + gap
    }
    return unlocked.map((item) => {
      const delta = translations.get(item.id) ?? 0
      return {
        nodeId: item.id,
        patch: horizontal ? { x: item.x + delta } : { y: item.y + delta },
      }
    })
  }
  const bounds = [...boundsById.values()]
  const left = Math.min(...bounds.map((item) => item.left))
  const right = Math.max(...bounds.map((item) => item.right))
  const top = Math.min(...bounds.map((item) => item.top))
  const bottom = Math.max(...bounds.map((item) => item.bottom))
  return unlocked.map((item) => {
    const visual = boundsById.get(item.id)!
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = left - visual.left
    else if (mode === 'center') dx = (left + right) / 2 - visual.centerX
    else if (mode === 'right') dx = right - visual.right
    else if (mode === 'top') dy = top - visual.top
    else if (mode === 'middle') dy = (top + bottom) / 2 - visual.centerY
    else dy = bottom - visual.bottom
    return { nodeId: item.id, patch: { x: item.x + dx, y: item.y + dy } }
  })
}

export function usePropertiesAuthoringBinding({
  onReplaceImage,
}: {
  onReplaceImage(): void
}): PropertiesContext {
  const read = useEditorStore(selectPropertiesAuthoringReadModel)
  const runFlowAuthoringIntent = useEditorStore((state) => state.runFlowAuthoringIntent)
  const applyFlowCommand = useEditorStore((state) => state.applyFlowCommand)
  const runSpatialAuthoringIntent = useEditorStore((state) => state.runSpatialAuthoringIntent)
  const applySlideCandidateCommand = useEditorStore((state) => state.applySlideCandidateCommand)
  const updateRuntimePropertyAtTarget = useEditorStore((state) => state.updateRuntimePropertyAtTarget)
  const updateRuntimeContentTextAtTarget = useEditorStore((state) => state.updateRuntimeContentTextAtTarget)
  const beginTextEdit = useEditorStore((state) => state.beginTextEdit)
  const updateTextEditDraft = useEditorStore((state) => state.updateTextEditDraft)
  const commitTextEdit = useEditorStore((state) => state.commitTextEdit)
  const cancelTextEdit = useEditorStore((state) => state.cancelTextEdit)
  const clearNodePresentationOverride = useEditorStore(
    (state) => state.clearNodePresentationOverride,
  )
  const updateScene = useEditorStore((state) => state.updateScene)
  const updatePresentationState = useEditorStore((state) => state.updatePresentationState)
  const updatePlayback = useEditorStore((state) => state.updatePlayback)
  const updateDesignTokens = useEditorStore((state) => state.updateDesignTokens)
  const ensureTeacherController = useEditorStore((state) => state.ensureTeacherController)
  const setCandidateGlobalLayerVisibleAtLocation = useEditorStore(
    (state) => state.setCandidateGlobalLayerVisibleAtLocation,
  )
  const setCandidateGlobalLayerLocationVisibility = useEditorStore(
    (state) => state.setCandidateGlobalLayerLocationVisibility,
  )
  const updateGlobalLayerSettings = useEditorStore((state) => state.updateGlobalLayerSettings)
  const addGlobalInteractionRule = useEditorStore((state) => state.addGlobalInteractionRule)
  const deleteGlobalInteractionRule = useEditorStore((state) => state.deleteGlobalInteractionRule)
  const updateInteractionRuleAtTarget = useEditorStore(
    (state) => state.updateInteractionRuleAtTarget,
  )
  const setEditorMode = useEditorStore((state) => state.setEditorMode)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const setError = useEditorStore((state) => state.setError)
  const setStatus = useEditorStore((state) => state.setStatus)

  const readLive = () => selectPropertiesAuthoringReadModel(useEditorStore.getState())

  const reportError = (message: string) => {
    setError(message)
    setStatus(null)
  }
  const reportStatus = (message: string) => {
    setError(null)
    setStatus(message)
  }
  const capturedOwnerKey = ownerIdentityKey(read)
  const ownerIsLive = () => ownerIdentityKey(readLive()) === capturedOwnerKey
  const requireLiveOwner = () => {
    if (ownerIsLive()) return true
    reportError(STALE_PROPERTY_TARGET)
    return false
  }

  const runtimeContexts = buildRuntimePropertiesContexts({
    view: read.runtimeView,
    editingScope: read.editingScope,
    updateProperty: updateRuntimePropertyAtTarget,
    updateContentText: updateRuntimeContentTextAtTarget,
    report: (feedback) => {
      if (feedback.kind === 'error') reportError(feedback.message)
      else reportStatus(feedback.message)
    },
  })
  const flowOwner = buildFlowPropertiesOwner({
    view: read.flow?.view ?? null,
    selection: read.flow?.selection ?? null,
    assets: read.flow?.assets ?? {},
    textEdit: read.flow?.textEdit ?? null,
    authoringToken: read.authoringToken,
    runIntent: runFlowAuthoringIntent,
    reportError,
  })
  const spatialOwner = buildSpatialPropertiesOwner({
    view: read.spatial?.view ?? null,
    scope: read.spatial?.scope ?? 'world',
    selectionIds: read.spatial?.selectionIds ?? [],
    showCameraFrames: read.spatial?.showCameraFrames ?? false,
    contentEdit: read.spatial?.contentEdit ?? null,
    graphSelection: read.spatial?.graphSelection ?? null,
    playbackPathId: read.spatial?.playbackPathId ?? null,
    authoringToken: read.authoringToken,
    runIntent: runSpatialAuthoringIntent,
    reportError,
    professionalInteraction: read.editorMode === 'professional'
      ? {
          editingScopeGlobal: read.editingScope === 'global',
          onOpenAutomation: () => setActiveTab('automation'),
        }
      : null,
  })

  if (flowOwner.status === 'stale') {
    return { kind: 'stale-target', reason: flowOwner.reason }
  }
  if (spatialOwner.status === 'stale') {
    return { kind: 'stale-target', reason: spatialOwner.reason }
  }
  const captureSpatialLayerTarget = (nodeId: string): CourseAuthoringTarget | null => {
    const spatial = read.spatial
    const token = read.authoringToken
    if (!spatial || !token) return null
    try {
      return captureSpatialEditorAuthoringTarget({
        view: spatial.view,
        sessionToken: token,
        target: { kind: 'layer', layerItemId: nodeId, field: 'item' },
      })
    } catch {
      return null
    }
  }
  const runSpatialLayerUpdates = (
    targets: readonly CourseAuthoringTarget[],
    updates: readonly { readonly nodeId: string; readonly patch: EditorCanvasNodePatch }[],
    capturedEdit: SpatialWorldContentEditSession | null,
  ) => {
    if (!targets[0] || targets.length !== updates.length || !requireLiveOwner()) return
    const receipt = runSpatialAuthoringIntent(targets[0], {
      kind: 'patch-layers',
      updates: updates.map((update, index) => ({
        target: targets[index]!,
        patch: update.patch,
      })),
      expectedSelectionIds: [...(read.spatial?.selectionIds ?? [])],
      expectedContentEdit: capturedEdit,
    })
    if (!receipt.ok) reportError(receipt.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
  }

  if (read.selectedViews.length > 1) {
    const viewsById = new Map(read.selectedViews.map((item) => [item.id, item]))
    const rowsById = new Map(read.selectedRows.map((row) => [row.id, row]))
    const items = read.selectedNodeIds.flatMap((id) => {
      const item = viewsById.get(id)
      return item ? [item] : []
    })
    if (items.length !== read.selectedNodeIds.length) {
      return { kind: 'stale-target', reason: '所选元素已失效，请重新选择。' }
    }
    const flowMode = Boolean(read.flow)
    const spatialMode = Boolean(read.spatial)
    const slideSession = read.slideSessionIdentity
    const slideTargets = !read.flow && !read.spatial && slideSession
      ? read.selectedNodeIds.flatMap((id) => {
          const row = rowsById.get(id)
          if (
            !row
            || row.owner === 'world'
            || row.owner !== slideSession.scope
            || row.scopeToken.locationId !== slideSession.locationId
            || row.scopeToken.stateId !== slideSession.stateId
          ) return []
          return [Object.freeze({
            sessionId: slideSession.sessionId,
            revision: slideSession.revision,
            generation: slideSession.generation,
            authoringAddress: row.authoringAddress,
            scope: slideSession.scope,
            layerItemId: row.id,
          }) satisfies SlideAuthoringTarget]
        })
      : []
    const slideMode = slideTargets.length === read.selectedNodeIds.length
    const flowTargets = flowMode && read.flow
      ? read.selectedNodeIds.flatMap((id) => {
          const row = rowsById.get(id)
          if (
            !row
            || (row.owner !== 'global' && row.owner !== 'surface')
            || row.scopeToken.locationId !== read.flow!.selection.locationId
          ) return []
          return [Object.freeze({
            authoringAddress: row.authoringAddress,
            locationId: row.scopeToken.locationId,
            stateId: null,
          }) satisfies EffectiveLayerCommandTarget]
        })
      : []
    const spatialTargets = spatialMode
      ? items.map((item) => captureSpatialLayerTarget(item.id))
      : []
    const capturedEdit = read.spatial?.contentEdit ?? null
    if (
      (!slideMode && !spatialMode && !flowMode)
      || (flowMode && flowTargets.length !== read.selectedNodeIds.length)
    ) {
      return { kind: 'stale-target', reason: COURSE_AUTHORING_STALE_SESSION_REASON }
    }
    const runFlowMultiUpdates = (
      updates: readonly { readonly nodeId: string; readonly patch: EditorCanvasNodePatch }[],
    ) => {
      if (!read.flow || !requireLiveOwner()) return
      const live = readLive().flow
      if (!live) {
        reportError(STALE_PROPERTY_TARGET)
        return
      }
      const targetsById = new Map(read.selectedNodeIds.map((id, index) => [id, flowTargets[index]!]))
      const planned = [] as Parameters<typeof patchEffectiveLayerPropertiesAtTargets>[1][number][]
      for (const update of updates) {
        const target = targetsById.get(update.nodeId)
        const row = rowsById.get(update.nodeId)
        if (!target || !row) {
          reportError(STALE_PROPERTY_TARGET)
          return
        }
        planned.push({
          target,
          patch: effectivePatchFromProperties(
            row.item,
            update.patch as PropertiesPatch,
          ),
        })
      }
      const result = patchEffectiveLayerPropertiesAtTargets(
        live.document,
        planned,
        { expectedRevision: read.identity.revision },
      )
      applyFlowCommand(result, { statusMessage: result.reason ?? null })
    }
    const applyUpdates = (
      updates: readonly { readonly nodeId: string; readonly patch: EditorCanvasNodePatch }[],
    ) => {
      if (updates.length === 0) return
      if (spatialMode) {
        if (spatialTargets.some((target) => !target)) {
          reportError(COURSE_AUTHORING_STALE_SESSION_REASON)
          return
        }
        runSpatialLayerUpdates(
          spatialTargets as CourseAuthoringTarget[],
          updates,
          capturedEdit,
        )
        return
      }
      if (flowMode) {
        runFlowMultiUpdates(updates)
        return
      }
      reportError(STALE_PROPERTY_TARGET)
    }
    const runSlideMulti = (intent: SlideMultiLayerPropertiesIntent) => {
      if (!slideMode || !slideSession) {
        reportError(STALE_PROPERTY_TARGET)
        return
      }
      const result = applySlideCandidateCommand((session) => (
        commitSlideMultiLayerIntentAtTargets(
          session,
          { targets: slideTargets, intent },
          { expectedRevision: slideSession.revision },
        )
      ))
      if (!result.ok) reportError(result.reason ?? STALE_PROPERTY_TARGET)
    }
    const context: MultiSelectionPropertiesContext = {
      kind: 'multi-selection',
      items,
      spatialMode,
      presentation: presentationView(read),
      commands: {
        setVisible: (visible) => slideMode
          ? runSlideMulti({ kind: 'set-visible', visible })
          : applyUpdates(items.map((item) => ({ nodeId: item.id, patch: { visible } }))),
        setLocked: (locked) => slideMode
          ? runSlideMulti({ kind: 'set-locked', locked })
          : applyUpdates(items.map((item) => ({ nodeId: item.id, patch: { locked } }))),
        align: (mode) => slideMode
          ? runSlideMulti({ kind: 'align', mode })
          : applyUpdates(computedMultiUpdates(items, mode)),
        distribute: (axis) => slideMode
          ? runSlideMulti({ kind: 'distribute', axis })
          : applyUpdates(computedMultiUpdates(
              items,
              axis === 'horizontal' ? 'distribute-horizontal' : 'distribute-vertical',
            )),
        duplicate: spatialMode || flowMode ? null : () => runSlideMulti({ kind: 'duplicate' }),
        remove: spatialMode
          ? null
          : flowMode
            ? () => {
                if (!read.flow || !requireLiveOwner()) return
                const live = readLive().flow
                if (!live) {
                  reportError(STALE_PROPERTY_TARGET)
                  return
                }
                const result = executeFlowDelete(
                  live.document,
                  read.flow.selection,
                  { expectedRevision: read.identity.revision },
                )
                applyFlowCommand(result, { statusMessage: result.reason ?? null })
              }
            : () => runSlideMulti({ kind: 'delete' }),
      },
      unavailableReason: spatialMode
        ? 'Spatial 多选复制与删除尚未接入一次提交，因此当前不会执行部分写入。'
        : flowMode
          ? 'Flow 多选复制尚未接入一次提交；删除与批量属性仍可正常使用。'
        : null,
    }
    return context
  }

  if (
    flowOwner.status === 'active'
    && flowOwner.context
    && flowOwner.context.kind !== 'flow-page'
  ) return flowOwner.context

  if (
    spatialOwner.status === 'active'
    && !spatialOwner.editingGlobal
    && spatialOwner.graphContext
  ) return spatialOwner.graphContext

  if (read.selectedNodeIds.length > 0 && read.selectedViews.length === 0) {
    return { kind: 'stale-target', reason: '所选元素已失效，请重新选择。' }
  }

  const slideTarget = makeSlideTarget(read)
  const node = read.selectedView
  const selectedRow = read.selectedRow

  if (
    node
    && selectedRow
    && !read.flow
    && !read.spatial
    && !slideTarget
  ) {
    return { kind: 'stale-target', reason: COURSE_AUTHORING_STALE_SESSION_REASON }
  }

  const patchSelectedNode = (patch: PropertiesPatch) => {
    if (!node || !selectedRow || !requireLiveOwner()) return
    const normalized = normalizePropertiesPatch(node, patch)
    if (read.spatial) {
      const target = captureSpatialLayerTarget(node.id)
      if (!target) {
        reportError(COURSE_AUTHORING_STALE_SESSION_REASON)
        return
      }
      runSpatialLayerUpdates(
        [target],
        [{ nodeId: node.id, patch: normalized as EditorCanvasNodePatch }],
        read.spatial.contentEdit,
      )
      return
    }
    if (slideTarget) {
      const result = applySlideCandidateCommand((session) => (
        node.type === 'teacher-controller'
          ? commitTeacherControllerPropertiesAtTarget(
              session,
              slideTarget,
              effectivePatchFromProperties(selectedRow.item, normalized),
              { expectedRevision: slideTarget.revision },
            )
          : patchSlideLayerPropertiesAtTarget(
              session,
              slideTarget,
              effectivePatchFromProperties(selectedRow.item, normalized),
              { expectedRevision: slideTarget.revision },
            )
      ))
      if (!result.ok) reportError(result.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
      return
    }
    reportError(COURSE_AUTHORING_STALE_SESSION_REASON)
  }

  const createSlideTextCommands = (textNode: TextNode): SlideNativeTextCommands => {
    if (!slideTarget) return dummyTextCommands()
    const boundEdit = read.textEdit?.kind === 'text'
      && read.textEdit.target.layerItemId === textNode.id
      && sameSlideContentTarget(read, slideTarget, read.textEdit.target, 'content.data.text')
      ? read.textEdit
      : null
    const readBoundEdit = () => {
      const live = readLive()
      return boundEdit
        && Object.is(live.textEdit, boundEdit)
        && sameSlideContentTarget(live, slideTarget, boundEdit.target, 'content.data.text')
        ? boundEdit
        : null
    }
    return {
      beginEdit: (source) => {
        if (!sameSlideTarget(readLive(), slideTarget)) {
          reportError(STALE_PROPERTY_TARGET)
          return
        }
        if (readBoundEdit()) return
        beginTextEdit(textNode.id, source)
      },
      commitEdit: () => {
        if (readBoundEdit()) commitTextEdit()
      },
      cancelEdit: () => {
        if (readBoundEdit()) cancelTextEdit()
      },
      updateDraft: (text) => {
        const edit = readBoundEdit()
        if (!edit) return
        const draft = edit.draft as V9SlideTextContentDraft
        const runs = remapTextRuns(draft.text, text, draft.runs)
        const width = draft.width ?? textNode.width
        const height = draft.height ?? textNode.height
        const draftNode = { ...textNode, text, runs, width, height }
        const rendered = textNode.style.overflow === 'auto-height'
          ? renderTextNodeCanvas(draftNode, width)
          : null
        updateTextEditDraft(
          textNode.id,
          text,
          runs,
          rendered?.height ?? height,
          rendered?.width ?? width,
        )
      },
      toggleStyle: (key, selection) => {
        if (!sameSlideTarget(readLive(), slideTarget)) return
        if (selection.end > selection.start) {
          const edit = readBoundEdit()
          if (!edit) return
          const styledEdit = applyV9SlideContentEditRunStyle(
            edit,
            selection.start,
            selection.end,
            { [key]: true },
          )
          const result = applySlideCandidateCommand(
            (session) => commitV9SlideContentEdit(session, styledEdit, {
              expectedRevision: edit.target.revision,
              expectedGeneration: edit.target.generation,
            }),
            { clearContentEdit: true },
          )
          if (!result.ok) reportError(result.reason ?? STALE_PROPERTY_TARGET)
          return
        }
        patchSelectedNode({ style: { [key]: !textNode.style[key] } } as PropertiesPatch)
      },
    }
  }

  const createSpatialTextCommands = (textNode: TextNode): SlideNativeTextCommands => {
    const capturedEdit = read.spatial?.contentEdit ?? null
    const layerTarget = captureSpatialLayerTarget(textNode.id)
    const boundEdit = capturedEdit?.kind === 'text'
      && capturedEdit.target.layerItemId === textNode.id
      && capturedEdit.courseTarget
      ? capturedEdit
      : null
    const readBoundEdit = () => {
      const live = readLive().spatial?.contentEdit ?? null
      return ownerIsLive() && boundEdit && Object.is(live, boundEdit) ? boundEdit : null
    }
    const dispatch = (
      target: CourseAuthoringTarget,
      intent: SpatialAuthoringIntent,
    ) => {
      const receipt = runSpatialAuthoringIntent(target, intent)
      if (!receipt.ok) reportError(receipt.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
    }
    return {
      beginEdit: (source) => {
        if (!layerTarget || !requireLiveOwner() || readBoundEdit()) return
        dispatch(layerTarget, {
          kind: 'begin-content-edit',
          source,
          expectedEdit: capturedEdit,
          expectedContentEdit: capturedEdit,
        })
      },
      commitEdit: () => {
        const edit = readBoundEdit()
        if (!edit || !edit.courseTarget) return
        const draft = edit.draft as V9SlideTextContentDraft
        dispatch(edit.courseTarget, {
          kind: 'commit-text-content-edit',
          expectedEdit: edit,
          expectedContentEdit: edit,
          text: draft.text,
          runs: draft.runs,
          width: draft.width,
          height: draft.height,
        })
      },
      cancelEdit: () => {
        const edit = readBoundEdit()
        if (!edit?.courseTarget) return
        dispatch(edit.courseTarget, {
          kind: 'cancel-content-edit',
          expectedEdit: edit,
          expectedContentEdit: edit,
        })
      },
      setComposing: (composing) => {
        const edit = readBoundEdit()
        if (!edit?.courseTarget || edit.composing === composing) return
        dispatch(edit.courseTarget, {
          kind: 'set-content-edit-composing',
          expectedEdit: edit,
          expectedContentEdit: edit,
          composing,
        })
      },
      updateDraft: (text) => {
        const edit = readBoundEdit()
        if (!edit?.courseTarget) return
        const draft = edit.draft as V9SlideTextContentDraft
        const runs = remapTextRuns(draft.text, text, draft.runs)
        const width = draft.width ?? textNode.width
        const height = draft.height ?? textNode.height
        const draftNode = { ...textNode, text, runs, width, height }
        const rendered = textNode.style.overflow === 'auto-height'
          ? renderTextNodeCanvas(draftNode, width)
          : null
        dispatch(edit.courseTarget, {
          kind: 'update-text-content-edit',
          expectedEdit: edit,
          expectedContentEdit: edit,
          text,
          runs,
          width: rendered?.width ?? width,
          height: rendered?.height ?? height,
        })
      },
      toggleStyle: (key, selection) => {
        const edit = readBoundEdit()
        if (edit?.courseTarget && selection.end > selection.start) {
          dispatch(edit.courseTarget, {
            kind: 'commit-text-run-style',
            expectedEdit: edit,
            expectedContentEdit: edit,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            patch: { [key]: true },
          })
          return
        }
        patchSelectedNode({ style: { [key]: !textNode.style[key] } } as PropertiesPatch)
      },
    }
  }

  const textCommands = node?.type === 'text'
    ? read.spatial
      ? createSpatialTextCommands(node)
      : slideTarget
        ? createSlideTextCommands(node)
        : dummyTextCommands()
    : dummyTextCommands()

  const sharedCommands = (): SlideNativePropertiesContext['commands'] => ({
    patch: patchSelectedNode,
    replaceImage: () => {
      if (requireLiveOwner()) onReplaceImage()
    },
    clearPresentationOverride: () => {
      if (node && read.activeState && requireLiveOwner()) {
        clearNodePresentationOverride(node.id)
      }
    },
    openAutomation: () => {
      if (ownerIsLive()) setActiveTab('automation')
    },
    openProfessionalAutomation: () => {
      if (!ownerIsLive()) return
      setEditorMode('professional')
      setActiveTab('automation')
    },
    text: textCommands,
  })

  const sceneInteraction = (): InteractionEditorProps | null => {
    if (
      read.editorMode !== 'professional'
      || read.identity.owner !== 'scene'
      || read.flow
      || read.spatial
      || !node
      || !selectedRow
      || !read.scene
      || !read.identity.projectId
      || !read.identity.locationId
      || !slideTarget
    ) return null
    const target: InteractionAuthoringTarget = Object.freeze({
      carrier: 'slide-scene',
      projectId: read.identity.projectId,
      baseRevision: read.identity.revision,
      locationId: read.identity.locationId,
      activeStateId: read.identity.stateId,
    })
    const scene = {
      id: read.scene.id,
      name: read.scene.name,
      nodes: read.interactionNodes,
      interactions: read.scene.interactions,
      presentation: read.slideScenes.find((candidate) => candidate.id === read.scene?.id)?.presentation,
    }
    return {
      scene,
      selectedNode: interactionLayerTargetFromItem(selectedRow.item),
      activeStateId: read.identity.stateId,
      scenes: read.slideScenes,
      sounds: read.sounds,
      courseState: read.courseState,
      ruleWarnings: read.interactionWarnings,
      onAddRule: (rule) => {
        if (!requireLiveOwner()) return
        const result = applySlideCandidateCommand((session) => (
          addSlideSceneInteractionRule(session, rule, {
            expectedRevision: target.baseRevision,
          })
        ))
        if (!result.ok) reportError(result.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
      },
      onUpdateRule: (ruleId, patch) => {
        if (!requireLiveOwner()) return
        const result = updateInteractionRuleAtTarget(target, ruleId, patch)
        if (!result.ok) reportError(result.reason)
      },
      onDeleteRule: (ruleId) => {
        if (!requireLiveOwner()) return
        const result = applySlideCandidateCommand((session) => (
          deleteSlideSceneInteractionRule(session, ruleId, {
            expectedRevision: target.baseRevision,
          })
        ))
        if (!result.ok) reportError(result.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
      },
    }
  }

  const globalInteraction = (): InteractionEditorProps | null => {
    if (
      read.editorMode !== 'professional'
      || !read.selectedIsGlobal
      || read.flow
      || read.spatial
      || !node
      || node.type === 'teacher-controller'
      || !selectedRow
      || !read.identity.projectId
    ) return null
    const target: InteractionAuthoringTarget = Object.freeze({
      carrier: 'global',
      projectId: read.identity.projectId,
      baseRevision: read.identity.revision,
      ...(read.identity.locationId ? { activeLocationId: read.identity.locationId } : {}),
      activeStateId: read.identity.stateId,
    })
    return {
      scene: {
        id: read.scene?.id ?? selectedRow.ownerKey,
        name: read.scene?.name ?? '当前页',
        nodes: read.interactionNodes,
        interactions: read.globalInteractions,
        presentation: read.slideScenes.find((candidate) => candidate.id === read.scene?.id)?.presentation,
      },
      selectedNode: interactionLayerTargetFromItem(selectedRow.item),
      sourceScope: 'global',
      sourceNodes: read.globalSourceNodes,
      sourceRules: read.globalInteractions,
      activeStateId: read.identity.stateId,
      scenes: read.slideScenes,
      sounds: read.sounds,
      courseState: read.courseState,
      onAddRule: (rule) => {
        if (requireLiveOwner()) addGlobalInteractionRule(rule)
      },
      onUpdateRule: (ruleId, patch) => {
        if (!requireLiveOwner()) return
        const result = updateInteractionRuleAtTarget(target, ruleId, patch)
        if (!result.ok) reportError(result.reason)
      },
      onDeleteRule: (ruleId) => {
        if (requireLiveOwner()) deleteGlobalInteractionRule(ruleId)
      },
    }
  }

  const feedback = (value: { kind: 'error' | 'status'; message: string }) => {
    if (value.kind === 'error') reportError(value.message)
    else reportStatus(value.message)
  }

  const projectCommands = {
    updatePlayback: (patch: Parameters<typeof updatePlayback>[0]) => {
      if (requireLiveOwner()) updatePlayback(patch)
    },
    ensureTeacherController: () => {
      if (requireLiveOwner()) ensureTeacherController()
    },
    updateDesignTokens: (tokens: Parameters<typeof updateDesignTokens>[0]) => {
      if (requireLiveOwner()) updateDesignTokens(tokens)
    },
    setVisibleAtLocation: (nodeId: string, visible: boolean) => {
      if (
        nodeId === read.selectedRow?.id
        && read.selectedRow.owner === 'global'
        && requireLiveOwner()
      ) setCandidateGlobalLayerVisibleAtLocation(nodeId, visible)
    },
    setLocationVisibility: (
      nodeId: string,
      visibility: Parameters<typeof setCandidateGlobalLayerLocationVisibility>[1],
    ) => {
      if (
        nodeId === read.selectedRow?.id
        && read.selectedRow.owner === 'global'
        && requireLiveOwner()
      ) setCandidateGlobalLayerLocationVisibility(nodeId, visibility)
    },
    updateLayerSettings: (
      nodeId: string,
      patch: Parameters<typeof updateGlobalLayerSettings>[1],
    ) => {
      if (
        nodeId === read.selectedRow?.id
        && read.selectedRow.owner === 'global'
        && requireLiveOwner()
      ) updateGlobalLayerSettings(nodeId, patch)
    },
  }

  const emptyGlobalContext = (): CourseGlobalPropertiesContext => ({
    kind: 'course-global',
    draftBindingKey: null,
    mode: 'empty',
    editorMode: read.editorMode,
    disabledReason: null,
    empty: {
      globalLayerCount: read.globalSummary.count,
      underlayCount: read.globalSummary.underlayCount,
      overlayCount: read.globalSummary.overlayCount,
      runtimeAvailable: read.runtimeView?.availability === 'available',
      playback: read.globalSummary.playback,
      hasTeacherController: read.globalSummary.hasTeacherController,
      designTokens: read.globalSummary.designTokens,
    },
    layer: null,
    selected: null,
    runtime: read.editorMode === 'professional' ? runtimeContexts.global : null,
    interaction: null,
    flowOrSpatial: Boolean(read.flow || read.spatial),
    editingScopeGlobal: read.editingScope === 'global',
    commands: {
      patch: () => undefined,
      replaceImage: onReplaceImage,
      clearPresentationOverride: () => undefined,
      ...projectCommands,
      openProfessionalAutomation: () => {
        if (ownerIsLive()) setActiveTab('automation')
      },
      text: dummyTextCommands(),
    },
    onFeedback: feedback,
  })

  if (!node || !selectedRow) {
    if (read.selectedIsGlobal) return emptyGlobalContext()
    if (flowOwner.status === 'active' && flowOwner.context) return flowOwner.context
    if (spatialOwner.status === 'active') return spatialOwner.pageContext
    if (read.identity.owner === 'surface') return { kind: 'empty-surface' }
    const scene = read.scene
    const sceneId = scene?.id ?? null
    const stateId = read.activeState?.id ?? null
    return {
      kind: 'empty-scene',
      draftBindingKey: propertyDraftBindingKey(read, sceneId ?? undefined),
      scene: scene
        ? {
            id: scene.id,
            name: scene.name,
            backgroundColor: scene.backgroundColor,
            interactionCount: scene.interactions.length,
            stateName: read.activeState?.name ?? null,
          }
        : null,
      editorMode: read.editorMode,
      runtime: read.editorMode === 'professional' ? runtimeContexts.scene : null,
      commands: {
        updateName: (name) => {
          if (sceneId && requireLiveOwner()) updateScene(sceneId, { name })
        },
        updateBackground: (backgroundColor) => {
          if (!sceneId || !requireLiveOwner()) return
          if (stateId) updatePresentationState(stateId, { backgroundColor })
          else updateScene(sceneId, { backgroundColor })
        },
        openAutomation: () => {
          if (ownerIsLive()) setActiveTab('automation')
        },
        openProfessionalAutomation: () => {
          if (!ownerIsLive()) return
          setEditorMode('professional')
          setActiveTab('automation')
        },
      },
      onStale: () => reportError(STALE_PROPERTY_TARGET),
    }
  }

  const notices = {
    surfaceBaseEditing: read.identity.owner === 'surface' && !read.flow && !read.spatial,
    sceneOwner: read.identity.owner === 'scene' && !read.flow && !read.spatial,
    presentationStateName: read.activeState?.name ?? null,
    stateOverrideApplied: Boolean(selectedRow.stateOverrideApplied),
  }
  const selectedComponent = componentPort(read, node)

  if (read.selectedIsGlobal || node.type === 'teacher-controller') {
    const controller = node.type === 'teacher-controller' ? node : null
    const controllerLayout = controller
      ? teacherControllerPropertiesPreview(controller, {
          x: controller.x,
          y: controller.y,
          width: controller.width,
          height: controller.height,
        })
      : null
    return {
      kind: 'course-global',
      draftBindingKey: propertyDraftBindingKey(read, node.id),
      mode: 'selected',
      editorMode: read.editorMode,
      disabledReason: null,
      empty: null,
      layer: read.globalLayer,
      selected: {
        view: node,
        notices,
        contentEditingEnabled: !read.spatial || read.spatial.scope === 'world',
        spatialMode: Boolean(read.spatial),
        videoDiagnostics: videoDiagnostics(read, node),
        controller,
        controllerPreview: controllerLayout
          ? {
              width: controllerLayout.width,
              height: controllerLayout.height,
              buttons: controllerLayout.buttons.map((button) => ({ label: button.label })),
            }
          : null,
        controllerScenes: read.slideScenes,
        component: selectedComponent,
      },
      runtime: null,
      interaction: globalInteraction(),
      flowOrSpatial: Boolean(read.flow || read.spatial),
      editingScopeGlobal: read.editingScope === 'global',
      commands: {
        ...sharedCommands(),
        ...projectCommands,
      },
      onFeedback: feedback,
    }
  }

  const animation = read.identity.owner === 'scene'
    && read.editorMode === 'simple'
    && !read.spatial
    && slideTarget
    ? {
        layerItemId: node.id,
        interactions: read.scene?.interactions ?? [],
        activeStateId: read.identity.stateId,
        onChange: (config: Parameters<typeof setSlideSimpleEntranceAnimation>[2]) => {
          if (!sameSlideTarget(readLive(), slideTarget)) {
            reportError(STALE_PROPERTY_TARGET)
            return
          }
          const result = applySlideCandidateCommand((session) => (
            setSlideSimpleEntranceAnimation(session, node.id, config, {
              expectedRevision: slideTarget.revision,
            })
          ))
          if (!result.ok) reportError(result.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
        },
        onOpenProfessional: () => {
          if (!sameSlideTarget(readLive(), slideTarget)) return
          setEditorMode('professional')
          setActiveTab('automation')
        },
      }
    : null

  return {
    kind: 'slide-native',
    draftBindingKey: propertyDraftBindingKey(read, node.id),
    view: node,
    target: { layerItemId: node.id },
    editorMode: read.editorMode,
    disabledReason: null,
    contentEditingEnabled: !read.spatial || read.spatial.scope === 'world',
    spatialMode: Boolean(read.spatial),
    flowOrSpatial: Boolean(read.flow || read.spatial),
    editingScopeGlobal: read.editingScope === 'global',
    notices,
    videoDiagnostics: videoDiagnostics(read, node),
    animation,
    interaction: sceneInteraction(),
    globalInteraction: null,
    component: selectedComponent,
    commands: sharedCommands(),
    onFeedback: feedback,
  }
}
