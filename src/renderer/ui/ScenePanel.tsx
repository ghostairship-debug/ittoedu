import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, Globe2, GripVertical, Layers3, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { useContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'
import { pageCardCommands } from '../editing/commands/pageCommands'
import type { CourseEditorLayoutResult } from '../course/courseEditorLayout'
import { LAST_COURSE_PAGE_REASON } from '../store/slices/courseStructureSlice'
import { flowBodyIds, projectFlowBlock } from '../componentPlatform/surfaces/flow/documentProjection'
import { plainDocumentText } from '../../shared/document/content'
import { selectHasDirtyCourseContentDraft, useEditorStore, type EditorState } from '../store/editorStore'
import { AddCourseContentMenu } from './AddCourseContentMenu'
import { ConfirmDialog } from './ConfirmDialog'

/** Navigation rows derive from formal surfaces and real component/camera targets. */
export interface CourseTreeNode {
  id: string
  kind: 'slide-page' | 'flow-page' | 'spatial-page' | 'flow-heading' | 'flow-section' | 'spatial-camera-group' | 'spatial-camera'
  label: string
  surfaceId: string
  instanceId?: string
  frameId?: string
  children: CourseTreeNode[]
}

export function buildCourseTreeView(project: CourseProjectV10): { pages: CourseTreeNode[] } {
  return { pages: project.surfaces.map(surface => {
    const children: CourseTreeNode[] = []
    if (surface.kind === 'flow') {
      const visit = (id: string) => {
        const instance = project.instances[id]
        if (!instance) return
        const block = projectFlowBlock(project, id)
        if (block.type === 'heading' || block.type === 'section') children.push({ id, kind: block.type === 'heading' ? 'flow-heading' : 'flow-section',
          label: plainDocumentText(block.type === 'heading' ? block.content : block.title) || '未命名标题', surfaceId: surface.id, instanceId: id, children: [] })
        instance.childIds?.forEach(visit)
      }
      flowBodyIds(project, surface.id).forEach(visit)
    }
    if (surface.kind === 'spatial') children.push({ id: surface.id + ':cameras', kind: 'spatial-camera-group', label: '镜头', surfaceId: surface.id,
      children: (surface.spatial?.frames ?? []).map(frame => ({ id: surface.id + ':camera:' + frame.id, kind: 'spatial-camera', label: frame.title ?? '未命名镜头', surfaceId: surface.id, frameId: frame.id, children: [] })) })
    return { id: surface.id, kind: surface.kind === 'slide' ? 'slide-page' : surface.kind === 'flow' ? 'flow-page' : 'spatial-page',
      label: surface.title, surfaceId: surface.id, children }
  }) }
}

export type CourseTreeReorderPlan = { kind: 'surfaces'; surfaceIds: string[] } | { kind: 'cameras'; surfaceId: string; frameIds: string[] }
export function planCourseTreeReorder(project: Pick<CourseProjectV10, 'surfaces'>, pages: readonly CourseTreeNode[], activeId: string, overId: string): CourseTreeReorderPlan | null {
  if (!activeId || !overId || activeId === overId) return null
  const from = pages.findIndex(page => page.id === activeId), to = pages.findIndex(page => page.id === overId)
  if (from >= 0 && to >= 0) return { kind: 'surfaces', surfaceIds: arrayMove(pages.map(page => page.surfaceId), from, to) }
  for (const surface of project.surfaces) {
    const frames = surface.spatial?.frames
    if (!frames) continue
    const ids = frames.map(frame => surface.id + ':camera:' + frame.id)
    const previous = ids.indexOf(activeId), next = ids.indexOf(overId)
    if (previous >= 0 && next >= 0) return { kind: 'cameras', surfaceId: surface.id, frameIds: arrayMove(frames.map(frame => frame.id), previous, next) }
  }
  return null
}

function layoutForProject(project: CourseProjectV10, activeSurfaceId: string | null): CourseEditorLayoutResult {
  const surface = project.surfaces.find(value => value.id === activeSurfaceId) ?? project.surfaces[0]
  const kinds = new Set(project.surfaces.map(value => value.kind))
  const action = surface?.kind === 'flow' ? 'flow-page' : surface?.kind === 'spatial' ? 'spatial-page' : 'scene'
  return { kind: kinds.size === 1 ? surface?.kind ?? 'mixed' : 'mixed', primary: { action, surfaceId: surface?.id },
    dropdown: (['slide-page', 'flow-page', 'spatial-page'] as const).filter(value => value !== (action === 'scene' ? 'slide-page' : action)), activeSurfaceId }
}

function SortableCourseTreeNode({ node, depth, row, nested }: { node: CourseTreeNode; depth: number; row: ReactNode; nested: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })
  return <div ref={setNodeRef} className="course-page-tree__node" data-kind={node.kind} data-testid={'course-page-node-' + node.id}
    style={{ marginLeft: depth * 14, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .55 : 1 }}>
    <div className="course-page-tree__row"><button type="button" className="drag-handle" title="拖动调整顺序" aria-label={'拖动“' + node.label + '”'} {...attributes} {...listeners}><GripVertical size={15} /></button>{row}</div>{nested}
  </div>
}

