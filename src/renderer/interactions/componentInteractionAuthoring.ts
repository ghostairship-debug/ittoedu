import { componentSurface } from '../../shared/contracts/component-platform/project'
import { componentClickInteractionEdits, interactionBehavior, interactionRules } from '../../shared/componentInteractionData'
export { INTERACTIONS_DEFINITION, componentRuleEdits, interactionBehavior, interactionRules,
  componentInteractionDataSchema, remapComponentInteractionData, createComponentInteractionCopyIdentities,
  componentRevealSequenceEdits, componentClickInteractionEdits, duplicateComponentRule } from '../../shared/componentInteractionData'
import type { ComponentSurface, ComponentTarget, CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { InteractionSceneView, InteractionSceneListItem } from '../ui/InteractionEditor'
import type { InteractionLayerTarget } from '../course/slideInteractionView'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { componentAudioSounds } from '../../shared/componentAudioSounds'

export function readComponentInteractionSounds(target: CapturedCourseTarget): readonly { id: string; name: string }[] {
  const view = target.surfaceId ? componentInteractionView(target.project, target.surfaceId) : undefined
  return Object.values(view?.sounds ?? componentAudioSounds(target.project)).map(({ id, name }) => ({ id, name }))
}
export async function setComponentClickInteraction(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  kind: 'audio-play' | 'location-go', value: string): Promise<void> {
  await kernel.editCaptured(kernel.capture(componentClickInteractionEdits(target, kind, value), target))
}
export function componentNavigationScene(surface: ComponentSurface): InteractionSceneListItem {
  return { id: surface.id, name: surface.title,
    presentation: surface.presentation ? { initialStateId: surface.presentation.initialStateId ?? undefined,
      states: surface.presentation.states.map(state => ({ id: state.id, name: state.title })) } : undefined,
    ...(surface.kind === 'spatial' ? { spatial: { frames: (surface.spatial?.frames ?? []).map(frame => ({ id: frame.id, name: frame.title ?? frame.id })) } } : {}) }
}
/** The interaction UI needs only identity, label and supported local navigation. */
export function componentWorkNavigationScenes(project: CourseProjectV10): InteractionSceneListItem[] {
  return project.rootIds.flatMap(id => {
    const surface = componentSurface(project, id), root = project.instances[id]
    return surface ? [componentNavigationScene(surface)] : root ? [{ id, name: root.name ?? project.definitions[root.definitionId]?.title ?? id }] : []
  })
}
export function componentInteractionView(project: CourseProjectV10, surfaceId: string, global = false) {
  const surface = componentSurface(project, surfaceId), root = project.rootIds.includes(surfaceId) ? project.instances[surfaceId] : undefined
  if (!surface && !root) throw new Error('互动目标已不存在')
  const target: ComponentTarget = global ? { kind: 'project' } : { kind: 'instance', instanceId: surfaceId }
  const behavior = interactionBehavior(project, target), rules = interactionRules(behavior)
  const ids = new Set<string>()
  const visit = (id: string) => { if (ids.has(id)) return; ids.add(id); if (!project.instances[id]?.container) project.instances[id]?.childIds?.forEach(visit) }
  const roots = [...project.global.underlay, ...project.global.overlay, ...(surface?.childIds ?? (root ? [root.id] : []))]
  roots.forEach(visit)
  const nodes: InteractionLayerTarget[] = [...ids].flatMap(id => {
    const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
    if (!instance || !definition || definition.role === 'behavior') return []
    const key = definition.implementation.kind === 'builtin' ? definition.implementation.key : instance.definitionId
    const type = key === 'guoling.video' ? 'video' : key === 'guoling.input' ? 'input' : 'external-component'
    return [{ id, name: instance.name ?? definition.title ?? id, type, visible: instance.visible !== false, locked: instance.locked === true,
      playbackInitialVisibility: instance.playbackInitialVisibility,
      ...(instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? {
        clickToToggle: typeof instance.data.clickToToggle === 'boolean' ? instance.data.clickToToggle : undefined,
        showControls: typeof instance.data.showControls === 'boolean' ? instance.data.showControls : undefined,
        loop: typeof instance.data.loop === 'boolean' ? instance.data.loop : undefined,
      } : {}) }]
  })
  const scene: InteractionSceneView = { ...(surface ? componentNavigationScene(surface) : { id: root!.id, name: root!.name ?? project.title }), nodes, interactions: rules }
  const scenes = componentWorkNavigationScenes(project)
  return { target, behavior, rules, nodes, scene, sounds: componentAudioSounds(project, ids),
    scenes, locations: scenes.map(value => ({ id: value.id, label: value.name })),
  }
}
