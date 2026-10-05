import { componentInteractionDataSchema } from '../../shared/componentInteractionData'
export { componentInteractionDataSchema, remapComponentInteractionData, createComponentInteractionCopyIdentities } from '../../shared/componentInteractionData'
import type { ComponentDefinition, ComponentEdit, ComponentInstance, ComponentSurface, ComponentTarget, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import type { InteractionRule } from '../../shared/interactionTypes'
import type { InteractionSceneView } from '../ui/InteractionEditor'
import type { InteractionLayerTarget } from '../course/slideInteractionView'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../store/editorStoreKernel'

export const INTERACTIONS_DEFINITION: ComponentDefinition = {
  id: 'guoling.interactions', title: '互动与动画', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interactions' },
}
export const interactionRules = (instance: ComponentInstance | undefined): InteractionRule[] => instance ? componentInteractionDataSchema.parse(instance.data).rules : []
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export function interactionBehavior(project: CourseProjectV10, target: ComponentTarget): ComponentInstance | undefined {
  return Object.values(project.instances).find(instance => componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === INTERACTIONS_DEFINITION.id
    && instance.attachments?.some(attachment => attachment.instanceId === instance.id && JSON.stringify(attachment.target) === JSON.stringify(target)))
}
export function componentRuleEdits(project: CourseProjectV10, target: ComponentTarget, rules: readonly InteractionRule[]): ComponentEdit[] {
  const data = componentInteractionDataSchema.parse({ rules })
  const current = interactionBehavior(project, target)
  if (current) return [{ type: 'data.set', instanceId: current.id, path: ['rules'], value: json(data.rules) }]
  const id = crypto.randomUUID()
  const container = target.kind === 'surface' ? { kind: 'surface' as const, surfaceId: target.surfaceId } : { kind: 'global' as const, plane: 'underlay' as const }
  const children = container.kind === 'surface' ? project.surfaces.find(surface => surface.id === container.surfaceId)?.childIds : project.global.underlay
  if (!children) throw new Error('互动目标表面已不存在')
  return [
    ...(project.definitions[INTERACTIONS_DEFINITION.id] ? [] : [{ type: 'definition.set' as const, definition: INTERACTIONS_DEFINITION }]),
    { type: 'instance.insert', container, index: children.length, rootIds: [id], instances: [{ id, definitionId: INTERACTIONS_DEFINITION.id,
      name: '互动与动画', data: json(data), attachments: [{ instanceId: id, target }] }] },
  ]
}
export function readComponentInteractionSounds(target: CapturedCourseTarget): readonly { id: string; name: string }[] {
  return Object.values(target.project.media?.audio.sounds ?? {}).map(({ id, name }) => ({ id, name }))
}
export function componentClickInteractionEdits(target: CapturedCourseTarget, kind: 'audio-play' | 'location-go', value: string): ComponentEdit[] {
  const { project, instanceId, surfaceId, activeStateId } = target
  if (!instanceId || !project.instances[instanceId] || !surfaceId) throw new Error('点击互动目标已不存在')
  if (kind === 'audio-play' && !project.media?.audio.sounds[value]) throw new Error('声音已不存在')
  if (kind === 'location-go' && !project.surfaces.some(surface => surface.id === value)) throw new Error('目标页面已不存在')
  const visited = new Set<string>()
  const owns = (id: string): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    return id === instanceId || (project.instances[id]?.childIds ?? []).some(owns)
  }
  const global = [...project.global.underlay, ...project.global.overlay].some(owns)
  const owner: ComponentTarget = global ? { kind: 'project' } : { kind: 'surface', surfaceId }
  const rules = structuredClone(interactionRules(interactionBehavior(project, owner)))
  const matches = rules.filter(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === instanceId)
  const simple = matches.length === 1 && matches[0]!.actions.length === 1 && matches[0]!.conditions.length === 0
    && ['audio.play', 'location.go'].includes(matches[0]!.actions[0]!.action.type)
  if (matches.length && !simple) throw new Error('此对象已有复杂点击规则，请在“互动与动画”中编辑，轻编辑不会覆盖它。')
  if (activeStateId) throw new Error('命名状态中的条件点击规则请在“互动与动画”中编辑。')
  const action = kind === 'audio-play' ? { type: 'audio.play' as const, soundId: value } : { type: 'location.go' as const, locationId: value }
  if (simple) matches[0]!.actions[0]!.action = action
  else rules.push({ id: crypto.randomUUID(), name: kind === 'audio-play' ? '点击播放声音' : '点击前往页面', enabled: true,
    trigger: { type: 'node.click', nodeId: instanceId }, conditions: [],
    actions: [{ id: crypto.randomUUID(), start: 'after-previous', delayMs: 0, action }] })
  return componentRuleEdits(project, owner, rules)
}
export async function setComponentClickInteraction(kernel: EditorStoreKernel, target: CapturedCourseTarget,
  kind: 'audio-play' | 'location-go', value: string): Promise<void> {
  await kernel.editCaptured(kernel.capture(componentClickInteractionEdits(target, kind, value), target))
}
export function duplicateComponentRule(rule: InteractionRule): InteractionRule {
  const next = structuredClone(rule), actions = new Map(next.actions.map(step => [step.id, crypto.randomUUID()]))
  next.id = crypto.randomUUID(); next.name += ' 副本'
  next.actions = next.actions.map(step => ({ ...step, id: actions.get(step.id)! }))
  if (next.trigger.type === 'animation.completed' && actions.has(next.trigger.actionId)) next.trigger.actionId = actions.get(next.trigger.actionId)!
  return next
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