function CourseTreeNodeRow({ node, depth, activeSurfaceId, selectedInstanceId, activeCameraFrameId, onActivate, onDelete }: {
  node: CourseTreeNode; depth: number; activeSurfaceId: string | null; selectedInstanceId: string | null; activeCameraFrameId: string | null
  onActivate(node: CourseTreeNode): void; onDelete(node: CourseTreeNode): void
}) {
  const project = useEditorStore(state => state.courseView.project)
  const documentId = useEditorStore(state => state.courseView.activeDocumentId)
  const editingScope = useEditorStore(state => state.editingScope)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const menu = useContextMenu()
  const isPage = node.kind.endsWith('-page')
  const presentation = project?.surfaces.find(surface => surface.id === node.surfaceId)?.presentation
  const thumbnailStateId = presentation?.thumbnailStateId ?? presentation?.initialStateId
  const thumbnailStateName = node.kind === 'slide-page' ? presentation?.states.find(state => state.id === thumbnailStateId)?.title ?? '母版' : null
  const active = editingScope !== 'global' && activeSurfaceId === node.surfaceId
    && (node.instanceId ? selectedInstanceId === node.instanceId : node.frameId ? activeCameraFrameId === node.frameId : true)
  const live = () => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) { state.setError('文档已切换，请重新选择页面。'); return null }
    return state
  }
  const startRename = () => { setDraft(node.label); setEditing(true) }
  const commitRename = () => {
    const title = draft.trim(); setEditing(false)
    if (!title || title === node.label) return
    const state = live()
    if (!state) return
    if (isPage) void state.renameCourseSurface(node.surfaceId, title)
    else if (node.frameId) void state.renameSpatialCameraFrame(node.surfaceId, node.frameId, title)
    else if (node.instanceId) void state.renameFlowHeading(node.instanceId, title)
  }
  const commands = (): MenuCommand[] => {
    if (!project) return []
    if (isPage) {
      const ids = project.surfaces.map(surface => surface.id), index = ids.indexOf(node.surfaceId)
      return pageCardCommands({ kind: node.kind === 'slide-page' ? 'scene' : 'page', index, count: ids.length,
        deleteBlocked: ids.length <= 1 ? LAST_COURSE_PAGE_REASON : null }, {
        addScene: () => { const state = live(); if (state) void state.addCourseContent('scene', { surfaceId: node.surfaceId }).then(result => { if (result.ok && result.activatedLocationId) state.courseBridge.selectSurface(documentId!, result.activatedLocationId) }) },
        duplicate: () => { const state = live(); if (state) void state.duplicateCourseLocation(node.surfaceId).then(result => { if (result.ok && result.activatedLocationId) state.courseBridge.selectSurface(documentId!, result.activatedLocationId) }) },
        rename: startRename, remove: () => onDelete(node),
        move: delta => { const to = index + delta; const state = live(); if (state && to >= 0 && to < ids.length) void state.reorderCourseSurfaces(arrayMove(ids, index, to)) },
      })
    }
    if (node.frameId) return [
      { id: 'camera.rename', label: '重命名', run: startRename },
      { id: 'camera.delete', label: '删除镜头', danger: true, run: () => onDelete(node) },
    ]
    if (node.instanceId) return [{ id: 'heading.rename', label: '重命名', run: startRename }]
    return []
  }
  const nested = node.children.map(child => <CourseTreeNodeRow key={child.id} node={child} depth={depth + 1} activeSurfaceId={activeSurfaceId}
    selectedInstanceId={selectedInstanceId} activeCameraFrameId={activeCameraFrameId} onActivate={onActivate} onDelete={onDelete} />)
  if (node.kind === 'spatial-camera-group') return <div className="course-page-tree__node course-page-tree__node--camera-group" data-kind={node.kind} style={{ marginLeft: depth * 14 }}>
    <div className="spatial-page-tree__group course-page-tree__group-row"><span>镜头</span><button type="button" className="icon-button" data-testid="add-spatial-camera" aria-label="添加镜头" title="从当前画面添加镜头"
      onClick={() => { const state = live(); if (state) void state.addSpatialCameraFrameFromSession(node.surfaceId) }}><Plus size={14} /></button></div>
    <SortableContext items={node.children.map(child => child.id)} strategy={verticalListSortingStrategy}>{nested}</SortableContext>
  </div>
  const label = editing ? <input autoFocus className="scene-name-input" value={draft} maxLength={80} onChange={event => setDraft(event.target.value)}
    onBlur={commitRename} onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(false) }} /> : <span>{node.label}</span>
  const row = <><button type="button" className={'course-page-tree__label' + (active ? ' is-active' : '') + (node.instanceId ? ' course-page-tree__label--heading' : '')}
    aria-current={active ? 'page' : undefined} data-testid={node.kind === 'flow-page' ? 'flow-page-' + node.surfaceId : node.instanceId ? 'flow-heading-' + node.instanceId : node.frameId ? 'spatial-camera-' + node.id : 'scene-item-' + node.id}
    data-heading-level={node.kind === 'flow-heading' ? 1 : node.kind === 'flow-section' ? 2 : undefined} onClick={() => onActivate(node)}
    onDoubleClick={startRename} onContextMenu={event => { const items = commands(); if (items.length) { event.preventDefault(); menu.open({ x: event.clientX, y: event.clientY }, isPage ? '页面操作' : '位置操作', items) } }}>
    {isPage && <FileText size={14} />}{label}{thumbnailStateName && <small>缩略图 · {thumbnailStateName}</small>}</button>{menu.element}
    {(isPage || node.frameId) && <button type="button" className="icon-button icon-button--danger" aria-label={'删除' + (isPage ? '页面' : '镜头') + '“' + node.label + '”'}
      title={isPage && project?.surfaces.length === 1 ? LAST_COURSE_PAGE_REASON : '删除'} disabled={isPage && project?.surfaces.length === 1}
      onClick={event => { event.stopPropagation(); onDelete(node) }}><Trash2 size={14} /></button>}</>
  if (isPage || node.frameId) return <SortableCourseTreeNode node={node} depth={depth} row={row} nested={nested} />
  return <div className="course-page-tree__node" data-kind={node.kind} style={{ marginLeft: depth * 14 }}><div className="course-page-tree__row">{row}</div>{nested}</div>
}

