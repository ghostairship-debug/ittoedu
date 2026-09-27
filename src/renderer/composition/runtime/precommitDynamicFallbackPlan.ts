import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { LightEditTextOverride } from '../../../shared/contracts/runtime/lightEdit'
import type { DocumentModel, DocumentSnapshot } from '../../../shared/workbench/document'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import { isCourseLayerVisibleAtLocation } from '../../../shared/courseProjectModel'
import { componentPackagesFromArchive, componentPackagesToArchiveFiles } from '../../components/componentPackageStore'
import { planComponentAssetReplacement, planComponentTextRule } from '../../components/componentLightEditTransactions'
import { planCourseRuntimeAssetReplacement, type CourseRuntimeAssetReplacementTarget } from '../../runtime/courseRuntimeTransactions'
import { planRuntimeContentTextUpdate, type CourseRuntimeContentTextTarget } from '../../runtime/runtimeContentTextAuthoringCommands'
import { applyHistoryResourceChanges } from '../../store/courseResourceState'
import type { EditorTransactionPlan } from '../../authoring/editorTransaction'

interface BaseIntent { readonly documentId: string; readonly locationId: string; readonly itemId: string; readonly projectId: string }
export type DynamicFallbackIntent = BaseIntent & (
  | { readonly kind: 'runtime.text'; readonly target: CourseRuntimeContentTextTarget; readonly value: string }
  | { readonly kind: 'runtime.asset'; readonly target: CourseRuntimeAssetReplacementTarget; readonly asset: AssetMeta; readonly bytes: Uint8Array }
  | { readonly kind: 'component.text'; readonly original: string; readonly region?: string; readonly text: string; readonly expectedText?: string }
  | { readonly kind: 'component.asset'; readonly assetKey: string; readonly asset: AssetMeta; readonly bytes: Uint8Array; readonly expectedAssetId?: string }
)
type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
export interface DynamicFallbackPlan { readonly model: CourseModel; readonly hasFallback: boolean }

/** Stable target and surface checks run again against each authoritative ACK, never a Store projection. */
export function assertDynamicFallbackTarget(snapshot: DocumentSnapshot, intent: DynamicFallbackIntent): void {
  if (snapshot.documentId !== intent.documentId || snapshot.model.kind !== 'course-v9'
    || snapshot.model.project.id !== intent.projectId) throw new Error('编辑目标文档已改变')
  const project = snapshot.model.project
  const location = project.locations.find(value => value.id === intent.locationId)
  const located = locateCourseLayer(project, intent.itemId)
  if (!location || !located || located.item.locked || located.item.kind === 'native'
    || located.source !== 'global' && located.surfaceId !== location.surfaceId
    || located.source === 'scene' && (location.kind !== 'slide-scene' || located.sceneId !== location.sceneId)
    || located.scoped && !isCourseLayerVisibleAtLocation(located.scoped, intent.locationId)) {
    throw new Error('动态目标已不存在、锁定或不在原页面')
  }
  if ((intent.kind.startsWith('runtime.') && located.item.kind !== 'runtime')
    || (intent.kind.startsWith('component.') && located.item.kind !== 'component')) throw new Error('动态目标类型已改变')
  if (intent.kind === 'runtime.text' || intent.kind === 'runtime.asset') {
    const target = intent.target.courseTarget
    if (target.projectId !== intent.projectId || target.itemId !== intent.itemId || target.locationId !== intent.locationId
      || target.surfaceId !== location.surfaceId || target.owner !== located.source) throw new Error('Runtime 编辑身份已改变')
  }
}

function rebindRuntimeTarget<T extends CourseRuntimeContentTextTarget | CourseRuntimeAssetReplacementTarget>(target: T, revision: number): T {
  return { ...target, courseTarget: { ...target.courseTarget, documentRevision: revision } }
}
function runtimeIdentity(target: CourseRuntimeContentTextTarget['courseTarget'], revision: number) {
  return { projectId: target.projectId, documentRevision: revision,
    sessionToken: { locationId: target.locationId, surfaceType: target.surfaceType, revision, generation: target.sessionGeneration },
    surfaceId: target.surfaceId, stateId: target.stateId, owner: target.owner, ownerKey: target.ownerKey }
}
function plannedModel(base: CourseModel, plan: EditorTransactionPlan): CourseModel {
  const resources = applyHistoryResourceChanges({ assetFiles: base.resources.assets,
    componentPackages: componentPackagesFromArchive(base.project, base.resources.components) }, plan.resourceChanges, 'forward')
  return { kind: 'course-v9', project: structuredClone(plan.nextDocument), resources: {
    assets: structuredClone(resources.assetFiles), components: componentPackagesToArchiveFiles(resources.componentPackages),
  } }
}

