import { componentSurface } from '../../shared/contracts/component-platform/project'
import { Globe2, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { ComponentSurface, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { CapturedComponentOperation, CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import { useContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'
import { newPageCommands, pageCardCommands, type NewPageKind } from '../editing/commands/pageCommands'
import { useEditorStore } from '../store/editorStore'
import { LAST_COURSE_PAGE_REASON } from '../store/slices/courseStructureSlice'
import { ConfirmDialog } from './ConfirmDialog'
import { buildCourseTreeView, type CourseTreeNode } from './ScenePanel'
import { SceneStateStrip, SceneStateButtons } from './SceneStateStrip'
import { SceneThumbnail } from './SceneThumbnail'
import { changeCourseEditingScope } from './courseEditingScope'
import './bottomSceneNavigator.css'

type NavigatorCard = { key: string; page: CourseTreeNode; number: number } & (
  | { kind: ComponentSurface['kind']; surface: Readonly<ComponentSurface> }
  | { kind: 'program'; surface?: never }
)
const deleteScopeName = (card: NavigatorCard) => card.kind === 'slide' ? '整个演示场景'
  : card.kind === 'flow' ? '流式页' : card.kind === 'spatial' ? '无限画布' : '整个程序'
const deleteScopeContents = (card: NavigatorCard) => card.kind === 'slide' ? '页内全部对象和命名状态'
  : card.kind === 'flow' ? '全部正文、对象和局部区域' : card.kind === 'spatial' ? '全部对象和镜头' : '全部程序内容'
/** The rail consumes the same actual root directory as the tree and runtime navigation. */
export function buildBottomSceneCards(project: CourseProjectV10): NavigatorCard[] {
  return buildCourseTreeView(project).pages.map((page, index) => {
    const surface = componentSurface(project, page.id), identity = { key: page.id, page, number: index + 1 }
    return surface ? { ...identity, kind: surface.kind, surface } : { ...identity, kind: 'program' }
  })
}

export function CourseBottomNavigation({ documentId }: { documentId: string | null }) {
  const { mode } = useCourseEditorChrome()
  const isSlide = useEditorStore(state => Boolean(state.courseView.project && componentSurface(state.courseView.project, state.courseView.surfaceId ?? '')?.kind === 'slide'))
  return mode === 'light' ? <BottomSceneNavigator documentId={documentId} /> : isSlide ? <SceneStateStrip /> : null
}
const PAGE_DRAG_TYPE = 'application/x-guoling-page-card'

function RenameField({ label, value, onCommit, onCancel }: { label: string; value: string; onCommit(name: string): void; onCancel(): void }) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const name = draft.trim()
    if (commit && name && name !== value) onCommit(name)
    else onCancel()
  }
  return <input className="bottom-scene-card__rename" aria-label={label} value={draft} autoFocus onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)} onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    }} />
}

