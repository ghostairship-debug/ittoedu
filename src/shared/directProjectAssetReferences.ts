import { parse } from 'acorn'

export interface DirectProjectAssetReference { assetId: string; offset: number }

/** Literal calls to the two public project-asset APIs. Comments and unrelated
 * string values are not executable asset references. No source is evaluated. */
export function directProjectAssetReferences(source: string): DirectProjectAssetReference[] {
  let root: unknown
  try {
    root = parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true })
  } catch {
    // Syntax validation belongs to the dynamic source validator. The deletion
    // graph separately retains its conservative scan for invalid author drafts.
    return []
  }
  const found: DirectProjectAssetReference[] = []
  const node = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  const propertyName = (member: Record<string, unknown> | null): unknown => {
    const property = node(member?.property)
    return member?.computed ? property?.value : property?.name
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    const current = node(value)
    if (!current) return
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
    }
    Object.values(current).forEach(visit)
  }
  visit(root)
  return found
}
