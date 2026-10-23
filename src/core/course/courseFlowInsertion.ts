import type { CourseProjectV10, ComponentContainer } from '../../shared/contracts/component-platform/project'
import { componentSurface, containerChildIds } from '../../shared/contracts/component-platform/project'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { DocumentSelection } from '../../shared/document/ports'
import { documentBlockChildren } from '../../shared/document/content'
import { locateDocumentBlock, planDocumentBlockInsertion } from '../../shared/document/blockInsertion'
import { projectFlowDocument, flowDocumentEdits } from '../components/document/flowDocumentProjection'
import { applyComponentOperation, captureComponentOperation } from '../drivers/courseV10Operations'

/** Prepare only the body split and its actual reading container. The existing caller
 * prepares the object against this working project, then captures all edits once. */
export function prepareFlowBodyInsertion(project: CourseProjectV10, surfaceId: string, selection: DocumentSelection | null,
  options: { deferTextRelationshipCleanup?: boolean } = {}): {
  edits: ComponentEdit[]; project: CourseProjectV10; container: ComponentContainer; index: number
} {
  if (componentSurface(project, surfaceId)?.kind !== 'flow') throw new Error('当前页面不是讲义')
  const before = projectFlowDocument(project, surfaceId).content
  const plan = planDocumentBlockInsertion(before, selection)
  const edits = flowDocumentEdits(project, surfaceId, plan.content.blocks, project, undefined, undefined, options)
  const working = edits.length ? applyComponentOperation(project, captureComponentOperation(project, edits, [], { deferTextRelationships: options.deferTextRelationshipCleanup })) : project
  const container: ComponentContainer = { kind: 'instance', instanceId: plan.parentId ?? surfaceId }
  const body = plan.parentId ? documentBlockChildren(locateDocumentBlock(plan.content.blocks, plan.parentId)!.block)! : plan.content.blocks
  const siblings = containerChildIds(working, container)
  const nextId = body[plan.index]?.id, previousId = body[plan.index - 1]?.id
  const index = nextId ? siblings.indexOf(nextId) : previousId ? siblings.indexOf(previousId) + 1 : siblings.length
  if (index < 0) throw new Error('正文插入位置已不存在，请重新选择落点')
  return { edits, project: working, container, index }
}
