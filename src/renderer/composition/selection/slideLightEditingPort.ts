import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import { slideSceneContext } from '../../../core/tools/slideInsertion'
import { materializeNamedStateItem } from '../../../core/tools/layerProperties'
import { isPublishedInteractionClickBindable } from '../../../shared/publishedInteractionSupport'
import { planSlideAudioPlacement, planSlideLightOpacity, planSlideLightTextStyle, planSlidePageAlignment, planSlideSceneBackground, planSimpleSlideInteraction, readSimpleSlideInteraction, type SlideAudioPlacement, type SlidePageAlignment } from '../../../core/tools/lightSlideEditing'
import { slideLightPageCommands, slideLightObjectCommands, type SlideLightCommand, type SlideLightObjectCommandState } from '../../editing/commands/slideLightCommands'
import { createEditorTransactionStep, type EditorTransactionStep } from '../../authoring/editorTransaction'

interface SlideLightIdentity {
  readonly documentId: string
  readonly epoch: string
  readonly projectId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly expectedRevision: number
}

/** Page actions need no selected object; both targets freeze one formal document identity. */
export interface SlideLightPageTarget extends SlideLightIdentity { readonly kind: 'page' }
export interface SlideLightObjectTarget extends SlideLightIdentity {
  readonly kind: 'object'
  readonly itemId: string
}
export type SlideLightSelectionSnapshot = SlideLightPageTarget | SlideLightObjectTarget

export interface SlideLightCurrent {
  readonly documentId: string
  readonly epoch: string
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly itemId: string | null
  readonly stateId: string | null
  readonly pending?: number
}

export interface SlideLightPageView {
  readonly target: SlideLightPageTarget
  readonly commands: readonly SlideLightCommand[]
  readonly backgroundColor: string | null
}