export function planDynamicFallbackIntent(snapshot: DocumentSnapshot, intent: DynamicFallbackIntent, now: string, allowOwnReplan = false): DynamicFallbackPlan | null {
  assertDynamicFallbackTarget(snapshot, intent)
  const base = snapshot.model as CourseModel, project = base.project
  let plan: EditorTransactionPlan | null = null
  if (intent.kind === 'runtime.text') {
    const located = locateCourseLayer(project, intent.itemId)?.item
    if (!located || located.kind !== 'runtime') throw new Error('Runtime 目标已改变')
    const original = intent.target.override
    const current = original
      ? located.runtime.content.overrides?.find(rule => rule.original === original.original && rule.region === original.region)?.text ?? original.original
      : located.runtime.content.values[intent.target.contentKey]
    if (typeof current !== 'string') throw new Error('Runtime 文字字段已改变')
    // A later queued intent may carry the text visible before an earlier local ACK.
    // Only the queue owner can reach this planner after verifying each intervening ACK.
    const target = { ...rebindRuntimeTarget(intent.target, project.revision), initialValue: allowOwnReplan ? current : intent.target.initialValue }
    const result = planRuntimeContentTextUpdate({ project, target, currentIdentity: runtimeIdentity(target.courseTarget, project.revision),
      value: intent.value, now })
    if (!result.ok) throw new Error(result.reason)
    plan = result.status === 'planned' ? result.plan : null
  } else if (intent.kind === 'runtime.asset') {
    const target = rebindRuntimeTarget(intent.target, project.revision)
    const result = planCourseRuntimeAssetReplacement({ project, sidecar: { files: base.resources.assets }, target,
      currentIdentity: runtimeIdentity(target.courseTarget, project.revision), asset: intent.asset, bytes: intent.bytes, now })
    if (!result.ok) throw new Error(result.reason)
    plan = result.status === 'planned' ? result.plan : null
  } else if (intent.kind === 'component.text') {
    const item = locateCourseLayer(project, intent.itemId)?.item
    if (!item || item.kind !== 'component') throw new Error('组件目标已改变')
    const key = `${intent.original}\u0000${intent.region ?? ''}`
    const current = (item.textOverrides ?? []).find(rule => `${rule.original}\u0000${rule.region ?? ''}` === key)?.text ?? intent.original
    if (intent.expectedText !== undefined && current !== intent.expectedText && !allowOwnReplan) throw new Error('组件文字已改变，请重新确认')
    const rule: LightEditTextOverride = { original: intent.original, ...(intent.region ? { region: intent.region } : {}), text: intent.text }
    const result = planComponentTextRule({ project, itemId: intent.itemId, rule, now })
    if (!result.ok) throw new Error(result.reason)
    plan = result.status === 'planned' ? result.plan : null
  } else {
    const item = locateCourseLayer(project, intent.itemId)?.item
    if (!item || item.kind !== 'component') throw new Error('组件目标已改变')
    const current = item.assetOverrides?.[intent.assetKey]?.assetId
    if (intent.expectedAssetId !== undefined && current !== intent.expectedAssetId && !allowOwnReplan) throw new Error('组件图片已改变，请重新确认')
    const result = planComponentAssetReplacement({ project, sidecar: { files: base.resources.assets }, itemId: intent.itemId,
      assetKey: intent.assetKey, asset: intent.asset, bytes: intent.bytes, now })
    if (!result.ok) throw new Error(result.reason)
    plan = result.status === 'planned' ? result.plan : null
  }
  if (!plan) return null
  const model = plannedModel(base, plan)
  const item = locateCourseLayer(model.project, intent.itemId)?.item
  const hasFallback = item?.kind === 'runtime' ? Boolean(item.runtime.staticFallback)
    : item?.kind === 'component' && Boolean(item.staticFallbackAssetId)
  return { model, hasFallback }
}
