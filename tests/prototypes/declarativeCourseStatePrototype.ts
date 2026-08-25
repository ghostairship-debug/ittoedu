/**
 * Review-only prototype for the 2026-08-12 declarative course-state RFC retained in Git history.
 * It deliberately lives under tests and is not a persisted Project contract.
 */

export type PrototypeCourseStateScalar = null | boolean | number | string
export type PrototypeCourseStateType = 'null' | 'boolean' | 'number' | 'string'

export interface PrototypeCourseStateDeclaration {
  key: string
  type: PrototypeCourseStateType
  defaultValue: PrototypeCourseStateScalar
}

export type PrototypeCourseState = Readonly<Record<string, PrototypeCourseStateScalar>>

export type PrototypeCourseStateCondition =
  | { type: 'course-state.exists'; key: string; exists: boolean }
  | {
      type: 'course-state.compare'
      key: string
      operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
      value: PrototypeCourseStateScalar
    }

export type PrototypeCourseStateAction =
  | { type: 'course-state.set'; key: string; value: PrototypeCourseStateScalar }
  | { type: 'course-state.increment'; key: string; by: number }
  | { type: 'course-state.delete'; key: string }

export type PrototypeMutationMode = 'playback' | 'authoring' | 'capture'

export interface PrototypeNavigationGuard {
  id: string
  fromSceneIds?: readonly string[]
  toSceneIds?: readonly string[]
  conditions: readonly PrototypeCourseStateCondition[]
  reason: string
}

export type PrototypeNavigationOrigin =
  | 'keyboard'
  | 'scene-picker'
  | 'teacher-controller'
  | 'presenter'
  | 'interaction'
  | 'runtime'
  | 'component'
  | 'initial'
  | 'replay'
  | 'restart'
  | 'authoring'
  | 'capture'
  | 'presentation-state'

export interface PrototypeNavigationDecision {
  accepted: boolean
  reason?: string
  guardId?: string
}

const KEY_PATTERN = /^[a-z][a-zA-Z0-9._-]{0,79}$/
const RESERVED_PREFIXES = ['system.', 'runtime.', 'component.'] as const

export const GUARDED_PROTOTYPE_NAVIGATION_ORIGINS = [
  'keyboard',
  'scene-picker',
  'teacher-controller',
  'presenter',
  'interaction',
  'runtime',
  'component',
] as const satisfies readonly PrototypeNavigationOrigin[]

export const FORCED_PROTOTYPE_NAVIGATION_ORIGINS = [
  'initial',
  'replay',
  'restart',
  'authoring',
  'capture',
  'presentation-state',
] as const satisfies readonly PrototypeNavigationOrigin[]

const guardedOrigins = new Set<PrototypeNavigationOrigin>(
  GUARDED_PROTOTYPE_NAVIGATION_ORIGINS,
)

