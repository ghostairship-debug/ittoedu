import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { ensureSlidePresentation } from '../../shared/contracts/course-project-v9/presentation'
import type { CourseProjectDocument, SlideSceneDocument } from '../../shared/courseProjectTypes'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import { buildCourseTreeView, type CourseTreeNode } from '../course/courseTreeView'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import { useContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'
import { newPageCommands, pageCardCommands, stateCommands, type NewPageKind } from '../editing/commands/pageCommands'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectEditingScope,
  useEditorStore,
} from '../store/editorStore'
import { ConfirmDialog } from './ConfirmDialog'
import { SceneStateStrip } from './SceneStateStrip'
import { SceneThumbnail } from './SceneThumbnail'
import './bottomSceneNavigator.css'

type SceneCard = {
  kind: 'slide'
  key: string
  page: CourseTreeNode
  node: CourseTreeNode
  scene: SlideSceneDocument
  number: number
}
type PageCard = {
  kind: 'flow' | 'spatial'
  key: string
  page: CourseTreeNode
  number: number
}
type NavigatorCard = SceneCard | PageCard

/** Projects the existing course tree; it does not create another location model. */
export function buildBottomSceneCards(project: CourseProjectDocument): NavigatorCard[] {
  let number = 0
  return buildCourseTreeView(project).pages.flatMap((page): NavigatorCard[] => {
    if (page.kind === 'slide-page') {
      const surface = project.surfaces.find(candidate => candidate.id === page.surfaceId)
      if (surface?.type !== 'slide') return []
      return page.children.flatMap(node => {
        if (node.kind !== 'slide-scene' || !node.locationId) return []
        const location = project.locations.find(candidate => candidate.id === node.locationId)
        if (location?.kind !== 'slide-scene') return []
        const scene = surface.scenes.find(candidate => candidate.id === location.sceneId)
        return scene ? [{ kind: 'slide' as const, key: node.id, page, node, scene, number: ++number }] : []
      })
    }
    if (page.kind === 'flow-page' || page.kind === 'spatial-page') {
      return [{ kind: page.kind === 'flow-page' ? 'flow' : 'spatial', key: page.id, page, number: ++number }]
    }
    return []
  })
}

function sameSlideScene(project: CourseProjectDocument, locationId: string | null, card: SceneCard): boolean {
  const active = project.locations.find(candidate => candidate.id === locationId)
  const target = project.locations.find(candidate => candidate.id === card.node.locationId)
  return active?.kind === 'slide-scene' && target?.kind === 'slide-scene'
    && active.surfaceId === target.surfaceId && active.sceneId === target.sceneId
}

function locationStillInScene(project: CourseProjectDocument, locationId: string | null, card: SceneCard): boolean {
  return sameSlideScene(project, locationId, card)
}

/** Deep mode keeps the established scene tree and state strip unchanged. */
export function CourseBottomNavigation({ documentId }: { documentId: string | null }) {
  const { mode } = useCourseEditorChrome()
  const flow = useEditorStore(state => Boolean(state.flowSession))
  const spatial = useEditorStore(state => Boolean(state.spatialSession))
  return mode === 'light'
    ? <BottomSceneNavigator documentId={documentId} />
    : flow || spatial ? null : <SceneStateStrip />
}

const LAST_PAGE_REASON = '这是最后一个页面，不能删除'
const PAGE_DRAG_TYPE = 'application/x-guoling-page-card'

/** One inline name field, for a card or a state button. */
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
  return <input className="bottom-scene-card__rename" aria-label={label} value={draft} autoFocus
    onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => finish(true)}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    }} />
}

