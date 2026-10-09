import type { ComponentContainer, ComponentFlowAuthoring, ComponentFlowBodyLayout, ComponentFlowPlacement, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { componentIsLocked, containerChildIds, owningContainer } from '../../shared/contracts/component-platform/project'
import { componentParentMatrix, equalComponentValue } from '../drivers/courseV10Operations'
import { composeMatrices, IDENTITY_MATRIX, reparentFrame } from '../components/geometry'
import { prepareCourseFlowPlacement, type CourseAuthoringReferences } from './courseAuthoringReferences'

export type FlowPlacementInput =
  | { kind: 'document'; surfaceId: string; parentId?: string | null; index?: number; wrap?: ComponentFlowBodyLayout['wrap'] }
  | { kind: 'overlay'; surfaceId: string; placement: ComponentFlowPlacement; frame?: ComponentFrame; index?: number; origin?: 'authoring' | 'quickbar' }

function requireFlow(project: CourseProjectV10, surfaceId: string) {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (surface?.kind !== 'flow') throw new Error('当前表面不是讲义')
  return surface
}
function requireEditable(project: CourseProjectV10, id: string) {
  const instance = project.instances[id]
  if (!instance) throw new Error('讲义对象已不存在')
  if (componentIsLocked(project, id)) throw new Error('对象已锁定，请先解锁')
  return instance
}

/** Flow settings preserve the existing reading mode and widths when only one field changes. */
export function flowSettingsEdits(project: CourseProjectV10, surfaceId: string, patch: Partial<ComponentFlowAuthoring['layout']>): ComponentEdit[] {
  const surface = requireFlow(project, surfaceId)
  const layout = surface.flow?.layout ?? { widthMode: 'reading' as const, readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#ffffff' }
  const flow = { ...surface.flow, layout: { ...layout, ...patch } }
  return equalComponentValue(surface.flow, flow) ? [] : [{ type: 'flow.set', surfaceId, flow }]
}

/** Body width, wrap and caption belong to the existing Flow body carrier. */
export function flowBodyLayoutEdits(project: CourseProjectV10, instanceId: string, patch: Partial<ComponentFlowBodyLayout>): ComponentEdit[] {
  const instance = requireEditable(project, instanceId)
  const flowLayout = { width: 'content-width' as const, ...instance.flowLayout, ...patch }
  return equalComponentValue(instance.flowLayout, flowLayout) ? [] : [{ type: 'instance.flowLayout.set', instanceId, flowLayout }]
}

/** Change carrier and ownership together while retaining identity and the authored affine frame. */
export function flowPlacementEdits(project: CourseProjectV10, instanceId: string, input: FlowPlacementInput, references?: CourseAuthoringReferences): ComponentEdit[] {
  requireFlow(project, input.surfaceId)
  const instance = requireEditable(project, instanceId), owner = owningContainer(project, instanceId)
  if (owner?.kind === 'global') throw new Error('全局对象使用全局平面，不属于讲义正文或浮层')
  const edits: ComponentEdit[] = []
  if (input.kind === 'overlay') {
    const placement = prepareCourseFlowPlacement(project, input.placement, references)
    // Explicit frames are in the destination surface; retained frames use their old parent.
    // Keep the two established UI defaults while making their preparation a Flow responsibility.
    const frame = input.frame ?? (instance.frame
      ? reparentFrame(instance.frame, componentParentMatrix(project, instanceId), IDENTITY_MATRIX) as ComponentFrame
      : input.origin === 'quickbar'
        ? { width: 400, height: 240, transform: [1, 0, 0, 1, 72, 72] as ComponentFrame['transform'] }
        : { width: 240, height: 120, transform: [1, 0, 0, 1, 80, 80] as ComponentFrame['transform'] })
    if (!equalComponentValue(frame, instance.frame)) edits.push({ type: 'frame.set', instanceId, frame })
    if (!equalComponentValue(instance.flowPlacement, placement)) edits.push({ type: 'instance.flowPlacement.set', instanceId, flowPlacement: placement })
    if (owner?.kind !== 'surface' || owner.surfaceId !== input.surfaceId || input.index !== undefined) {
      const container: ComponentContainer = { kind: 'surface', surfaceId: input.surfaceId }
      edits.push({ type: 'instance.move', instanceId, container, index: input.index ?? containerChildIds(project, container).length,
        frame })
    }
  } else {
    if (instance.flowPlacement) edits.push({ type: 'instance.flowPlacement.set', instanceId, flowPlacement: null })
    if (input.parentId !== undefined || input.index !== undefined) {
      const container: ComponentContainer = input.parentId ? { kind: 'instance', instanceId: input.parentId } : { kind: 'surface', surfaceId: input.surfaceId }
      const parent = input.parentId ? requireEditable(project, input.parentId) : null
      const parentMatrix = parent ? composeMatrices(componentParentMatrix(project, parent.id), parent.frame?.transform ?? IDENTITY_MATRIX) : IDENTITY_MATRIX
      const siblings = containerChildIds(project, container).filter(id => id !== instanceId)
      const reading = flowReadingMembers(project, container).filter(id => id !== instanceId)
      const readingIndex = input.index ?? reading.length
      const index = reading[readingIndex] ? siblings.indexOf(reading[readingIndex])
        : reading.length ? siblings.indexOf(reading.at(-1)!) + 1 : siblings.length
      edits.push({ type: 'instance.move', instanceId, container, index,
        ...(instance.frame ? { frame: reparentFrame(instance.frame, componentParentMatrix(project, instanceId), parentMatrix) as ComponentFrame } : {}) })
    }
    if (input.wrap !== undefined) edits.push(...flowBodyLayoutEdits(project, instanceId, { wrap: input.wrap }))
  }
  return edits
}

export function flowReadingMembers(project: CourseProjectV10, container: ComponentContainer): string[] {
  return containerChildIds(project, container).filter(id => {
    const instance = project.instances[id]
    return instance && !instance.flowPlacement && project.definitions[instance.definitionId]?.role !== 'behavior'
  })
}

/** Reading order crosses only reading peers; floating order stays within its own plane and space. */
export function flowReadingOrderEdits(project: CourseProjectV10, instanceId: string, direction: 'up' | 'down' | 'first' | 'last'): ComponentEdit[] {
  const instance = requireEditable(project, instanceId), container = owningContainer(project, instanceId)
  if (!container) return []
  const members = instance.flowPlacement ? containerChildIds(project, container).filter(id => {
    const placement = project.instances[id]?.flowPlacement
    return placement?.space === instance.flowPlacement!.space && placement.plane === instance.flowPlacement!.plane
  }) : flowReadingMembers(project, container)
  const at = members.indexOf(instanceId)
  const neighbor = direction === 'first' ? members[0] : direction === 'last' ? members.at(-1)
    : members[at + (direction === 'up' ? -1 : 1)]
  if (at < 0 || !neighbor || neighbor === instanceId) return []
  const remaining = containerChildIds(project, container).filter(id => id !== instanceId)
  return [{ type: 'instance.move', instanceId, container, index: remaining.indexOf(neighbor) + (direction === 'down' || direction === 'last' ? 1 : 0) }]
}
