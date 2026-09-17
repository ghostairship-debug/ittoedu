import type { AuthoringToolTargetWireV1 } from './authoringToolContract'
import type { GenerationTaskFacts } from './generationTaskFacts'

const MAX_INLINE_TASK_FACTS_BYTES = 4000

export type GenerationTaskFactsTargetProjector = (target: AuthoringToolTargetWireV1) => AuthoringToolTargetWireV1 | string

/**
 * Projects frozen task facts for the initial native prompt. The complete facts
 * remain in request.json; this projection is only the human-facing summary
 * sent inline to the model.
 */
export function generationTaskFactsPromptProjection(
  taskFacts: GenerationTaskFacts | undefined,
  projectTarget: GenerationTaskFactsTargetProjector = target => target,
) {
  if (!taskFacts || (!taskFacts.components.length && !taskFacts.relations.length)) return undefined
  const projection = {
    source: taskFacts.source,
    documentRevision: taskFacts.documentRevision,
    details: 'request.json taskFacts',
    components: taskFacts.components.map(component => ({ ...component, target: projectTarget(component.target) })),
    relations: taskFacts.relations,
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength <= MAX_INLINE_TASK_FACTS_BYTES) return projection
  return {
    source: projection.source,
    documentRevision: projection.documentRevision,
    details: projection.details,
    scope: 'summary-only' as const,
    components: projection.components.length,
    relations: projection.relations.length,
  }
}
