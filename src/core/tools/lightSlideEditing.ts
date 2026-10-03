import type { CourseProjectDocument, LayerItem } from '../../shared/courseProjectTypes'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { InteractionActionPayload, InteractionRule } from '../../shared/interactionTypes'
import { isPublishedInteractionClickBindable } from '../../shared/publishedInteractionSupport'
import { FONT_FAMILY_OPTIONS, fontFamilySource } from '../../shared/fonts/fontFamilyCatalog'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { createTextNode } from './nativeNodeFactories'
import { appendSceneLayer, slideSceneContext } from './slideInsertion'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { updateSlideBackgroundOwner } from './courseBackground'
import { createCourseSoundDefinition } from './courseAudio'
import { locateSceneInteractions, planAddSlideInteractionRule, planUpdateSlideInteractionRule } from './slideInteractions'
import { patchEffectiveLayerPropertiesAtTarget, materializeNamedStateItem } from './layerProperties'
import { makeEffectiveLayerAuthoringAddress } from './layerCommands'
import { locateCourseLayer } from '../drivers/course/layerProperties'
import { effectiveSceneCanvas } from '../../shared/slideCanvas'

export const LIGHT_SLIDE_OPACITIES = [1, 0.75, 0.5, 0.25] as const
export const LIGHT_SLIDE_LINE_SPACING = [0, 4, 8, 16] as const
export type SlidePageAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
export type SimpleSlideAction = 'audio.play' | 'location.go'
export interface SlideLightTarget { readonly locationId: string; readonly itemId: string; readonly stateId?: string | null; readonly expectedRevision: number }

function context(project: CourseProjectDocument, target: SlideLightTarget) {
  if (project.revision !== target.expectedRevision) throw new Error('stale-revision')
  const owner = { scope: 'scene', selection: { locationId: target.locationId, stateId: target.stateId ?? null } }
  const { location, surface, scene } = slideSceneContext(project, owner)
  if (target.stateId && !scene.presentation?.states.some(state => state.id === target.stateId)) throw new Error('当前命名状态已失效')
  const item = scene.layerItems.find(candidate => candidate.layerItemId === target.itemId)
  if (!item) throw new Error('当前场景中找不到所选元素')
  const state = scene.presentation?.states.find(candidate => candidate.id === target.stateId)
  if (materializeNamedStateItem(item, state?.layerItemOverrides[item.layerItemId]).locked) throw new Error('所选元素已锁定')
  return { location, surface, scene, item, owner }
}

function effectiveItem(project: CourseProjectDocument, target: SlideLightTarget): LayerItem {
  const { scene, item } = context(project, target)
  const state = scene.presentation?.states.find(candidate => candidate.id === target.stateId)
  return materializeNamedStateItem(item, state?.layerItemOverrides[item.layerItemId])
}

function property(project: CourseProjectDocument, target: SlideLightTarget, patch: Parameters<typeof patchEffectiveLayerPropertiesAtTarget>[2]): CourseProjectDocument {
  const { item } = context(project, target)
  const located = locateCourseLayer(project, item.layerItemId)
  if (!located || located.source !== 'scene') throw new Error('所选元素的作者范围已失效')
  const result = patchEffectiveLayerPropertiesAtTarget(project, {
    authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located), locationId: target.locationId, stateId: target.stateId,
  }, patch, { expectedRevision: target.expectedRevision })
  if (!result.ok || !result.nextDocument) throw new Error(result.reason ?? '无法更新元素属性')
  return result.nextDocument
}

export function planSlideLightOpacity(project: CourseProjectDocument, target: SlideLightTarget, opacity: typeof LIGHT_SLIDE_OPACITIES[number]): CourseProjectDocument {
  if (!LIGHT_SLIDE_OPACITIES.includes(opacity)) throw new Error('不支持的不透明度预设')
  return property(project, target, { opacity })
}

export function planSlideLightTextStyle(project: CourseProjectDocument, target: SlideLightTarget, style: { readonly fontFamily?: string; readonly lineSpacing?: typeof LIGHT_SLIDE_LINE_SPACING[number] }): CourseProjectDocument {
  const item = effectiveItem(project, target)
  if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('仅文字元素支持字体和行距')
  if (style.lineSpacing !== undefined && !LIGHT_SLIDE_LINE_SPACING.includes(style.lineSpacing)) throw new Error('不支持的额外像素行距预设')
  if (style.fontFamily !== undefined && !isBundledSlideFont(style.fontFamily)) throw new Error('只能选择内置字体')
  if (style.fontFamily === undefined && style.lineSpacing === undefined) return project
  return property(project, target, { nativeTextStyle: style })
}

