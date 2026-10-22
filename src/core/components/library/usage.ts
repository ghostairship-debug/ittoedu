import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentContainer, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey, componentSurface, owningContainer } from '../../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../../shared/contracts/component-platform/operations'
import type { InsertLibraryOptions } from './insert'

const record = (value: JsonValue | undefined): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value)
const navigationTypes = new Set(['scene.go', 'location.go', 'presentation.set', 'step.next', 'step.previous', 'scene.next', 'scene.previous', 'scene.replay', 'course.restart'])

export function componentLibraryHost(project: CourseProjectV10, container: ComponentContainer) {
  let owner: ComponentContainer | null = container
  while (owner?.kind === 'instance') {
    const surface = componentSurface(project, owner.instanceId)
    if (surface) return surface
    owner = owningContainer(project, owner.instanceId)
  }
  return owner?.kind === 'surface' ? componentSurface(project, owner.surfaceId) : undefined
}

/** Purpose metadata reaches the existing placement/action consumers, rather than becoming a catalog-only label. */
export function planComponentLibraryUsage(project: CourseProjectV10, entry: ComponentLibraryEntry, options: InsertLibraryOptions): {
  edits: ComponentEdit[]; container?: ComponentContainer; index?: number; background?: boolean; flowBackground?: boolean; attachmentOnly?: boolean
} {
  const usage = entry.usage, host = componentLibraryHost(project, options.container)
  if (!usage) return { edits: [] }
  if (usage.host === 'container' && !host) throw new Error('此资产需要一个实际容器作为宿主。')
  if (usage.host === 'spatial' && host?.kind !== 'spatial') throw new Error('此资产需要 Spatial 容器作为宿主。')
  if (usage.kind === 'transition') {
    if (!usage.transition) throw new Error('此转场条目没有可执行的转场配置。')
    const targetId = options.targetBindings?.navigation
      ?? (options.container.kind === 'instance' ? options.container.instanceId : undefined)
    const target = targetId ? project.instances[targetId] : undefined
    const key = target && componentDefinitionBuiltinKey(project.definitions[target.definitionId])
    if (!target || !record(target.data) || !['guoling.navigation', 'guoling.interactions'].includes(key ?? '')) {
      throw new Error('请选择实际导航控件或互动规则作为转场目标。')
    }
    const paths: string[][] = []
    if (key === 'guoling.navigation' && Array.isArray(target.data.buttons)) {
      target.data.buttons.forEach((button, index) => {
        if (record(button) && record(button.action) && typeof button.action.type === 'string' && navigationTypes.has(button.action.type)) {
          paths.push(['buttons', String(index), 'action', 'transition'])
        }
      })
    } else if (key === 'guoling.interactions' && Array.isArray(target.data.rules)) {
      target.data.rules.forEach((rule, ruleIndex) => {
        if (!record(rule) || !Array.isArray(rule.actions)) return
        rule.actions.forEach((step, stepIndex) => {
          if (record(step) && record(step.action) && typeof step.action.type === 'string' && navigationTypes.has(step.action.type)) {
            paths.push(['rules', String(ruleIndex), 'actions', String(stepIndex), 'action', 'transition'])
          }
        })
      })
    }
    if (!paths.length) throw new Error('所选控件或规则没有可附着转场的导航动作。')
    return { attachmentOnly: true, edits: paths.map(path => ({ type: 'data.set', instanceId: target.id, path,
      value: structuredClone(usage.transition) as JsonValue })) }
  }
  if (usage.host === 'navigation') throw new Error('此资产需要明确的导航附着实现。')
  if (usage.kind !== 'background') return { edits: [] }
  const plane = usage.placement === 'overlay' ? 'overlay' : 'underlay'
  if (options.container.kind === 'global' || options.container.kind === 'project') {
    return { edits: [], container: { kind: 'global', plane }, index: plane === 'underlay' ? 0 : project.global[plane].length, background: true }
  }
  if (!host) throw new Error('背景需要实际容器或作品级图层作为宿主。')
  return { edits: [], container: { kind: 'instance', instanceId: host.id },
    index: plane === 'underlay' ? 0 : host.childIds.length, background: true, flowBackground: host.kind === 'flow' }
}
