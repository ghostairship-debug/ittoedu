import { createDefaultSlidePresentation } from '../../shared/contracts/course-project-v9/presentation'
import type {
  CourseProjectDocument,
  LayerItem,
  SlidePresentation,
} from '../../shared/courseProjectTypes'
import type { SoundDefinition } from '../../shared/contracts/media-v1'
import type { InteractionRule } from '../../shared/interactionTypes'

/**
 * V9-shaped scene summaries consumed by store-agnostic interaction editors.
 * Named-state overrides are never round-tripped here.
 */
export interface V9InteractionPresentationSummary {
  readonly initialStateId: string
  readonly thumbnailStateId?: string
  readonly states: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
}

export interface V9InteractionSceneSummary {
  readonly id: string
  readonly name: string
  readonly presentation: V9InteractionPresentationSummary
}

export interface InteractionLayerTarget {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly visible: boolean
  readonly locked: boolean
  readonly playbackInitialVisibility?: 'inherit' | 'hidden'
  readonly clickToToggle?: boolean
  readonly showControls?: boolean
  readonly loop?: boolean
}

export interface V9InteractionSceneView {
  readonly id: string
  readonly name: string
  readonly nodes: readonly InteractionLayerTarget[]
  readonly interactions: readonly InteractionRule[]
  readonly presentation?: V9InteractionPresentationSummary
}

function v9PresentationSummary(
  presentation: SlidePresentation | undefined,
): V9InteractionPresentationSummary {
  if (!presentation || presentation.states.length === 0) {
    const fallback = createDefaultSlidePresentation()
    return {
      initialStateId: fallback.initialStateId,
      ...(fallback.thumbnailStateId === undefined
        ? {}
        : { thumbnailStateId: fallback.thumbnailStateId }),
      states: fallback.states.map((state) => ({
        id: state.id,
        name: state.name,
      })),
    }
  }
  return {
    initialStateId: presentation.initialStateId,
    ...(presentation.thumbnailStateId === undefined
      ? {}
      : { thumbnailStateId: presentation.thumbnailStateId }),
    states: presentation.states.map((state) => ({
      id: state.id,
      name: state.name,
    })),
  }
}

export function v9SlideScenes(
  project: CourseProjectDocument,
): V9InteractionSceneSummary[] {
  const scenes: V9InteractionSceneSummary[] = []
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      scenes.push({
        id: scene.id,
        name: scene.name,
        presentation: v9PresentationSummary(scene.presentation),
      })
    }
  }
  return scenes
}

function nativeTypeOf(item: LayerItem): string {
  if (item.kind === 'component') return 'external-component'
  if (item.kind === 'runtime') return 'runtime'
  return item.content.nativeType
}

export function interactionLayerTargetFromItem(item: LayerItem): InteractionLayerTarget {
  const target: InteractionLayerTarget = {
    id: item.layerItemId,
    name: item.label,
    type: nativeTypeOf(item),
    visible: item.visible,
    locked: item.locked,
    playbackInitialVisibility: item.playbackInitialVisibility,
  }
  if (item.kind === 'native' && item.content.nativeType === 'video') {
    return {
      ...target,
      clickToToggle: item.content.data.clickToToggle,
      showControls: item.content.data.showControls,
      loop: item.content.data.loop,
    }
  }
  return target
}

/** Builds the read-only V9 scene view the interaction editors need. */
export function v9InteractionSceneDocument(
  sceneId: string,
  sceneName: string,
  nodes: readonly InteractionLayerTarget[],
  interactions: readonly InteractionRule[],
  presentation: V9InteractionSceneSummary['presentation'] | undefined,
): V9InteractionSceneView {
  return {
    id: sceneId,
    name: sceneName,
    nodes: [...nodes],
    interactions: [...interactions],
    ...(presentation === undefined ? {} : { presentation }),
  }
}

export function v9InteractionSounds(
  project: CourseProjectDocument,
): Record<string, SoundDefinition> {
  return project.media.audio.sounds
}

function knownLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  for (const entry of project.globalLayerItems) ids.add(entry.item.layerItemId)
  for (const surface of project.surfaces) {
    for (const entry of surface.surfaceLayerItems) ids.add(entry.item.layerItemId)
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) {
        for (const item of scene.layerItems) ids.add(item.layerItemId)
      }
    } else if (surface.type === 'spatial-2d') {
      for (const item of surface.world.layerItems) ids.add(item.layerItemId)
    }
  }
  return ids
}

function knownSceneIds(project: CourseProjectDocument): Set<string> {
  return new Set(
    project.surfaces.flatMap((surface) => (
      surface.type === 'slide' ? surface.scenes.map((scene) => scene.id) : []
    )),
  )
}

function knownStateIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      for (const state of scene.presentation?.states ?? []) ids.add(state.id)
    }
  }
  return ids
}

interface VideoHint {
  readonly name: string
  readonly loop: boolean
  readonly clickToToggle: boolean
  readonly showControls: boolean
}

function visitVideoItem(
  hints: Map<string, VideoHint>,
  item: LayerItem,
): void {
  if (item.kind !== 'native' || item.content.nativeType !== 'video') return
  hints.set(item.layerItemId, {
    name: item.label,
    loop: item.content.data.loop,
    clickToToggle: item.content.data.clickToToggle,
    showControls: item.content.data.showControls,
  })
}

