import type { ExecutionRunRecord } from '../../../src/shared/workbench/execution'

const inputFields = new Set([
  'target', 'job', 'path', 'offset', 'limit', 'encoding', 'kind', 'family',
  'content', 'artifact', 'buttonCheck', 'parent', 'name', 'query', 'cursor',
  'resource', 'placement', 'prompt', 'steps', 'type', 'document', 'workspace',
])
const toolNames = new Set([
  'tools.load', 'read', 'inspect', 'listChildren', 'file.list', 'file.search',
  'file.open', 'file.create', 'course.navigation', 'slide.create', 'batch',
  'image.generate', 'media.insert', 'build.create', 'build.read', 'build.write',
  'build.compile', 'build.check', 'build.logs', 'build.import',
])
const errorCodes = new Set([
  'invalid-input', 'invalid-target', 'target-conflict', 'invalid-operation',
  'operation-payload-mismatch', 'service-unavailable', 'build-create-unknown',
  'build-target-conflict', 'build-budget', 'build-no-progress', 'invalid-baseline',
  'invalid-budget', 'file-tool-failed', 'file-create-outcome-unknown',
  'tool-outcome-unknown', 'unresolved-prior-tool', 'resume-observation-required',
  'invalid-tool-arguments', 'tool-load-failed', 'run-stopped', 'user-denied',
])
const states = new Set(['pending', 'executing', 'returned'])
const resultKinds = new Set(['error', 'read', 'document-operation'])

function valueShape(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value
}

function inputShape(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: valueShape(value) }
  const entries = Object.entries(value)
  const fields = Object.fromEntries(entries.filter(([key]) => inputFields.has(key)).slice(0, 24)
    .map(([key, field]) => [key, valueShape(field)]))
  return { type: 'object', fields, otherFieldCount: entries.length - Object.keys(fields).length }
}

/** Persist bounded structure only; never include tool argument values or error messages. */
export function relToolDiagnostics(runs: readonly ExecutionRunRecord[]) {
  return runs.flatMap((run, runIndex) => run.tools.map((tool, toolIndex) => ({
    runIndex, toolIndex,
    name: toolNames.has(tool.call.name) ? tool.call.name : 'unrecognized',
    state: states.has(tool.state) ? tool.state : 'unrecognized',
    inputShape: inputShape(tool.call.input),
    resultKind: tool.result ? (resultKinds.has(tool.result.kind) ? tool.result.kind : 'unrecognized') : null,
    errorCode: tool.result?.kind === 'error'
      ? (errorCodes.has(tool.result.code) ? tool.result.code : 'unrecognized')
      : null,
  })))
}
