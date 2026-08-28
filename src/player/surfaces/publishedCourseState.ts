import type {
  CourseNavigationGuard,
  CourseStateDeclaration,
  CourseStateScalar,
} from '../../shared/courseProjectTypes'
import type { ComponentHostActions } from '../../shared/componentTypes'
import type {
  CourseStateStore as CourseStateStoreContract,
  RuntimeHostActions,
} from '../../shared/runtimeTypes'
import type { CourseStateStore } from '../CourseStateStore'

export interface PublishedCarrierSideEffects {
  readonly courseState?: CourseStateStoreContract
  readonly runtimeActions?: Readonly<RuntimeHostActions>
  readonly componentActions?: Readonly<ComponentHostActions>
  readonly active: () => boolean
  retire(): void
}

function guardedRuntimeActions(
  actions: Readonly<RuntimeHostActions> | undefined,
  active: () => boolean,
): Readonly<RuntimeHostActions> | undefined {
  if (!actions) return undefined
  return Object.freeze({
    goToScene: (sceneId: string, targetStateId?: string) => (
      active() && actions.goToScene(sceneId, targetStateId)
    ),
    nextScene: () => active() && actions.nextScene(),
    previousScene: () => active() && actions.previousScene(),
    replayScene: () => active() && actions.replayScene(),
    restartCourse: () => active() && actions.restartCourse(),
  })
}

function guardedCourseState(
  store: CourseStateStoreContract | undefined,
  active: () => boolean,
): CourseStateStoreContract | undefined {
  if (!store) return undefined
  return Object.freeze({
    get: <T>(key: string) => store.get<T>(key),
    set: (key: string, value: unknown) => {
      if (active()) store.set(key, value)
    },
    delete: (key: string) => {
      if (active()) store.delete(key)
    },
    clear: () => {
      if (active()) store.clear()
    },
    snapshot: () => store.snapshot(),
  })
}

/**
 * Keeps executable Published carriers attached to exactly one live host
 * generation. Suspended or replaced instances may still finish timers, but
 * their state writes and navigation actions become inert synchronously.
 */
export class PublishedCarrierSideEffectGate {
  readonly #courseState?: CourseStateStoreContract
  readonly #runtimeActions?: Readonly<RuntimeHostActions>
  readonly #componentActions?: Readonly<ComponentHostActions>
  #active = false
  #destroyed = false
  #generation = 0

  constructor(options: Readonly<{
    courseState?: CourseStateStoreContract
    runtimeActions?: Readonly<RuntimeHostActions>
    componentActions?: Readonly<ComponentHostActions>
  }>) {
    this.#courseState = options.courseState
    this.#runtimeActions = options.runtimeActions
    this.#componentActions = options.componentActions
  }

  activate(): void {
    if (!this.#destroyed) this.#active = true
  }

  suspend(): void {
    this.#active = false
  }

  destroy(): void {
    this.#active = false
    this.#destroyed = true
    this.#generation += 1
  }

  /** Starts one replacement generation and permanently retires the previous one. */
  beginGeneration(): PublishedCarrierSideEffects {
    const generation = ++this.#generation
    return this.#createScope(() => generation === this.#generation)
  }

  /** Creates a record-scoped carrier for hosts that preserve other records. */
  createScope(isCurrent: () => boolean = () => true): PublishedCarrierSideEffects {
    return this.#createScope(isCurrent)
  }

  #createScope(isCurrent: () => boolean): PublishedCarrierSideEffects {
    let retired = false
    const active = () => (
      !retired
      && !this.#destroyed
      && this.#active
      && isCurrent()
    )
    const runtimeActions = guardedRuntimeActions(this.#runtimeActions, active)
    const componentActions = guardedRuntimeActions(
      this.#componentActions,
      active,
    ) as Readonly<ComponentHostActions> | undefined
    const courseState = guardedCourseState(this.#courseState, active)
    return Object.freeze({
      ...(courseState ? { courseState } : {}),
      ...(runtimeActions ? { runtimeActions } : {}),
      ...(componentActions ? { componentActions } : {}),
      active,
      retire: () => {
        retired = true
      },
    })
  }
}

function cloneDefaultValue(declaration: CourseStateDeclaration): CourseStateScalar {
  return structuredClone(declaration.defaultValue)
}

/** Restores the authored V9 defaults without replacing the shared store object. */
export function resetPublishedCourseState(
  store: CourseStateStore,
  declarations: readonly CourseStateDeclaration[],
): void {
  store.clear()
  for (const declaration of declarations) {
    store.set(declaration.key, cloneDefaultValue(declaration))
  }
}

function compareStateValues(
  actual: unknown,
  operator: Extract<
    CourseNavigationGuard['conditions'][number],
    { type: 'compare' }
  >['operator'],
  expected: CourseStateScalar,
): boolean {
  if (operator === 'eq') return Object.is(actual, expected)
  if (operator === 'neq') return !Object.is(actual, expected)
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  if (operator === 'gt') return actual > expected
  if (operator === 'gte') return actual >= expected
  if (operator === 'lt') return actual < expected
  return actual <= expected
}

/** Shared exists/compare semantics for navigation guards and Interaction rules. */
export function matchesPublishedCourseStateCondition(
  store: Pick<CourseStateStoreContract, 'get'>,
  condition:
    | Readonly<{ key: string; exists: boolean }>
    | Readonly<{
        key: string
        operator: Extract<
          CourseNavigationGuard['conditions'][number],
          { type: 'compare' }
        >['operator']
        value: CourseStateScalar
      }>,
): boolean {
  if ('exists' in condition) {
    return (store.get(condition.key) !== undefined) === condition.exists
  }
  return compareStateValues(
    store.get(condition.key),
    condition.operator,
    condition.value,
  )
}

function guardAppliesToTransition(
  guard: CourseNavigationGuard,
  fromLocationId: string | null,
  toLocationId: string,
): boolean {
  if (!guard.toLocationIds.includes(toLocationId)) return false
  if (!guard.fromLocationIds) return true
  return fromLocationId !== null && guard.fromLocationIds.includes(fromLocationId)
}

/** Returns the first authored blocking guard for a concrete Published transition. */
export function findPublishedNavigationBlock(
  guards: readonly CourseNavigationGuard[],
  store: CourseStateStore,
  transition: Readonly<{
    fromLocationId: string | null
    toLocationId: string
  }>,
): CourseNavigationGuard | null {
  for (const guard of guards) {
    if (!guardAppliesToTransition(
      guard,
      transition.fromLocationId,
      transition.toLocationId,
    )) continue
    const results = guard.conditions.map((condition) => (
      matchesPublishedCourseStateCondition(store, condition)
    ))
    const matched = guard.match === 'all'
      ? results.every(Boolean)
      : results.some(Boolean)
    if (matched) return guard
  }
  return null
}
