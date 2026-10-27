import type { ImportedImageAsset } from '../project/assetManager'
import type { MediaImportItem } from '../app/useMediaImport'
import type { WorkspaceMediaDropHandler } from '../lessonWorkspace/workspaceMediaDrop'
import { FlowWorkspaceConnector } from './workspaces/FlowWorkspaceConnector'
import { SlideWorkspaceConnector } from './workspaces/SlideWorkspaceConnector'
import { SpatialWorkspaceConnector } from './workspaces/SpatialWorkspaceConnector'
import { useWorkspaceRoute } from './workspaces/WorkspaceRouteContext'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { selectActiveSlideContentEdit, useEditorStore } from '../store/editorStore'
import { containerEditingPath, editingLevelInstanceId, globalContainerEditingLocation, groupEditingPath, isOrdinaryEditingGroup } from '../documents/containerEditingContext'
import { componentDefinitionBuiltinKey, componentIsLocked, componentSurface, isComponentVisibleAtSurface, owningContainer } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame, CourseProjectV10 } from '../../shared/contracts/component-platform'
import { isNativeFlowLayoutGroup } from '../../shared/flowNativeLayout'
import { useCourseV10Runtime } from '../components/CourseV10RuntimeView'
import { useComponentAuthorInteraction } from './workspaces/useComponentAuthorInteraction'
import { NativeSelectionContext } from '../workbench/NativeSelectionContext'
import { IDENTITY_MATRIX, invertMatrix, multiplyMatrices, translationMatrix, type AffineMatrix, type GeometryPoint } from '../../core/components/geometry'
import { FreeTransformGesture, type FreeObjectTarget, type FreeResizeHandle } from '../componentPlatform/surfaces/slide'
import { selectedRoots } from '../../core/course/courseObjectEdits'
import { capturedCourseViewIsCurrent, type CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { flowContentClientMatrix } from './flow/flowParagraphLayout'
import { selectionHandleGesture, SlideLayerSelectionOverlay } from './workspaces/SlideLayerSelectionOverlay'
import { OBJECT_EDIT_EVENT, requestImageEdit } from '../editing/commands/objectContextMenu'
import { useSlideNativeTextEditor } from './workspaces/useSlideNativeTextEditor'
import { componentInstanceDisplayName } from './properties/componentDefinitionPresentation'

interface WorkspaceProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
  onSelectMediaAsset?(kind: 'image' | 'audio' | 'video'): Promise<MediaImportItem | null>
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
}