function scalarType(value: PrototypeCourseStateScalar): PrototypeCourseStateType {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'string'
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限数`)
}

function declarationsByKey(
  declarations: readonly PrototypeCourseStateDeclaration[],
): ReadonlyMap<string, PrototypeCourseStateDeclaration> {
  if (declarations.length > 128) throw new Error('课程状态声明不能超过 128 项')
  const result = new Map<string, PrototypeCourseStateDeclaration>()
  for (const declaration of declarations) {
    if (!KEY_PATTERN.test(declaration.key)) {
      throw new Error(`课程状态 key“${declaration.key}”格式无效`)
    }
    if (RESERVED_PREFIXES.some((prefix) => declaration.key.startsWith(prefix))) {
      throw new Error(`课程状态 key“${declaration.key}”使用了保留命名空间`)
    }
    if (result.has(declaration.key)) {
      throw new Error(`课程状态 key“${declaration.key}”重复`)
    }
    if (scalarType(declaration.defaultValue) !== declaration.type) {
      throw new Error(`课程状态“${declaration.key}”的默认值类型不匹配`)
    }
    if (declaration.type === 'number') {
      assertFiniteNumber(declaration.defaultValue as number, declaration.key)
    }
    result.set(declaration.key, declaration)
  }
  return result
}

export function initializePrototypeCourseState(
  declarations: readonly PrototypeCourseStateDeclaration[],
): PrototypeCourseState {
  declarationsByKey(declarations)
  return Object.fromEntries(
    declarations.map((declaration) => [declaration.key, declaration.defaultValue]),
  )
}

function requireDeclaration(
  declarations: ReadonlyMap<string, PrototypeCourseStateDeclaration>,
  key: string,
): PrototypeCourseStateDeclaration {
  const declaration = declarations.get(key)
  if (!declaration) throw new Error(`课程状态 key“${key}”未声明`)
  return declaration
}

export function evaluatePrototypeCourseStateCondition(
  state: PrototypeCourseState,
  declarations: readonly PrototypeCourseStateDeclaration[],
  condition: PrototypeCourseStateCondition,
): boolean {
  const declaration = requireDeclaration(declarationsByKey(declarations), condition.key)
  const exists = Object.hasOwn(state, condition.key)
  if (condition.type === 'course-state.exists') return exists === condition.exists
  if (!exists) return false
  if (scalarType(condition.value) !== declaration.type) {
    throw new Error(`课程状态“${condition.key}”的比较值类型不匹配`)
  }
  const current = state[condition.key]
  switch (condition.operator) {
    case 'eq': return current === condition.value
    case 'ne': return current !== condition.value
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (declaration.type !== 'number') {
        throw new Error(`${condition.operator} 只允许用于 number 状态`)
      }
      const left = current as number
      const right = condition.value as number
      assertFiniteNumber(left, condition.key)
      assertFiniteNumber(right, condition.key)
      if (condition.operator === 'gt') return left > right
      if (condition.operator === 'gte') return left >= right
      if (condition.operator === 'lt') return left < right
      return left <= right
    }
  }
}

export function applyPrototypeCourseStateAction(
  state: PrototypeCourseState,
  declarations: readonly PrototypeCourseStateDeclaration[],
  action: PrototypeCourseStateAction,
  mode: PrototypeMutationMode = 'playback',
): PrototypeCourseState {
  if (mode !== 'playback') return { ...state }
  const byKey = declarationsByKey(declarations)
  const declaration = requireDeclaration(byKey, action.key)
  const next = { ...state }
  if (action.type === 'course-state.delete') {
    delete next[action.key]
    return next
  }
  if (action.type === 'course-state.set') {
    if (scalarType(action.value) !== declaration.type) {
      throw new Error(`课程状态“${action.key}”的赋值类型不匹配`)
    }
    if (declaration.type === 'number') {
      assertFiniteNumber(action.value as number, action.key)
    }
    next[action.key] = action.value
    return next
  }
  if (declaration.type !== 'number') {
    throw new Error(`课程状态“${action.key}”不是 number，不能递增`)
  }
  assertFiniteNumber(action.by, '递增量')
  const base = Object.hasOwn(state, action.key)
    ? state[action.key] as number
    : declaration.defaultValue as number
  assertFiniteNumber(base, action.key)
  const result = base + action.by
  assertFiniteNumber(result, `${action.key} 递增结果`)
  next[action.key] = result
  return next
}

export function restartPrototypeCourseState(
  declarations: readonly PrototypeCourseStateDeclaration[],
): PrototypeCourseState {
  return initializePrototypeCourseState(declarations)
}

export function resolvePrototypeNavigation(
  input: {
    origin: PrototypeNavigationOrigin
    fromSceneId?: string
    toSceneId: string
    state: PrototypeCourseState
    declarations: readonly PrototypeCourseStateDeclaration[]
    guards: readonly PrototypeNavigationGuard[]
  },
): PrototypeNavigationDecision {
  if (!guardedOrigins.has(input.origin)) return { accepted: true }
  for (const guard of input.guards) {
    if (guard.fromSceneIds && !guard.fromSceneIds.includes(input.fromSceneId ?? '')) {
      continue
    }
    if (guard.toSceneIds && !guard.toSceneIds.includes(input.toSceneId)) continue
    const satisfied = guard.conditions.every((condition) =>
      evaluatePrototypeCourseStateCondition(input.state, input.declarations, condition))
    if (!satisfied) {
      return { accepted: false, reason: guard.reason, guardId: guard.id }
    }
  }
  return { accepted: true }
}
