import type { PropertiesContext } from './PropertiesContext'
import { usePropertiesAuthoringBinding } from '../../composition/properties/usePropertiesAuthoringBinding'

/**
 * Narrow UI adapter for the Properties root. Canonical target capture,
 * owner-specific planning and persistence stay behind the owner use case.
 */
export function usePropertiesContext({
  onReplaceImage,
}: {
  onReplaceImage(): void
}): PropertiesContext {
  return usePropertiesAuthoringBinding({ onReplaceImage })
}
