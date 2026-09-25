import type { CourseProjectDocument, LayerItem, LayerItemOverride } from '../../shared/courseProjectTypes'
import { mergeCourseNativeData } from '../../shared/courseProjectSchema'
import { locateCourseLayer, normalizeEffectiveLayerPropertyPatch, writeBasePropertyPatch, type EffectiveLayerPropertyPatch, type NativeTextFramePort } from '../drivers/course/layerProperties'
import { resolveEffectiveLayerTarget, namedState, deleteEmptyOverride, runMutation } from './layerCommands'
import { LAYER_REJECT_LOCKED, rejectIfStaleDocument, succeedLayerNoop, failLayerCommand, type EffectiveLayerCommandTarget, type LayerCommandOptions, type LayerCommandResult } from './globalLayers'
export interface MeasuredLayerCommandOptions extends LayerCommandOptions { readonly measureTextFrame?: NativeTextFramePort }

export interface EffectiveLayerPropertiesPatchAtTarget extends EffectiveLayerPropertyPatch {
  readonly componentProps?: Record<string, unknown>
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function sparseObjectDiff(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (sameJson(base[key], next[key])) continue
    // `null` rides the shared merge contract as a key deletion.
    diff[key] = Object.prototype.hasOwnProperty.call(next, key)
      ? structuredClone(next[key])
      : null
  }
  return diff
}

