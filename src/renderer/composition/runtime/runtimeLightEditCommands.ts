import { useMemo } from 'react'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import { selectActiveCourseProjectDocument, selectActiveSceneId, selectEditingScope, selectEffectiveLayerProjection, useEditorStore } from '../../store/editorStore'


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

/** Page-text edits enter the dynamic fallback precommit lane; an ACK owns content and fallback together. */
export const runtimeLightEditCommands = {
  read(itemId: string): RuntimeLightEditView | null {
    const row = selectEffectiveLayerProjection(useEditorStore.getState())?.unifiedRows
      .find(candidate => candidate.id === itemId && candidate.item.kind === 'runtime')
    if (!row || row.item.kind !== 'runtime') return null
    return { source: row.item.runtime.source, overrides: row.item.runtime.content.overrides ?? [], locked: row.locked }
  },

  /** Replace one text everywhere the Runtime renders it (a rule without a region). */
  async setPageText(itemId: string, original: string, text: string): Promise<RuntimePageTextResult> {
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    const projection = selectEffectiveLayerProjection(state)
    const documentId = state.courseDocument.documentId
    if (!document || !projection?.locationId || !documentId) return { ok: false, reason: '当前没有可编辑的 H5 演示页面' }
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
    const submission = state.submitDynamicFallbackIntent({
      kind: 'runtime.text', documentId, locationId: projection.locationId, itemId, projectId: document.id, target, value: text,
    })
    if (!submission) return { ok: false, reason: '页面文字暂时无法提交，草稿已保留' }
    try {
      const result = await submission.settled
      if (result.status === 'failed' || result.status === 'conflict') return { ok: false, reason: result.reason }
      return { ok: true, changed: result.status === 'applied' }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '页面文字提交失败，草稿已保留' }
    }
  },
}