export function ScenePanel() {
  const view = useEditorStore(state => state.courseView)
  const editingScope = useEditorStore(state => state.editingScope)
  const spatialViews = useEditorStore(state => state.spatialViewStates)
  const [pendingDelete, setPendingDelete] = useState<{ node: CourseTreeNode; captured: CapturedComponentOperation | CapturedCourseTarget; contentEdit: EditorState['slideContentEdit'] } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const project = view.project
  const treeView = useMemo(() => project ? buildCourseTreeView(project) : null, [project])
  const layout = useMemo(() => project ? layoutForProject(project, view.surfaceId) : null, [project, view.surfaceId])
  if (!project || !treeView || !layout || !view.activeDocumentId) return null
  const documentId = view.activeDocumentId
  const activeCameraFrameId = spatialViews[documentId]?.[view.surfaceId ?? '']?.activeCameraFrameId ?? null
  const activate = (node: CourseTreeNode) => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) return
    state.courseBridge.selectSurface(documentId, node.surfaceId)
    state.setEditingScope('scene')
    if (node.frameId) state.activateSpatialCameraFrame(node.surfaceId, node.frameId)
    else if (node.instanceId) state.activateFlowHeading(node.surfaceId, node.instanceId)
    else if (node.kind === 'spatial-page') state.activateSpatialCameraFrame(node.surfaceId, null)
  }
  const add = (action: 'scene' | 'slide-page' | 'flow-page' | 'spatial-page') => {
    const state = useEditorStore.getState()
    void state.addCourseContent(action, { surfaceId: view.surfaceId ?? undefined }).then(result => {
      if (result.ok && result.activatedLocationId && state.courseView.activeDocumentId === documentId) state.courseBridge.selectSurface(documentId, result.activatedLocationId)
    })
  }
  const requestDelete = (node: CourseTreeNode) => {
    const state = useEditorStore.getState()
    if (selectHasDirtyCourseContentDraft(state)) { state.setError('请先完成当前输入，再删除页面或镜头。'); return }
    try { setPendingDelete({ node, captured: node.frameId ? state.courseBridge.captureTarget(documentId) : state.captureCourseSurfaceDelete(node.surfaceId), contentEdit: state.slideContentEdit }) }
    catch (error) { state.setError(error instanceof Error ? error.message : '删除目标已改变') }
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const plan = planCourseTreeReorder(project, treeView.pages, String(active.id), String(over.id))
    if (!plan) return
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) return
    if (plan.kind === 'surfaces') void state.reorderCourseSurfaces(plan.surfaceIds)
    else void state.reorderSpatialCameraFrames(plan.surfaceId, plan.frameIds)
  }
  const globalLayerCount = project.global.underlay.length + project.global.overlay.length
  return <aside className="panel scene-panel" aria-label="课程结构">
    <div className="panel-header"><h2 className="panel-title">课程共享</h2></div>
    <div className="global-layer-entry-wrap"><button type="button" className={'global-layer-entry' + (editingScope === 'global' ? ' global-layer-entry--active' : '')} aria-pressed={editingScope === 'global'} data-testid="global-layer-entry" onClick={() => useEditorStore.getState().setEditingScope('global')}>
      <span className="global-layer-entry__icon"><Globe2 size={19} /></span><span className="global-layer-entry__content"><strong>全局层（整课）</strong><small>{globalLayerCount} 个元素</small></span><Layers3 size={16} /></button></div>
    <div className="scene-panel__divider" role="separator" /><div className="panel-header panel-header--course-structure"><h2 className="panel-title">课程结构</h2>
      <AddCourseContentMenu layout={layout} onPrimary={() => add(layout.primary.action)}
        onAddSlidePage={layout.dropdown.includes('slide-page') ? () => add('slide-page') : undefined}
        onAddFlowPage={layout.dropdown.includes('flow-page') ? () => add('flow-page') : undefined}
        onAddSpatialPage={layout.dropdown.includes('spatial-page') ? () => add('spatial-page') : undefined} /></div>
    <div className="course-page-tree" data-testid="course-page-tree"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={treeView.pages.map(page => page.id)} strategy={verticalListSortingStrategy}><div className="course-page-tree__list">
        {treeView.pages.map(page => <CourseTreeNodeRow key={page.id} node={page} depth={0} activeSurfaceId={view.surfaceId} selectedInstanceId={view.selectedInstanceId}
          activeCameraFrameId={activeCameraFrameId} onActivate={activate} onDelete={requestDelete} />)}
      </div></SortableContext></DndContext></div>
    <ConfirmDialog open={Boolean(pendingDelete)} title={pendingDelete?.node.frameId ? '删除镜头？' : '删除页面？'}
      message={pendingDelete ? '“' + pendingDelete.node.label + '”' + (pendingDelete.node.frameId ? '镜头' : '及其中的全部对象') + '将被删除。此操作可以撤销。' : ''}
      confirmLabel={pendingDelete?.node.frameId ? '删除镜头' : '删除页面'} danger onCancel={() => setPendingDelete(null)} onConfirm={() => {
        const pending = pendingDelete; setPendingDelete(null)
        if (!pending) return
        const state = useEditorStore.getState()
        if (state.courseView.activeDocumentId !== pending.captured.documentId || state.slideContentEdit !== pending.contentEdit || selectHasDirtyCourseContentDraft(state)) {
          state.setError('删除目标或当前输入已改变，请完成输入后重新确认。')
          return
        }
        const operation = pending.node.frameId
          ? state.deleteSpatialCameraFrame(pending.node.surfaceId, pending.node.frameId, pending.captured as CapturedCourseTarget)
          : state.deleteCourseSurface(pending.node.surfaceId, pending.captured as CapturedComponentOperation)
        void operation.catch(error => state.setError(error instanceof Error ? error.message : '删除失败，原内容已保留。'))
      }} />
  </aside>
}