export function BottomSceneNavigator({ documentId }: { documentId: string | null }) {
  const view = useEditorStore(state => state.courseView)
  const editingScope = useEditorStore(state => state.editingScope)
  const canvasMode = useEditorStore(state => state.canvasMode)
  const spatialViews = useEditorStore(state => state.spatialViewStates)
  const track = useRef<HTMLOListElement>(null)
  const cards = useMemo(() => view.project ? buildBottomSceneCards(view.project) : [], [view.project])
  const menu = useContextMenu()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingCamera, setRenamingCamera] = useState<{ surfaceId: string; frameId: string; title: string; target: CapturedCourseTarget } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ card: NavigatorCard; captured: CapturedComponentOperation } | null>(null)
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null)
  useEffect(() => { track.current?.querySelector<HTMLElement>('[data-current-card="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [view.rootInstanceId, view.surfaceId, view.activeDocumentId])
  if (!view.project || !cards.length || !documentId) return null
  const project = view.project
  const liveStore = () => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) { state.setError('文档已切换，请在当前 果铃工程重新选择页面。'); return null }
    return state
  }
  const goTo = async (node: CourseTreeNode) => {
    const state = liveStore()
    const project = state?.courseView.project
    if (!state || !project || !project.rootIds.includes(node.surfaceId) && !componentSurface(project, node.surfaceId)) return
    await state.navigateCourseView(() => {
      if (node.kind === 'container') {
        if (node.rootInstanceId && state.courseBridge.read().rootInstanceId !== node.rootInstanceId) state.courseBridge.selectSurface(documentId, node.rootInstanceId)
        state.courseBridge.enterContainer(documentId, node.surfaceId)
        state.setEditingScope('scene')
        return
      }
      state.courseBridge.selectSurface(documentId, node.surfaceId)
      state.setEditingScope('scene')
      if (node.instanceId) state.activateFlowHeading(node.surfaceId, node.instanceId)
      else if (node.frameId) state.activateSpatialCameraFrame(node.surfaceId, node.frameId)
      else if (node.kind === 'spatial-page') state.activateSpatialCameraFrame(node.surfaceId, null)
    })
  }
  const moveSurface = (surfaceId: string, toIndex: number) => {
    const ids = [...project.rootIds], from = ids.indexOf(surfaceId)
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || toIndex === from) return
    ids.splice(from, 1); ids.splice(toIndex, 0, surfaceId)
    const state = liveStore()
    if (!state) return
    if (ids.some(id => !project.instances[id]?.container))
      void state.courseBridge.edit(ids.map((instanceId, index) => ({ type: 'instance.move', instanceId, container: { kind: 'project' }, index })))
        .catch(error => state.setError(error instanceof Error ? error.message : String(error)))
    else void state.reorderCourseSurfaces(ids)
  }
  const addPage = (kind: NewPageKind, surfaceId?: string) => {
    const state = liveStore()
    if (!state) return
    void state.addCourseContent(kind, { surfaceId: surfaceId ?? view.surfaceId ?? undefined })
  }
  const requestDelete = (card: NavigatorCard) => {
    const state = liveStore()
    if (!state) return
    try {
      if (card.kind !== 'program') { setPendingDelete({ card, captured: state.captureCourseSurfaceDelete(card.key) }); return }
      const target = state.courseBridge.captureTarget(documentId)
      if (target.project.rootIds.length <= 1) throw new Error('这是最后一项作品内容，不能删除')
      const next = target.project.rootIds.find(id => id !== card.key)
      const captured = state.courseBridge.capture([
        ...(target.project.entry?.rootInstanceId === card.key ? [{ type: 'project.entry.set' as const, entry: next ? { rootInstanceId: next } : null }] : []),
        { type: 'instance.remove', instanceId: card.key },
      ], target)
      setPendingDelete({ card, captured })
    }
    catch (error) { state.setError(error instanceof Error ? error.message : '删除目标已改变') }
  }
  const cardCommands = (card: NavigatorCard): MenuCommand[] => {
    const index = project.rootIds.indexOf(card.key)
    if (card.kind === 'program') return [
      { id: 'program.rename', label: '重命名', group: 'edit', run: () => setRenaming(card.key) },
      { id: 'program.move-before', label: '前移', group: 'order', disabledReason: index <= 0 ? '已是第一项内容' : null, run: () => moveSurface(card.key, index - 1) },
      { id: 'program.move-after', label: '后移', group: 'order', disabledReason: index >= cards.length - 1 ? '已是最后一项内容' : null, run: () => moveSurface(card.key, index + 1) },
      { id: 'program.delete', label: '删除程序', group: 'danger', danger: true, disabledReason: project.rootIds.length <= 1 ? '这是最后一项作品内容，不能删除' : null, run: () => requestDelete(card) },
    ]
    return pageCardCommands({ kind: card.kind === 'slide' ? 'scene' : 'page', index, count: cards.length, deleteBlocked: project.rootIds.length <= 1 ? LAST_COURSE_PAGE_REASON : null }, {
      addScene: () => addPage('scene', card.key),
      duplicate: () => { const state = liveStore(); if (state) void state.duplicateCourseLocation(card.key) },
      rename: () => setRenaming(card.key), remove: () => requestDelete(card), move: delta => moveSurface(card.key, index + delta),
    })
  }
  const renameCard = (card: NavigatorCard, name: string) => {
    const state = liveStore()
    if (!state) return
    if (card.kind === 'program') void state.courseBridge.edit([{ type: 'instance.patch', instanceId: card.key, patch: { name } }])
      .catch(error => state.setError(error instanceof Error ? error.message : String(error)))
    else void state.renameCourseSurface(card.key, name)
  }
  const captureCamera = (surfaceId: string): CapturedCourseTarget | null => {
    const state = liveStore()
    if (!state) return null
    try { const target = state.courseBridge.captureTarget(documentId); return { ...target, surfaceId, activeStateId: null, editingProject: target.project } }
    catch (error) { state.setError(error instanceof Error ? error.message : '镜头目标已改变'); return null }
  }
  const startCameraRename = (card: NavigatorCard, child: CourseTreeNode) => {
    const target = captureCamera(card.key)
    if (target && child.frameId) setRenamingCamera({ surfaceId: card.key, frameId: child.frameId, title: child.label, target })
  }
  const cameraCommands = (card: NavigatorCard, child: CourseTreeNode): MenuCommand[] => [
    { id: 'camera.rename', label: '重命名镜头', group: 'edit', run: () => startCameraRename(card, child) },
    { id: 'camera.delete', label: '删除镜头', group: 'edit', danger: true, run: () => {
      const target = captureCamera(card.key)
      if (target && child.frameId) void liveStore()?.deleteSpatialCameraFrame(card.key, child.frameId, target)
    } },
  ]
  const openMenu = (event: ReactMouseEvent, label: string, items: MenuCommand[]) => { event.preventDefault(); event.stopPropagation(); menu.open({ x: event.clientX, y: event.clientY }, label, items) }
  const dropTarget = (card: NavigatorCard) => drag && drag.key !== card.key ? cards.find(candidate => candidate.key === drag.key) ?? null : null
  const dragProps = (card: NavigatorCard) => ({
    draggable: renaming !== card.key,
    onDragStart: (event: ReactDragEvent) => { event.dataTransfer.setData(PAGE_DRAG_TYPE, card.key); event.dataTransfer.effectAllowed = 'move'; setDrag({ key: card.key, over: null }) },
    onDragOver: (event: ReactDragEvent) => { if (!event.dataTransfer.types.includes(PAGE_DRAG_TYPE) || !dropTarget(card)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (drag?.over !== card.key) setDrag(current => current ? { ...current, over: card.key } : current) },
    onDrop: (event: ReactDragEvent) => { event.preventDefault(); const dragged = dropTarget(card); setDrag(null); if (dragged) moveSurface(dragged.key, cards.indexOf(card)) },
    onDragEnd: () => setDrag(null),
    'data-drop-target': drag?.over === card.key || undefined,
  })
  const globalEditing = editingScope === 'global'
  return <nav className="bottom-scene-nav" aria-label="场景与页面导航">
    <button type="button" className="bottom-scene-nav__scope" aria-label={globalEditing ? '返回当前内容' : '全局层（整课）'}
      aria-pressed={globalEditing} disabled={canvasMode === 'run'} title={canvasMode === 'run' ? '请先返回编辑模式' : globalEditing ? '返回进入全局层前的当前内容' : '编辑跨页面共用的全局元素'}
      onClick={() => { if (liveStore()) void changeCourseEditingScope(globalEditing ? 'scene' : 'global') }}>
      <Globe2 size={20} aria-hidden="true" /><strong>{globalEditing ? '返回当前内容' : '全局层'}</strong>
      <small>{globalEditing ? '正在编辑全局层' : `${project.global.underlay.length + project.global.overlay.length} 个整课元素`}</small>
    </button>
    <ol ref={track} className="bottom-scene-nav__track">
    {cards.map(card => {
      const active = (view.rootInstanceId ?? view.surfaceId) === card.key && editingScope !== 'global'
      const localActive = view.surfaceId === card.key && editingScope !== 'global'
      const renamingCard = renaming === card.key
      const children = card.kind === 'flow' || card.kind === 'program' ? card.page.children : card.page.children.flatMap(group => group.children)
      const activeCamera = spatialViews[documentId]?.[card.key]?.activeCameraFrameId ?? null
      const cameraChild = children.find(child => child.frameId === activeCamera)
      return <li key={card.key} className={'bottom-scene-card' + (card.kind !== 'slide' ? ' bottom-scene-card--' + card.kind : '') + (active ? ' bottom-scene-card--active' : '')}
        data-current-card={active} data-kind={card.kind} data-testid={(card.kind === 'slide' ? 'bottom-scene-' : card.kind === 'program' ? 'bottom-program-' : 'bottom-page-') + card.key}
        onClick={event => { if (!(event.target as Element).closest('button, input')) goTo(card.page) }}
        onContextMenu={event => openMenu(event, card.kind === 'program' ? '程序操作' : '页面操作', cardCommands(card))} {...dragProps(card)}>
        <div className="bottom-scene-card__header"><button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined} aria-label={(card.kind === 'program' ? '程序 ' : '页面 ') + card.number + '：' + card.page.label} onClick={() => goTo(card.page)}>
          {card.kind === 'slide' ? <SceneThumbnail locationId={card.key} /> : <span className="bottom-scene-card__surface-mark" aria-hidden="true">{card.kind === 'flow' ? '文' : card.kind === 'program' ? '程' : '空'}</span>}
        </button><div className="bottom-scene-card__identity"><div className="bottom-scene-card__meta"><small>{String(card.number).padStart(2, '0')} · {card.kind === 'slide' ? '演示页' : card.kind === 'flow' ? '流式布局' : card.kind === 'program' ? '程序' : '无限画布'}</small><button type="button" className="bottom-scene-card__delete" aria-label={`删除${deleteScopeName(card)}：${card.page.label}`}
          title={project.rootIds.length <= 1 ? LAST_COURSE_PAGE_REASON : `删除${deleteScopeName(card)}及${deleteScopeContents(card)}`}
          disabled={canvasMode === 'run' || project.rootIds.length <= 1} onClick={() => requestDelete(card)}>
          <Trash2 size={12} aria-hidden="true" />
        </button></div>{!renamingCard && <strong title={card.page.label}>{card.page.label}</strong>}</div></div>
        {renamingCard && <RenameField label={card.kind === 'program' ? '程序名称' : '页面名称'} value={card.page.label} onCommit={name => { setRenaming(null); renameCard(card, name) }} onCancel={() => setRenaming(null)} />}
        {card.kind === 'slide' ? <SceneStateButtons documentId={documentId} surfaceId={card.key} compact /> : <div className="bottom-scene-card__children" role="group" aria-label={card.page.label + '的' + (card.kind === 'flow' ? '标题与章节' : card.kind === 'program' ? '容器' : '镜头')}>
          {card.kind === 'spatial' && <>
            <button type="button" className="bottom-scene-card__tool" aria-label="从当前画面添加镜头" title="从当前画面添加镜头" disabled={!localActive} onClick={() => {
              const target = captureCamera(card.key)
              if (target) void liveStore()?.addSpatialCameraFrameFromSession(card.key, target)
            }}><Plus size={13} /></button>
            <button type="button" className="bottom-scene-card__tool" aria-label="镜头操作" title="镜头操作" aria-haspopup="menu" disabled={!localActive || !cameraChild}
              onClick={event => cameraChild && openMenu(event, '镜头操作', cameraCommands(card, cameraChild))}><MoreHorizontal size={13} /></button>
          </>}
          {card.kind === 'spatial' && children.length === 0 && <span className="bottom-scene-card__empty">暂无镜头</span>}
          {children.map(child => renamingCamera?.surfaceId === card.key && renamingCamera.frameId === child.frameId
            ? <RenameField key={child.id} label="镜头名称" value={renamingCamera.title} onCommit={name => {
              const edit = renamingCamera; setRenamingCamera(null)
              void liveStore()?.renameSpatialCameraFrame(edit.surfaceId, edit.frameId, name, edit.target)
            }} onCancel={() => setRenamingCamera(null)} /> : <button key={child.id} type="button" className="bottom-scene-card__child" data-kind={child.kind}
            aria-current={active && (child.instanceId ? view.selectedInstanceId === child.instanceId : activeCamera === child.frameId) ? 'location' : undefined}
            title={child.label} onClick={() => goTo(child)}
            onDoubleClick={child.frameId ? () => startCameraRename(card, child) : undefined}
            onContextMenu={child.frameId ? event => openMenu(event, '镜头操作', cameraCommands(card, child)) : undefined}>
            {child.kind === 'flow-heading' ? '标题 · ' : child.kind === 'flow-section' ? '章节 · ' : child.kind === 'container' ? '容器 · ' : '镜头 · '}{child.label}</button>)}
        </div>}
      </li>
    })}
    <li className="bottom-scene-nav__add"><button type="button" className="bottom-scene-nav__add-button" aria-label="新建页面" title="新建页面" aria-haspopup="menu" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      menu.open({ x: rect.left, y: rect.top - 4, above: true }, '新建页面', newPageCommands(kind => addPage(kind)))
    }}><Plus size={18} aria-hidden="true" /></button></li>
  </ol>{menu.element}
  <ConfirmDialog open={pendingDelete !== null} title={pendingDelete ? `删除${deleteScopeName(pendingDelete.card)}？` : '删除整页？'} message={pendingDelete ? `“${pendingDelete.card.page.label}”的${deleteScopeContents(pendingDelete.card)}将被删除。此操作可以撤销。` : ''} confirmLabel={pendingDelete?.card.kind === 'program' ? '删除程序' : '删除整页'} danger onCancel={() => setPendingDelete(null)} onConfirm={() => {
    const pending = pendingDelete; setPendingDelete(null)
    if (pending) {
      const state = liveStore()
      if (!state) return
      const operation = pending.card.kind === 'program' ? state.courseBridge.editCaptured(pending.captured) : state.deleteCourseSurface(pending.card.key, pending.captured)
      void operation.catch(error => state.setError(error instanceof Error ? error.message : String(error)))
    }
  }} /></nav>
}
