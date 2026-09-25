import { useEffect, useMemo, useRef } from 'react'
import { ensureSlidePresentation } from '../../shared/contracts/course-project-v9/presentation'
import type { CourseProjectDocument, SlideSceneDocument } from '../../shared/courseProjectTypes'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import { buildCourseTreeView, type CourseTreeNode } from '../course/courseTreeView'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActivePresentationStateId,
  selectEditingScope,
  useEditorStore,
} from '../store/editorStore'
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

export function BottomSceneNavigator({ documentId }: { documentId: string | null }) {
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const activeLocationId = useEditorStore(selectActiveCourseLocationId)
  const activeStateId = useEditorStore(selectActivePresentationStateId)
  const editingScope = useEditorStore(selectEditingScope)
  const spatialScope = useEditorStore(state => state.spatialSession?.scope ?? null)
  const track = useRef<HTMLOListElement>(null)
  const cards = useMemo(() => project ? buildBottomSceneCards(project) : [], [project])
  const activeLocation = project?.locations.find(candidate => candidate.id === activeLocationId)

  useEffect(() => {
    track.current?.querySelector<HTMLElement>('[data-current-card="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeLocationId, project?.id])

  if (!project || !cards.length) return null

  const liveStore = () => {
    const state = useEditorStore.getState()
    if (!documentId || state.courseDocument.documentId !== documentId) {
      state.setError('文档已切换，请在当前课件重新选择场景。')
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
  const goToState = (card: SceneCard, stateId: string | null) => {
    const state = liveStore()
    if (!state) return
    const liveProject = selectActiveCourseProjectDocument(state)
    const target = liveProject?.locations.find(candidate => candidate.id === card.node.locationId)
    const surface = liveProject?.surfaces.find(candidate => candidate.id === target?.surfaceId)
    const scene = surface?.type === 'slide' && target?.kind === 'slide-scene'
      ? surface.scenes.find(candidate => candidate.id === target.sceneId) : null
    if (!liveProject || !target || !scene || (stateId && !ensureSlidePresentation(scene).states.some(item => item.id === stateId))) {
      state.setError('场景或状态已经改变，请重新选择。')
      return
    }
    if (!locationStillInScene(liveProject, selectActiveCourseLocationId(state), card)) state.activateCourseLocation(target.id)
    const after = useEditorStore.getState()
    const afterProject = selectActiveCourseProjectDocument(after)
    if (!afterProject || !locationStillInScene(afterProject, selectActiveCourseLocationId(after), card)) {
      after.setError('场景切换未完成，状态没有改变；请完成当前编辑后重试。')
      return
    }
    if (selectEditingScope(after) === 'global') after.setEditingScope('scene')
    useEditorStore.getState().setActivePresentationState(stateId)
  }
  const goToWorld = (card: PageCard) => {
    const state = liveStore()
    if (!state) return
    const active = selectActiveCourseProjectDocument(state)?.locations.find(candidate => candidate.id === selectActiveCourseLocationId(state))
    if (active?.surfaceId !== card.page.surfaceId && !goTo(card.page.locationId)) return
    useEditorStore.getState().setEditingScope('scene')
  }

  return <nav className="bottom-scene-nav" aria-label="课件场景与页面导航">
    <ol ref={track} className="bottom-scene-nav__track">
      {cards.map(card => {
        const active = card.kind === 'slide'
          ? sameSlideScene(project, activeLocationId, card)
          : activeLocation?.surfaceId === card.page.surfaceId
        if (card.kind === 'slide') {
          const presentation = ensureSlidePresentation(card.scene)
          return <li key={card.key} className={`bottom-scene-card${active ? ' bottom-scene-card--active' : ''}`}
            data-current-card={active} data-kind="slide" data-testid={`bottom-scene-${card.key}`}>
            <button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined}
              aria-label={`场景 ${card.number}：${card.node.label}，${card.page.label}`} onClick={() => goToScene(card)}>
              <SceneThumbnail locationId={card.node.locationId ?? undefined} />
              <span className="bottom-scene-card__identity"><small>{String(card.number).padStart(2, '0')} · {card.page.label}</small><strong title={card.node.label}>{card.node.label}</strong></span>
            </button>
            <div className="bottom-scene-card__states" role="group" aria-label={`${card.node.label}的呈现状态`}>
              <button type="button" className="bottom-scene-card__state" aria-pressed={active && editingScope !== 'global' && activeStateId === null}
                onClick={() => goToState(card, null)}>基础</button>
              {presentation.states.map(state => <button key={state.id} type="button" className="bottom-scene-card__state"
                aria-pressed={active && editingScope !== 'global' && activeStateId === state.id}
                title={state.name} onClick={() => goToState(card, state.id)}>{state.name}</button>)}
            </div>
          </li>
        }
        const children = card.kind === 'flow' ? card.page.children : card.page.children.flatMap(group => group.children)
        return <li key={card.key} className={`bottom-scene-card bottom-scene-card--${card.kind}${active ? ' bottom-scene-card--active' : ''}`}
          data-current-card={active} data-kind={card.kind} data-testid={`bottom-page-${card.key}`}>
          <button type="button" className="bottom-scene-card__main" aria-current={active ? 'page' : undefined}
            aria-label={`${card.kind === 'flow' ? 'Flow' : 'Spatial'} 页面 ${card.number}：${card.page.label}`}
            onClick={() => goTo(card.page.locationId)}>
            <span className="bottom-scene-card__surface-mark" aria-hidden="true">{card.kind === 'flow' ? '文' : '空'}</span>
            <span className="bottom-scene-card__identity"><small>{String(card.number).padStart(2, '0')} · {card.kind === 'flow' ? 'Flow 页面' : 'Spatial 页面'}</small><strong title={card.page.label}>{card.page.label}</strong></span>
          </button>
          <div className="bottom-scene-card__children" role="group" aria-label={`${card.page.label}的${card.kind === 'flow' ? '标题与章节' : '世界与镜头'}`}>
            {card.kind === 'spatial' && <button type="button" className="bottom-scene-card__child"
              aria-pressed={active && spatialScope === 'world'} onClick={() => goToWorld(card)}>世界</button>}
            {children.map(child => child.locationId && <button key={child.id} type="button" className="bottom-scene-card__child"
              data-kind={child.kind} aria-current={activeLocationId === child.locationId ? 'location' : undefined}
              title={child.label} onClick={() => goTo(child.locationId)}>{child.kind === 'flow-heading' ? '标题 · ' : child.kind === 'flow-section' ? '章节 · ' : child.kind === 'spatial-camera' ? '镜头 · ' : ''}{child.label}</button>)}
          </div>
        </li>
      })}
    </ol>
  </nav>
}
