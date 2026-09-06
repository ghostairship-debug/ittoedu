import type { GenerationCandidate } from '../../../shared/generationContract'

type Carrier = GenerationCandidate['steps'][number]['carrier']
/** The same tool policy is shown to the CLI and checked before execution. */
export function authoringToolCarrierPolicy(tool: string): { default: Carrier; operations?: Record<string, Carrier> } {
  if (tool === 'component.insert') return { default: 'existing-component', operations: { candidate: 'generated-component', existing: 'existing-component', catalog: 'existing-component' } }
  if (tool === 'component.package') return { default: 'generated-component' }
  if (tool.startsWith('component.')) return { default: 'existing-component' }
  if (tool.startsWith('runtime.')) return { default: 'runtime' }
  return { default: tool === 'recipe.apply' ? 'recipe' : 'native' }
}

export function authoringToolCarrier(tool: string, input: unknown): Carrier {
  const policy = authoringToolCarrierPolicy(tool)
  const operation = input && typeof input === 'object' && !Array.isArray(input) ? Reflect.get(input, 'operation') : undefined
  return typeof operation === 'string' ? policy.operations?.[operation] ?? policy.default : policy.default
}
