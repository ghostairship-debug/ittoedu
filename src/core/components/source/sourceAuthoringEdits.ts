import type { ComponentDefinition, ComponentEdit, ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'

export type ComponentSourceEditTarget =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'definition'; definition: ComponentDefinition }

/** Copy a source owner if it is referenced outside the scope being edited. */
export function componentSourceOwnerIsShared(project: CourseProjectV10, instanceId: string, ownerId: string, definitionId?: string): boolean {
  return Object.values(project.definitions).some(definition => definition.implementation.kind === 'source'
    && definition.id !== definitionId && definition.implementation.workspace?.ownerId === ownerId)
    || Object.values(project.instances).some(instance => (definitionId !== undefined || instance.id !== instanceId)
      && instance.implementationOverride?.kind === 'source' && instance.implementationOverride.workspace?.ownerId === ownerId)
}

/** UI and file producers assemble the same source/bytes batch; DocumentSession remains the writer. */
export function componentSourceAuthoringEdits(target: ComponentSourceEditTarget, implementation: ComponentImplementation,
  files?: Extract<ComponentEdit, { type: 'component.files.set' }>): ComponentEdit[] {
  const professionalBuiltinKey = target.kind === 'definition' && implementation.kind === 'source'
    ? componentDefinitionBuiltinKey(target.definition) : undefined
  return [...(files ? [files] : []), target.kind === 'instance'
    ? { type: 'implementation.set', instanceId: target.instanceId, implementation }
    : { type: 'definition.set', definition: { ...target.definition, implementation,
      ...(professionalBuiltinKey ? { professionalBuiltinKey } : {}) } }]
}
