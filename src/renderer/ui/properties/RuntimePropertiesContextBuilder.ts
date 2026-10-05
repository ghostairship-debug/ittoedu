import type { RuntimePropertiesContext } from './RuntimePropertiesPanel'
import type { ComponentDefinition, ComponentInstance } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
/** Source management uses the actual implementation. Editable data stays in ComponentPropertiesEditor. */
export function buildRuntimePropertiesContexts(input: {
  scope: 'scene' | 'global'; definition: ComponentDefinition; instance: ComponentInstance
  components?: DocumentResources['components']
  assetCount: number; disabledReason?: string | null; setEnabled(enabled: boolean): void; editSource(): void
}): RuntimePropertiesContext | null {
  if ((input.instance.implementationOverride ?? input.definition.implementation).kind !== 'source') return null
  return { kind: 'runtime', scope: input.scope, definition: input.definition, instance: input.instance,
    assetCount: input.assetCount, components: input.components, disabledReason: input.disabledReason ?? null,
    commands: { setEnabled: input.setEnabled, editSource: input.editSource } }
}
