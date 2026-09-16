import { componentManifestSchema } from './contracts/component-v4/schema'
import type { GenerationCandidate, GenerationRequest } from './generationContract'

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
