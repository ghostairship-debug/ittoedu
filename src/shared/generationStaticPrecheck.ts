import { componentManifestSchema } from './contracts/component-v4/schema'
import type { GenerationCandidate, GenerationRequest } from './generationContract'
import { resolveSlideInteractionTarget } from './slideInteractionTargetResolver'

export interface GenerationStaticPrecheckDiagnostic {
  stepId: string
  code: string
  path: (string | number)[]
  message: string
}

function frozenUpdateTarget(
  request: GenerationRequest,
  destination: GenerationCandidate['steps'][number]['destination'],
) {
  if ('stepId' in destination || destination.kind !== 'update') return null
  const frozen = request.destinations.find((candidate) =>
    candidate.kind === 'update' && JSON.stringify(candidate.target) === JSON.stringify(destination.target),
  )
  return frozen?.kind === 'update' ? frozen : null
}

/** The carrier is encoded by the host in the frozen canonical authoring address.
 * This deliberately does not resolve the live document. */
function frozenTargetCarrier(authoringAddress: string): 'native' | 'runtime' | 'component' | null {
  try {
    const address = new URL(authoringAddress)
    if (address.protocol !== 'courseware:' || address.hostname !== 'authoring') return null
    const parts = address.pathname.split('/').filter(Boolean)
    const carrier = parts[4]
    return carrier === 'native' || carrier === 'runtime' || carrier === 'component' ? carrier : null
  } catch {
    return null
  }
}

function changedUtf8File(input: unknown, filename: string): string | null {
  if (!input || typeof input !== 'object' || Reflect.get(input, 'operation') !== 'patch') return null
  const files = Reflect.get(input, 'changedFiles')
  if (!files || typeof files !== 'object') return null
  const file = Reflect.get(files, filename)
  if (typeof file === 'string') return null
  if (!file || typeof file !== 'object' || Reflect.get(file, 'encoding') !== 'utf8') return null
  const text = Reflect.get(file, 'text')
  return typeof text === 'string' ? text : null
}

function destinationScope(destination: GenerationCandidate['steps'][number]['destination']) {
  if ('stepId' in destination) return undefined
  return destination.kind === 'update' ? destination.target : destination.scope
}

function priorStepMayChangeIndex(candidate: GenerationCandidate, stepIndex: number): boolean {
  // Keep an early static decision only when every preceding operation is
  // provably index-safe. Unknown tools and all index-affecting authoring
  // mutations defer to
  // the host, including mutations whose destination appears to be elsewhere:
  // a global layer can still change the applicable items or their labels here.
  const indexSafeTools = new Set(['slide.interaction'])
  return candidate.steps.slice(0, stepIndex).some(step => !indexSafeTools.has(step.tool))
}

function interactionNodeReferences(input: unknown): { reference: string; path: (string | number)[] }[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Reflect.get(input, 'operation') !== 'compose') return []
  const references: { reference: string; path: (string | number)[] }[] = []
  const trigger = Reflect.get(input, 'trigger')
  if (trigger && typeof trigger === 'object' && !Array.isArray(trigger)
    && (Reflect.get(trigger, 'kind') === 'click' || Reflect.get(trigger, 'kind') === 'input-submit')
    && typeof Reflect.get(trigger, 'node') === 'string') {
    references.push({ reference: Reflect.get(trigger, 'node'), path: ['input', 'trigger', 'node'] })
  }
  const effects = Reflect.get(input, 'effects')
  if (!Array.isArray(effects)) return references
  effects.forEach((effect, effectIndex) => {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return
    if (Reflect.get(effect, 'kind') !== 'show' && Reflect.get(effect, 'kind') !== 'hide') return
    const nodes = Reflect.get(effect, 'nodes')
    if (!Array.isArray(nodes)) return
    nodes.forEach((reference, nodeIndex) => {
      if (typeof reference === 'string') references.push({ reference, path: ['input', 'effects', effectIndex, 'nodes', nodeIndex] })
    })
  })
  return references
}

function checkFrozenSlideInteractionTargets(candidate: GenerationCandidate, request: GenerationRequest): GenerationStaticPrecheckDiagnostic[] {
  const diagnostics: GenerationStaticPrecheckDiagnostic[] = []
  candidate.steps.forEach((step, stepIndex) => {
    if (step.tool !== 'slide.interaction') return
    const scope = destinationScope(step.destination)
    if (!scope || scope.surfaceType !== 'slide' || scope.owner !== 'scene') return
    const references = interactionNodeReferences(step.input)
    if (!references.length) return
    const index = request.taskFacts?.indexes.find(value => value.locationId === scope.locationId
      && value.surfaceId === scope.surfaceId && value.stateId === null)
    // A result destination or a previous mutation means this request needs the
    // host's current resolver; absence/partial facts are deliberately deferred.
    if ('stepId' in step.destination || !index || index.completeness !== 'complete'
      || priorStepMayChangeIndex(candidate, stepIndex)) return
    for (const reference of references) {
      const resolution = resolveSlideInteractionTarget({ index, reference: reference.reference, what: '互动目标', path: reference.path })
      if (resolution.status === 'error') diagnostics.push({ stepId: step.id, code: resolution.code, path: resolution.path, message: resolution.message })
    }
  })
  return diagnostics
}

/**
 * Free checks whose inputs are completely frozen in this candidate/request.
 * Resource closure, current identity, package admission and runtime behavior stay
 * with their existing host Owners.
 */
export function checkGenerationStaticPrecheck(
  candidate: GenerationCandidate,
  request: GenerationRequest,
): GenerationStaticPrecheckDiagnostic[] {
  const diagnostics: GenerationStaticPrecheckDiagnostic[] = []
  diagnostics.push(...checkFrozenSlideInteractionTargets(candidate, request))
  for (const step of candidate.steps) {
    const frozen = frozenUpdateTarget(request, step.destination)
    if (step.tool === 'native.content' && frozen && frozenTargetCarrier(frozen.target.authoringAddress) === 'component') {
      diagnostics.push({
        stepId: step.id,
        code: 'static-target-carrier-mismatch',
        path: ['destination', 'target', 'authoringAddress'],
        message: 'Native 内容工具不能修改冻结的 Component 目标；请使用 component.configure 修改公开参数，或用 component.package 修改组件源码。',
      })
    }

    if (step.tool !== 'component.package') continue
    const manifestText = changedUtf8File(step.input, 'manifest.json')
    if (manifestText === null) continue
    let manifest: unknown
    try {
      manifest = JSON.parse(manifestText)
    } catch {
      diagnostics.push({ stepId: step.id, code: 'component-manifest-invalid', path: ['input', 'changedFiles', 'manifest.json', 'text'], message: '组件 manifest 必须是有效 JSON。' })
      continue
    }
    const parsed = componentManifestSchema.safeParse(manifest)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      diagnostics.push({
        stepId: step.id,
        code: 'component-manifest-invalid',
        path: ['input', 'changedFiles', 'manifest.json', 'text', ...(issue?.path ?? []).filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')],
        message: `组件 manifest 校验失败：${issue?.path.join('.') || 'manifest'} ${issue?.message ?? '字段无效'}。`,
      })
    }
  }
  return diagnostics
}
