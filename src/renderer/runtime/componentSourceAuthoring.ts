import type { ComponentImplementation } from '../../shared/contracts/component-platform'
import type { CapturedComponentOperation, CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'

export { componentSourceOwnerIsShared } from '../../core/components/source/sourceAuthoringEdits'

/** Capture document/epoch and implementation expectation when input starts. */
export function createComponentSourceDraft(bridge: CourseV10DocumentBridge, documentId: string, instanceId: string) {
  const target = bridge.captureTarget(documentId)
  const instance = target.project.instances[instanceId]
  if (!instance) throw new Error('源码目标已不存在')
  const implementation = instance.implementationOverride ?? target.project.definitions[instance.definitionId]?.implementation
  return { command: bridge.capture([{ type: 'implementation.set', instanceId, implementation: null }], target),
    dependencies: implementation?.kind === 'source' ? implementation.dependencies : undefined }
}

export function sourceDraftOperation(draft: ReturnType<typeof createComponentSourceDraft>, implementation: ComponentImplementation | null): CapturedComponentOperation {
  const command = structuredClone(draft.command)
  const original = command.edits[0]
  if (original.type !== 'implementation.set') throw new Error('源码捕获不是实现修改')
  command.edits = [{ type: 'implementation.set', instanceId: original.instanceId,
    implementation: implementation?.kind === 'source' ? { ...implementation,
      ...(draft.dependencies ? { dependencies: [...draft.dependencies] } : {}) } : implementation }]
  return command
}
