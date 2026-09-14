import type { AuthoringToolDestinationV1, AuthoringToolReceiptV1 } from './authoringToolContract'

export interface AuthoringOperationCondition {
  operations?: readonly string[]
  destination: 'create' | 'update'
  parents?: readonly string[]
  requiredForParent?: { parent: string; field: string }
  nativeTypesByScope?: Readonly<Record<string, readonly string[]>>
  message: string
}

/** The generated discovery/helper and real executor share this check. Resource
 * decoding and live identity checks remain with their existing host Owners. */
export function checkAuthoringOperationConditions(conditions: readonly AuthoringOperationCondition[], destination: AuthoringToolDestinationV1, input: unknown): AuthoringToolReceiptV1['diagnostics'] {
  const data = input && typeof input === 'object' ? input : {}
  const operation = Reflect.get(data, 'operation')
  for (const condition of conditions) {
    if (condition.operations && (typeof operation !== 'string' || !condition.operations.includes(operation))) continue
    if (destination.kind !== condition.destination) return [{ code: 'operation-target-mismatch', path: ['destination', 'kind'], message: condition.message }]
    if (destination.kind === 'create') {
      if (condition.parents && !condition.parents.includes(destination.scope.parent.kind)) return [{ code: 'operation-parent-mismatch', path: ['destination', 'scope', 'parent'], message: condition.message }]
      const required = condition.requiredForParent
      if (required?.parent === destination.scope.parent.kind && !Reflect.get(data, required.field)) return [{ code: 'missing-required-resource', path: ['input', required.field], message: condition.message }]
      if (condition.nativeTypesByScope) {
        const template = Reflect.get(data, 'template')
        const supported = condition.nativeTypesByScope[`${destination.scope.surfaceType}:${destination.scope.owner}`] ?? []
        if (!supported.includes(template?.nativeType)) return [{ code: 'shortcut-not-supported', path: ['input', 'template', 'nativeType'], message: `当前创建目标支持 ${supported.join('/') || '其他正式创建入口'}；可查询匹配目标或通过 project.document 交回完整结果。` }]
      }
    }
  }
  return []
}
