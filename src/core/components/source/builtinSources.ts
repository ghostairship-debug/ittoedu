import generatedSources from '../../../shared/generated/componentBuiltinSources.json'
import type { ComponentImplementation } from '../../../shared/contracts/component-platform/project'

export type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>
const sources = generatedSources as Readonly<Record<string, SourceImplementation>>

/** Read the build artifact in Main, renderer, and project-file projection alike. */
export function getBuiltinComponentSource(key: string): SourceImplementation | undefined {
  if (!Object.hasOwn(sources, key)) return undefined
  return { ...sources[key] }
}

export const builtinComponentSourceKeys: readonly string[] = Object.freeze(Object.keys(sources))
