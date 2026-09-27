import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import {
  selectActiveCourseProjectDocument,
  selectEditingScope,
  selectEffectiveLayerProjection,
  useEditorStore,
} from '../../store/editorStore'

export interface FlowComponentLightEditTarget {
  readonly projectId: string
  readonly revision: number
  readonly generation: number
  readonly locationId: string
  readonly surfaceId: string
  readonly ownerKey: string
  readonly itemId: string
  readonly kind: 'text' | 'asset'
  readonly key: string
  readonly original?: string
  readonly region?: string
}

type Result = { readonly ok: true; readonly status: 'updated' | 'unchanged' } | { readonly ok: false; readonly reason: string }

function capture(itemId: string, kind: FlowComponentLightEditTarget['kind'], key: string, original?: string, region?: string): FlowComponentLightEditTarget | null {
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  const projection = selectEffectiveLayerProjection(state)
  const session = state.courseAuthoringSession
  if (!document || !projection || !session || projection.surfaceType !== 'flow' || selectEditingScope(state) !== 'scene'
    || session.token.locationId !== projection.locationId || session.token.surfaceType !== 'flow') return null
  const row = projection.unifiedRows.find(candidate => candidate.id === itemId && candidate.owner === 'surface' && candidate.item.kind === 'component')
  if (!row || row.locked || row.item.paperSpace !== 'paper'
    || row.scopeToken.ownerKey !== `surface:${projection.surfaceId}` || !key.trim()) return null
  return Object.freeze({ projectId: document.id, revision: document.revision, generation: session.token.generation,
    locationId: projection.locationId, surfaceId: projection.surfaceId, ownerKey: row.scopeToken.ownerKey,
    itemId, kind, key, ...(original === undefined ? {} : { original }), ...(region ? { region } : {}) })
}

function validate(target: FlowComponentLightEditTarget): string | null {
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  const projection = selectEffectiveLayerProjection(state)
  const session = state.courseAuthoringSession
  if (!document || document.id !== target.projectId || document.revision !== target.revision || !projection || !session
    || session.token.generation !== target.generation || session.token.locationId !== target.locationId
    || projection.locationId !== target.locationId || projection.surfaceId !== target.surfaceId
    || projection.surfaceType !== 'flow' || selectEditingScope(state) !== 'scene') return '组件编辑目标已过期，请重新选择。'
  const row = projection.unifiedRows.find(candidate => candidate.id === target.itemId && candidate.owner === 'surface' && candidate.item.kind === 'component')
  if (!row || row.item.paperSpace !== 'paper' || row.scopeToken.ownerKey !== target.ownerKey) return '原组件已不在当前纸面。'
  if (row.locked) return '组件已锁定，请先解锁。'
  if (target.kind === 'asset' && !target.key.trim()) return '组件图片目标无效。'
  if (target.kind === 'text' && target.original === undefined) return '组件文字目标无效。'
  return null
}

export const flowComponentLightEditCommands = {
  captureText(itemId: string, original: string, region?: string): FlowComponentLightEditTarget | null {
    return capture(itemId, 'text', `${original}\u0000${region ?? ''}`, original, region)
  },
  captureAsset(itemId: string, assetKey: string): FlowComponentLightEditTarget | null {
    return capture(itemId, 'asset', assetKey)
  },
  writeText(target: FlowComponentLightEditTarget, text: string): Result {
    const invalid = validate(target)
    if (invalid) return { ok: false, reason: invalid }
    if (target.kind !== 'text' || target.original === undefined) return { ok: false, reason: '组件文字目标无效。' }
    const rule: LightEditTextOverride = { original: target.original, ...(target.region ? { region: target.region } : {}), text }
    return useEditorStore.getState().writeComponentTextRule(target.itemId, rule)
  },
  replaceAsset(target: FlowComponentLightEditTarget, asset: AssetMeta, bytes: Uint8Array): Result {
    const invalid = validate(target)
    if (invalid) return { ok: false, reason: invalid }
    if (target.kind !== 'asset') return { ok: false, reason: '组件图片目标无效。' }
    return useEditorStore.getState().replaceComponentAssetAtKey(target.itemId, target.key, asset, bytes)
  },
}
