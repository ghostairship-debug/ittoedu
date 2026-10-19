import type { z } from 'zod'
import type { ModelToolCall, ToolResult } from '../../shared/workbench/tools'

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined, input)
}

/** Prefer errors in supplied fields over an unrelated union branch's missing fields. */
function localIssues(issues: readonly z.ZodIssue[], input: unknown, prefix: PropertyKey[] = []): z.ZodIssue[] {
  const cost = (issues: z.ZodIssue[]) => issues.reduce((sum, issue) => sum + (issue.code === 'unrecognized_keys' ? issue.keys.length * 2
    : valueAt(input, issue.path) === undefined ? 3 : issue.code === 'invalid_value' ? 4 : 1), 0)
  return issues.flatMap(issue => {
    const path = [...prefix, ...issue.path]
    if (issue.code !== 'invalid_union' || !issue.errors.length) return [{ ...issue, path }]
    const branches = issue.errors.map(branch => localIssues(branch, input, path))
    return branches.reduce((nearest, branch) => cost(branch) < cost(nearest) ? branch : nearest)
  })
}

/** One actionable schema error, tied to the original operation and observed target. */
export function compactToolInputError(error: z.ZodError, call?: Pick<ModelToolCall, 'name' | 'input'>): Extract<ToolResult, { kind: 'error' }> {
  const issue = localIssues(error.issues, error.issues[0]?.path[0] === 'input' ? call : call?.input)[0]
  const issuePath = issue?.path ?? []
  const operationIndex = issuePath[0] === 'operations' && typeof issuePath[1] === 'number' ? issuePath[1] : undefined
  const root = call?.input && typeof call.input === 'object' ? call.input as Record<string, unknown> : undefined
  const operation = operationIndex !== undefined && Array.isArray(root?.operations) ? root.operations[operationIndex] as Record<string, unknown> | undefined : call
  const input = operation?.input && typeof operation.input === 'object' ? operation.input as Record<string, unknown>
    : operationIndex !== undefined ? operation as Record<string, unknown> | undefined : root
  const tool = typeof operation?.name === 'string' ? operation.name : call?.name
  const target = typeof input?.target === 'string' ? input.target : typeof input?.path === 'string' ? input.path : undefined
  const fieldPath = operationIndex === undefined ? [...issuePath] : issuePath.slice(2)
  if (fieldPath[0] === 'input') fieldPath.shift()
  if (issue?.code === 'unrecognized_keys' && issue.keys.length) fieldPath.push(issue.keys[0]!)
  const field = fieldPath.map(String).join('.') || 'input'
  const expected = issue?.message ?? '参数需符合工具支持的形状'
  const read = typeof input?.target === 'string' ? { name: 'read', input: { target: input.target, ...(tool?.startsWith('text.') ? {} : { detail: 'object' }) } }
    : typeof input?.path === 'string' ? { name: 'project.read', input: { ...(typeof (input.project ?? root?.project) === 'string' ? { project: input.project ?? root?.project } : {}), path: input.path } } : undefined
  const label = `${operationIndex === undefined ? '' : `operations[${operationIndex}] `}${tool ?? '工具'}`
  return { kind: 'error', code: 'invalid-input',
    message: `${label}${target ? ` target=${target}` : ''} ${field}: ${expected}${read ? `；局部读取 ${read.name} ${JSON.stringify(read.input)}` : ''}`,
    data: { ...(tool ? { tool } : {}), ...(operationIndex === undefined ? {} : { operationIndex }), ...(target ? { target } : {}), field, expected, ...(read ? { read } : {}) } }
}
