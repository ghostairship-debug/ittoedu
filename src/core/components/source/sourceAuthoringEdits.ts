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
  const scopedFiles = files && { ...files, sourceScope: target.kind === 'instance'
    ? { kind: 'instance' as const, instanceId: target.instanceId }
    : { kind: 'definition' as const, definitionId: target.definition.id }, forkOwnerId: crypto.randomUUID() }
  return [...(scopedFiles ? [scopedFiles] : []), target.kind === 'instance'
    ? { type: 'implementation.set', instanceId: target.instanceId, implementation }
    : { type: 'definition.set', definition: { ...target.definition, implementation,
      ...(professionalBuiltinKey ? { professionalBuiltinKey } : {}) } }]
}

/** The canonical driver checks current references, after the producer's source CAS. */
export function scopeComponentSourceEdits(project: CourseProjectV10, edits: ComponentEdit[]): ComponentEdit[] {
  let scoped = edits
  for (const files of edits) {
    if (files.type !== 'component.files.set' || !files.sourceScope || files.files === null) continue
    const scope = files.sourceScope
    if (!componentSourceOwnerIsShared(project, scope.kind === 'instance' ? scope.instanceId : '', files.ownerId,
      scope.kind === 'definition' ? scope.definitionId : undefined)) continue
    if (!files.forkOwnerId || files.forkOwnerId === files.ownerId) throw new Error('源码独立副本缺少软件分配的文件身份')
    const implementationEdit = edits.find(edit => scope.kind === 'instance'
      ? edit.type === 'implementation.set' && edit.instanceId === scope.instanceId
      : edit.type === 'definition.set' && edit.definition.id === scope.definitionId)
    const implementation = implementationEdit?.type === 'implementation.set' ? implementationEdit.implementation
      : implementationEdit?.type === 'definition.set' ? implementationEdit.definition.implementation : undefined
    if (implementation?.kind !== 'source' || implementation.workspace?.ownerId !== files.ownerId)
      throw new Error('源码文件与当前编辑范围的实现引用不一致')
    const { source: _source, ...metadata } = implementation
    const independent: ComponentImplementation = { ...metadata, workspace: { ...implementation.workspace, ownerId: files.forkOwnerId } }
    scoped = scoped.map(edit => edit === files ? { ...files, ownerId: files.forkOwnerId!, expectedFiles: null }
      : edit === implementationEdit ? edit.type === 'implementation.set' ? { ...edit, implementation: independent }
        : edit.type === 'definition.set' ? { ...edit, definition: { ...edit.definition, implementation: independent } } : edit : edit)
  }
  return scoped
}
