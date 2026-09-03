import {
  Copy,
  Image as ImageIcon,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ensureSlidePresentation } from '../../shared/contracts/course-project-v9/presentation'
import type { SlidePresentationState } from '../../shared/courseProjectTypes'
import {
  selectActivePresentationStateId,
  selectEditingScope,
  selectSlideAuthoringDocument,
  selectSlideAuthoringSnapshot,
  useEditorStore,
} from '../store/editorStore'
import { ConfirmDialog } from './ConfirmDialog'

type PendingAction = 'delete' | 'reset' | null

function countStateOverrides(state: SlidePresentationState): number {
  let count = Object.keys(state.layerItemOverrides).length
  if (state.backgroundColor !== undefined) count += 1
  if (state.backgroundAssetId !== undefined) count += 1
  if (state.layerItemOrder !== undefined) count += 1
  return count
}

export function SceneStateStrip() {
  const document = useEditorStore(selectSlideAuthoringDocument)
  const snapshot = useEditorStore(selectSlideAuthoringSnapshot)
  const scene = useMemo(() => {
    if (!document || !snapshot) return null
    const surface = document.surfaces.find((candidate) => candidate.id === snapshot.surfaceId)
    if (!surface || surface.type !== 'slide') return null
    return surface.scenes.find((candidate) => candidate.id === snapshot.sceneId) ?? null
  }, [document, snapshot])
  const editingScope = useEditorStore(selectEditingScope)
  const editorMode = useEditorStore((state) => state.editorMode)
  const setEditorMode = useEditorStore((state) => state.setEditorMode)
  const activeStateId = useEditorStore(selectActivePresentationStateId)
  const setActiveState = useEditorStore(
    (state) => state.setActivePresentationState,
  )
  const addState = useEditorStore((state) => state.addPresentationState)
  const duplicateState = useEditorStore(
    (state) => state.duplicatePresentationState,
  )
  const renameState = useEditorStore(
    (state) => state.renamePresentationState,
  )
  const deleteState = useEditorStore(
    (state) => state.deletePresentationState,
  )
  const setInitialState = useEditorStore(
    (state) => state.setInitialPresentationState,
  )
  const setThumbnailState = useEditorStore(
    (state) => state.setThumbnailPresentationState,
  )
  const clearState = useEditorStore(
    (state) => state.clearPresentationStateOverrides,
  )
  const [editingStateId, setEditingStateId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

  const presentation = useMemo(
    () => scene ? ensureSlidePresentation(scene) : null,
    [scene],
  )
  const activeState = activeStateId === null || !presentation
    ? null
    : presentation.states.find((state) => state.id === activeStateId) ?? null

  useEffect(() => {
    if (
      editingStateId &&
      !presentation?.states.some((state) => state.id === editingStateId)
    ) {
      setEditingStateId(null)
    }
  }, [editingStateId, presentation])

  const startRename = () => {
    if (!activeState) return
    setEditingStateId(activeState.id)
    setDraftName(activeState.name)
  }

  const commitRename = () => {
    if (editingStateId && draftName.trim()) {
      renameState(editingStateId, draftName)
    }
    setEditingStateId(null)
  }

  if (!scene || !presentation) return null

  if (editingScope === 'global') {
    return (
      <section className="scene-state-strip scene-state-strip--global" aria-label="场景状态">
        <div className="scene-state-strip__empty">
          <strong>场景状态</strong>
          <span>全局层跨场景常驻，不参与单个场景的状态切换。</span>
        </div>
      </section>
    )
  }

  return (
    <section className="scene-state-strip" aria-label="场景状态">
      <header className="scene-state-strip__header">
        <div className="scene-state-strip__title">
          <strong>{editorMode === 'simple' ? '场景画面' : '场景状态'}</strong>
          <span>
            {activeState
              ? `正在编辑“${activeState.name}”的覆盖值`
              : editorMode === 'simple'
                ? '基础画面的修改会同步到继承它的其他画面'
                : '正在编辑基础；修改会被所有状态继承'}
          </span>
        </div>
        {editorMode === 'professional' ? (
          <div className="scene-state-strip__actions" aria-label="状态操作">
          <button
            type="button"
            className="state-action"
            aria-label="新建场景状态"
            title="新建场景状态"
            onClick={() => addState()}
          >
            <Plus size={14} /><span>新状态</span>
          </button>
          <button
            type="button"
            className="state-action"
            onClick={() => activeState ? duplicateState(activeState.id) : addState()}
            aria-label={activeState ? '复制当前状态' : '从基础新建状态'}
            title={activeState ? '复制当前状态及其覆盖' : '从基础创建空状态'}
          >
            <Copy size={14} /><span>复制</span>
          </button>
          <button
            type="button"
            className="state-action"
            disabled={!activeState}
            aria-label="重命名当前状态"
            title={activeState ? '重命名当前状态' : '请先选择一个命名状态'}
            onClick={startRename}
          >
            <Pencil size={14} /><span>改名</span>
          </button>
          <button
            type="button"
            className="state-action"
            disabled={!activeState || activeState.id === presentation.initialStateId}
            aria-label="将当前状态设为运行初始状态"
            title={activeState?.id === presentation.initialStateId ? '当前已是运行初始状态' : '设为运行初始状态'}
            onClick={() => activeState && setInitialState(activeState.id)}
          >
            <Star size={14} /><span>设为初始</span>
          </button>
          <button
            type="button"
            className="state-action"
            disabled={!activeState || activeState.id === presentation.thumbnailStateId}
            aria-label="将当前状态设为场景缩略图状态"
            title={activeState?.id === presentation.thumbnailStateId ? '当前已用于场景缩略图' : '用于左侧场景缩略图'}
            onClick={() => activeState && setThumbnailState(activeState.id)}
          >
            <ImageIcon size={14} /><span>设为缩略图</span>
          </button>
          <button
            type="button"
            className="state-action"
            disabled={!activeState}
            aria-label="清除当前状态的全部覆盖"
            title={activeState ? '恢复为基础场景外观' : '基础场景没有状态覆盖'}
            onClick={() => setPendingAction('reset')}
          >
            <RotateCcw size={14} /><span>清除覆盖</span>
          </button>
          <button
            type="button"
            className="state-action state-action--danger"
            disabled={!activeState || presentation.states.length <= 1}
            aria-label="删除当前状态"
            title={presentation.states.length <= 1 ? '至少保留一个命名状态' : '删除当前状态'}
            onClick={() => setPendingAction('delete')}
          >
            <Trash2 size={14} /><span>删除</span>
          </button>
          </div>
        ) : (
          <button
            type="button"
            className="state-action scene-state-strip__professional-link"
            onClick={() => setEditorMode('professional')}
          >
            管理状态
          </button>
        )}
      </header>

      <ul className="scene-state-strip__track" aria-label="当前场景状态列表">
        <li className="scene-state-card-shell">
          <button
            type="button"
            className={`scene-state-card scene-state-card--base${activeStateId === null ? ' scene-state-card--active' : ''}`}
            aria-pressed={activeStateId === null}
            aria-label="基础场景，所有命名状态的继承源"
            onClick={() => setActiveState(null)}
          >
            <span className="scene-state-card__preview">基础</span>
            <span className="scene-state-card__name">基础场景</span>
            <small>所有命名状态的继承源</small>
          </button>
        </li>

        {presentation.states.map((state) => {
          const active = state.id === activeStateId
          const isInitial = state.id === presentation.initialStateId
          const isThumbnail = state.id === presentation.thumbnailStateId
          const overrideCount = countStateOverrides(state)
          const overrideSummary = overrideCount === 0
            ? '继承基础，无覆盖'
            : `${overrideCount} 项覆盖`
          const incomingCount = scene.interactions.filter((rule) =>
            rule.actions.some(({ action }) =>
              action.type === 'presentation.set' && action.stateId === state.id,
            ),
          ).length
          const scopedCount = scene.interactions.filter((rule) =>
            rule.conditions.some((condition) =>
              condition.type === 'presentation.in' && condition.stateIds.includes(state.id),
            ),
          ).length
          if (editingStateId === state.id) {
            return (
              <li
                key={state.id}
                className="scene-state-card scene-state-card--active scene-state-card--editing"
              >
                <span className="scene-state-card__preview">状态</span>
                <input
                  autoFocus
                  value={draftName}
                  maxLength={80}
                  aria-label="状态名称"
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEditingStateId(null)
                  }}
                />
                <small>Enter 保存 · Esc 取消</small>
              </li>
            )
          }
          return (
            <li key={state.id} className="scene-state-card-shell">
              <button
                type="button"
                className={`scene-state-card${active ? ' scene-state-card--active' : ''}`}
                aria-pressed={active}
                aria-label={`${state.name}，命名状态${isInitial ? '，运行初始状态' : ''}${isThumbnail ? '，场景缩略图状态' : ''}，${overrideSummary}`}
                onClick={() => setActiveState(state.id)}
                onDoubleClick={() => {
                  if (editorMode !== 'professional') return
                  setActiveState(state.id)
                  setEditingStateId(state.id)
                  setDraftName(state.name)
                }}
              >
                <span className="scene-state-card__preview">命名状态</span>
                <span className="scene-state-card__name">{state.name}</span>
                <small>{overrideSummary}</small>
                {(incomingCount > 0 || scopedCount > 0) && (
                  <small className="scene-state-card__links">
                    {incomingCount > 0 ? `${incomingCount} 个入口` : ''}
                    {incomingCount > 0 && scopedCount > 0 ? ' · ' : ''}
                    {scopedCount > 0 ? `${scopedCount} 条状态映射` : ''}
                  </small>
                )}
                <span className="scene-state-card__badges" aria-hidden="true">
                  {isInitial && <i title="运行初始状态"><Star size={9} />初始</i>}
                  {isThumbnail && <i title="场景缩略图状态"><ImageIcon size={9} />缩略图</i>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {editorMode === 'professional' && <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction === 'delete' ? '删除场景状态？' : '清除当前状态的覆盖？'}
        message={pendingAction === 'delete'
          ? `“${activeState?.name ?? ''}”及其全部覆盖值将被删除，基础场景不会受影响。此操作可以撤销。`
          : `“${activeState?.name ?? ''}”将恢复为基础场景的外观。此操作可以撤销。`}
        confirmLabel={pendingAction === 'delete' ? '删除状态' : '清除覆盖'}
        danger={pendingAction === 'delete'}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (activeState) {
            if (pendingAction === 'delete') deleteState(activeState.id)
            else clearState(activeState.id)
          }
          setPendingAction(null)
        }}
      />}
    </section>
  )
}