export function Workspace({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
  onSelectMediaAsset,
  onDropWorkspaceMedia,
}: WorkspaceProps) {
  const route = useWorkspaceRoute()
  const view = useEditorStore(state => state.courseView)
  const retainedInputs = useEditorStore(state => state.retainedSlideContentEdits)
  const retained = (retainedInputs ?? []).filter(record => record.documentId === view.activeDocumentId)
  const selected = view.project?.instances[view.selectedInstanceId ?? '']
  const bridge = useEditorStore(state => state.courseBridge)
  const sharedLocation = view.project && selected?.container ? globalContainerEditingLocation(view.project, selected.id) : null
  const canEnterSelected = Boolean(selected?.container && view.project && view.rootInstanceId && containerEditingPath(view.project, view.rootInstanceId, selected.id) && (!sharedLocation || sharedLocation.path.every(id => isComponentVisibleAtSurface(view.project!.instances[id], view.rootInstanceId ?? ''))))
  const groupPath = view.project && view.activeGroupId ? groupEditingPath(view.project, view.surfaceId ?? view.rootInstanceId ?? null, view.activeGroupId) : null
  const selectedGroupPath = view.project && selected ? groupEditingPath(view.project, view.surfaceId ?? view.rootInstanceId ?? null, selected.id) : null
  const canEnterGroup = Boolean(selected && selected.id !== view.activeGroupId && selectedGroupPath
    && (!view.activeGroupId || selectedGroupPath.slice(0, -1).includes(view.activeGroupId))
    && selectedGroupPath.every(id => isComponentVisibleAtSurface(view.project!.instances[id], view.surfaceId ?? view.rootInstanceId ?? ''))
    && !(view.project && componentSurface(view.project, view.surfaceId ?? '')?.kind === 'flow'
      && isNativeFlowLayoutGroup(selected, view.project.definitions[selected.definitionId])))
  const groupRoot = groupPath?.[0]
  const groupPlane = groupRoot && view.project ? view.project.global.underlay.includes(groupRoot) ? 'underlay'
    : view.project.global.overlay.includes(groupRoot) ? 'overlay' : null : null
  const editingPlane = view.editingPlane ?? groupPlane
  const editingPath = groupPlane && !view.editingPlane ? groupPath ?? [] : [...(view.editingPath ?? []), ...(groupPath ?? [])]
  const editingLabels = editingPath.map(id => {
    const instance = view.project?.instances[id]
    if (instance?.name == null && id === view.rootInstanceId && view.project?.title != null) return view.project.title
    return componentInstanceDisplayName(instance, instance ? view.project?.definitions[instance.definitionId] : undefined)
  })
  const scopeControls = view.activeDocumentId && (view.activeGroupId || view.editingContainerId || canEnterSelected || canEnterGroup) ? <nav aria-label="容器编辑位置"
    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', flex: '0 0 auto' }}>
    {(view.activeGroupId || view.editingContainerId) && <button type="button" data-testid={view.activeGroupId ? 'group-edit-return' : 'container-edit-return'} onClick={() => {
      const documentId = view.activeDocumentId!
      void useEditorStore.getState().navigateCourseView(() => {
        if (view.activeGroupId) { bridge.leaveGroup(documentId); return }
        const returnShared = view.editingPlane && (view.editingPath?.length ?? 0) <= 1
        bridge.leaveContainer(documentId)
        if (returnShared) useEditorStore.getState().setEditingScope('global')
        if (returnShared) bridge.selectInstances(documentId, [view.editingContainerId!])
      })
    }}>返回上层</button>}
    <span>{editingPlane ? editingPlane === 'underlay' ? '共享底层 / ' : '共享浮层 / ' : ''}{editingLabels.join(' / ')}</span>
    {canEnterGroup && selected && <button type="button" data-testid="group-edit-enter" onClick={() => {
      const documentId = view.activeDocumentId!, groupId = selected.id
      void useEditorStore.getState().navigateCourseView(() => bridge.enterGroup(documentId, groupId))
    }}>进入组编辑</button>}
    {canEnterSelected && selected && selected.id !== view.surfaceId && <button type="button" data-testid="container-edit-enter" onClick={() => {
      const documentId = view.activeDocumentId!, containerId = selected.id
      void useEditorStore.getState().navigateCourseView(() => {
        bridge.enterContainer(documentId, containerId); useEditorStore.getState().setEditingScope('scene')
      })
    }}>进入容器编辑</button>}
  </nav> : null
  const retainedView = retained.length ? <details style={{ padding: '4px 10px', fontSize: 12 }}>
    <summary>保留的文字原稿（{retained.length}）</summary>
    <p>这些输入尚未应用，当前内容可以继续编辑。可复制原文后在对应位置接续。</p>
    {retained.map((record, index) => {
      const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : {}
      const raw = typeof payload.spotText === 'string' ? payload.spotText : JSON.stringify(payload.spotValue ?? payload.data ?? record.payload, null, 2)
      return <label key={`${record.key}:${index}`} style={{ display: 'block' }}>原稿 {index + 1}
        <textarea readOnly aria-label={`保留的文字原稿 ${index + 1}`} value={raw} rows={4} style={{ width: '100%' }} />
      </label>
    })}
  </details> : null
  const hasHeader = Boolean(scopeControls || retainedView)
  const frame = (content: ReactNode) => <div data-container-editor-frame="" style={{ display: 'grid', gridTemplateRows: hasHeader ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)', minWidth: 0, minHeight: 0 }}>
    {hasHeader && <div>{scopeControls}{retainedView}</div>}{content}
  </div>
  if (route.kind === 'conflict') {
    return (
      <main className="workspace" data-testid="workspace-route-conflict" role="alert">
        <p className="property-hint">{route.message}</p>
      </main>
    )
  }
  if (route.kind === 'program') return frame(<ProgramWorkspace rootInstanceId={route.rootInstanceId} onSelectImageAsset={onSelectImageAsset} />)
  if (route.kind === 'flow') return frame(<FlowWorkspaceConnector onDropWorkspaceMedia={onDropWorkspaceMedia} onSelectImageAsset={onSelectImageAsset} onSelectMediaAsset={onSelectMediaAsset} />)
  if (route.kind === 'spatial') return frame(<SpatialWorkspaceConnector onDropWorkspaceMedia={onDropWorkspaceMedia} onSelectImageAsset={onSelectImageAsset} />)
  return frame(
    <SlideWorkspaceConnector
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
      onDropWorkspaceMedia={onDropWorkspaceMedia}
    />
  )
}

/** A program consumes the actual workspace viewport and the existing component runtime. */
function ProgramWorkspace({ rootInstanceId, onSelectImageAsset }: { rootInstanceId: string; onSelectImageAsset(): Promise<ImportedImageAsset | null> }) {
  const runtime = useCourseV10Runtime()
  const canvasMode = useEditorStore(state => state.canvasMode)
  const view = useEditorStore(state => state.courseView), bridge = useEditorStore(state => state.courseBridge)
  const root = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null)
  const contentDraft = useEditorStore(selectActiveSlideContentEdit)
  const [preview, setPreview] = useState<Record<string, ComponentFrame>>({})
  const objectPointer = useRef<{ pointerId: number; start: GeometryPoint; latest: GeometryPoint; ended: boolean; cancelled: boolean;
    target?: CapturedCourseTarget; gesture?: FreeTransformGesture; host?: HTMLElement; moved: boolean } | null>(null)
  const state = () => useEditorStore.getState()
  const objectId = (id: string) => {
    const current = bridge.read()
    return id === rootInstanceId ? current.activeGroupId ? null : id
      : editingLevelInstanceId(current.editingProject ?? runtime.project, rootInstanceId, id, current.activeGroupId ?? null)
  }
  const targetElement = (id: string) => runtime.world.targetElement?.(id)
    ?? [...(viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? [])].find(element => element.dataset.componentInstance === id)
  const wholeTarget = (id: string, project: CourseProjectV10 = runtime.project): FreeObjectTarget | null => {
    const instance = project.instances[id], element = targetElement(id), parent = owningContainer(project, id)
    // The program root fills its viewport. Its measured box is not an author frame.
    if (id === rootInstanceId || !instance?.frame || !element || element.dataset.componentPlacement !== 'free' || !parent) return null
    const matrix = flowContentClientMatrix(element)
    if (!matrix) return null
    // An input ACK can resize the author frame before React paints it. Remove
    // the transform actually rendered now; only its parent/client map is observed.
    const css = /^matrix\(([^)]+)\)$/.exec(element.style.transform)?.[1].split(',').map(Number)
    const renderedTransform: AffineMatrix = css?.length === 6 ? [css[0], css[1], css[2], css[3], css[4], css[5]] : instance.frame.transform
    return { instanceId: id, frame: instance.frame, parentToSurface: multiplyMatrices(matrix, invertMatrix(renderedTransform)),
      parent, ancestors: [], preserveAspectRatio: componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.image',
      ...(componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.text' ? { resizeMode: 'box' as const } : {}) }
  }
  const nativeTarget = (id: string) => {
    const target = wholeTarget(id, bridge.read().editingProject ?? runtime.project), box = viewport.current?.getBoundingClientRect()
    return target && box ? { ...target, parentToSurface: multiplyMatrices(translationMatrix(-box.left, -box.top), target.parentToSurface) } : null
  }
  const nativeText = useSlideNativeTextEditor({ project: runtime.project, surfaceId: runtime.surfaceId ?? rootInstanceId,
    readProject: () => bridge.read().editingProject ?? runtime.project, resolveTarget: nativeTarget,
    edit: contentDraft?.source === 'canvas' && !contentDraft.authorSpot ? contentDraft : null,
    fieldIsCurrent: identity => authorInteraction.fieldIsCurrent(identity),
    begin: id => state().beginSlideDataEdit(id), update: (...args) => state().updateSlideDataDraft(...args),
    updateSpot: (...args) => state().updateSlideSpotDraft(...args), commitInput: () => state().commitSlideContentInput(),
    commit: () => state().commitSlideContentEdit(), cancel: () => state().cancelTextEdit(), preserve: () => state().retainTextEdit(),
    undo: () => { void state().undo() }, redo: () => { void state().redo() }, host: () => viewport.current,
    report: message => state().setError(message), onSelectField: (spot, activate, read) => authorInteraction.selectNativeField(spot, activate, read),
  }, `${runtime.documentId}:${rootInstanceId}:${view.activeGroupId ?? ''}`)
  const captureNative = (id: string, client: GeometryPoint) => {
    const box = viewport.current?.getBoundingClientRect()
    return box ? nativeText.capture(id, { x: client.x - box.left, y: client.y - box.top }, client) : null
  }
  const cancelObjectPointer = () => {
    const pointer = objectPointer.current
    objectPointer.current = null; setPreview({})
    if (!pointer) return
    pointer.cancelled = true
    if (pointer.host?.hasPointerCapture?.(pointer.pointerId)) pointer.host.releasePointerCapture(pointer.pointerId)
  }
  const moveObjectPointer = (point: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}) => {
    const pointer = objectPointer.current
    if (!pointer || pointer.cancelled) return
    pointer.latest = point; pointer.moved ||= Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) >= 3
    if (!pointer.gesture || !pointer.moved) return
    if (!pointer.target || !capturedCourseViewIsCurrent(bridge.read(), pointer.target)) { cancelObjectPointer(); return }
    setPreview(Object.fromEntries(pointer.gesture.update(point, modifiers).edits.flatMap(edit => edit.type === 'frame.set' && edit.frame ? [[edit.instanceId, edit.frame]] : [])))
  }
  const finishObjectPointer = (point: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}) => {
    const pointer = objectPointer.current
    if (!pointer) return
    moveObjectPointer(point, modifiers); pointer.ended = true
    if (!pointer.gesture) return
    objectPointer.current = null; setPreview({})
    if (pointer.host?.hasPointerCapture?.(pointer.pointerId)) pointer.host.releasePointerCapture(pointer.pointerId)
    if (!pointer.moved || !pointer.target || !capturedCourseViewIsCurrent(bridge.read(), pointer.target)) return
    const edits = pointer.gesture.update(point, modifiers).edits.filter(edit => edit.type !== 'frame.set'
      || JSON.stringify(edit.frame) !== JSON.stringify(pointer.target!.editingProject.instances[edit.instanceId]?.frame))
    if (edits.length) void bridge.editCaptured(bridge.capture(edits, pointer.target), crypto.randomUUID()).catch(error => state().setError(String(error)))
  }
  const beginObjectPointer = (id: string, pointerId: number, point: GeometryPoint, mode: 'drag' | 'resize' | 'rotate' = 'drag', handle?: FreeResizeHandle, ended = false) => {
    cancelObjectPointer()
    const pointer = { pointerId, start: point, latest: point, ended, cancelled: false, moved: false } as NonNullable<typeof objectPointer.current>
    objectPointer.current = pointer
    void state().navigateCourseView(documentId => {
      if (pointer.cancelled || objectPointer.current !== pointer) return
      const current = bridge.read(), project = current.editingProject ?? runtime.project
      if (!project.instances[id]) return
      const selected = current.interactionSelection?.kind === 'objects' ? current.interactionSelection.instanceIds : []
      const ids = selected.includes(id) ? selected : [id]
      bridge.selectInstances(documentId, ids, runtime.surfaceId)
      const targets = selectedRoots(project, ids).flatMap(value => {
        const target = !componentIsLocked(project, value) && wholeTarget(value, project)
        return target ? [target] : []
      })
      if (!targets.length) { objectPointer.current = null; return }
      pointer.target = bridge.captureOwnedTarget(documentId)
      pointer.gesture = new FreeTransformGesture({ targets, mode, handle, pointer: point, surfaceToPointer: IDENTITY_MATRIX })
      if (pointer.ended) finishObjectPointer(pointer.latest)
      else { pointer.host = viewport.current ?? undefined; pointer.host?.setPointerCapture?.(pointerId); moveObjectPointer(pointer.latest) }
    }).catch(error => { cancelObjectPointer(); state().setError(String(error)) })
  }
  const editObject = (rawId: string, client?: GeometryPoint) => {
    const id = objectId(rawId), instance = id && runtime.project.instances[id]
    if (!id || !instance || componentIsLocked(runtime.project, id)) return
    if (componentDefinitionBuiltinKey(runtime.project.definitions[instance.definitionId]) === 'guoling.image') {
      bridge.selectInstances(runtime.documentId, [id], runtime.surfaceId)
      const epoch = bridge.read().snapshot?.epoch
      if (epoch) requestImageEdit({ documentId: runtime.documentId, epoch, itemId: id })
      return
    }
    const native = id === rawId && client ? captureNative(id, client) : null
    if (native) { void authorInteraction.beginNative(id, native); return }
    void state().navigateCourseView(documentId => {
      if (isOrdinaryEditingGroup(runtime.project, id)) bridge.enterGroup(documentId, id)
      else if (instance.container) bridge.enterContainer(documentId, id)
      else if (['guoling.text', 'guoling.formula'].includes(componentDefinitionBuiltinKey(runtime.project.definitions[instance.definitionId]) ?? '')) {
        bridge.selectInstances(documentId, [id], runtime.surfaceId); state().beginSlideDataEdit(id)
      }
    }).catch(error => state().setError(String(error)))
  }
  const authorInteraction = useComponentAuthorInteraction({ root, documentId: runtime.documentId, surfaceId: runtime.surfaceId ?? null,
    enabled: canvasMode === 'edit', contextKey: view.activeGroupId ?? '', selectImage: onSelectImageAsset, report: message => state().setError(message), wholeInstanceEditor: false,
    resolveObjectTarget: objectId, onObjectDoubleClick: editObject,
    onObjectPointer: (detail, point) => {
      if (detail.phase === 'start') { const id = objectId(detail.instanceId); if (id) beginObjectPointer(id, detail.pointerId ?? 0, point, 'drag', undefined, detail.released) }
      else if (detail.phase === 'update') moveObjectPointer(point, { shift: detail.shiftKey, alt: detail.altKey })
      else if (detail.phase === 'end') finishObjectPointer(point, { shift: detail.shiftKey, alt: detail.altKey })
      else if (detail.phase === 'cancel') cancelObjectPointer()
    } })
  useEffect(() => {
    const current = nativeText.resolveSelection(view.interactionSelection)
    if (current) authorInteraction.selectNativeField(current.spot, current.activate, current.read)
  }, [view.interactionSelection, runtime.project.revision, view.activeGroupId])
  const pointerHandlers = useRef({ moveObjectPointer, finishObjectPointer, cancelObjectPointer })
  pointerHandlers.current = { moveObjectPointer, finishObjectPointer, cancelObjectPointer }
  useEffect(() => {
    const move = (event: PointerEvent) => { if (objectPointer.current?.pointerId === event.pointerId) pointerHandlers.current.moveObjectPointer({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey }) }
    const end = (event: PointerEvent) => { if (objectPointer.current?.pointerId === event.pointerId) pointerHandlers.current.finishObjectPointer({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey }) }
    const cancel = (event: PointerEvent) => { if (objectPointer.current?.pointerId === event.pointerId) pointerHandlers.current.cancelObjectPointer() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && objectPointer.current) { event.preventDefault(); event.stopImmediatePropagation(); pointerHandlers.current.cancelObjectPointer() } }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true); window.addEventListener('lostpointercapture', cancel, true); window.addEventListener('keydown', escape, true)
    return () => { pointerHandlers.current.cancelObjectPointer(); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('lostpointercapture', cancel, true); window.removeEventListener('keydown', escape, true) }
  }, [])
  useEffect(() => { cancelObjectPointer() }, [canvasMode, rootInstanceId, view.activeGroupId, runtime.documentId])
  useEffect(() => { runtime.setPlaying(canvasMode === 'run') }, [runtime.setPlaying, canvasMode])
  useEffect(() => {
    const element = root.current
    if (!element || canvasMode !== 'edit') return
    const edit = (event: Event) => { const id = (event as CustomEvent<{ itemId: string }>).detail?.itemId; if (id && runtime.project.instances[id]) { event.preventDefault(); editObject(id) } }
    element.addEventListener(OBJECT_EDIT_EVENT, edit); return () => element.removeEventListener(OBJECT_EDIT_EVENT, edit)
  }, [canvasMode, runtime.project, view.activeGroupId])
  const authorTarget = authorInteraction.authorTarget, authorBounds = authorInteraction.authorBounds()
  const fieldTransformable = Boolean(authorTarget && authorInteraction.selectedSpot && !componentIsLocked(runtime.project, authorInteraction.selectedSpot.instanceId) && !contentDraft)
  const selectedTargets = view.interactionSelection?.kind === 'objects' ? view.interactionSelection.instanceIds.flatMap(id => {
    const target = objectPointer.current?.gesture?.targets.find(value => value.instanceId === id) ?? wholeTarget(id)
    return target ? [{ ...target, frame: preview[id] ?? target.frame }] : []
  }) : []
  const movable = selectedTargets.length > 0 && selectedTargets.every(target => !componentIsLocked(runtime.project, target.instanceId)) && !contentDraft
  const shownProject = Object.keys(preview).length ? { ...runtime.project, instances: { ...runtime.project.instances,
    ...Object.fromEntries(Object.entries(preview).map(([id, frame]) => [id, { ...runtime.project.instances[id], frame }])) } } : runtime.project
  const inContent = (target: EventTarget | null): target is Element => target instanceof Element
    && Boolean(viewport.current?.contains(target)) && !target.closest('[data-component-professional-editor],.selection-quick-bar,.text-edit-toolbar')
  return <main ref={root} className="workspace workspace--program" data-testid="program-workspace"
    onPointerDownCapture={event => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as FreeResizeHandle | 'move' | 'rotate' | undefined
      if (handle && canvasMode === 'edit') {
        const intent = selectionHandleGesture(handle)
        if (authorTarget) authorInteraction.beginTransform(event, intent.mode, intent.handle)
        else if (movable && selectedTargets[0]) { event.preventDefault(); event.stopPropagation(); beginObjectPointer(selectedTargets[0].instanceId, event.pointerId, { x: event.clientX, y: event.clientY }, intent.mode, intent.handle) }
        return
      }
      if (!inContent(event.target) || canvasMode !== 'edit' || event.button !== 0 || authorInteraction.pointerFromElement(event)) return
      const rawId = event.target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance, id = rawId && objectId(rawId)
      event.preventDefault(); event.stopPropagation()
      if (id) beginObjectPointer(id, event.pointerId, { x: event.clientX, y: event.clientY })
      else void state().navigateCourseView(documentId => bridge.selectInstances(documentId, [], runtime.surfaceId))
    }}
    onClickCapture={event => { if (canvasMode === 'edit' && inContent(event.target)) { event.preventDefault(); event.stopPropagation() } }}
    onDoubleClickCapture={event => { if (canvasMode === 'edit' && inContent(event.target)) {
      cancelObjectPointer()
      const rawId = event.target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
      const native = rawId && objectId(rawId) === rawId ? captureNative(rawId, { x: event.clientX, y: event.clientY }) : null
      if (rawId && native) { event.preventDefault(); event.stopPropagation(); void authorInteraction.beginNative(rawId, native); return }
      if (authorInteraction.doubleClickFromElement(event)) return
      event.preventDefault(); event.stopPropagation(); if (rawId) editObject(rawId, { x: event.clientX, y: event.clientY })
    } }}
    onContextMenuCapture={event => { if (canvasMode === 'edit' && inContent(event.target) && !authorInteraction.contextMenuFromElement(event)) {
      const rawId = event.target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance, id = rawId && objectId(rawId)
      if (id) { event.preventDefault(); event.stopPropagation(); void state().navigateCourseView(documentId => { bridge.selectInstances(documentId, [id], runtime.surfaceId); authorInteraction.openContextMenu({ x: event.clientX, y: event.clientY }, id) }) }
    } }}
    style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0, minHeight: 0, flex: 1 }}>
    <NativeSelectionContext documentId={runtime.documentId} revision={runtime.project.revision} surfaceId={runtime.surfaceId}
      itemIds={runtime.selectedInstanceIds} enabled={canvasMode === 'edit'} textEditing={Boolean(contentDraft)}
      authorSpot={authorInteraction.selectedSpot} authorBounds={authorInteraction.authorBounds} bounds={id => {
        const rect = targetElement(id)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
      }} />
    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', padding: '6px 10px' }}>
      {(['edit', 'run'] as const).map(mode => <button key={mode} type="button" aria-pressed={canvasMode === mode} onClick={() => {
        void useEditorStore.getState().commitTextEdit().then(() => useEditorStore.getState().setCanvasMode(mode))
          .catch(error => useEditorStore.getState().setError(String(error)))
      }}>{mode === 'edit' ? '编辑' : '试运行'}</button>)}
      {canvasMode === 'edit' && <span role="status">单击选中，拖动对象；双击编辑，Esc 完成编辑</span>}
      <button type="button" onClick={() => runtime.selectInstances([rootInstanceId])}>选择程序</button>
    </div>
    <div ref={viewport} data-program-viewport="" style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      {runtime.project.global.underlay.map(id => runtime.renderInstance(id, shownProject, 'free'))}
      {runtime.renderInstance(rootInstanceId, shownProject, 'program')}
      {runtime.project.global.overlay.map(id => runtime.renderInstance(id, shownProject, 'free'))}
      {canvasMode === 'edit' && nativeText.editor}
      {canvasMode === 'edit' && (authorTarget ? <SlideLayerSelectionOverlay targets={[authorTarget]} scale={1} surfaceToPointer={IDENTITY_MATRIX}
        movable={fieldTransformable} resizable={fieldTransformable} rotatable={fieldTransformable} />
        : authorBounds ? <div data-program-field-selection="" aria-hidden="true" style={{ position: 'fixed', ...authorBounds, border: '1px solid #2563eb', pointerEvents: 'none' }} />
          : selectedTargets.length > 0 ? <SlideLayerSelectionOverlay targets={selectedTargets} scale={1} surfaceToPointer={IDENTITY_MATRIX}
            movable={movable} resizable={movable} rotatable={movable} /> : null)}
    </div>
    {authorInteraction.editor}
  </main>
}
