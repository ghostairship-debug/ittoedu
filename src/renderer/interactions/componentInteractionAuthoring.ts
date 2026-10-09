import { componentClickInteractionEdits, interactionBehavior, interactionRules } from '../../shared/componentInteractionData'
export { INTERACTIONS_DEFINITION, componentRuleEdits, interactionBehavior, interactionRules,
  componentInteractionDataSchema, remapComponentInteractionData, createComponentInteractionCopyIdentities,
  componentRevealSequenceEdits, componentClickInteractionEdits, duplicateComponentRule } from '../../shared/componentInteractionData'
import type { ComponentSurface, ComponentTarget, CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { InteractionSceneView } from '../ui/InteractionEditor'
import type { InteractionLayerTarget } from '../course/slideInteractionView'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'

export function readComponentInteractionSounds(target: CapturedCourseTarget): readonly { id: string; name: string }[] {
  return Object.values(target.project.media?.audio.sounds ?? {}).map(({ id, name }) => ({ id, name }))
}
export async function setComponentClickInteraction(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  kind: 'audio-play' | 'location-go', value: string): Promise<void> {
  await kernel.editCaptured(kernel.capture(componentClickInteractionEdits(target, kind, value), target))
}
export function componentInteractionView(project: CourseProjectV10, surfaceId: string, global = false) {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (!surface) throw new Error('互动目标页面已不存在')
  const target: ComponentTarget = global ? { kind: 'project' } : { kind: 'surface', surfaceId }
  const behavior = interactionBehavior(project, target), rules = interactionRules(behavior)
  const ids = new Set<string>()
  const visit = (id: string) => { if (ids.has(id)) return; ids.add(id); project.instances[id]?.childIds?.forEach(visit) }
  const roots = [...project.global.underlay, ...project.global.overlay, ...surface.childIds]
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
  const presentation = (value: ComponentSurface) => value.presentation ? { initialStateId: value.presentation.initialStateId ?? undefined,
    states: value.presentation.states.map(state => ({ id: state.id, name: state.title })) } : undefined
  const scene: InteractionSceneView = { id: surface.id, name: surface.title, nodes, interactions: rules, presentation: presentation(surface) }
  return { target, behavior, rules, nodes, scene,
    scenes: project.surfaces.map(value => ({ id: value.id, name: value.title, presentation: presentation(value) })),
    locations: project.surfaces.map(value => ({ id: value.id, label: value.title })),
  }
}
