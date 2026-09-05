export const ASSESSMENT_EVALUATOR_MODULE =
  'src/shared/assessmentEvaluators.ts' as const

export const ASSESSMENT_EVALUATOR_REGISTRY = [
  {
    id: 'EVAL-finite-choice-v1',
    version: 1,
    status: 'stable',
    authorities: ['finite-auto'],
    responseTypes: ['choice'],
    invocation: {
      module: ASSESSMENT_EVALUATOR_MODULE,
      export: 'evaluateAssessment',
      runtime: 'ctx.assessment.evaluate',
    },
  },
  {
    id: 'EVAL-normalized-short-v1',
    version: 1,
    status: 'stable',
    authorities: ['normalized-auto'],
    responseTypes: ['normalized-short'],
    invocation: {
      module: ASSESSMENT_EVALUATOR_MODULE,
      export: 'evaluateAssessment',
      runtime: 'ctx.assessment.evaluate',
    },
  },
] as const

export type AssessmentEvaluatorId =
  typeof ASSESSMENT_EVALUATOR_REGISTRY[number]['id']

export interface AssessmentEvaluationRequest {
  /** Approved response record this invocation implements, when applicable. */
  responseId?: `RESP-${number}`
  evaluatorId: AssessmentEvaluatorId
  input: string
  acceptedValues: readonly string[]
}

export interface AssessmentEvaluationResult {
  evaluatorId: AssessmentEvaluatorId
  normalizedInput: string
  status: 'pass' | 'fail'
}

export const NUMBER_INPUT_REGEX =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function normalizeShortAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('und')
}

export function normalizeNumberAnswer(value: string): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  if (!NUMBER_INPUT_REGEX.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

/**
 * Published, deterministic assessment invocation used by the capability index.
 * The approved case still owns the exact accepted values and tolerance cases.
 */
export function evaluateAssessment(
  request: AssessmentEvaluationRequest,
): AssessmentEvaluationResult {
  if (typeof request?.input !== 'string' ||
      !Array.isArray(request.acceptedValues) ||
      request.acceptedValues.some((value) => typeof value !== 'string')) {
    throw new TypeError('判定请求必须包含字符串 input 与 acceptedValues')
  }
  if (request.responseId !== undefined &&
      (typeof request.responseId !== 'string' ||
        !/^RESP-\d{3,}$/.test(request.responseId))) {
    throw new TypeError('responseId 必须是 RESP-* 稳定 ID')
  }
  const evaluator = ASSESSMENT_EVALUATOR_REGISTRY.find(
    (candidate) => candidate.id === request.evaluatorId,
  )
  if (!evaluator) {
    throw new TypeError(`未发布的判定器：${String(request.evaluatorId)}`)
  }
  const normalize = request.evaluatorId === 'EVAL-normalized-short-v1'
    ? normalizeShortAnswer
    : (value: string) => value.trim()
  const normalizedInput = normalize(request.input)
  const accepted = new Set(request.acceptedValues.map(normalize))
  return {
    evaluatorId: request.evaluatorId,
    normalizedInput,
    status: accepted.has(normalizedInput) ? 'pass' : 'fail',
  }
}
