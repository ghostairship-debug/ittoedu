import { MoreHorizontal, Plus } from 'lucide-react'
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
import './bottomSceneNavigator.css'

type NavigatorCard = { kind: ComponentSurface['kind']; key: string; page: CourseTreeNode; surface: ComponentSurface; number: number }
/** The rail consumes the same real surface order as the tree and runtime navigation. */
export function buildBottomSceneCards(project: CourseProjectV10): NavigatorCard[] {
  return buildCourseTreeView(project).pages.map((page, index) => ({ kind: project.surfaces[index].kind, key: page.id, page, surface: project.surfaces[index], number: index + 1 }))
}

export function CourseBottomNavigation({ documentId }: { documentId: string | null }) {
  const { mode } = useCourseEditorChrome()
  const surface = useEditorStore(state => state.courseView.project?.surfaces.find(value => value.id === state.courseView.surfaceId))
  return mode === 'light' ? <BottomSceneNavigator documentId={documentId} /> : surface?.kind === 'slide' ? <SceneStateStrip /> : null
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
  const spatialViews = useEditorStore(state => state.spatialViewStates)
  const track = useRef<HTMLOListElement>(null)
  const cards = useMemo(() => view.project ? buildBottomSceneCards(view.project) : [], [view.project])
  const menu = useContextMenu()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingCamera, setRenamingCamera] = useState<{ surfaceId: string; frameId: string; title: string; target: CapturedCourseTarget } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ card: NavigatorCard; captured: CapturedComponentOperation } | null>(null)
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null)
  useEffect(() => { track.current?.querySelector<HTMLElement>('[data-current-card="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [view.surfaceId, view.activeDocumentId])
  if (!view.project || !cards.length || !documentId) return null
  const project = view.project
  const liveStore = () => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) { state.setError('文档已切换，请在当前 H5 演示重新选择页面。'); return null }
    return state
  }
  const goTo = (node: CourseTreeNode) => {
    const state = liveStore()
    if (!state || !state.courseView.project?.surfaces.some(surface => surface.id === node.surfaceId)) return
    state.courseBridge.selectSurface(documentId, node.surfaceId)
    state.setEditingScope('scene')
    if (node.instanceId) state.activateFlowHeading(node.surfaceId, node.instanceId)
    else if (node.frameId) state.activateSpatialCameraFrame(node.surfaceId, node.frameId)
    else if (node.kind === 'spatial-page') state.activateSpatialCameraFrame(node.surfaceId, null)
  }
  const moveSurface = (surfaceId: string, toIndex: number) => {
    const ids = project.surfaces.map(surface => surface.id), from = ids.indexOf(surfaceId)
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || toIndex === from) return
    ids.splice(from, 1); ids.splice(toIndex, 0, surfaceId)
    void liveStore()?.reorderCourseSurfaces(ids)
  }
  const activateResult = (result: { ok: boolean; activatedLocationId?: string }) => {
    const state = liveStore()
    if (state && result.ok && result.activatedLocationId) { state.courseBridge.selectSurface(documentId, result.activatedLocationId); state.setEditingScope('scene') }
  }
  const addPage = (kind: NewPageKind, surfaceId?: string) => {
    const state = liveStore()
    if (!state) return
    void state.addCourseContent(kind, { surfaceId: surfaceId ?? view.surfaceId ?? undefined }).then(activateResult)
  }
  const requestDelete = (card: NavigatorCard) => {
    const state = liveStore()
    if (!state) return
    try { setPendingDelete({ card, captured: state.captureCourseSurfaceDelete(card.key) }) }
    catch (error) { state.setError(error instanceof Error ? error.message : '删除目标已改变') }
  }
  const cardCommands = (card: NavigatorCard): MenuCommand[] => {
    const index = project.surfaces.findIndex(surface => surface.id === card.key)
    return pageCardCommands({ kind: card.kind === 'slide' ? 'scene' : 'page', index, count: cards.length, deleteBlocked: cards.length <= 1 ? LAST_COURSE_PAGE_REASON : null }, {
      addScene: () => addPage('scene', card.key),
      duplicate: () => { const state = liveStore(); if (state) void state.duplicateCourseLocation(card.key).then(activateResult) },
      rename: () => setRenaming(card.key), remove: () => requestDelete(card), move: delta => moveSurface(card.key, index + delta),
    })
  }
  const renameCard = (card: NavigatorCard, name: string) => { void liveStore()?.renameCourseSurface(card.key, name) }
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
  return <nav className="bottom-scene-nav" aria-label="场景与页面导航"><ol ref={track} className="bottom-scene-nav__track">
    {cards.map(card => {
      const active = view.surfaceId === card.key && editingScope !== 'global'
      const renamingCard = renaming === card.key
      const children = card.kind === 'flow' ? card.page.children : card.page.children.flatMap(group => group.children)
      const activeCamera = spatialViews[documentId]?.[card.key]?.activeCameraFrameId ?? null
      const cameraChild = children.find(child => child.frameId === activeCamera)
      return <li key={card.key} className={'bottom-scene-card' + (card.kind !== 'slide' ? ' bottom-scene-card--' + card.kind : '') + (active ? ' bottom-scene-card--active' : '')}
        data-current-card={active} data-kind={card.kind} data-testid={(card.kind === 'slide' ? 'bottom-scene-' : 'bottom-page-') + card.key}
        onClick={event => { if (!(event.target as Element).closest('button, input')) goTo(card.page) }}
        onContextMenu={event => openMenu(event, '页面操作', cardCommands(card))} {...dragProps(card)}>
        <button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined} aria-label={'页面 ' + card.number + '：' + card.page.label} onClick={() => goTo(card.page)}>
          {card.kind === 'slide' ? <SceneThumbnail locationId={card.key} /> : <span className="bottom-scene-card__surface-mark" aria-hidden="true">{card.kind === 'flow' ? '文' : '空'}</span>}
          <span className="bottom-scene-card__identity"><small>{String(card.number).padStart(2, '0')} · {card.kind === 'slide' ? '演示页' : card.kind === 'flow' ? '流式讲义' : '无限画布'}</small>{!renamingCard && <strong title={card.page.label}>{card.page.label}</strong>}</span>
        </button>
        {renamingCard && <RenameField label="页面名称" value={card.page.label} onCommit={name => { setRenaming(null); renameCard(card, name) }} onCancel={() => setRenaming(null)} />}
        {card.kind === 'slide' ? <SceneStateButtons documentId={documentId} surfaceId={card.key} compact /> : <div className="bottom-scene-card__children" role="group" aria-label={card.page.label + '的' + (card.kind === 'flow' ? '标题与章节' : '世界与镜头')}>
          {card.kind === 'spatial' && <>
            <button type="button" className="bottom-scene-card__tool" aria-label="从当前画面添加镜头" title="从当前画面添加镜头" disabled={!active} onClick={() => {
              const target = captureCamera(card.key)
              if (target) void liveStore()?.addSpatialCameraFrameFromSession(card.key, target)
            }}><Plus size={13} /></button>
            <button type="button" className="bottom-scene-card__tool" aria-label="镜头操作" title="镜头操作" aria-haspopup="menu" disabled={!active || !cameraChild}
              onClick={event => cameraChild && openMenu(event, '镜头操作', cameraCommands(card, cameraChild))}><MoreHorizontal size={13} /></button>
          </>}
          {card.kind === 'spatial' && <button type="button" className="bottom-scene-card__child" aria-pressed={active && activeCamera === null} onClick={() => goTo(card.page)}>世界</button>}
          {children.map(child => renamingCamera?.surfaceId === card.key && renamingCamera.frameId === child.frameId
            ? <RenameField key={child.id} label="镜头名称" value={renamingCamera.title} onCommit={name => {
              const edit = renamingCamera; setRenamingCamera(null)
              void liveStore()?.renameSpatialCameraFrame(edit.surfaceId, edit.frameId, name, edit.target)
            }} onCancel={() => setRenamingCamera(null)} /> : <button key={child.id} type="button" className="bottom-scene-card__child" data-kind={child.kind}
            aria-current={active && (child.instanceId ? view.selectedInstanceId === child.instanceId : activeCamera === child.frameId) ? 'location' : undefined}
            title={child.label} onClick={() => goTo(child)}
            onDoubleClick={child.frameId ? () => startCameraRename(card, child) : undefined}
            onContextMenu={child.frameId ? event => openMenu(event, '镜头操作', cameraCommands(card, child)) : undefined}>
            {child.kind === 'flow-heading' ? '标题 · ' : child.kind === 'flow-section' ? '章节 · ' : '镜头 · '}{child.label}</button>)}
        </div>}
      </li>
    })}
    <li className="bottom-scene-nav__add"><button type="button" className="bottom-scene-nav__add-button" aria-label="新建场景或页面" title="新建场景或页面" aria-haspopup="menu" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      menu.open({ x: rect.left, y: rect.top - 4, above: true }, '新建场景或页面', newPageCommands(kind => addPage(kind), null))
    }}><Plus size={18} aria-hidden="true" /></button></li>
  </ol>{menu.element}
  <ConfirmDialog open={pendingDelete !== null} title="删除页面？" message={pendingDelete ? '“' + pendingDelete.card.page.label + '”及其中的全部对象将被删除。此操作可以撤销。' : ''} confirmLabel="删除页面" danger onCancel={() => setPendingDelete(null)} onConfirm={() => {
    const pending = pendingDelete; setPendingDelete(null)
    if (pending) void useEditorStore.getState().deleteCourseSurface(pending.card.key, pending.captured)
  }} /></nav>
}
