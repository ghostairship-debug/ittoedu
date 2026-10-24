import type { ComponentContainer, ComponentEdit, CourseProjectV10, JsonValue } from '../../shared/contracts/component-platform'
import { componentIsLocked, componentSurface, containerChildIds } from '../../shared/contracts/component-platform/project'
import type { DocumentSelection } from '../../shared/document/ports'
import { componentClickInteractionEdits } from '../../shared/componentInteractionData'
import { applyComponentOperation, captureComponentOperation } from '../drivers/courseV10Operations'
import { prepareCourseElementEdits, insertionContainer, type CourseInsertionOptions, type CourseElementKind } from './courseElementInsertion'
import { prepareFlowBodyInsertion } from './courseFlowInsertion'
import { componentAppearanceEdits } from './componentAppearanceEdits'
import type { CourseAuthoringReferences } from './courseAuthoringReferences'

export class CourseInsertionError extends Error {
  constructor(readonly code: 'invalid-target' | 'locked-target', message: string) { super(message) }
}

export interface CourseElementInsertRequest {
  surfaceId: string | null
  selectedInstanceId?: string | null
  stateId?: string | null
  kind: CourseElementKind
  options?: CourseInsertionOptions
  afterInstanceId?: string
  flowSelection?: DocumentSelection | null
  appearance?: Record<string, JsonValue>
  click?: { action: Parameters<typeof componentClickInteractionEdits>[1]; value?: string }
  references?: CourseAuthoringReferences
}

/** Plans one professional insertion against the caller's current working presentation.
 * Handles, grants, CAS, batch scheduling and History stay with the caller/Session. */
export function planCourseElementInsertion(project: CourseProjectV10, request: CourseElementInsertRequest): {
  edits: ComponentEdit[]; stages: ComponentEdit[][]; instanceIds: string[]; container: ComponentContainer; bodyContainer?: ComponentContainer
} {
  const { surfaceId, selectedInstanceId = null } = request
  let options = { ...request.options }
  const target = { project, surfaceId, instanceId: selectedInstanceId }
  let container = options.container ?? insertionContainer(target, options)
  if (container.kind === 'instance') {
    if (!project.instances[container.instanceId]?.childIds) throw new CourseInsertionError('invalid-target', '所选对象不是容器')
    if (componentIsLocked(project, container.instanceId)) throw new CourseInsertionError('locked-target', '容器已锁定，请先解锁')
  }
  if (request.afterInstanceId) {
    const offset = containerChildIds(project, container).indexOf(request.afterInstanceId)
    if (offset < 0) throw new CourseInsertionError('invalid-target', 'after对象已不在目标插入容器中，请重新定位')
    options.index = offset + 1
  }
  const edits: ComponentEdit[] = [], stages: ComponentEdit[][] = []
  const append = (stage: ComponentEdit[]) => { if (stage.length) { stages.push(stage); edits.push(...stage) } }
  let working = project, bodyContainer: ComponentContainer | undefined
  if (request.flowSelection !== undefined && options.destination !== 'paper') {
    if (!surfaceId || componentSurface(project, surfaceId)?.kind !== 'flow') throw new CourseInsertionError('invalid-target', '当前目标不是 Flow 正文，无法按光标位置插入')
    const split = prepareFlowBodyInsertion(project, surfaceId, request.flowSelection)
    working = split.project; append(split.edits)
    bodyContainer = container = split.container
    options.index = split.index
  }
  options = { ...options, container }
  const prepared = prepareCourseElementEdits(working, surfaceId, selectedInstanceId, request.kind, options)
  append(prepared.edits)
  if (request.appearance !== undefined || request.click) {
    working = applyComponentOperation(working, captureComponentOperation(working, prepared.edits, [], { deferTextRelationships: true }))
    const insertedTarget = { surfaceId, instanceId: prepared.instanceIds[0]!, stateId: request.stateId }
    if (request.appearance !== undefined) {
      const appearance = componentAppearanceEdits(working, insertedTarget, request.appearance)
      append(appearance)
      if (appearance.length && request.click) working = applyComponentOperation(working, captureComponentOperation(working, appearance, [], { deferTextRelationships: true }))
    }
    if (request.click) {
      if (!surfaceId) throw new CourseInsertionError('invalid-target', '点击行为需要页面')
      append(componentClickInteractionEdits({ project: working, surfaceId, activeStateId: request.stateId ?? null,
        instanceId: insertedTarget.instanceId }, request.click.action, request.click.value, request.references))
    }
  }
  return { edits, stages, instanceIds: prepared.instanceIds, container, ...(bodyContainer ? { bodyContainer } : {}) }
}
