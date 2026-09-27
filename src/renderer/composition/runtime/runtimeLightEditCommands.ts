import { useMemo } from 'react'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import { selectActiveCourseProjectDocument, selectActiveSceneId, selectEditingScope, selectEffectiveLayerProjection, useEditorStore } from '../../store/editorStore'
import { scheduleStaticFallbackRecapture } from './staticFallbackRecapture'

export interface RuntimeLightEditView {
  readonly source: string
  readonly overrides: readonly LightEditTextOverride[]
  readonly locked: boolean
}

/** Live view of one Runtime's source and rules; re-renders only when they change. */
export function useRuntimeLightEditView(itemId: string): RuntimeLightEditView | null {
  const key = useEditorStore((state) => {
    const row = selectEffectiveLayerProjection(state)?.unifiedRows
      .find(candidate => candidate.id === itemId && candidate.item.kind === 'runtime')
    return row && row.item.kind === 'runtime'
      ? JSON.stringify([row.item.runtime.source, row.item.runtime.content.overrides ?? [], row.locked])
      : ''
  })
  return useMemo(() => {
    if (!key) return null
    const [source, overrides, locked] = JSON.parse(key) as [string, LightEditTextOverride[], boolean]
    return { source, overrides, locked }
  }, [key])
}

export type RuntimePageTextResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }

/** Store-backed M15 page-text commands for one selected Runtime; commits go through the Runtime text planner. */
export const runtimeLightEditCommands = {
  read(itemId: string): RuntimeLightEditView | null {
    const row = selectEffectiveLayerProjection(useEditorStore.getState())?.unifiedRows
      .find(candidate => candidate.id === itemId && candidate.item.kind === 'runtime')
    if (!row || row.item.kind !== 'runtime') return null
    return { source: row.item.runtime.source, overrides: row.item.runtime.content.overrides ?? [], locked: row.locked }
  },

  /** Replace one text everywhere the Runtime renders it (a rule without a region). */
  setPageText(itemId: string, original: string, text: string): RuntimePageTextResult {
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    const projection = selectEffectiveLayerProjection(state)
    if (!document || !projection) return { ok: false, reason: '当前没有可编辑的 H5 演示' }
    const target = state.captureRuntimeContentTextTarget({
      projectId: document.id,
      scope: selectEditingScope(state),
      sceneId: projection.surfaceType === 'spatial-2d' || projection.surfaceType === 'flow' ? projection.locationId : selectActiveSceneId(state),
      targetId: `page-text:${itemId}`,
      nodeId: itemId,
      kind: 'text',
      key: '',
      lightEdit: { original },
    })
    if (!target) return { ok: false, reason: '这个 Runtime 已锁定或不在当前编辑范围，未写入修改' }
    const committed = state.updateRuntimeContentTextAtTarget(target, text)
    if (!committed.ok) return { ok: false, reason: committed.reason }
    if (committed.status === 'updated') scheduleStaticFallbackRecapture(itemId)
    return { ok: true, changed: committed.status === 'updated' }
  },
}
