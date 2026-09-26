import type { EditorTransactionPlan } from '@/renderer/authoring/editorTransaction'
import type { CourseAssetSidecar } from '@/renderer/project/v9AssetAdapter'
import { planAssetFileHistoryChange } from '@/renderer/store/courseResourceState'
import { locateCourseLayer } from '@/core/drivers/course/layerProperties'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { ComponentLayerItem, CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { lightEditOverrideKey, type LightEditTextOverride } from '@/shared/contracts/runtime/lightEdit'

/**
 * M15 light edits of a component instance: text the component renders itself becomes a rule on its layer item
 * (original text and region → new text), and a replaced picture points one manifest asset at a managed project
 * asset. The component's package and source are never changed.
 */
export type ComponentLightEditPlanResult =
  | { readonly ok: true; readonly status: 'planned'; readonly plan: EditorTransactionPlan }
  | { readonly ok: true; readonly status: 'no-op' }
  | { readonly ok: false; readonly reason: string }

function componentItem(project: CourseProjectDocument, itemId: string): ComponentLayerItem | string {
  const located = locateCourseLayer(project, itemId)
  if (!located || located.item.kind !== 'component') return '这个组件已不存在，请重新选择。'
  if (located.item.locked) return '组件已锁定，请先解锁再修改。'
  return located.item
}
function finish(project: CourseProjectDocument, next: CourseProjectDocument, now: string, resourceChanges: EditorTransactionPlan['resourceChanges'] = {}): ComponentLightEditPlanResult {
  next.revision = project.revision + 1
  next.updatedAt = now
  const parsed = courseProjectDocumentSchema.safeParse(next)
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? '修改后的 H5 演示无效，未写入。' }
  return { ok: true, status: 'planned', plan: { projectId: project.id, baseRevision: project.revision, nextDocument: parsed.data, resourceChanges } }
}

/** Sets (or, back at the original text, removes) the rule for one occurrence of the component's own text. */
export function planComponentTextRule(input: {
  project: CourseProjectDocument
  itemId: string
  rule: LightEditTextOverride
  now: string
}): ComponentLightEditPlanResult {
  const item = componentItem(input.project, input.itemId)
  if (typeof item === 'string') return { ok: false, reason: item }
  const key = lightEditOverrideKey(input.rule)
  const rules = (item.textOverrides ?? []).filter(rule => lightEditOverrideKey(rule) !== key)
  if (input.rule.text !== input.rule.original) rules.push({ original: input.rule.original, ...(input.rule.region ? { region: input.rule.region } : {}), text: input.rule.text })
  if (JSON.stringify(rules) === JSON.stringify(item.textOverrides ?? [])) return { ok: true, status: 'no-op' }
  const next = structuredClone(input.project)
  const target = locateCourseLayer(next, input.itemId)!.item as ComponentLayerItem
  if (rules.length) target.textOverrides = rules
  else delete target.textOverrides
  return finish(input.project, next, input.now)
}

/** Shows a managed image instead of one of the component's manifest assets; the image and the override are one step. */
export function planComponentAssetReplacement(input: {
  project: CourseProjectDocument
  sidecar: CourseAssetSidecar
  itemId: string
  assetKey: string
  asset: AssetMeta
  bytes: Uint8Array
  now: string
}): ComponentLightEditPlanResult {
  const item = componentItem(input.project, input.itemId)
  if (typeof item === 'string') return { ok: false, reason: item }
  if (input.asset.kind !== 'image' || !input.asset.mimeType.startsWith('image/')) return { ok: false, reason: '请选择一张图片。' }
  const existingMeta = Object.hasOwn(input.project.assets, input.asset.id) ? input.project.assets[input.asset.id] : undefined
  const existingBytes = Object.hasOwn(input.sidecar.files, input.asset.id) ? input.sidecar.files[input.asset.id] : undefined
  if (existingMeta && JSON.stringify(existingMeta) !== JSON.stringify(input.asset)) return { ok: false, reason: '同名素材已存在且内容不同，未写入。' }
  if (existingBytes && (existingBytes.byteLength !== input.bytes.byteLength || existingBytes.some((value, index) => value !== input.bytes[index])))
    return { ok: false, reason: '同名素材已存在且内容不同，未写入。' }
  if (item.assetOverrides?.[input.assetKey]?.assetId === input.asset.id && existingMeta && existingBytes) return { ok: true, status: 'no-op' }
  const next = structuredClone(input.project)
  if (!existingMeta) next.assets[input.asset.id] = structuredClone(input.asset)
  const target = locateCourseLayer(next, input.itemId)!.item as ComponentLayerItem
  target.assetOverrides = { ...target.assetOverrides, [input.assetKey]: { assetId: input.asset.id } }
  const change = planAssetFileHistoryChange(input.asset.id, existingBytes, input.bytes)
  return finish(input.project, next, input.now, change ? { assetFileChanges: [change] } : {})
}
