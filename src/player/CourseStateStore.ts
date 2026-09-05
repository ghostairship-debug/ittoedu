import type {
  CourseStateData,
  CourseStateStore as CourseStateStoreContract,
} from '../shared/runtimeTypes'

const PURE_DATA_ERROR =
  '课程状态只能保存由基本值、普通对象和数组组成的可结构化克隆纯数据'

function assertPureData(value: unknown, activeObjects: WeakSet<object>): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return
  }

  if (typeof value !== 'object') {
    throw new TypeError(PURE_DATA_ERROR)
  }

  if (activeObjects.has(value)) {
    throw new TypeError(`${PURE_DATA_ERROR}，不能包含循环引用`)
  }

  const prototype = Object.getPrototypeOf(value)
  const isArray = Array.isArray(value)
  if (
    (!isArray && prototype !== Object.prototype && prototype !== null) ||
    (isArray && prototype !== Array.prototype)
  ) {
    throw new TypeError(`${PURE_DATA_ERROR}，不能保存类实例或平台对象`)
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${PURE_DATA_ERROR}，不能包含 Symbol 属性`)
  }

  activeObjects.add(value)
  try {
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (isArray && key === 'length') continue
      if (!('value' in descriptor)) {
        throw new TypeError(`${PURE_DATA_ERROR}，不能包含访问器属性`)
      }
      if (!descriptor.enumerable) {
        throw new TypeError(`${PURE_DATA_ERROR}，不能包含不可枚举数据属性`)
      }
      assertPureData(descriptor.value, activeObjects)
    }
  } finally {
    activeObjects.delete(value)
  }
}

function clonePureData<T>(value: T, key: string): T {
  try {
    assertPureData(value, new WeakSet<object>())
    return structuredClone(value)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : PURE_DATA_ERROR
    throw new TypeError(`课程状态“${key}”无效：${detail}。`, { cause })
  }
}

export class CourseStateStore implements CourseStateStoreContract {
  private readonly values = new Map<string, CourseStateData>()

  constructor(
    private readonly onChange?: (
      change: Readonly<{
        type: 'set' | 'delete' | 'clear' | 'batch'
        key?: string
        value?: unknown
        entries?: readonly { key: string; value: unknown }[]
      }>,
    ) => void,
  ) {}

  get<T = CourseStateData>(key: string): T | undefined {
    if (!this.values.has(key)) return undefined
    return clonePureData(this.values.get(key), key) as T
  }

  set(key: string, value: unknown): void {
    const cloned = clonePureData(value, key) as CourseStateData
    this.values.set(key, cloned)
    this.onChange?.({ type: 'set', key, value: clonePureData(cloned, key) })
  }

  delete(key: string): void {
    if (this.values.delete(key)) {
      this.onChange?.({ type: 'delete', key })
    }
  }

  /** Host-only atomic write; intentionally absent from the extension API. */
  setMany(entries: readonly { key: string; value: unknown }[]): void {
    const keys = new Set<string>()
    const prepared = entries.map(({ key, value }) => {
      if (!key || keys.has(key)) throw new TypeError(`重复或空的课程状态键：${key}`)
      keys.add(key)
      return { key, value: clonePureData(value, key) as CourseStateData }
    })
    if (!prepared.length) return
    const notification = prepared.map(({ key, value }) => ({ key, value: clonePureData(value, key) }))
    for (const { key, value } of prepared) this.values.set(key, value)
    this.onChange?.({ type: 'batch', entries: notification })
  }

  clear(): void {
    const hadValues = this.values.size > 0
    this.values.clear()
    if (hadValues) this.onChange?.({ type: 'clear' })
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.values].map(([key, value]) => [key, clonePureData(value, key)]),
    )
  }
}
