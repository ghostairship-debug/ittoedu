import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import { slideSceneContext } from '../../../core/tools/slideInsertion'
import { materializeNamedStateItem } from '../../../core/tools/layerProperties'
import { planSlideAudioPlacement, planSlideLightOpacity, planSlideLightTextStyle, planSlidePageAlignment, planSlideSceneBackground, planSimpleSlideInteraction, readSimpleSlideInteraction, type SlideLightTarget, type SlideAudioPlacement, type SlidePageAlignment } from '../../../core/tools/lightSlideEditing'
import { slideLightCommands, type SlideLightCommand, type SlideLightCommandState } from '../../editing/commands/slideLightCommands'
import { createEditorTransactionStep, type EditorTransactionStep } from '../../authoring/editorTransaction'

/** Captured at selection time. Commands never retarget to the current selection. */
export interface SlideLightSelectionSnapshot extends SlideLightTarget {
  readonly documentId: string
  readonly projectId: string
  readonly stateId: string | null
}

export interface SlideLightCurrent {
  readonly documentId: string
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly itemId: string
  readonly stateId: string | null
}

export interface SlideLightView {
  readonly target: SlideLightSelectionSnapshot
  readonly commands: readonly SlideLightCommand[]
  readonly fontFamily: string | null
  readonly lineSpacing: number | null
  readonly opacity: number
  readonly backgroundColor: string | null
}

/** The composition root supplies its existing canonical transaction writer and ACK. */
export interface SlideLightEditingOwner {
  readCurrent(): SlideLightCurrent | null
  commit(step: EditorTransactionStep, target: SlideLightSelectionSnapshot): Promise<boolean>
  chooseAudio?(): Promise<{ readonly asset: AssetMeta; readonly bytes: Uint8Array } | null>
  createId(): string
}

const stale = () => new Error('选择或文档已改变，请重新选择后再试')

export function createSlideLightEditingPort(owner: SlideLightEditingOwner) {
  const capture = (): SlideLightSelectionSnapshot | null => {
    const current = owner.readCurrent()
    return current ? Object.freeze({ documentId: current.documentId, projectId: current.project.id,
      locationId: current.locationId, itemId: current.itemId, stateId: current.stateId,
      expectedRevision: current.project.revision }) : null
  }
  const requireCurrent = (target: SlideLightSelectionSnapshot): CourseProjectDocument => {
    const current = owner.readCurrent()
    if (!current || current.documentId !== target.documentId || current.project.id !== target.projectId ||
      current.project.revision !== target.expectedRevision || current.locationId !== target.locationId ||
      current.itemId !== target.itemId || current.stateId !== target.stateId) throw stale()
    return current.project
  }
  const view = (target: SlideLightSelectionSnapshot): SlideLightView => {
    const project = requireCurrent(target)
    const { scene } = slideSceneContext(project, { scope: 'scene', selection: { locationId: target.locationId, stateId: target.stateId } })
    const base = scene.layerItems.find(item => item.layerItemId === target.itemId)
    if (!base) throw stale()
    const state = scene.presentation?.states.find(value => value.id === target.stateId)
    if (target.stateId && !state) throw stale()
    const item = materializeNamedStateItem(base, state?.layerItemOverrides[base.layerItemId])
    const audio = readSimpleSlideInteraction(project, target, 'audio.play')
    const navigation = readSimpleSlideInteraction(project, target, 'location.go')
    const commandState: SlideLightCommandState = {
      isText: item.kind === 'native' && item.content.nativeType === 'text', locked: item.locked,
      clickBindable: !audio.disabledReason || audio.disabledReason !== '此元素不支持点击互动',
      complexAudioRule: Boolean(audio.disabledReason && audio.disabledReason !== '此元素不支持点击互动'),
      complexNavigationRule: Boolean(navigation.disabledReason && navigation.disabledReason !== '此元素不支持点击互动'),
      stateBackgroundOverride: Boolean(state && (state.backgroundColor !== undefined || state.backgroundAssetId !== undefined)),
      sounds: Object.values(project.media.audio.sounds).map(sound => ({ id: sound.id, name: sound.name })),
      locations: project.locations.map(location => ({ id: location.id, label: location.label })),
    }
    const style = item.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.style : null
    return { target, commands: slideLightCommands(commandState), fontFamily: style?.fontFamily ?? null,
      lineSpacing: style?.lineSpacing ?? null, opacity: item.opacity,
      backgroundColor: scene.backgroundColor ?? null }
  }
  const commit = async (target: SlideLightSelectionSnapshot, next: CourseProjectDocument, addition?: { readonly meta: AssetMeta; readonly bytes: Uint8Array } | null): Promise<void> => {
    const project = requireCurrent(target)
    const step = createEditorTransactionStep(project, { projectId: target.projectId, baseRevision: target.expectedRevision,
      nextDocument: next, resourceChanges: addition ? { assetFileChanges: [{ assetId: addition.meta.id, after: addition.bytes }] } : {},
      selectionHint: { kind: 'authoring-tool-selection' as const, locationId: target.locationId, stateId: target.stateId,
        owner: 'scene' as const, itemIds: [target.itemId] } })
    if (step && !await owner.commit(step, target)) throw new Error('修改未提交，请重新选择后重试')
  }
  const placeAudio = async (target: SlideLightSelectionSnapshot): Promise<void> => {
    requireCurrent(target)
    if (!owner.chooseAudio) throw new Error('未连接音频文件选择入口')
    const selected = await owner.chooseAudio()
    if (!selected) return
    const project = requireCurrent(target)
    const input: SlideAudioPlacement = { ...target, asset: selected.asset, bytes: selected.bytes,
      buttonId: owner.createId(), ruleId: owner.createId(), stepId: owner.createId() }
    const planned = planSlideAudioPlacement(project, input)
    await commit(target, planned.project, planned.assetAddition)
  }
  const run = async (target: SlideLightSelectionSnapshot, command: SlideLightCommand): Promise<void> => {
    const project = requireCurrent(target)
    const available = view(target).commands.find(candidate => candidate.id === command.id)
    if (!available || available.disabledReason) throw new Error(available?.disabledReason ?? '当前操作不可用')
    if (available.kind === 'audio-import') return placeAudio(target)
    const value = available.value
    let next: CourseProjectDocument
    switch (available.kind) {
      case 'opacity': next = planSlideLightOpacity(project, target, value as 1 | 0.75 | 0.5 | 0.25); break
      case 'font': next = planSlideLightTextStyle(project, target, { fontFamily: String(value) }); break
      case 'line-spacing': next = planSlideLightTextStyle(project, target, { lineSpacing: value as 0 | 4 | 8 | 16 }); break
      case 'page-align': next = planSlidePageAlignment(project, target, value as SlidePageAlignment); break
      case 'scene-background': next = planSlideSceneBackground(project, target.locationId, target.stateId, String(value), target.expectedRevision); break
      case 'audio-play': next = planSimpleSlideInteraction(project, target, 'audio.play', String(value), { ruleId: owner.createId(), stepId: owner.createId() }); break
      case 'location-go': next = planSimpleSlideInteraction(project, target, 'location.go', String(value), { ruleId: owner.createId(), stepId: owner.createId() }); break
    }
    await commit(target, next)
  }
  return { capture, view, run, placeAudio }
}

export type SlideLightEditingPort = ReturnType<typeof createSlideLightEditingPort>
