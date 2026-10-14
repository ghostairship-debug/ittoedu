/** Both author-source and delivery parsers consume this explicit API5 declaration. */
export function isWebDocumentDeclaration(node: { type?: string; [key: string]: unknown }): boolean {
  if (node.type !== 'Property' && node.type !== 'ObjectProperty') return false
  const key = node.key as { type?: string; name?: string; value?: unknown } | undefined
  type ValueNode = { type?: string; value?: unknown; expression?: ValueNode }
  let value = node.value as ValueNode | undefined
  while (value && ['TSAsExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(value.type ?? '')) value = value.expression
  const name = key?.type === 'Identifier' && !node.computed ? key.name : key?.value
  return name === 'document' && (value?.type === 'Literal' || value?.type === 'StringLiteral') && value.value === 'web'
}