export function BottomSceneNavigator({ documentId }: { documentId: string | null }) {
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const activeLocationId = useEditorStore(selectActiveCourseLocationId)
  const activeStateId = useEditorStore(selectActivePresentationStateId)
  const editingScope = useEditorStore(selectEditingScope)
  const spatialScope = useEditorStore(state => state.spatialSession?.scope ?? null)
  const track = useRef<HTMLOListElement>(null)
  const cards = useMemo(() => project ? buildBottomSceneCards(project) : [], [project])
  const activeLocation = project?.locations.find(candidate => candidate.id === activeLocationId)
  const menu = useContextMenu()
  // What is being renamed: a card (by key) or a state button (card key + state id).
  const [renaming, setRenaming] = useState<{ key: string; stateId?: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; message: string; confirmLabel: string; run(): void } | null>(null)
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null)

  useEffect(() => {
    track.current?.querySelector<HTMLElement>('[data-current-card="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeLocationId, project?.id])

  if (!project || !cards.length) return null

  const liveStore = () => {
    const state = useEditorStore.getState()
    if (!documentId || state.courseDocument.documentId !== documentId) {
      state.setError('文档已切换，请在当前 H5 演示重新选择场景。')
      return null
    }
    return state
  }
  const goTo = (locationId: string | null): boolean => {
    const state = liveStore()
    if (!state || !locationId) return false
    const liveProject = selectActiveCourseProjectDocument(state)
    const location = liveProject?.locations.find(candidate => candidate.id === locationId)
    if (!liveProject || !location) {
      state.setError('目标位置已经改变，请重新选择。')
      return false
    }
    if (location.kind === 'flow-block' && state.flowSession) {
      state.applyFlowSelection(selectFlowEditorBlock(liveProject, locationId, location.blockId))
    } else {
      state.activateCourseLocation(locationId)
    }
    return true
  }
  const goToScene = (card: SceneCard) => {
    if (sameSlideScene(project, activeLocationId, card) && editingScope !== 'global') return
    if (goTo(card.node.locationId) && selectEditingScope(useEditorStore.getState()) === 'global') {
      useEditorStore.getState().setEditingScope('scene')
    }
  }
  const goToState = (card: SceneCard, stateId: string | null): boolean => {
    const state = liveStore()
    if (!state) return false
    const liveProject = selectActiveCourseProjectDocument(state)
    const target = liveProject?.locations.find(candidate => candidate.id === card.node.locationId)
    const surface = liveProject?.surfaces.find(candidate => candidate.id === target?.surfaceId)
    const scene = surface?.type === 'slide' && target?.kind === 'slide-scene'
      ? surface.scenes.find(candidate => candidate.id === target.sceneId) : null
    if (!liveProject || !target || !scene || (stateId && !ensureSlidePresentation(scene).states.some(item => item.id === stateId))) {
      state.setError('场景或状态已经改变，请重新选择。')
      return false
    }
    if (!locationStillInScene(liveProject, selectActiveCourseLocationId(state), card)) state.activateCourseLocation(target.id)
    const after = useEditorStore.getState()
    const afterProject = selectActiveCourseProjectDocument(after)
    if (!afterProject || !locationStillInScene(afterProject, selectActiveCourseLocationId(after), card)) {
      after.setError('场景切换未完成，状态没有改变；请完成当前编辑后重试。')
      return false
    }
    if (selectEditingScope(after) === 'global') after.setEditingScope('scene')
    useEditorStore.getState().setActivePresentationState(stateId)
    return true
  }
  const goToWorld = (card: PageCard) => {
    const state = liveStore()
    if (!state) return
    const active = selectActiveCourseProjectDocument(state)?.locations.find(candidate => candidate.id === selectActiveCourseLocationId(state))
    if (active?.surfaceId !== card.page.surfaceId && !goTo(card.page.locationId)) return
    useEditorStore.getState().setEditingScope('scene')
  }

  // Page structure (M21): the page bar changes pages with the same store commands as the editor's page list.
  const slideSurfaceOf = (card: SceneCard) => {
    const surface = project.surfaces.find(candidate => candidate.id === card.page.surfaceId)
    return surface?.type === 'slide' ? surface : null
  }
  const others = (surfaceId: string) => project.locations.some(location => location.surfaceId !== surfaceId)
  const reorderScenes = (card: SceneCard, sceneIds: string[]) => {
    // The Slide session reorders the scenes of the page it has open.
    if (!sameSlideScene(project, activeLocationId, card)) goToScene(card)
    liveStore()?.reorderScenes(sceneIds)
  }
  const moveScene = (card: SceneCard, toIndex: number) => {
    const surface = slideSurfaceOf(card)
    if (!surface) return
    const ids = surface.scenes.map(scene => scene.id), from = ids.indexOf(card.scene.id)
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || toIndex === from) return
    ids.splice(from, 1); ids.splice(toIndex, 0, card.scene.id)
    reorderScenes(card, ids)
  }
  const moveSurface = (surfaceId: string, toIndex: number) => {
    const ids = project.surfaces.map(surface => surface.id), from = ids.indexOf(surfaceId)
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || toIndex === from) return
    ids.splice(from, 1); ids.splice(toIndex, 0, surfaceId)
    liveStore()?.reorderCourseSurfaces(ids)
  }
  const activate = (result: { ok: boolean; activatedLocationId?: string }) => {
    if (result.ok && result.activatedLocationId) useEditorStore.getState().activateCourseLocation(result.activatedLocationId)
  }
  const addPage = (kind: NewPageKind, surfaceId?: string) => {
    const state = liveStore()
    if (!state) return
    if (kind !== 'scene') { state.addCourseContent(kind); return }
    const target = surfaceId ?? (activeLocation?.kind === 'slide-scene' ? activeLocation.surfaceId : [...project.surfaces].reverse().find(surface => surface.type === 'slide')?.id)
    if (target) state.addCourseContent('scene', { surfaceId: target })
  }
  const cardCommands = (card: NavigatorCard): MenuCommand[] => {
    if (card.kind === 'slide') {
      const surface = slideSurfaceOf(card)
      const index = surface?.scenes.findIndex(scene => scene.id === card.scene.id) ?? 0
      const count = surface?.scenes.length ?? 1
      return pageCardCommands({ kind: 'scene', index, count, deleteBlocked: count <= 1 && !others(card.page.surfaceId) ? LAST_PAGE_REASON : null }, {
        addScene: () => addPage('scene', card.page.surfaceId),
        duplicate: () => { if (card.node.locationId) { const state = liveStore(); if (state) activate(state.duplicateCourseLocation(card.node.locationId)) } },
        rename: () => setRenaming({ key: card.key }),
        remove: () => setPendingDelete({ title: '删除场景？', message: `“${card.node.label}”及其中的全部对象将被删除。此操作可以撤销。`, confirmLabel: '删除场景',
          run: () => { liveStore()?.deleteScene(card.scene.id) } }),
        move: delta => moveScene(card, index + delta),
      })
    }
    const index = project.surfaces.findIndex(surface => surface.id === card.page.surfaceId)
    return pageCardCommands({ kind: 'page', index, count: project.surfaces.length, deleteBlocked: others(card.page.surfaceId) ? null : LAST_PAGE_REASON }, {
      addScene: () => addPage('scene'),
      duplicate: () => {},
      rename: () => setRenaming({ key: card.key }),
      remove: () => setPendingDelete({ title: '删除页面？', message: `“${card.page.label}”整页将被删除。此操作可以撤销。`, confirmLabel: '删除页面',
        run: () => { liveStore()?.deleteCourseSurface(card.page.surfaceId) } }),
      move: delta => moveSurface(card.page.surfaceId, index + delta),
    })
  }
  const stateMenu = (card: SceneCard, stateId: string | null, name: string): MenuCommand[] => stateCommands(stateId === null, {
    add: () => { if (goToState(card, null)) useEditorStore.getState().addPresentationState() },
    duplicate: () => { if (stateId && goToState(card, stateId)) useEditorStore.getState().duplicatePresentationState(stateId) },
    rename: () => { if (stateId) setRenaming({ key: card.key, stateId }) },
    remove: () => {
      if (!stateId) return
      setPendingDelete({ title: '删除状态？', message: `“${name}”状态的全部改动将被删除，场景回到母版。此操作可以撤销。`, confirmLabel: '删除状态',
        run: () => { if (goToState(card, null)) useEditorStore.getState().deletePresentationState(stateId) } })
    },
  })
  const renameCard = (card: NavigatorCard, name: string) => {
    const state = liveStore()
    if (!state) return
    if (card.kind === 'slide') { if (card.node.locationId) state.renameCourseLocation(card.node.locationId, name) }
    else state.renameCourseSurface(card.page.surfaceId, name)
  }
  const openMenu = (event: ReactMouseEvent, label: string, items: MenuCommand[]) => {
    event.preventDefault()
    event.stopPropagation()
    menu.open({ x: event.clientX, y: event.clientY }, label, items)
  }
  // Dragging a card: scenes move within or into a Slide page, other pages move among pages.
  const dropTarget = (card: NavigatorCard) => drag && drag.key !== card.key ? cards.find(candidate => candidate.key === drag.key) ?? null : null
  const dropOn = (card: NavigatorCard) => {
    const dragged = dropTarget(card)
    setDrag(null)
    if (!dragged) return
    if (dragged.kind === 'slide' && card.kind === 'slide') {
      if (dragged.page.surfaceId === card.page.surfaceId) {
        const index = slideSurfaceOf(card)?.scenes.findIndex(scene => scene.id === card.scene.id) ?? -1
        moveScene(dragged, index)
      } else if (dragged.node.locationId) {
        const index = slideSurfaceOf(card)?.scenes.findIndex(scene => scene.id === card.scene.id) ?? undefined
        liveStore()?.moveCourseSlideScene(dragged.node.locationId, card.page.surfaceId, index)
      }
      return
    }
    if (dragged.page.surfaceId !== card.page.surfaceId) moveSurface(dragged.page.surfaceId, project.surfaces.findIndex(surface => surface.id === card.page.surfaceId))
  }
  const dragProps = (card: NavigatorCard) => ({
    draggable: renaming?.key !== card.key,
    onDragStart: (event: ReactDragEvent) => { event.dataTransfer.setData(PAGE_DRAG_TYPE, card.key); event.dataTransfer.effectAllowed = 'move'; setDrag({ key: card.key, over: null }) },
    onDragOver: (event: ReactDragEvent) => {
      if (!event.dataTransfer.types.includes(PAGE_DRAG_TYPE) || !dropTarget(card)) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      if (drag?.over !== card.key) setDrag(current => current ? { ...current, over: card.key } : current)
    },
    onDrop: (event: ReactDragEvent) => { event.preventDefault(); dropOn(card) },
    onDragEnd: () => setDrag(null),
    'data-drop-target': drag?.over === card.key || undefined,
  })
  const firstSlide = activeLocation?.kind === 'slide-scene' || project.surfaces.some(surface => surface.type === 'slide')

  return <nav className="bottom-scene-nav" aria-label="场景与页面导航">
    <ol ref={track} className="bottom-scene-nav__track">
      {cards.map(card => {
        const active = card.kind === 'slide'
          ? sameSlideScene(project, activeLocationId, card)
          : activeLocation?.surfaceId === card.page.surfaceId
        const renamingCard = renaming?.key === card.key && !renaming.stateId
        if (card.kind === 'slide') {
          const presentation = ensureSlidePresentation(card.scene)
          return <li key={card.key} className={`bottom-scene-card${active ? ' bottom-scene-card--active' : ''}`}
            data-current-card={active} data-kind="slide" data-testid={`bottom-scene-${card.key}`}
            onContextMenu={event => openMenu(event, '场景操作', cardCommands(card))} {...dragProps(card)}>
            <button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined}
              aria-label={`场景 ${card.number}：${card.node.label}，${card.page.label}`} onClick={() => goToScene(card)}>
              <SceneThumbnail locationId={card.node.locationId ?? undefined} />
              <span className="bottom-scene-card__identity"><small>{String(card.number).padStart(2, '0')} · {card.page.label}</small>{!renamingCard && <strong title={card.node.label}>{card.node.label}</strong>}</span>
            </button>
            {renamingCard && <RenameField label="场景名称" value={card.node.label} onCommit={name => { setRenaming(null); renameCard(card, name) }} onCancel={() => setRenaming(null)} />}
            <div className="bottom-scene-card__states" role="group" aria-label={`${card.node.label}的呈现状态`}>
              <button type="button" className="bottom-scene-card__state" aria-pressed={active && editingScope !== 'global' && activeStateId === null}
                onClick={() => goToState(card, null)} onContextMenu={event => openMenu(event, '状态操作', stateMenu(card, null, '母版'))}>母版</button>
              {presentation.states.map(state => renaming?.key === card.key && renaming.stateId === state.id
                ? <RenameField key={state.id} label="状态名称" value={state.name}
                  onCommit={name => { setRenaming(null); if (goToState(card, state.id)) useEditorStore.getState().renamePresentationState(state.id, name) }}
                  onCancel={() => setRenaming(null)} />
                : <button key={state.id} type="button" className="bottom-scene-card__state"
                  aria-pressed={active && editingScope !== 'global' && activeStateId === state.id}
                  title={state.name} onClick={() => goToState(card, state.id)}
                  onContextMenu={event => openMenu(event, '状态操作', stateMenu(card, state.id, state.name))}>{state.name}</button>)}
            </div>
          </li>
        }
        const children = card.kind === 'flow' ? card.page.children : card.page.children.flatMap(group => group.children)
        return <li key={card.key} className={`bottom-scene-card bottom-scene-card--${card.kind}${active ? ' bottom-scene-card--active' : ''}`}
          data-current-card={active} data-kind={card.kind} data-testid={`bottom-page-${card.key}`}
          onContextMenu={event => openMenu(event, '页面操作', cardCommands(card))} {...dragProps(card)}>
          <button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined}
            aria-label={`${card.kind === 'flow' ? '流式讲义' : '无限画布'} ${card.number}：${card.page.label}`}
            onClick={() => goTo(card.page.locationId)}>
            <span className="bottom-scene-card__surface-mark" aria-hidden="true">{card.kind === 'flow' ? '文' : '空'}</span>
            <span className="bottom-scene-card__identity"><small>{String(card.number).padStart(2, '0')} · {card.kind === 'flow' ? '流式讲义' : '无限画布'}</small>{!renamingCard && <strong title={card.page.label}>{card.page.label}</strong>}</span>
          </button>
          {renamingCard && <RenameField label="页面名称" value={card.page.label} onCommit={name => { setRenaming(null); renameCard(card, name) }} onCancel={() => setRenaming(null)} />}
          <div className="bottom-scene-card__children" role="group" aria-label={`${card.page.label}的${card.kind === 'flow' ? '标题与章节' : '世界与镜头'}`}>
            {card.kind === 'spatial' && <button type="button" className="bottom-scene-card__child"
              aria-pressed={active && spatialScope === 'world'} onClick={() => goToWorld(card)}>世界</button>}
            {children.map(child => child.locationId && <button key={child.id} type="button" className="bottom-scene-card__child"
              data-kind={child.kind} aria-current={activeLocationId === child.locationId ? 'location' : undefined}
              title={child.label} onClick={() => goTo(child.locationId)}>{child.kind === 'flow-heading' ? '标题 · ' : child.kind === 'flow-section' ? '章节 · ' : child.kind === 'spatial-camera' ? '镜头 · ' : ''}{child.label}</button>)}
          </div>
        </li>
      })}
      <li className="bottom-scene-nav__add">
        {/* Always shown, no hover needed (M21): a scene of the current Slide page, or a new page. */}
        <button type="button" className="bottom-scene-nav__add-button" aria-label="新建场景或页面" title="新建场景或页面" aria-haspopup="menu"
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            menu.open({ x: rect.left, y: rect.top - 4, above: true }, '新建场景或页面', newPageCommands(kind => addPage(kind), firstSlide ? null : '还没有演示页，请先新建演示页'))
          }}><Plus size={18} aria-hidden="true" /></button>
      </li>
    </ol>
    {menu.element}
    <ConfirmDialog open={pendingDelete !== null} title={pendingDelete?.title ?? ''} message={pendingDelete?.message ?? ''}
      confirmLabel={pendingDelete?.confirmLabel ?? '删除'} danger
      onCancel={() => setPendingDelete(null)} onConfirm={() => { const action = pendingDelete; setPendingDelete(null); action?.run() }} />
  </nav>
}
