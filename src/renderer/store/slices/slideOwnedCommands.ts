import type { ComponentEdit, ComponentFrame, JsonValue } from '../../../shared/contracts/component-platform'
import type { EditorStoreKernel } from '../editorStoreKernel'
import type { SlideAuthoringPorts } from './slideAuthoringSlice'
export type AlignmentMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** Slide actions use the kernel writer; shared object actions belong to U2. */
export function createSlideOwnedCommands(kernel: EditorStoreKernel, slide: SlideAuthoringPorts & {
  submit(edits: ComponentEdit[], group?: string): Promise<unknown>
}) {
  const updates = (instanceId: string, patch: Record<string, unknown>): ComponentEdit[] => {
    const instance = kernel.readDocument().instances[instanceId]
    if (!instance || instance.locked) return []
    const edits: ComponentEdit[] = []
    if (patch.frame && typeof patch.frame === 'object') edits.push({ type: 'frame.set', instanceId, frame: patch.frame as ComponentFrame })
    if (patch.data !== undefined) edits.push({ type: 'data.set', instanceId, path: [], value: JSON.parse(JSON.stringify(patch.data)) as JsonValue })
    for (const key of ['name', 'visible', 'locked'] as const) if (patch[key] !== undefined)
      edits.push({ type: 'instance.patch', instanceId, patch: { [key]: patch[key] } as Extract<ComponentEdit, { type: 'instance.patch' }>['patch'] })
    return edits
  }
  return {
    updateNode(instanceId: string, patch: Record<string, unknown>) {
      const edits = updates(instanceId, patch)
      return edits.length ? slide.submit(edits) : Promise.resolve()
    },
    updateNodes(nodes: ReadonlyArray<{ nodeId: string; patch: Record<string, unknown> }>) {
      const edits = nodes.flatMap(({ nodeId, patch }) => updates(nodeId, patch))
      return edits.length ? slide.submit(edits) : Promise.resolve()
    },
    selectNode(instanceId: string | null, additive = false) {
      const view = kernel.readView(), ids = instanceId === null ? [] : additive
        ? [...new Set([...view.selectedInstanceIds, instanceId])] : [instanceId]
      kernel.selectInstances(ids)
    },
  }
}