export function materializeNamedStateItem(
  base: LayerItem,
  override: LayerItemOverride | undefined,
): LayerItem {
  if (!override) return structuredClone(base)
  const item = structuredClone(base)
  if (override.label !== undefined) item.label = override.label
  if (override.frame) Object.assign(item.frame, override.frame)
  if (override.rotation !== undefined) item.rotation = override.rotation
  if (override.opacity !== undefined) item.opacity = override.opacity
  if (override.visible !== undefined) item.visible = override.visible
  if (override.locked !== undefined) item.locked = override.locked
  if (override.playbackInitialVisibility !== undefined) {
    item.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (item.kind === 'native' && override.nativeData) {
    item.content.data = mergeCourseNativeData(
      item.content.data as Record<string, unknown>,
      override.nativeData,
    ) as typeof item.content.data
  }
  if (item.kind === 'component' && override.componentProps) {
    item.props = { ...item.props, ...structuredClone(override.componentProps) }
  }
  return item
}

export function assignOverrideValue<K extends keyof LayerItemOverride>(
  override: LayerItemOverride,
  key: K,
  value: LayerItemOverride[K],
  baseValue: LayerItemOverride[K],
): void {
  if (sameJson(value, baseValue)) delete override[key]
  else override[key] = structuredClone(value) as LayerItemOverride[K]
}

export function writeNamedStatePropertyPatch(
  base: LayerItem,
  override: LayerItemOverride,
  patch: EffectiveLayerPropertyPatch,
): void {
  const effective = materializeNamedStateItem(base, override)
  if (patch.label !== undefined) assignOverrideValue(override, 'label', patch.label, base.label)
  if (patch.frame) {
    const nextFrame = { ...effective.frame, ...patch.frame }
    const frame = Object.fromEntries(
      (['x', 'y', 'width', 'height'] as const).flatMap((key) => (
        nextFrame[key] === base.frame[key] ? [] : [[key, nextFrame[key]]]
      )),
    ) as NonNullable<LayerItemOverride['frame']>
    if (Object.keys(frame).length === 0) delete override.frame
    else override.frame = frame
  }
  if (patch.rotation !== undefined) assignOverrideValue(override, 'rotation', patch.rotation, base.rotation)
  if (patch.opacity !== undefined) assignOverrideValue(override, 'opacity', patch.opacity, base.opacity)
  if (patch.visible !== undefined) assignOverrideValue(override, 'visible', patch.visible, base.visible)
  if (patch.locked !== undefined) assignOverrideValue(override, 'locked', patch.locked, base.locked)
  if (patch.playbackInitialVisibility !== undefined) {
    assignOverrideValue(
      override,
      'playbackInitialVisibility',
      patch.playbackInitialVisibility,
      base.playbackInitialVisibility,
    )
  }
  if (patch.nativeTextStyle !== undefined || patch.nativeData !== undefined) {
    if (base.kind !== 'native' || effective.kind !== 'native') {
      throw new Error('当前元素不支持原生内容属性')
    }
    const currentData = effective.content.data as Record<string, unknown>
    const nextData = mergeCourseNativeData(
      patch.nativeTextStyle !== undefined
        ? mergeCourseNativeData(currentData, { style: patch.nativeTextStyle })
        : currentData,
      patch.nativeData ?? {},
    )
    const nativeData = sparseObjectDiff(
      base.content.data as Record<string, unknown>,
      nextData,
    )
    if (Object.keys(nativeData).length === 0) delete override.nativeData
    else override.nativeData = nativeData
  }
}

export function patchEffectiveLayerPropertiesAtTargets(
  document: CourseProjectDocument,
  updates: readonly {
    readonly target: EffectiveLayerCommandTarget
    readonly patch: EffectiveLayerPropertiesPatchAtTarget
  }[],
  options: MeasuredLayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    if (updates.length === 0) return succeedLayerNoop(document, '未变化')
    const plans = updates.map(({ target, patch }) => {
      const located = resolveEffectiveLayerTarget(document, target)
      const stateView = namedState(document, located, target.stateId)
      if (target.stateId && located.source === 'scene' && !stateView) {
        throw new Error('当前命名状态已失效')
      }
      const effective = stateView
        ? materializeNamedStateItem(
            located.item,
            stateView.state.layerItemOverrides[located.item.layerItemId],
          )
        : located.item
      const { componentProps, ...propertyPatch } = patch
      const normalized = normalizeEffectiveLayerPropertyPatch(
        effective,
        located.source,
        propertyPatch,
        { allowOwnedNativeData: true, measureTextFrame: options.measureTextFrame },
      )
      let nextComponentProps: Record<string, unknown> | null = null
      let componentChanged = false
      if (componentProps !== undefined) {
        if (
          componentProps === null
          || typeof componentProps !== 'object'
          || Array.isArray(componentProps)
          || effective.kind !== 'component'
        ) {
          throw new Error('当前元素不支持组件属性')
        }
        if (effective.locked) throw new Error(LAYER_REJECT_LOCKED)
        nextComponentProps = structuredClone(componentProps)
        componentChanged = !sameJson(effective.props, nextComponentProps)
      }
      return {
        target,
        layerItemId: located.item.layerItemId,
        patch: normalized.patch,
        changed: normalized.changed || componentChanged,
        nextComponentProps,
      }
    })
    if (new Set(plans.map((plan) => plan.layerItemId)).size !== plans.length) {
      throw new Error('一次属性更新不能包含重复元素')
    }
    if (!plans.some((plan) => plan.changed)) return succeedLayerNoop(document, '未变化')
    return runMutation(document, (draft) => {
      for (const plan of plans) {
        if (!plan.changed) continue
        const current = locateCourseLayer(draft, plan.layerItemId)
        if (!current) throw new Error(`找不到图层：${plan.layerItemId}`)
        const nextState = namedState(draft, current, plan.target.stateId)
        if (plan.target.stateId && current.source === 'scene' && !nextState) {
          throw new Error('当前命名状态已失效')
        }
        if (nextState) {
          const override = nextState.state.layerItemOverrides[current.item.layerItemId] ?? {}
          writeNamedStatePropertyPatch(current.item, override, plan.patch)
          if (plan.nextComponentProps !== null) {
            if (current.item.kind !== 'component') {
              throw new Error('当前元素不支持组件属性')
            }
            const sparse = sparseObjectDiff(current.item.props, plan.nextComponentProps)
            if (Object.keys(sparse).length === 0) delete override.componentProps
            else override.componentProps = sparse
          }
          nextState.state.layerItemOverrides[current.item.layerItemId] = override
          deleteEmptyOverride(nextState.state.layerItemOverrides, current.item.layerItemId)
          continue
        }
        writeBasePropertyPatch(current.item, plan.patch)
        if (plan.nextComponentProps !== null) {
          if (current.item.kind !== 'component') {
            throw new Error('当前元素不支持组件属性')
          }
          current.item.props = plan.nextComponentProps
        }
      }
    }, plans.length === 1 ? '已更新元素属性' : `已更新 ${plans.length} 个元素属性`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新所选元素属性')
  }
}

export function patchEffectiveLayerPropertiesAtTarget(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  patch: EffectiveLayerPropertiesPatchAtTarget,
  options: MeasuredLayerCommandOptions = {},
): LayerCommandResult {
  return patchEffectiveLayerPropertiesAtTargets(document, [{ target, patch }], options)
}
