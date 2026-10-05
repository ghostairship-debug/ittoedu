import type { z } from 'zod'
import type { DocumentModel } from '../../shared/workbench/document'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import type { objectUpdatePropertiesInputSchema } from './toolSchemas'
import { courseInstanceContext, type CourseInstanceTarget } from './ToolTargets'

/** Selected instance properties use the same public operations as the inspector. */
export function courseInstancePropertyEdits(model: DocumentModel, target: CourseInstanceTarget,
  properties: z.infer<typeof objectUpdatePropertiesInputSchema>): ComponentEdit[] {
  if (target.dataPath || target.from !== undefined || target.to !== undefined) throw new Error('属性修改需要整对象授权，所选文字仅可替换正文')
  const { instance } = courseInstanceContext(model, target)
  if (instance.locked && Object.keys(properties).some(key => key !== 'locked')) throw new Error('所选对象已锁定，请先解锁')
  const edits: ComponentEdit[] = []
  if (properties.frame || properties.rotation !== undefined) {
    if (!instance.frame) throw new Error('当前正文对象没有自由布局 frame')
    const frame = structuredClone(instance.frame), patch = properties.frame
    if (patch?.width !== undefined) frame.width = patch.width
    if (patch?.height !== undefined) frame.height = patch.height
    if (patch?.x !== undefined) frame.transform[4] = patch.x
    if (patch?.y !== undefined) frame.transform[5] = patch.y
    if (properties.rotation !== undefined) {
      const delta = properties.rotation * Math.PI / 180 - Math.atan2(frame.transform[1], frame.transform[0])
      const c = Math.cos(delta), s = Math.sin(delta), [a, b, x, d] = frame.transform
      frame.transform.splice(0, 4, c * a - s * b, s * a + c * b, c * x - s * d, s * x + c * d)
    }
    edits.push({ type: 'frame.set', instanceId: instance.id, frame })
  }
  if (properties.data !== undefined) edits.push({ type: 'data.set', instanceId: instance.id, path: [], value: properties.data })
  if (properties.style !== undefined) edits.push({ type: 'style.set', instanceId: instance.id, path: [], value: properties.style })
  if (properties.opacity !== undefined) edits.push({ type: 'style.set', instanceId: instance.id, path: ['opacity'], value: properties.opacity })
  const patch = { ...(properties.visible !== undefined ? { visible: properties.visible } : {}),
    ...(properties.locked !== undefined ? { locked: properties.locked } : {}), ...(properties.label !== undefined ? { name: properties.label } : {}) }
  if (Object.keys(patch).length) edits.push({ type: 'instance.patch', instanceId: instance.id, patch })
  if (properties.implementation !== undefined) edits.push({ type: 'implementation.set', instanceId: instance.id, implementation: properties.implementation })
  return edits
}