function videoHints(
  project: CourseProjectDocument,
  nodes: readonly InteractionLayerTarget[] = [],
): Map<string, VideoHint> {
  const hints = new Map<string, VideoHint>()
  for (const entry of project.globalLayerItems) visitVideoItem(hints, entry.item)
  for (const surface of project.surfaces) {
    for (const entry of surface.surfaceLayerItems) visitVideoItem(hints, entry.item)
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) scene.layerItems.forEach((item) => visitVideoItem(hints, item))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => visitVideoItem(hints, item))
    }
  }
  for (const node of nodes) {
    if (node.type !== 'video') continue
    hints.set(node.id, {
      name: node.name,
      loop: node.loop ?? false,
      clickToToggle: node.clickToToggle ?? false,
      showControls: node.showControls ?? false,
    })
  }
  return hints
}

function pushWarning(
  warnings: Record<string, string[]>,
  ruleId: string,
  message: string,
): void {
  const current = warnings[ruleId] ?? []
  if (!current.includes(message)) current.push(message)
  warnings[ruleId] = current
}

/**
 * Authoring-time diagnostics for interaction rules whose V9 targets were
 * deleted, or whose video playback policy makes the trigger unreachable.
 * Schema still rejects malformed documents at save; this is the editor hint.
 */
export function collectV9InteractionRuleWarnings(
  project: CourseProjectDocument,
  rules: readonly InteractionRule[],
  nodes: readonly InteractionLayerTarget[] = [],
): Record<string, string[]> {
  const warnings: Record<string, string[]> = {}
  const layerIds = knownLayerItemIds(project)
  const sceneIds = knownSceneIds(project)
  const stateIds = knownStateIds(project)
  const courseStateKeys = new Set(project.courseState.map((state) => state.key))
  const soundIds = new Set(Object.keys(project.media.audio.sounds))
  const actionIds = new Set(rules.flatMap((rule) => rule.actions.map((step) => step.id)))
  const videos = videoHints(project, nodes)

  for (const rule of rules) {
    const trigger = rule.trigger
    if ('nodeId' in trigger && !layerIds.has(trigger.nodeId)) {
      pushWarning(warnings, rule.id, '规则仍引用已删除的元素。')
    }
    if (trigger.type === 'audio.ended' && !soundIds.has(trigger.soundId)) {
      pushWarning(warnings, rule.id, '规则仍引用已删除的声音。')
    }
    if (trigger.type === 'presentation.enter' && !stateIds.has(trigger.stateId)) {
      pushWarning(warnings, rule.id, '规则仍引用已删除的状态。')
    }
    if (trigger.type === 'animation.completed' && !actionIds.has(trigger.actionId)) {
      pushWarning(warnings, rule.id, '规则仍引用已删除的动画动作。')
    }
    if (trigger.type === 'video.ended') {
      const video = videos.get(trigger.nodeId)
      if (video?.loop) {
        pushWarning(
          warnings,
          rule.id,
          `视频“${video.name}”正在循环播放，因此“视频播放结束”不会自然到达。`,
        )
      }
    }
    if (trigger.type === 'node.click') {
      const video = videos.get(trigger.nodeId)
      if (video && (video.clickToToggle || video.showControls)) {
        pushWarning(
          warnings,
          rule.id,
          `视频“${video.name}”的播放点击或画布控件会覆盖这条单击规则。`,
        )
      }
    }
    for (const condition of rule.conditions) {
      if (condition.type === 'scene.in') {
        if (condition.sceneIds.some((sceneId) => !sceneIds.has(sceneId))) {
          pushWarning(warnings, rule.id, '规则仍引用已删除的场景。')
        }
      } else if (
        condition.type === 'presentation.in'
        && condition.stateIds.some((stateId) => !stateIds.has(stateId))
      ) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的状态。')
      } else if (
        (condition.type === 'course-state.exists'
          || condition.type === 'course-state.compare')
        && !courseStateKeys.has(condition.key)
      ) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的课程状态。')
      }
    }
    for (const step of rule.actions) {
      const action = step.action
      if ('nodeId' in action && !layerIds.has(action.nodeId)) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的元素。')
      }
      if (action.type === 'audio.play' && !soundIds.has(action.soundId)) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的声音。')
      }
      if (
        (
          action.type === 'audio.pause' ||
          action.type === 'audio.resume' ||
          action.type === 'audio.stop' ||
          action.type === 'audio.toggle-mute'
        ) &&
        action.target.kind === 'sound' &&
        !soundIds.has(action.target.soundId)
      ) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的声音。')
      }
      if (action.type === 'presentation.set' && !stateIds.has(action.stateId)) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的状态。')
      }
      if (action.type === 'course-state.set' && !courseStateKeys.has(action.key)) {
        pushWarning(warnings, rule.id, '规则仍引用已删除的课程状态。')
      }
      if (action.type === 'scene.go') {
        if (!sceneIds.has(action.sceneId)) {
          pushWarning(warnings, rule.id, '规则仍引用已删除的场景。')
        }
        if (action.targetStateId && !stateIds.has(action.targetStateId)) {
          pushWarning(warnings, rule.id, '规则仍引用已删除的状态。')
        }
      }
    }
  }
  return warnings
}