export const LIGHT_SLIDE_FONTS = FONT_FAMILY_OPTIONS.filter(option => fontFamilySource(option.family) === 'bundled')
function isBundledSlideFont(value: string) { return LIGHT_SLIDE_FONTS.some(option => option.family === value) }

export function planSlideSceneBackground(project: CourseProjectDocument, locationId: string, stateId: string | null, color: string, expectedRevision: number): CourseProjectDocument {
  if (project.revision !== expectedRevision) throw new Error('stale-revision')
  const { location, scene } = slideSceneContext(project, { scope: 'scene', selection: { locationId, stateId } })
  if (stateId) {
    const state = scene.presentation?.states.find(candidate => candidate.id === stateId)
    if (!state) throw new Error('当前命名状态已失效')
    if (state.backgroundColor !== undefined || state.backgroundAssetId !== undefined) throw new Error('此状态有独立背景，请切换母版或在编辑器中调整')
  }
  const result = updateSlideBackgroundOwner(project, { surfaceId: location.surfaceId, sceneId: location.sceneId }, {
    backgroundMode: 'own', backgroundColor: color, backgroundAssetId: null,
  }, { expectedRevision })
  if (!result.ok) throw new Error(result.reason)
  return result.project
}

export function planSlidePageAlignment(project: CourseProjectDocument, target: SlideLightTarget, alignment: SlidePageAlignment): CourseProjectDocument {
  const { surface, scene } = context(project, target)
  const canvas = effectiveSceneCanvas(surface, scene)
  const item = effectiveItem(project, target)
  const radians = item.rotation * Math.PI / 180
  const boundsWidth = Math.abs(item.frame.width * Math.cos(radians)) + Math.abs(item.frame.height * Math.sin(radians))
  const boundsHeight = Math.abs(item.frame.width * Math.sin(radians)) + Math.abs(item.frame.height * Math.cos(radians))
  const left = item.frame.x + (item.frame.width - boundsWidth) / 2
  const top = item.frame.y + (item.frame.height - boundsHeight) / 2
  const desiredLeft = alignment === 'left' ? 0 : alignment === 'center-x' ? (canvas.width - boundsWidth) / 2 : alignment === 'right' ? canvas.width - boundsWidth : left
  const desiredTop = alignment === 'top' ? 0 : alignment === 'center-y' ? (canvas.height - boundsHeight) / 2 : alignment === 'bottom' ? canvas.height - boundsHeight : top
  if (!['left', 'center-x', 'right', 'top', 'center-y', 'bottom'].includes(alignment)) throw new Error('不支持的页面对齐方式')
  return property(project, target, { frame: { x: item.frame.x + desiredLeft - left, y: item.frame.y + desiredTop - top } })
}

function simpleRule(rule: InteractionRule, action: SimpleSlideAction): boolean {
  return rule.conditions.length === 0 && rule.actions.length === 1 && rule.actions[0].start === 'after-previous'
    && rule.actions[0].delayMs === 0 && rule.actions[0].action.type === action
}

export function readSimpleSlideInteraction(project: CourseProjectDocument, target: SlideLightTarget, action: SimpleSlideAction): { readonly rule: InteractionRule | null; readonly disabledReason: string | null } {
  const { item } = context(project, target)
  if (!isPublishedInteractionClickBindable(item)) return { rule: null, disabledReason: '此元素不支持点击互动' }
  const matching = (rule: InteractionRule) => rule.trigger.type === 'node.click' && rule.trigger.nodeId === target.itemId && rule.actions.some(step => step.action.type === action)
  if (project.globalInteractions.some(matching)) return { rule: null, disabledReason: '此元素已有全局点击互动，请在编辑器中设置' }
  const rules = locateSceneInteractions(project, target.locationId).filter(matching)
  if (rules.length > 1 || rules.some(rule => !simpleRule(rule, action))) return { rule: null, disabledReason: '已有复杂互动，请在编辑器中设置' }
  return { rule: rules[0] ?? null, disabledReason: null }
}

