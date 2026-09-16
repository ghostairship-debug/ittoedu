import { createHash } from 'node:crypto'
import { parse, tokenizer } from 'acorn'
import { generationInputReferenceSchema, type GenerationCandidate, type GenerationFailure } from '../../shared/generationContract'

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Sort object keys, retaining array order and every JSON parameter value. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  const record = object(value)
  return record ? Object.fromEntries(Object.keys(record).sort().map(key => [key, ordered(record[key])])) : value
}

function semanticAst(value: unknown): unknown {
  if (typeof value === 'bigint') return { valueType: 'bigint', value: value.toString() }
  if (typeof value === 'number' && !Number.isFinite(value)) return { valueType: 'number', value: String(value) }
  if (value instanceof RegExp) return { valueType: 'regexp', source: value.source, flags: value.flags }
  if (Array.isArray(value)) return value.map(semanticAst)
  const record = object(value)
  if (!record) return value
  const isNode = typeof record.type === 'string'
  return Object.fromEntries(Object.entries(record).filter(([key]) => {
    if (isNode && ['start', 'end', 'loc', 'range'].includes(key)) return false
    // Literal spelling is formatting; TemplateElement.value.raw remains observable
    // through tagged templates and must never be stripped with the same rule.
    if (record.type === 'Literal' && (key === 'raw' || key === 'bigint' && typeof record.value === 'bigint')) return false
    return true
  }).map(([key, nested]) => [key, semanticAst(nested)]))
}

function javascript(source: string): unknown {
  for (const sourceType of ['script', 'module'] as const) {
    try {
      const ast = parse(source, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
      return { representation: 'javascript-ast', ast: semanticAst(ast) }
    } catch { /* A draft can fail grammar parsing while retaining a usable token stream. */ }
  }
  try {
    const reader = tokenizer(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
    const tokens: Array<{ type: string; text: string; lineBreakBefore?: true }> = []
    let previousEnd = 0
    for (;;) {
      const token = reader.getToken()
      if (token.type.label === 'eof') break
      const previous = tokens.at(-1)
      // These restricted productions give a line break meaning beyond formatting.
      const restrictedBreak = previous && (['return', 'throw', 'break', 'continue', 'yield', 'async'].includes(previous.text)
        || ['++/--', '=>'].includes(token.type.label)) && /[\r\n\u2028\u2029]/.test(source.slice(previousEnd, token.start))
      // Raw token boundaries preserve strings, template chunks, regexes, and BigInt
      // without mistaking their contents for comments or serializing native values.
      tokens.push({ type: token.type.label, text: source.slice(token.start, token.end), ...(restrictedBreak ? { lineBreakBefore: true } : {}) })
      previousEnd = token.end
    }
    return { representation: 'javascript-tokens', tokens }
  } catch {
    return { representation: 'unparsed-javascript', source }
  }
}

function javascriptFile(value: unknown): unknown {
  const record = object(value)
  if (record?.encoding === 'utf8' && typeof record.text === 'string' && Object.keys(record).length === 2) return javascript(record.text)
  if (typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    try { return javascript(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'))) }
    catch { /* A binary or invalid encoding is not proven JavaScript text. */ }
  }
  return value
}

function sourceInput(tool: string, value: unknown): unknown {
  const input = object(value)
  if (!input) return value
  if (tool === 'runtime.source' && typeof input.source === 'string') return { ...input, source: javascript(input.source) }
  if (tool !== 'component.package' || !['patch', 'revise'].includes(String(input.operation))) return value
  const field = input.operation === 'patch' ? 'changedFiles' : 'files'
  const files = object(input[field])
  if (!files) return value
  return { ...input, [field]: Object.fromEntries(Object.entries(files).map(([filename, content]) =>
    [filename, filename.toLowerCase().endsWith('.js') ? javascriptFile(content) : content])) }
}

function resultReferences(value: unknown, steps: ReadonlyMap<string, number>): unknown {
  if (Array.isArray(value)) return value.map(nested => resultReferences(nested, steps))
  const record = object(value)
  if (!record) return value
  if (Object.hasOwn(record, '$result')) {
    const reference = generationInputReferenceSchema.safeParse(record)
    if (reference.success) {
      const { stepId, ...rest } = reference.data.$result
      const stepIndex = steps.get(stepId)
      if (stepIndex !== undefined) return { $result: { ...rest, stepIndex } }
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, resultReferences(nested, steps)]))
}

/** Identity of the requested operations, not candidate presentation or transport.
 * The digest bounds storage of the parsed semantic representation; it is not an
 * artifact-integrity check and never substitutes for candidate/host validation. */
export function candidateChangeKey(candidate: GenerationCandidate): string {
  const steps = new Map(candidate.steps.map((step, index) => [step.id, index]))
  const operations = candidate.steps.map(step => {
    let destination: unknown = step.destination
    if (step.destination.kind === 'created-item' || step.destination.kind === 'created-scope') {
      const { stepId, ...rest } = step.destination
      const stepIndex = steps.get(stepId)
      if (stepIndex !== undefined) destination = { ...rest, stepIndex }
    }
    return { tool: step.tool, carrier: step.carrier, destination,
      input: sourceInput(step.tool, resultReferences(step.input, steps)) }
  })
  return `candidate-change-v1:${createHash('sha256').update(JSON.stringify(ordered(operations))).digest('hex')}`
}

/** A rejection envelope alone does not identify a cause. In that case the
 * existing semantic candidate key still detects unchanged attempts. */
const opaqueFailureCodes = new Set(['tool-failed', 'candidate-prepare-failed', 'dynamic-host-failed', 'dynamic-host-destroy-failed'])

function failureDestination(value: unknown): unknown {
  const destination = object(value)
  if (!destination) return value
  const field = destination.kind === 'update' ? 'target' : 'scope'
  const target = object(destination[field])
  if (!target) return destination
  const { documentRevision: _revision, sessionGeneration: _generation, ...identity } = target
  return { ...destination, [field]: identity }
}

/** Bind a precise producer cause to the failing field and target, not candidate
 * wording or the position/name of its step. Actual field corrections permit a
 * new attempt; changing unrelated input does not erase the previous failure. */
export function failureReasonKey(failure: GenerationFailure | undefined, candidate?: GenerationCandidate): string | null {
  if (!failure) return null
  if (failure.diagnostics.some(diagnostic => opaqueFailureCodes.has(diagnostic.code))) return null
  const diagnostics = failure.diagnostics
    .map(diagnostic => {
      const indexed = diagnostic.path[0] === 'steps' && typeof diagnostic.path[1] === 'number'
      const step = candidate?.steps.find(step => step.id === failure.stepId)
        ?? (indexed ? candidate?.steps[diagnostic.path[1] as number] : undefined)
      const path = indexed ? diagnostic.path.slice(2) : diagnostic.path
      const destination = failureDestination(step?.destination ?? failure.destination)
      const input = step ? sourceInput(step.tool, step.input) : undefined
      const value = path.reduce<unknown>((value, key) => value && typeof value === 'object'
        ? Reflect.get(value, key) : undefined, { input, destination })
      return { code: diagnostic.code, path, tool: step?.tool ?? failure.tool ?? null, destination,
        ...(value !== undefined ? { value } : {}) }
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return `failure-reason-v2:${createHash('sha256').update(JSON.stringify(ordered(diagnostics))).digest('hex')}`
}
