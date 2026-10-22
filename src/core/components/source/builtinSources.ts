import type { ComponentImplementation } from '../../../shared/contracts/component-platform/project'
import { BUILTIN_SOURCE_ENTRIES } from '../../../components/builtin-source/entries'
import { builtinComponentSourceLoaders } from '../../../shared/generated/componentBuiltinSourceLoaders'

export type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>
const entries: Readonly<Record<string, string>> = BUILTIN_SOURCE_ENTRIES
const sources = new Map<string, SourceImplementation>()
const pending = new Map<string, Promise<SourceImplementation>>()

function sourceEntry(key: string): string | undefined {
  return Object.hasOwn(entries, key) ? entries[key] : undefined
}

/** Source readiness is a small fact; callers need not load code merely to list a builtin. */
export function hasBuiltinComponentSource(key: string): boolean {
  const entry = sourceEntry(key)
  return entry !== undefined && sources.has(entry)
}

/** Prepare only the requested runtime closure. Aliases share the same entry request and cache. */
export async function loadBuiltinComponentSource(key: string): Promise<SourceImplementation | undefined> {
  const entry = sourceEntry(key)
  if (entry === undefined) return undefined
  let request = pending.get(entry)
  if (!request) {
    const load = builtinComponentSourceLoaders[entry]
    if (!load) throw new Error(`默认组件 ${key} 的源码制品缺失，请重新生成开发构建。`)
    request = load().then(source => { sources.set(entry, source); return source }).catch(error => {
      pending.delete(entry)
      throw error
    })
    pending.set(entry, request)
  }
  await request
  return getBuiltinComponentSource(key)
}

export async function prepareBuiltinComponentSources(keys: readonly string[]): Promise<void> {
  await Promise.all([...new Set(keys)].map(loadBuiltinComponentSource))
}

/** Pure planners read a closure only after their existing asynchronous caller prepared it. */
export function getBuiltinComponentSource(key: string): SourceImplementation | undefined {
  const entry = sourceEntry(key)
  if (entry === undefined) return undefined
  const source = sources.get(entry)
  if (!source) throw new Error(`默认组件 ${key} 的完整源码尚未准备，请先等待该源码加载完成。`)
  return { ...source }
}

export const builtinComponentSourceKeys: readonly string[] = Object.freeze(Object.keys(entries))