export function planSimpleSlideInteraction(project: CourseProjectDocument, target: SlideLightTarget, action: SimpleSlideAction, destinationId: string, ids: { readonly ruleId: string; readonly stepId: string }): CourseProjectDocument {
  const current = readSimpleSlideInteraction(project, target, action)
  if (current.disabledReason) throw new Error(current.disabledReason)
  if (action === 'audio.play') {
    if (!project.media.audio.sounds[destinationId]) throw new Error('找不到声音')
  } else if (!project.locations.some(location => location.id === destinationId)) throw new Error('找不到目标页面')
  const payload: InteractionActionPayload = action === 'audio.play'
    ? { type: 'audio.play', soundId: destinationId, loop: false, ifPlaying: 'restart', lifetime: 'scene' }
    : { type: 'location.go', locationId: destinationId }
  const scope = { locationId: target.locationId, scope: 'scene' as const }
  if (current.rule) {
    const previous = current.rule.actions[0].action
    const updated = previous.type === 'audio.play' ? { ...previous, soundId: destinationId } : payload
    return planUpdateSlideInteractionRule(project, scope, current.rule.id, { enabled: true, actions: [{ ...current.rule.actions[0], action: updated }] })
  }
  const rule: InteractionRule = { id: ids.ruleId, enabled: true, trigger: { type: 'node.click', nodeId: target.itemId }, conditions: [], actions: [{ id: ids.stepId, start: 'after-previous', delayMs: 0, action: payload }] }
  return planAddSlideInteractionRule(project, scope, rule)
}

export interface SlideAudioPlacement {
  readonly locationId: string
  readonly stateId?: string | null
  readonly expectedRevision: number
  readonly asset: AssetMeta
  readonly bytes?: Uint8Array
  readonly buttonId: string
  readonly ruleId: string
  readonly stepId: string
  readonly x?: number
  readonly y?: number
}

export function planSlideAudioPlacement(project: CourseProjectDocument, input: SlideAudioPlacement): { readonly project: CourseProjectDocument; readonly itemId: string; readonly soundId: string; readonly assetAddition: { readonly meta: AssetMeta; readonly bytes: Uint8Array } | null } {
  if (project.revision !== input.expectedRevision) throw new Error('stale-revision')
  const owner = { scope: 'scene', selection: { locationId: input.locationId, stateId: input.stateId ?? null } }
  const { scene, surface } = slideSceneContext(project, owner)
  if (input.stateId && !scene.presentation?.states.some(state => state.id === input.stateId)) throw new Error('当前命名状态已失效')
  if (input.asset.kind !== 'audio') throw new Error('所选素材不是音频')
  const existingAsset = project.assets[input.asset.id]
  if (existingAsset && existingAsset.kind !== 'audio') throw new Error('素材 ID 已用于其他类型')
  if (!existingAsset && (!input.bytes || input.bytes.length !== input.asset.byteLength)) throw new Error('音频资源字节缺失或长度不符')
  const sound = Object.values(project.media.audio.sounds).find(value => value.assetId === input.asset.id)
    ?? createCourseSoundDefinition(input.asset)
  const node = createTextNode({ id: input.buttonId, name: `音频：${sound.name}`, text: `▶ ${sound.name}`, x: input.x, y: input.y, canvas: effectiveSceneCanvas(surface, scene) })
  const item = sceneNodeToCourseLayerItem(node)
  const rule: InteractionRule = { id: input.ruleId, enabled: true, trigger: { type: 'node.click', nodeId: item.layerItemId }, conditions: [], actions: [{ id: input.stepId, start: 'after-previous', delayMs: 0, action: { type: 'audio.play', soundId: sound.id, loop: false, ifPlaying: 'restart', lifetime: 'scene' } }] }
  const next = commitCourseProjectMutation(project, draft => {
    if (!existingAsset) draft.assets[input.asset.id] = structuredClone(input.asset)
    if (!draft.media.audio.sounds[sound.id]) draft.media.audio.sounds[sound.id] = sound
    const destination = slideSceneContext(draft, owner).scene
    appendSceneLayer(draft, destination, item, input.stateId ?? null)
    if (destination.interactions.some(candidate => candidate.id === rule.id || candidate.actions.some(step => step.id === input.stepId))) throw new Error('互动规则 ID 已存在')
    destination.interactions.push(rule)
  })
  return { project: next, itemId: item.layerItemId, soundId: sound.id, assetAddition: existingAsset ? null : { meta: input.asset, bytes: input.bytes! } }
}
