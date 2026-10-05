import { Copy, Image as ImageIcon, Pencil, Plus, RotateCcw, Star, Trash2 } from 'lucide-react'
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { ComponentPresentationState } from '../../shared/contracts/component-platform/project'
import { useContextMenu } from '../editing/commands/CommandMenu'
import { stateCommands } from '../editing/commands/pageCommands'
import { interactionBehavior, interactionRules } from '../interactions/componentInteractionAuthoring'
import { useEditorStore } from '../store/editorStore'
import { ConfirmDialog } from './ConfirmDialog'

function countStateOverrides(state: ComponentPresentationState): number {
  return Object.keys(state.overrides).length + (state.background === undefined ? 0 : 1) + (state.order === undefined ? 0 : 1)
}

export function SceneStateStrip() {
  const view = useEditorStore(state => state.courseView)
  if (!view.activeDocumentId || !view.surfaceId) return null
  return <SceneStateButtons documentId={view.activeDocumentId} surfaceId={view.surfaceId} />
}

/** Both modes edit the same formal state on a captured document/surface. */
export function SceneStateButtons({ documentId, surfaceId, compact = false }: { documentId: string; surfaceId: string; compact?: boolean }) {
  const view = useEditorStore(state => state.courseView)
  const editingScope = useEditorStore(state => state.editingScope)
  const surface = view.project?.surfaces.find(value => value.id === surfaceId)
  const presentation = surface?.presentation
  const states = presentation?.states ?? []
  const rules = view.project ? interactionRules(interactionBehavior(view.project, { kind: 'surface', surfaceId })) : []
  const activeStateId = view.surfaceId === surfaceId ? view.activeStateId : null
  const activeState = states.find(state => state.id === activeStateId) ?? null
  const menu = useContextMenu()
  const [editing, setEditing] = useState<{ id: string; target: CapturedCourseTarget } | null>(null)
  const [draftName, setDraftName] = useState('')
  const [pending, setPending] = useState<{ kind: 'delete' | 'reset'; id: string; title: string; target: CapturedCourseTarget } | null>(null)
  useEffect(() => { if (editing && !states.some(state => state.id === editing.id)) setEditing(null) }, [editing, states])
  const capture = (): CapturedCourseTarget | null => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) { state.setError('文档已切换，请重新选择状态。'); return null }
    try { const target = state.courseBridge.captureTarget(documentId); return { ...target, surfaceId, activeStateId: null, editingProject: target.project } }
    catch (error) { state.setError(error instanceof Error ? error.message : '状态目标已改变'); return null }
  }
  const select = (stateId: string | null) => {
    const state = useEditorStore.getState()
    if (state.courseView.activeDocumentId !== documentId) return
    state.courseBridge.selectPresentationState(documentId, stateId, surfaceId)
    state.setEditingScope('scene')
  }
  const add = () => { const target = capture(); if (target) void useEditorStore.getState().addPresentationState(undefined, target) }
  const duplicate = (stateId: string) => { const target = capture(); if (target) void useEditorStore.getState().duplicatePresentationState(stateId, target) }
  const startRename = (stateId: string, title: string) => { const target = capture(); if (target) { setEditing({ id: stateId, target }); setDraftName(title) } }
  const commitRename = () => {
    const draft = editing; setEditing(null)
    if (draft && draftName.trim()) void useEditorStore.getState().renamePresentationState(draft.id, draftName.trim(), draft.target)
  }
  const request = (kind: 'delete' | 'reset', stateId: string, title: string) => { const target = capture(); if (target) setPending({ kind, id: stateId, title, target }) }
  const openStateMenu = (event: ReactMouseEvent, stateId: string | null, title: string) => {
    event.preventDefault(); event.stopPropagation()
    select(stateId)
    menu.open({ x: event.clientX, y: event.clientY }, '状态操作', stateCommands(stateId === null, {
      add, duplicate: () => { if (stateId) duplicate(stateId) },
      rename: () => { if (stateId) startRename(stateId, title) },
      remove: () => { if (stateId) request('delete', stateId, title) },
    }))
  }
  if (!surface || surface.kind !== 'slide') return null
  if (!compact && editingScope === 'global') return <section className="scene-state-strip scene-state-strip--global" aria-label="场景状态"><div className="scene-state-strip__empty"><strong>场景状态</strong><span>全局层跨场景常驻，不参与单个场景的状态切换。</span></div></section>
  const renameField = <input autoFocus value={draftName} maxLength={80} className={compact ? 'bottom-scene-card__rename' : undefined} aria-label="状态名称"
    onChange={event => setDraftName(event.target.value)} onBlur={commitRename} onKeyDown={event => {
      event.stopPropagation(); if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') setEditing(null)
    }} />
  const pressed = (stateId: string | null) => view.surfaceId === surfaceId && view.activeStateId === stateId && editingScope !== 'global'
  const masterButton = <button type="button" className={compact ? 'bottom-scene-card__state' : 'scene-state-card scene-state-card--base' + (pressed(null) ? ' scene-state-card--active' : '')}
      aria-pressed={pressed(null)} aria-label="母版，所有命名状态的继承源" onClick={() => select(null)} onContextMenu={event => openStateMenu(event, null, '母版')}>
      {compact ? '母版' : <><span className="scene-state-card__preview">母版</span><span className="scene-state-card__name">母版</span><small>所有命名状态的继承源</small></>}
    </button>
  const buttons = <>
    {compact ? masterButton : <li className="scene-state-card-shell">{masterButton}</li>}
    {states.map(state => {
      const isInitial = state.id === presentation?.initialStateId
      const isThumbnail = state.id === presentation?.thumbnailStateId
      const overrideCount = countStateOverrides(state)
      const overrideSummary = overrideCount === 0 ? '继承母版，无覆盖' : overrideCount + ' 项覆盖'
      const incomingCount = rules.filter(rule => rule.actions.some(step => step.action.type === 'presentation.set' && step.action.stateId === state.id)).length
      const scopedCount = rules.filter(rule => rule.conditions.some(condition => condition.type === 'presentation.in' && condition.stateIds.includes(state.id))).length
      const button = editing?.id === state.id ? renameField : <button type="button" className={compact ? 'bottom-scene-card__state' : 'scene-state-card' + (pressed(state.id) ? ' scene-state-card--active' : '')}
        aria-pressed={pressed(state.id)} aria-label={state.title + '，命名状态' + (isInitial ? '，运行初始状态' : '') + (isThumbnail ? '，场景缩略图状态' : '') + '，' + overrideSummary}
        title={state.title} onClick={() => select(state.id)} onContextMenu={event => openStateMenu(event, state.id, state.title)}
        onDoubleClick={() => { select(state.id); startRename(state.id, state.title) }}>
        {compact ? state.title : <><span className="scene-state-card__preview">命名状态</span><span className="scene-state-card__name">{state.title}</span><small>{overrideSummary}</small>
          {(incomingCount > 0 || scopedCount > 0) && <small className="scene-state-card__links">{incomingCount > 0 ? incomingCount + ' 个入口' : ''}{incomingCount > 0 && scopedCount > 0 ? ' · ' : ''}{scopedCount > 0 ? scopedCount + ' 条状态映射' : ''}</small>}
          <span className="scene-state-card__badges" aria-hidden="true">{isInitial && <i title="运行初始状态"><Star size={9} />初始</i>}{isThumbnail && <i title="场景缩略图状态"><ImageIcon size={9} />缩略图</i>}</span></>}
      </button>
      return compact ? <span key={state.id} style={{ display: 'contents' }}>{button}</span> : <li key={state.id} className="scene-state-card-shell">{button}</li>
    })}
  </>
  const confirmation = <ConfirmDialog open={pending !== null} title={pending?.kind === 'delete' ? '删除场景状态？' : '清除当前状态的覆盖？'}
    message={pending ? '“' + pending.title + '”' + (pending.kind === 'delete' ? '及其全部覆盖值将被删除，母版不会受影响。' : '将恢复为母版的外观。') + '此操作可以撤销。' : ''}
    confirmLabel={pending?.kind === 'delete' ? '删除状态' : '清除覆盖'} danger={pending?.kind === 'delete'} onCancel={() => setPending(null)} onConfirm={() => {
      const action = pending; setPending(null)
      if (!action) return
      const state = useEditorStore.getState()
      if (action.kind === 'delete') void state.deletePresentationState(action.id, action.target)
      else void state.clearPresentationStateOverrides(action.id, action.target)
    }} />
  if (compact) return <div className="bottom-scene-card__states" role="group" aria-label={surface.title + '的呈现状态'}>{buttons}{menu.element}{confirmation}</div>
  return <section className="scene-state-strip" aria-label="场景状态">
    <header className="scene-state-strip__header"><div className="scene-state-strip__title"><strong>场景状态</strong><span>{activeState ? '正在编辑“' + activeState.title + '”的覆盖值' : '正在编辑母版；修改会被所有状态继承'}</span></div>
      <div className="scene-state-strip__actions" aria-label="状态操作">
        <button type="button" className="state-action" aria-label="新建场景状态" title="新建场景状态" onClick={add}><Plus size={14} /><span>新状态</span></button>
        <button type="button" className="state-action" aria-label={activeState ? '复制当前状态' : '从母版新建状态'} title={activeState ? '复制当前状态及其覆盖' : '从母版创建空状态'} onClick={() => activeState ? duplicate(activeState.id) : add()}><Copy size={14} /><span>复制</span></button>
        <button type="button" className="state-action" disabled={!activeState} aria-label="重命名当前状态" title={activeState ? '重命名当前状态' : '请先选择一个命名状态'} onClick={() => activeState && startRename(activeState.id, activeState.title)}><Pencil size={14} /><span>改名</span></button>
        <button type="button" className="state-action" disabled={!activeState || activeState.id === presentation?.initialStateId} aria-label="将当前状态设为运行初始状态" title="设为运行初始状态" onClick={() => { const target = capture(); if (target && activeState) void useEditorStore.getState().setInitialPresentationState(activeState.id, target) }}><Star size={14} /><span>设为初始</span></button>
        <button type="button" className="state-action" disabled={!activeState || activeState.id === presentation?.thumbnailStateId} aria-label="将当前状态设为场景缩略图状态" title="用于左侧场景缩略图" onClick={() => { const target = capture(); if (target && activeState) void useEditorStore.getState().setThumbnailPresentationState(activeState.id, target) }}><ImageIcon size={14} /><span>设为缩略图</span></button>
        <button type="button" className="state-action" disabled={!activeState} aria-label="清除当前状态的全部覆盖" title={activeState ? '恢复为母版外观' : '母版没有状态覆盖'} onClick={() => activeState && request('reset', activeState.id, activeState.title)}><RotateCcw size={14} /><span>清除覆盖</span></button>
        <button type="button" className="state-action state-action--danger" disabled={!activeState} aria-label="删除当前状态" title="删除当前状态" onClick={() => activeState && request('delete', activeState.id, activeState.title)}><Trash2 size={14} /><span>删除</span></button>
      </div>
    </header>{menu.element}<ul className="scene-state-strip__track" aria-label="当前场景状态列表">{buttons}</ul>{confirmation}
  </section>
}
