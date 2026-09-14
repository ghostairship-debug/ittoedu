import { parse } from 'acorn'

export interface DirectProjectAssetReference { assetId: string; offset: number }

/** Literal calls to the two public project-asset APIs. Comments and unrelated
 * string values are not executable asset references. No source is evaluated. */
export function directProjectAssetReferences(source: string): DirectProjectAssetReference[] {
  return analyzeProjectAssetCalls(source).direct
}

export function analyzeProjectAssetCalls(source: string): { direct: DirectProjectAssetReference[]; dynamic: boolean } {
  let root: unknown
  try {
    root = parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
  } catch {
    // Syntax validation belongs to the dynamic source validator. The deletion
    // graph separately retains its conservative scan for invalid author drafts.
    return { direct: [], dynamic: true }
  }
  const found: DirectProjectAssetReference[] = []
  let dynamic = false
  const node = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  const propertyName = (member: Record<string, unknown> | null): unknown => {
    const property = node(member?.property)
    return member?.computed ? property?.value : property?.name
  }
  const visit = (value: unknown, parent?: Record<string, unknown>): void => {
    if (Array.isArray(value)) { value.forEach(child => visit(child, parent)); return }
    const current = node(value)
    if (!current) return
    // Taking an API function as a value (alias/bind/call) also prevents a
    // literal-only closure from proving which project assets it will request.
    if (current.type === 'MemberExpression' && (propertyName(current) === 'projectAssetUrl'
      || propertyName(current) === 'projectUrl' && propertyName(node(current.object)) === 'assets')
      && !(parent?.type === 'CallExpression' && parent.callee === value)) dynamic = true
    if (current.type === 'CallExpression') {
      const callee = node(current.callee)
      const property = propertyName(callee)
      const direct = callee?.type === 'MemberExpression' && (
        property === 'projectAssetUrl' ||
        (property === 'projectUrl' && propertyName(node(callee.object)) === 'assets')
      )
      const argument = node(Array.isArray(current.arguments) ? current.arguments[0] : null)
      let assetId = argument?.type === 'Literal' ? argument.value : undefined
      if (argument?.type === 'TemplateLiteral' && Array.isArray(argument.expressions) && argument.expressions.length === 0) {
        assetId = node(node(Array.isArray(argument.quasis) ? argument.quasis[0] : null)?.value)?.cooked
      }
      if (direct && typeof assetId === 'string' && assetId) found.push({ assetId, offset: Number(current.start) })
      else if (direct) dynamic = true
    }
    Object.values(current).forEach(child => visit(child, current))
  }
  visit(root)
  return { direct: found, dynamic }
}