export interface SlideLightObjectView {
  readonly target: SlideLightObjectTarget
  readonly commands: readonly SlideLightCommand[]
  readonly fontFamily: string | null
  readonly lineSpacing: number | null
  readonly opacity: number
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
  const capturePage = (): SlideLightPageTarget | null => {
    const current = owner.readCurrent()
    return current && !current.pending ? Object.freeze({ kind: 'page', documentId: current.documentId, epoch: current.epoch,
      projectId: current.project.id, locationId: current.locationId, stateId: current.stateId,
      expectedRevision: current.project.revision }) : null
  }
  const captureObject = (): SlideLightObjectTarget | null => {
    const current = owner.readCurrent()
    return current?.itemId && !current.pending ? Object.freeze({ kind: 'object', documentId: current.documentId,
      epoch: current.epoch, projectId: current.project.id, locationId: current.locationId, itemId: current.itemId,
      stateId: current.stateId, expectedRevision: current.project.revision }) : null
  }
  const requireCurrent = (target: SlideLightSelectionSnapshot): CourseProjectDocument => {
    const current = owner.readCurrent()
    if (!current || current.pending || current.documentId !== target.documentId || current.epoch !== target.epoch ||
      current.project.id !== target.projectId || current.project.revision !== target.expectedRevision ||
      current.locationId !== target.locationId || current.stateId !== target.stateId ||
      (target.kind === 'object' && current.itemId !== target.itemId)) throw stale()
    return current.project
  }
  const viewPage = (target: SlideLightPageTarget): SlideLightPageView => {
    const project = requireCurrent(target)
    const { scene } = slideSceneContext(project, { scope: 'scene', selection: { locationId: target.locationId, stateId: target.stateId } })
    const state = scene.presentation?.states.find(value => value.id === target.stateId)
    if (target.stateId && !state) throw stale()
    return { target, commands: slideLightPageCommands({ stateBackgroundOverride: Boolean(state &&
      (state.backgroundColor !== undefined || state.backgroundAssetId !== undefined)) }),
    backgroundColor: scene.backgroundColor ?? null }
  }
  const viewObject = (target: SlideLightObjectTarget): SlideLightObjectView => {
    const project = requireCurrent(target)
    const { scene } = slideSceneContext(project, { scope: 'scene', selection: { locationId: target.locationId, stateId: target.stateId } })
    const base = scene.layerItems.find(item => item.layerItemId === target.itemId)
    if (!base) throw stale()
    const state = scene.presentation?.states.find(value => value.id === target.stateId)
    if (target.stateId && !state) throw stale()
    const item = materializeNamedStateItem(base, state?.layerItemOverrides[base.layerItemId])
    const audio = item.locked ? null : readSimpleSlideInteraction(project, target, 'audio.play')
    const navigation = item.locked ? null : readSimpleSlideInteraction(project, target, 'location.go')
    const commandState: SlideLightObjectCommandState = {
      isText: item.kind === 'native' && item.content.nativeType === 'text', locked: item.locked,
      clickBindable: isPublishedInteractionClickBindable(item),
      complexAudioRule: Boolean(audio?.disabledReason && audio.disabledReason !== '此元素不支持点击互动'),
      complexNavigationRule: Boolean(navigation?.disabledReason && navigation.disabledReason !== '此元素不支持点击互动'),
      sounds: Object.values(project.media.audio.sounds).map(sound => ({ id: sound.id, name: sound.name })),
      locations: project.locations.map(location => ({ id: location.id, label: location.label })),
    }
    const style = item.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.style : null
    return { target, commands: slideLightObjectCommands(commandState), fontFamily: style?.fontFamily ?? null,
      lineSpacing: style?.lineSpacing ?? null, opacity: item.opacity }
  }
  const commit = async (target: SlideLightSelectionSnapshot, next: CourseProjectDocument,
    addition?: { readonly meta: AssetMeta; readonly bytes: Uint8Array } | null, selectedItemId?: string): Promise<void> => {
    const project = requireCurrent(target)
    const step = createEditorTransactionStep(project, { projectId: target.projectId, baseRevision: target.expectedRevision,
      nextDocument: next, resourceChanges: addition ? { assetFileChanges: [{ assetId: addition.meta.id, after: addition.bytes }] } : {},
      ...(selectedItemId ? { selectionHint: { kind: 'authoring-tool-selection' as const, locationId: target.locationId,
        stateId: target.stateId, owner: 'scene' as const, itemIds: [selectedItemId] } } : {}) })
    if (step && !await owner.commit(step, target)) throw new Error('修改未提交，请重新选择后重试')
  }
  const placeAudio = async (target: SlideLightPageTarget): Promise<void> => {
    requireCurrent(target)
    if (!owner.chooseAudio) throw new Error('未连接音频文件选择入口')
    const selected = await owner.chooseAudio()
    if (!selected) return
    const project = requireCurrent(target)
    const input: SlideAudioPlacement = { locationId: target.locationId, stateId: target.stateId,
      expectedRevision: target.expectedRevision, asset: selected.asset, bytes: selected.bytes,
      buttonId: owner.createId(), ruleId: owner.createId(), stepId: owner.createId() }
    const planned = planSlideAudioPlacement(project, input)
    await commit(target, planned.project, planned.assetAddition, planned.itemId)
  }
  const runPage = async (target: SlideLightPageTarget, command: SlideLightCommand): Promise<void> => {
    const project = requireCurrent(target)
    const available = viewPage(target).commands.find(candidate => candidate.id === command.id)
    if (!available || available.disabledReason) throw new Error(available?.disabledReason ?? '当前页面操作不可用')
    if (available.kind === 'audio-import') return placeAudio(target)
    if (available.kind !== 'scene-background') throw new Error('当前页面操作不可用')
    const next = planSlideSceneBackground(project, target.locationId, target.stateId, String(available.value), target.expectedRevision)
    await commit(target, next)
  }
  const runObject = async (target: SlideLightObjectTarget, command: SlideLightCommand): Promise<void> => {
    const project = requireCurrent(target)
    const available = viewObject(target).commands.find(candidate => candidate.id === command.id)
    if (!available || available.disabledReason) throw new Error(available?.disabledReason ?? '当前对象操作不可用')
    const value = available.value
    let next: CourseProjectDocument
    switch (available.kind) {
      case 'opacity': next = planSlideLightOpacity(project, target, value as 1 | 0.75 | 0.5 | 0.25); break
      case 'font': next = planSlideLightTextStyle(project, target, { fontFamily: String(value) }); break
      case 'line-spacing': next = planSlideLightTextStyle(project, target, { lineSpacing: value as 0 | 4 | 8 | 16 }); break
      case 'page-align': next = planSlidePageAlignment(project, target, value as SlidePageAlignment); break
      case 'audio-play': next = planSimpleSlideInteraction(project, target, 'audio.play', String(value), { ruleId: owner.createId(), stepId: owner.createId() }); break
      case 'location-go': next = planSimpleSlideInteraction(project, target, 'location.go', String(value), { ruleId: owner.createId(), stepId: owner.createId() }); break
      default: throw new Error('当前对象操作不可用')
    }
    await commit(target, next, null, target.itemId)
  }
  return { capturePage, captureObject, viewPage, viewObject, runPage, runObject, placeAudio }
}

export type SlideLightEditingPort = ReturnType<typeof createSlideLightEditingPort>
